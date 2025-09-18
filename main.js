import * as THREE from 'three';
import { scene, camera, renderer, resizeRenderer, createLights } from './scene.js';
import { createBear, updateBear, BEAR_X_LIMIT } from './entities/bear.js';
import { createScenery } from './entities/scenery.js';
import { createWaterfall, updateWaterfall } from './entities/waterfall.js';
import { createFish, updateFish, isFishPastLog } from './entities/fish.js';
import { initAudio, playSFX, sounds, wireAudioUnlock } from './systems/audio.js';
import { bindUI, updateUIValues, showGameOver, showHUD, showStart, populateUnlocks } from './systems/ui.js';
import { BEARS, FISH, getPlayerProgress, savePlayerProgress } from './unlocks.js';

// --- GAME OBJECTS (refactored) ---
let bear = null;
let showcaseBear = null; // added
let showcaseFish = null; // added
const scenery = createScenery();
scene.add(scenery);
const waterfall = createWaterfall();
scene.add(waterfall);

// ensure lighting is present for Lambert materials
createLights(scene);

let activeFish = null;
let activeFishes = [];
let spawnTimer = 0;
const maxConcurrent = 3;
let currentPattern = null;
let patternStep = 0;

function* diagonalPattern(dir = 'right', steps = 7, minX = -3, maxX = 3) {
    const inc = (maxX - minX) / (steps - 1);
    for (let i = 0; i < steps; i++) yield dir === 'right' ? (minX + i * inc) : (maxX - i * inc);
}
function* wavePattern(cycles = 2, samples = 12, amp = 3) {
    for (let i = 0; i < cycles * samples; i++) yield Math.sin((i / samples) * Math.PI * 2) * amp * 0.9;
}
function nextPattern() {
    const stairs = (dir='right') => {
        const xs = [-3,-2,-1,0,1,2,3];
        return xs.map((v,i)=>({ x: dir==='right'?xs[i]:xs[xs.length-1-i], delay: 18, move: 'zigzag' }));
    };
    const sine = () => {
        const steps = 10, amp = 3;
        return Array.from({length: steps}, (_,i)=>({ x: Math.sin((i/steps)*Math.PI*2)*amp, delay: 12, move: 'sine' }));
    };
    const lanes = () => {
        const seq = [-2,0,2,-2,0,2];
        return seq.map(x=>({ x, delay: 15, move: 'drift' }));
    };
    const choices = [ () => stairs('right'), () => stairs('left'), sine, lanes ];
    currentPattern = { steps: choices[Math.floor(Math.random()*choices.length)]() };
    patternStep = 0; spawnTimer = 0;
}

// --- UI & STATE (refactored) ---
const {
  startScreen, gameOverScreen, scoreContainer, streakContainer,
  scoreEl, streakEl, finalScoreEl, startButton, restartButton
} = bindUI();

let playerProgress = getPlayerProgress();
let gameState = { current: 'IDLE', score: 0, streak: 1 };

function refreshShowcase() {
    if (showcaseBear) { scene.remove(showcaseBear); showcaseBear = null; }
    if (showcaseFish) { scene.remove(showcaseFish); showcaseFish = null; }
    // Bear showcase
    showcaseBear = createBear(playerProgress.selectedBear);
    showcaseBear.name = 'showcase-bear';
    showcaseBear.position.set(-1.8, 4, 3);
    showcaseBear.rotation.set(0, Math.PI * 0.9, 0);
    scene.add(showcaseBear);
    // Fish showcase
    showcaseFish = createFish(scene, 0, playerProgress.selectedFish);
    showcaseFish.name = 'showcase-fish';
    showcaseFish.position.set(2.0, 2.3, -1.5);
    if (showcaseFish.userData?.velocity) showcaseFish.userData.velocity.set(0, 0, 0);
    if (showcaseFish.userData) showcaseFish.userData.swimAmplitude = 0;
}

function setupStartScreen() {
    gameState.current = 'IDLE';
    if(bear) bear.visible = false;
    if(activeFish) scene.remove(activeFish);
    activeFish = null;
    populateUnlocks(playerProgress, (type, id) => {
        if (type === 'bear') playerProgress.selectedBear = id;
        if (type === 'fish') playerProgress.selectedFish = id;
        savePlayerProgress(playerProgress);
        populateUnlocks(playerProgress, () => {});
        refreshShowcase(); // update 3D showcase to reflect new selection
    });
    refreshShowcase();
    showStart();
}
setupStartScreen();

startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);
wireAudioUnlock(initAudio);

function getFishToSpawn() {
    const selectedFishInfo = FISH.find(f => f.id === playerProgress.selectedFish) || FISH[0];
    const availableFish = FISH.filter(f => 
        playerProgress.unlockedFish.includes(f.id) && f.difficulty <= selectedFishInfo.difficulty
    );
    return (availableFish[Math.floor(Math.random() * availableFish.length)]) || FISH[0];
}

function startGame() {
    gameState = { current: 'PLAYING', score: 0, streak: 1 };
    if (showcaseBear) { scene.remove(showcaseBear); showcaseBear = null; }
    if (showcaseFish) { scene.remove(showcaseFish); showcaseFish = null; }
    
    if (bear) scene.remove(bear);
    bear = createBear(playerProgress.selectedBear);
    scene.add(bear);

    bear.position.set(0, 4, 4);
    bear.rotation.set(0, Math.PI, 0);
    updateUIValues({ score: gameState.score, streak: gameState.streak });
    showHUD();
    try { initAudio(); } catch (e) { /* ignore */ }
    
    if (activeFish) scene.remove(activeFish);
    activeFish = null;
    activeFishes.forEach(f => scene.remove(f));
    activeFishes = [];
    spawnTimer = 0; currentPattern = null; patternStep = 0;
}

function gameOver() {
    gameState.current = 'GAME_OVER';
    finalScoreEl.innerText = gameState.score;
    
    // Update high score and check for unlocks
    if (gameState.score > playerProgress.highScore) {
        playerProgress.highScore = gameState.score;
    }
    let newUnlock = false;
    BEARS.forEach(bear => {
        if (!playerProgress.unlockedBears.includes(bear.id) && bear.unlockCondition.type === 'score' && playerProgress.highScore >= bear.unlockCondition.value) {
            playerProgress.unlockedBears.push(bear.id);
            newUnlock = true;
        }
    });
    FISH.forEach(fish => {
        if (!playerProgress.unlockedFish.includes(fish.id) && fish.unlockCondition.type === 'score' && playerProgress.highScore >= fish.unlockCondition.value) {
            playerProgress.unlockedFish.push(fish.id);
            newUnlock = true;
        }
    });

    if (newUnlock) {
        // TODO: Show a small notification for new unlocks
    }
    savePlayerProgress(playerProgress);

    showGameOver();
    playSFX(sounds.splash);
    activeFishes.forEach(f => scene.remove(f));
    activeFishes = [];
}

// --- CONTROLS (kept local for simplicity) ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let keysPressed = {};
let isDragging = false; // Simplified from previous lastTouchX logic

function onPointerDown(event) {
    if (gameState.current !== 'PLAYING' || event.target.tagName === 'BUTTON') return;
    isDragging = true;
    onPointerMove(event); // Call move immediately to handle taps
}

function onPointerMove(event) {
    if (!isDragging || gameState.current !== 'PLAYING') return;

    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (const intersect of intersects) {
        let object = intersect.object;
        let isLog = false;
        let isFish = false;

        while (object.parent) {
            if (object.name === 'fish') {
                isFish = true;
                break;
            }
            if (object.name === 'log') {
                isLog = true;
                break;
            }
            object = object.parent;
        }

        // Catch fish on tap/click - this logic now lives in onPointerUp
        if (isFish && object === activeFish) {
            // No action on drag-over, only on pointer up
            continue; 
        }

        if (isLog) {
            bear.userData.targetX = THREE.MathUtils.clamp(intersect.point.x, -BEAR_X_LIMIT, BEAR_X_LIMIT);
            bear.userData.isMovingWithKeys = false;
            break; // Stop after finding the log
        }
    }
}

function onPointerUp(event) {
    if (gameState.current !== 'PLAYING') {
        isDragging = false;
        return;
    }
    // remove tap-to-catch; catching is now timing/position based with the net
    isDragging = false;
}

function updatePointer(event) {
    // Handle both mouse and touch events
    const eventCoord = event.changedTouches ? event.changedTouches[0] : event;
    pointer.x = (eventCoord.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(eventCoord.clientY / window.innerHeight) * 2 + 1;
}

function handleKeyDown(event) {
    if (gameState.current !== 'PLAYING') return;
    keysPressed[event.key] = true;
    if (event.key === 'a' || event.key === 'ArrowLeft' || event.key === 'd' || event.key === 'ArrowRight') {
        bear.userData.isMovingWithKeys = true;
    }
}

function handleKeyUp(event) {
    keysPressed[event.key] = false;
    if (event.key === 'a' || event.key === 'ArrowLeft' || event.key === 'd' || event.key === 'ArrowRight') {
        // Only stop if no other movement key is pressed.
        if (!keysPressed['a'] && !keysPressed['ArrowLeft'] && !keysPressed['d'] && !keysPressed['ArrowRight']) {
            bear.userData.isMovingWithKeys = false;
        }
    }
}

window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// mount renderer and handle sizing
import { mountRenderer } from './scene.js';
mountRenderer(document.getElementById('game-container'));
window.addEventListener('resize', resizeRenderer);

// --- GAME LOOP (trimmed) ---
const gravity = new THREE.Vector3(0, -0.05, 0);

function animate() {
    requestAnimationFrame(animate); // Ensure continuous rendering
    updateWaterfall(waterfall);
    if (gameState.current === 'PLAYING') {
        if (!bear) { // Added guard in case something goes wrong
            renderer.render(scene, camera);
            return;
        };
        // Bear movement
        let moveDirection = 0;
        if (keysPressed['a'] || keysPressed['ArrowLeft']) moveDirection = -1;
        else if (keysPressed['d'] || keysPressed['ArrowRight']) moveDirection = 1;
        updateBear(bear, moveDirection);
        // Fish
        // Spawn logic with patterns
        if (!currentPattern) nextPattern();
        if (spawnTimer-- <= 0 && activeFishes.length < maxConcurrent) {
            const step = currentPattern.steps[patternStep];
            const fishInfo = getFishToSpawn();
            const f = createFish(scene, gameState.score, fishInfo.id, { x: step.x, pattern: step.move });
            activeFishes.push(f);
            spawnTimer = step.delay;
            patternStep++;
            if (patternStep >= currentPattern.steps.length) {
                currentPattern = null;
                spawnTimer = 45; // gap between sequences
            }
        }
        // Update and resolve fishes
        const catchZ = 3.2, failZ = 3.6;
        for (let i = activeFishes.length - 1; i >= 0; i--) {
            const f = activeFishes[i];
            updateFish(f);
            if (f.position.z >= catchZ) {
                const withinX = Math.abs(f.position.x - bear.position.x) <= (bear.userData.netWidth || 1) / 2;
                if (withinX) {
                    playSFX(sounds.catch);
                    gameState.score += 10 * gameState.streak;
                    gameState.streak++;
                    updateUIValues({ score: gameState.score, streak: gameState.streak });
                    scene.remove(f); activeFishes.splice(i,1);
                } else if (f.position.z > failZ) {
                    gameState.streak = 1;
                    updateUIValues({ score: gameState.score, streak: gameState.streak });
                    scene.remove(f); activeFishes.splice(i,1);
                    gameOver(); break;
                }
            }
        }
    } else if (gameState.current === 'GAME_OVER') {
        if (bear && bear.position.y > -10) {
            bear.position.add(gravity);
            bear.rotation.z += 0.05;
        }
    } else { // IDLE (title screen)
        // Handled by setupStartScreen
    }
    renderer.render(scene, camera);
}

// Start the animation loop
animate();