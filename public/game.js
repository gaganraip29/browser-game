// --- START OF FILE game.js ---

// <<< ADD THIS AT THE TOP >>>
import { loadMap, maps } from './mapLoader.js'; // Import the loader

// Ensure THREE is loaded
if (typeof THREE === 'undefined') {
    console.error("THREE.js library not loaded correctly!");
}
// Ensure io is loaded
if (typeof io === 'undefined') {
     console.error("Socket.IO client library not loaded correctly! Make sure server is running and serving it.");
}

// Game configuration (can be received from server later if needed)
const config = { // config can be const as its properties aren't reassigned wholesale
    movementSpeed: 20, // Units per second
    jumpForce: 20,    // Initial upward velocity
    gravity: -25,    // Units per second squared
    bulletSpeed: 80, // Units per second
    bulletLifetime: 2, // Seconds
    maxHealth: 300,
    respawnTime: 3000, // milliseconds
    ammoCapacity: 30,
    reloadTime: 2000, // milliseconds
    maxAmmoReserve: 90,
    playerHeight: 4.8, // Total height of the player model/collision shape
    playerRadius: 2.5, // Radius for collision/visuals
    playerEyeLevel: 4.0, // Camera height relative to the player's *base* (feet)
    touchLookSensitivity: 0.008, // Sensitivity for touch screen look
    joystickDeadzone: 0.1, // Ignore small movements near joystick center
    touchShootCooldown: 200, // ms between shots for touch
};

// Game state (local player) - **MUST BE LET**
let gameState = {
    playerName: '',
    health: config.maxHealth,
    score: 0,
    ammo: config.ammoCapacity,
    ammoReserve: config.maxAmmoReserve,
    isReloading: false,
    isAlive: true,
    respawning: false,
    canShoot: true, // Cooldown for shooting (used by both mouse/touch)
};

// DOM Elements - These can be const as the elements themselves don't change
const menuElement = document.getElementById('menu');
const playButton = document.getElementById('play-button'); // Ensure ID matches HTML
const playerNameInput = document.getElementById('player-name');
// <<< ADD THIS >>>
const mapOptionsContainer = document.querySelector('#map-selection .map-options'); // Get the button container

const uiElement = document.getElementById('ui');
const crosshairElement = document.getElementById('crosshair');
const scoreElement = document.getElementById('score');
const healthElement = document.getElementById('health');
const healthBarElement = document.getElementById('health-bar');
const ammoElement = document.getElementById('ammo');
const killFeedElement = document.getElementById('kill-feed');
const touchControlsElement = document.getElementById('touch-controls');
const joystickElement = document.getElementById('touch-joystick');
const joystickHandleElement = document.getElementById('touch-joystick-handle');
const shootButtonElement = document.getElementById('touch-shoot-button');
const jumpButtonElement = document.getElementById('touch-jump-button');
const reloadButtonElement = document.getElementById('touch-reload-button');

// Three.js related variables - Use let for things that might be reassigned
let scene, camera, renderer, clock;
// let ground; // <<< REMOVE THIS - ground is now part of map objects
let playerMesh; // Local player's visual representation (THREE.Group)
let playerVelocity = new THREE.Vector3(); // For physics simulation
let isOnGround = false;
let animationFrameId = null; // <--- DECLARED GLOBALLY HERE (Using let)
// <<< ADD THIS >>>
let currentMapObjects = []; // Array to hold meshes loaded by mapLoader
let ambientLight, directionalLight, hemisphereLight; // <<< Make lights globally accessible in this file

// <<< ADD THIS FOR MAP SELECTION STATE >>>
let selectedMapName = 'forest'; // Default map selection

// Multiplayer related variables - Use let for things that might be reassigned
let players = {};   // Stores remote players { id: { mesh, name, health, ... } }
let bullets = {};   // Stores active bullets { id: { mesh, velocity, ownerId } }
let socket;         // Socket.IO connection
let socketId;       // This client's unique ID from the server

// Input state - Use let if reassigned (like keysPressed object), otherwise const
const keysPressed = {}; // Can be const if only properties change
let isPointerLocked = false;

// --- Touch Input State --- Use let for objects whose properties change
let joystickData = {
    active: false,
    touchId: null,
    startPos: { x: 0, y: 0 },
    currentPos: { x: 0, y: 0 },
    vector: { x: 0, y: 0 } // Normalized vector for movement (-1 to 1)
};
let lookData = {
    active: false,
    touchId: null,
    lastPos: { x: 0, y: 0 }
};
let touchState = {
    shoot: false,
    jump: false,
};

// --- Initialization ---

function init() {
    setupScene();
    // <<< MODIFY: Setup lights *before* map selection UI >>>
    setupLighting();
    // <<< REMOVE initial map load here >>>
    // loadSelectedMap('forest');
    setupMapSelectionUI(); // <<< ADD call to setup map buttons
    setupEventListeners(); // Sets up keyboard/mouse AND touch
    connectToServer();
}

function setupScene() {
    scene = new THREE.Scene();
    // <<< REMOVE background color here - mapLoader will set it >>>
    // scene.background = new THREE.Color(0x87CEEB); // Sky blue

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Camera position will be set relative to the player mesh later

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    // Adjust shadow map type for potentially better quality/performance balance
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    document.body.appendChild(renderer.domElement);

    clock = new THREE.Clock();
}

function setupLighting() {
    // <<< Assign lights to the module-scoped variables >>>
    ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Initial intensity
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Initial intensity
    directionalLight.position.set(50, 100, 75);
    directionalLight.castShadow = true;
    // Increase shadow map resolution for sharper shadows
    directionalLight.shadow.mapSize.width = 2048; // Default 512
    directionalLight.shadow.mapSize.height = 2048; // Default 512
    // Adjust shadow camera frustum to better fit the scene bounds (adjust if map size changes)
    const shadowCamSize = 100; // Half-width/height of the shadow area
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 250; // Should encompass the map + player height
    directionalLight.shadow.camera.left = -shadowCamSize;
    directionalLight.shadow.camera.right = shadowCamSize;
    directionalLight.shadow.camera.top = shadowCamSize;
    directionalLight.shadow.camera.bottom = -shadowCamSize;
    directionalLight.shadow.bias = -0.0005; // Helps prevent shadow acne
    scene.add(directionalLight);
    // Optional: Add a helper to visualize the shadow camera
    // const shadowCamHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
    // scene.add(shadowCamHelper);

    hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x4CAF50, 0.3); // Initial colors/intensity
    scene.add(hemisphereLight);
}

// <<< ADD THIS FUNCTION >>>
/** Populates the map selection buttons in the menu */
function setupMapSelectionUI() {
    if (!mapOptionsContainer) {
        // Don't log error here, menu might not exist if user modified HTML heavily
        // console.error("Map options container not found!");
        return;
    }
    mapOptionsContainer.innerHTML = ''; // Clear any existing buttons

    // Iterate over the maps available in mapLoader.js
    for (const mapKey in maps) {
        if (Object.hasOwnProperty.call(maps, mapKey)) {
            const mapConfig = maps[mapKey];
            const button = document.createElement('button');
            button.classList.add('map-option-button');
            button.dataset.map = mapKey; // Store map key in data attribute
            button.textContent = mapConfig.name || mapKey; // Use descriptive name or key

            // Set the 'active' class on the default selected map
            if (mapKey === selectedMapName) {
                button.classList.add('active');
            }

            // Add event listener for selection
            button.addEventListener('click', handleMapSelection);

            mapOptionsContainer.appendChild(button);
        }
    }
}

// <<< ADD THIS FUNCTION >>>
/** Handles clicking on a map selection button */
function handleMapSelection(event) {
    const clickedButton = event.target;
    const mapKey = clickedButton.dataset.map;

    if (mapKey && maps[mapKey]) { // Check if valid map key
        selectedMapName = mapKey; // Update the selected map state
        console.log(`Selected map: ${selectedMapName}`);

        // Update visual state (remove active from others, add to clicked)
        const allButtons = mapOptionsContainer.querySelectorAll('.map-option-button');
        allButtons.forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
    } else {
        console.warn(`Invalid map key selected: ${mapKey}`);
    }
}


// <<< Modify loadSelectedMap >>>
/** Loads the specified map, cleaning up the previous one */
function loadSelectedMap(mapName) {
    // 1. Clean up previous map objects
    // console.log(`[MapLoad] Clearing ${currentMapObjects.length} old map objects.`); // Optional logging
    currentMapObjects.forEach(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            } else {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        }
        scene.remove(obj);
    });
    currentMapObjects = []; // Clear the array

    // 2. Load the new map using the imported function
    console.log(`[MapLoad] Loading map: ${mapName}`);
    // Check if map exists before loading
    if (!maps[mapName]) {
         console.error(`Attempted to load non-existent map: ${mapName}. Loading default 'forest'.`);
         mapName = 'forest'; // Fallback to default
         selectedMapName = 'forest'; // Update state variable too
         // Optionally update UI selection visually here if needed
         if (mapOptionsContainer) { // Check if container exists before trying to update UI
             const allButtons = mapOptionsContainer.querySelectorAll('.map-option-button');
             allButtons.forEach(btn => {
                 btn.classList.toggle('active', btn.dataset.map === selectedMapName);
             });
         }
    }
    currentMapObjects = loadMap(mapName, scene, ambientLight, directionalLight, hemisphereLight);
     // Add map name to terrain userData for potential future reference
    if (currentMapObjects.length > 0 && currentMapObjects[0].userData.isGround) {
        currentMapObjects[0].userData.mapName = mapName;
    }


    // 3. Optional: Reset player position or perform other map-specific setup
    if (playerMesh) {
         // Reset position to a default spawn point (adjust Y based on height)
         const initialY = 0; // Player base at Y=0
         playerMesh.position.set(0, initialY, 5);
         playerVelocity.set(0,0,0); // Reset velocity on map change
         isOnGround = false; // Force ground check on next frame
         console.log("[MapLoad] Reset player position.");
    }
     // You might want to inform the server about the map change if it affects gameplay logic
     // socket.emit('map-selected', mapName); // Example
}


function setupEventListeners() {
    // --- Menu ---
    playButton.addEventListener('click', joinGame);
    playerNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinGame(); });

    // --- Map Selection Buttons (Listeners are added in setupMapSelectionUI) ---

    // --- Window Resize ---
    window.addEventListener('resize', onWindowResize);

    // --- Keyboard/Mouse Controls (Desktop) ---
    document.addEventListener('pointerlockchange', handlePointerLockChange, false);
    document.addEventListener('click', handleDesktopClick); // Separate handler
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', onMouseMove);

    // --- Touch Controls (Mobile) ---
    if (joystickElement) { // Add checks in case elements don't exist
        joystickElement.addEventListener('touchstart', handleJoystickStart, { passive: false });
        joystickElement.addEventListener('touchmove', handleJoystickMove, { passive: false });
        joystickElement.addEventListener('touchend', handleJoystickEnd, { passive: false });
        joystickElement.addEventListener('touchcancel', handleJoystickEnd, { passive: false });
    }
    if (shootButtonElement) {
        shootButtonElement.addEventListener('touchstart', handleShootButtonStart, { passive: false });
        shootButtonElement.addEventListener('touchend', handleShootButtonEnd, { passive: false });
        shootButtonElement.addEventListener('touchcancel', handleShootButtonEnd, { passive: false });
    }
    if (jumpButtonElement) {
        jumpButtonElement.addEventListener('touchstart', handleJumpButtonStart, { passive: false });
        jumpButtonElement.addEventListener('touchend', handleJumpButtonEnd, { passive: false });
        jumpButtonElement.addEventListener('touchcancel', handleJumpButtonEnd, { passive: false });
    }
    if (reloadButtonElement) {
        reloadButtonElement.addEventListener('touchstart', handleReloadButtonStart, { passive: false });
    }

    // Use the canvas element for look controls to avoid conflicts
    if (renderer && renderer.domElement) {
        renderer.domElement.addEventListener('touchstart', handleLookStart, { passive: false });
        renderer.domElement.addEventListener('touchmove', handleLookMove, { passive: false });
        renderer.domElement.addEventListener('touchend', handleLookEnd, { passive: false });
        renderer.domElement.addEventListener('touchcancel', handleLookEnd, { passive: false });
    }
}

// --- Touch Event Handlers ---
function handleJoystickStart(event) {
    event.preventDefault();
    if (lookData.active && lookData.touchId !== null) {
        lookData.active = false; lookData.touchId = null;
    }
    if (!joystickData.active) {
        const touch = event.changedTouches[0];
        joystickData.active = true;
        joystickData.touchId = touch.identifier;
        const rect = joystickElement.getBoundingClientRect();
        joystickData.startPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        joystickData.currentPos = { x: touch.clientX, y: touch.clientY };
        updateJoystickVisuals();
    }
}

function handleJoystickMove(event) {
    event.preventDefault();
    if (joystickData.active) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            if (touch.identifier === joystickData.touchId) {
                joystickData.currentPos = { x: touch.clientX, y: touch.clientY };
                updateJoystickVisuals(); break;
            }
        }
    }
}

function handleJoystickEnd(event) {
    event.preventDefault();
    if (joystickData.active) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            if (touch.identifier === joystickData.touchId) {
                joystickData.active = false; joystickData.touchId = null;
                joystickData.vector = { x: 0, y: 0 };
                if (joystickHandleElement) joystickHandleElement.style.transform = `translate(-50%, -50%)`;
                break;
            }
        }
    }
}

function updateJoystickVisuals() {
    if (!joystickElement || !joystickHandleElement) return; // Add checks
    const dx = joystickData.currentPos.x - joystickData.startPos.x;
    const dy = joystickData.currentPos.y - joystickData.startPos.y;
    let distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = joystickElement.offsetWidth / 2;
    const handleRadius = joystickHandleElement.offsetWidth / 2;
    const clampedDistance = Math.min(distance, maxDistance - handleRadius);
    const angle = Math.atan2(dy, dx);
    const handleX = Math.cos(angle) * clampedDistance;
    const handleY = Math.sin(angle) * clampedDistance;
    joystickHandleElement.style.transform = `translate(calc(-50% + ${handleX}px), calc(-50% + ${handleY}px))`;
    const effectiveRadius = maxDistance - handleRadius;
    if (distance > joystickElement.offsetWidth * config.joystickDeadzone && effectiveRadius > 0) {
         joystickData.vector.x = Math.cos(angle) * (clampedDistance / effectiveRadius);
         joystickData.vector.y = -Math.sin(angle) * (clampedDistance / effectiveRadius);
    } else {
         joystickData.vector.x = 0; joystickData.vector.y = 0;
    }
}


function handleShootButtonStart(event) { event.preventDefault(); touchState.shoot = true; if(shootButtonElement) shootButtonElement.classList.add('active'); }
function handleShootButtonEnd(event) { event.preventDefault(); touchState.shoot = false; if(shootButtonElement) shootButtonElement.classList.remove('active'); }

function handleJumpButtonStart(event) { event.preventDefault(); if (gameState.isAlive) { touchState.jump = true; if(jumpButtonElement) jumpButtonElement.classList.add('active');} }
function handleJumpButtonEnd(event) { event.preventDefault(); if(jumpButtonElement) jumpButtonElement.classList.remove('active'); }

function handleReloadButtonStart(event) {
    event.preventDefault();
    if(reloadButtonElement) reloadButtonElement.classList.add('active');
    reload();
    setTimeout(() => { if(reloadButtonElement) reloadButtonElement.classList.remove('active'); }, 150);
}

function handleLookStart(event) {
     if (event.target === renderer.domElement && !lookData.active) {
         if (joystickData.active && joystickData.touchId !== null && event.changedTouches[0].identifier === joystickData.touchId) {
             return;
         }
         event.preventDefault();
         const touch = event.changedTouches[0];
         lookData.active = true;
         lookData.touchId = touch.identifier;
         lookData.lastPos = { x: touch.clientX, y: touch.clientY };
     }
}

function handleLookMove(event) {
    if (lookData.active) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            if (touch.identifier === lookData.touchId) {
                if (event.target !== renderer.domElement) { /* Optional: handle slide off */ }
                event.preventDefault();
                const currentPos = { x: touch.clientX, y: touch.clientY };
                const deltaX = currentPos.x - lookData.lastPos.x;
                const deltaY = currentPos.y - lookData.lastPos.y;
                if (gameState.isAlive) { rotateCamera(deltaX, deltaY, config.touchLookSensitivity); }
                lookData.lastPos = currentPos;
                break;
            }
        }
    }
}

function handleLookEnd(event) {
    if (lookData.active) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            if (touch.identifier === lookData.touchId) {
                 lookData.active = false; lookData.touchId = null; break;
            }
        }
    }
}

// --- Keyboard/Mouse Event Handlers ---
function handleDesktopClick() {
    if (!document.body.classList.contains('game-active')) return;
    if (!isPointerLocked) {
         if (!('ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0)) {
              if(renderer && renderer.domElement) renderer.domElement.requestPointerLock();
         }
    } else {
        if (gameState.isAlive && !gameState.respawning && !gameState.isReloading && gameState.canShoot) {
             shootBullet();
        } else if (gameState.ammo <= 0 && !gameState.isReloading && gameState.ammoReserve > 0) {
            reload();
        }
    }
}

function handleKeyDown(event) {
     if (!isPointerLocked && !document.body.classList.contains('game-active')) return;
     const key = event.key.toLowerCase();
     keysPressed[key] = true;
     if (key === 'r' && !gameState.isReloading && gameState.ammo < config.ammoCapacity && gameState.ammoReserve > 0 && gameState.isAlive) {
         reload();
     }
}
function handleKeyUp(event) { keysPressed[event.key.toLowerCase()] = false; }

function onMouseMove(event) {
    if (!isPointerLocked || !gameState.isAlive) return;
    rotateCamera(event.movementX, event.movementY, 0.002);
}

function rotateCamera(deltaX, deltaY, sensitivity) {
    if (!playerMesh) return;
    playerMesh.rotation.y -= deltaX * sensitivity;
    if (camera) { // Add check for camera
        camera.rotation.x -= deltaY * sensitivity;
        const maxAngle = Math.PI / 2 - 0.1;
        camera.rotation.x = Math.max(-maxAngle, Math.min(maxAngle, camera.rotation.x));
    }
}

function handlePointerLockChange() {
    isPointerLocked = document.pointerLockElement === renderer?.domElement; // Check against renderer element
    if(crosshairElement) crosshairElement.style.display = (document.body.classList.contains('game-active') && isPointerLocked) ? 'block' : 'none';
    if (!isPointerLocked) {
        keysPressed['w'] = false; keysPressed['a'] = false;
        keysPressed['s'] = false; keysPressed['d'] = false;
        keysPressed[' '] = false;
    }
}

function onWindowResize() {
    if (camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }
    if (renderer) {
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// --- Multiplayer Connection and Game Logic ---
function connectToServer() {
    try {
        socket = io();
    } catch (e) {
        console.error("Failed to initialize Socket.IO:", e);
        alert("Could not initialize connection. Is the server running and serving the client library?");
        return; // Stop if socket cannot be initialized
    }


    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        socketId = socket.id;
    });
    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        alert('Lost connection to the server.');
        resetGame();
    });
    socket.on('connect_error', (err) => {
        console.error('Connection Error:', err.message);
        if (!document.body.classList.contains('game-active')) {
             alert('Could not connect to the server. Please ensure it is running and refresh.');
        }
        resetGame();
    });

    socket.on('game-state', (serverState) => {
        // console.log('[DEBUG] Received game-state.');
        if (!serverState) { console.warn("Received empty game-state"); return; }

        if (serverState.mapName && maps[serverState.mapName]) {
            let currentMapName = '';
            if (currentMapObjects.length > 0 && currentMapObjects[0]?.userData?.mapName) { // Safer access
                 currentMapName = currentMapObjects[0].userData.mapName;
            }
            if (currentMapName !== serverState.mapName) {
                 console.log(`[Server] Changing map to ${serverState.mapName}`);
                 loadSelectedMap(serverState.mapName);
            }
        } else if (serverState.mapName) {
            console.warn(`Server specified unknown map: ${serverState.mapName}`);
        }

        const serverPlayers = serverState.players || {};
        // console.log(`[DEBUG] Player Count in state: ${Object.keys(serverPlayers).length}`);
        const receivedPlayerIds = new Set(Object.keys(serverPlayers));

        for (const id in serverPlayers) {
            const playerData = serverPlayers[id];
            if (!playerData || !playerData.position) {
                 console.warn(`Received invalid data for player ${id}`, playerData); continue;
            }
            if (id === socketId) {
                if (!playerMesh) { initializeLocalPlayerMesh(); }
                if (playerMesh) {
                     gameState.health = playerData.health ?? gameState.health;
                     gameState.score = playerData.score ?? gameState.score;
                     gameState.ammo = playerData.ammo ?? gameState.ammo;
                     gameState.ammoReserve = playerData.ammoReserve ?? gameState.ammoReserve;
                     gameState.isAlive = playerData.health > 0;
                     gameState.name = playerData.name;
                     // Position correction if discrepancy is large
                     if (playerMesh.position.distanceToSquared(playerData.position) > 100) {
                         console.log("Correcting significant position discrepancy for local player.");
                         playerMesh.position.copy(playerData.position);
                         playerMesh.position.y = Math.max(playerData.position.y, 0); // Ensure base is >= 0
                         playerVelocity.set(0,0,0);
                     }
                } else { console.error("Local player mesh not ready during game-state update!"); }
            } else {
                addOrUpdateRemotePlayer(playerData);
            }
        }

        for (const existingId in players) {
            if (!receivedPlayerIds.has(existingId)) {
                 console.log(`Removing player ${existingId} not present in game-state.`);
                removePlayer(existingId);
            }
        }
        updateUI();
    });

    socket.on('player-joined', (playerData) => {
        console.log(`Player joined: ${playerData?.name || 'Unknown'} (${playerData?.id})`);
        if (playerData?.id && playerData.id !== socketId) { // Add checks
            addOrUpdateRemotePlayer(playerData);
        } else if (playerData?.id === socketId) {
             if (!playerMesh) initializeLocalPlayerMesh();
        }
    });

    socket.on('player-left', (id) => {
         console.log(`Player left: ${players[id]?.name || id}`);
        if (id && id !== socketId) { // Add check
             removePlayer(id);
        }
    });

    socket.on('player-moved', (data) => {
        if (data?.id && data.id !== socketId && players[data.id]?.mesh) { // Add checks
            const player = players[data.id];
             player.targetPosition = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
             player.targetRotationY = data.rotation.y;
             player.targetPosition.y = Math.max(player.targetPosition.y, 0); // Ensure base Y >= 0
             player.lastUpdateTime = clock?.getElapsedTime() ?? 0; // Add check for clock
        }
    });

    socket.on('bullet-fired', (bulletData) => { createBullet(bulletData); });

    socket.on('player-hit', (data) => {
          if (!data || typeof data.victimHealth === 'undefined') return;
          if (data.victimId === socketId) {
              handleLocalPlayerHit(data.victimHealth, data.attackerId);
              flashScreen(0xff0000, 150);
          } else if (players[data.victimId]) {
              players[data.victimId].health = data.victimHealth;
          }
          if (data.attackerId === socketId && data.victimId !== socketId) {
              // console.log("Hit confirmed!"); // Optional hit marker logic
          }
    });

    socket.on('player-died', (data) => {
           if (!data || !data.victimName || !data.attackerName || !data.victimId) return;
           console.log(`${data.attackerName} eliminated ${data.victimName}`);
           addKillFeedMessage(`${data.attackerName} ︻╦╤─ ${data.victimName}`);
           if (data.victimId === socketId) {
               handleLocalPlayerDeath();
           } else if (players[data.victimId]) {
                if (players[data.victimId].mesh) { players[data.victimId].mesh.visible = false; }
                players[data.victimId].health = 0;
                players[data.victimId].isAlive = false;
           }
           if (data.attackerId === socketId && typeof data.attackerScore !== 'undefined') { // Check score exists
               gameState.score = data.attackerScore;
               updateUI();
           }
    });

    socket.on('player-respawned', (data) => {
        if (!data || !data.position || !data.id) return;
             console.log(`Player respawned: ${data.id}`);
             if (data.id === socketId) {
                 handleLocalPlayerRespawn(data);
             } else {
                 addOrUpdateRemotePlayer(data);
                 if (players[data.id]?.mesh) { // Add checks
                     players[data.id].mesh.position.copy(data.position);
                     players[data.id].mesh.position.y = Math.max(data.position.y, 0); // Base Y >= 0
                     players[data.id].mesh.visible = true;
                     players[data.id].health = data.health;
                     players[data.id].isAlive = true;
                 }
             }
    });

    socket.on('reload-complete', (data) => {
           if (gameState.isReloading && data) { // Add check for data
               gameState.ammo = data.ammo;
               gameState.ammoReserve = data.ammoReserve;
               gameState.isReloading = false;
               console.log("Reload complete.");
               updateUI();
           }
    });

     socket.on('map-change', (mapName) => {
        if (mapName && maps[mapName]) { // Add check for mapName
             console.log(`[Server] Received map change command: ${mapName}`);
             loadSelectedMap(mapName);
             selectedMapName = mapName; // Update local selection state
             setupMapSelectionUI(); // Update menu UI to reflect server change
        } else {
            console.error(`Server requested unknown or invalid map: ${mapName}`);
        }
    });
}

// --- Helper Functions for Player Management ---

function addOrUpdateRemotePlayer(playerData) {
    if (!playerData?.id || !playerData.position) return;
    const id = playerData.id;
    const playerName = playerData.name || `Player_${id.substring(0, 4)}`;
    if (players[id]) {
        const player = players[id];
        player.name = playerName;
        player.health = playerData.health ?? player.health;
        player.isAlive = player.health > 0;
        if (player.mesh) {
            player.mesh.visible = player.isAlive;
            if (player.mesh.userData.nameTag && player.mesh.userData.name !== playerName) {
                 const oldTag = player.mesh.getObjectByProperty('type', 'Sprite');
                 if(oldTag) player.mesh.remove(oldTag);
                 const newNameTag = createNameTag(playerName);
                 if (newNameTag) {
                     newNameTag.position.y = config.playerHeight + 1.0;
                     player.mesh.add(newNameTag);
                     player.mesh.userData.nameTag = newNameTag;
                 }
            }
            player.mesh.userData.name = playerName;
        }
    } else {
        // console.log(`Creating mesh for new player: ${playerName} (${id})`);
        const remotePlayerMesh = createPlayerMesh(id, playerName, 0xFF4500);
        if (!remotePlayerMesh) { console.error(`Failed to create mesh for player ${id}`); return; }
        remotePlayerMesh.position.copy(playerData.position);
        remotePlayerMesh.position.y = Math.max(playerData.position.y, 0); // Base Y >= 0
        if (playerData.rotation) { remotePlayerMesh.rotation.y = playerData.rotation.y; }
        remotePlayerMesh.visible = (playerData.health ?? config.maxHealth) > 0;
        scene.add(remotePlayerMesh);
        players[id] = {
            mesh: remotePlayerMesh, name: playerName,
            health: playerData.health ?? config.maxHealth,
            isAlive: (playerData.health ?? config.maxHealth) > 0,
            targetPosition: remotePlayerMesh.position.clone(),
            targetRotationY: remotePlayerMesh.rotation.y,
            lastUpdateTime: clock?.getElapsedTime() ?? 0 // Add check for clock
        };
    }
}

function removePlayer(id) {
     if (players[id]?.mesh) { // Add check
        const mesh = players[id].mesh;
        scene.remove(mesh);
        mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                 if (Array.isArray(child.material)) {
                     child.material.forEach(m => { if(m.map) m.map.dispose(); m.dispose(); });
                 } else {
                     if (child.material.map) child.material.map.dispose();
                     child.material.dispose();
                 }
             }
        });
        // console.log(`Removed mesh for player ${id}`);
    }
    delete players[id];
}


// --- Join/Reset Game ---

function joinGame() {
    const name = playerNameInput?.value.trim().substring(0, 16) || `Player_${Math.floor(Math.random() * 1000)}`; // Add check
    gameState.playerName = name;

    // <<< LOAD THE SELECTED MAP HERE >>>
    loadSelectedMap(selectedMapName);

    initializeLocalPlayerMesh(); // Initialize AFTER map load

    if (socket && socket.connected) { // Check socket connection
        socket.emit('player-join', {
             name: gameState.playerName
             // map: selectedMapName // Optional: send map choice
        });
    } else {
        alert("Not connected to server. Cannot join game.");
        return; // Don't proceed if not connected
    }


    if(menuElement) menuElement.style.display = 'none';
    if(uiElement) uiElement.style.display = 'block';
    document.body.classList.add('game-active');

    gameState.health = config.maxHealth;
    gameState.score = 0;
    gameState.ammo = config.ammoCapacity;
    gameState.ammoReserve = config.maxAmmoReserve;
    gameState.isReloading = false;
    gameState.isAlive = true;
    gameState.respawning = false;
    gameState.canShoot = true;
    playerVelocity.set(0,0,0);

    updateUI();

    if (!animationFrameId) { animate(); }
}

function resetGame() {
     console.log("Resetting game...");
     if(menuElement) menuElement.style.display = 'block';
     if(uiElement) uiElement.style.display = 'none';
     if(crosshairElement) crosshairElement.style.display = 'none';
     document.body.classList.remove('game-active');

     if (isPointerLocked) { document.exitPointerLock(); }

     for (const id in players) { removePlayer(id); }
     players = {};

     for (const id in bullets) {
         if (bullets[id]?.mesh) { // Add check
             if(bullets[id].mesh.geometry) bullets[id].mesh.geometry.dispose();
             if(bullets[id].mesh.material) bullets[id].mesh.material.dispose();
             scene.remove(bullets[id].mesh);
         }
     }
     bullets = {};

     if (playerMesh) {
         scene.remove(playerMesh);
         playerMesh.traverse(child => {
             if (child.geometry) child.geometry.dispose();
             if (child.material) {
                 if (Array.isArray(child.material)) {
                     child.material.forEach(m => { if(m.map) m.map.dispose(); m.dispose(); });
                 } else if(child.material.dispose) {
                     if (child.material.map) child.material.map.dispose();
                     child.material.dispose();
                 }
             }
         });
         playerMesh = null;
     }

     currentMapObjects.forEach(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
             if (Array.isArray(obj.material)) { obj.material.forEach(m => { if(m.map) m.map.dispose(); m.dispose(); }); }
             else { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
        }
        scene.remove(obj);
    });
    currentMapObjects = [];

    // <<< Reset map selection state and UI >>>
    selectedMapName = 'forest';
    setupMapSelectionUI(); // Update menu UI

    gameState.playerName= '';
    gameState.health = config.maxHealth;
    gameState.score = 0;
    gameState.ammo = config.ammoCapacity;
    gameState.ammoReserve = config.maxAmmoReserve;
    gameState.isReloading = false;
    gameState.isAlive = true;
    gameState.respawning = false;
    gameState.canShoot= true;

    socketId = null;
    isPointerLocked = false;
    for (const key in keysPressed) { delete keysPressed[key]; }
    joystickData = { active: false, touchId: null, startPos: {x:0,y:0}, currentPos: {x:0,y:0}, vector: {x:0,y:0} };
    lookData = { active: false, touchId: null, lastPos: {x:0,y:0} };
    touchState = { shoot: false, jump: false };
    playerVelocity.set(0, 0, 0);

    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    console.log("Game reset complete.");
}
// --- Player Creation ---
function initializeLocalPlayerMesh() {
    if (!playerMesh) {
         console.log("Initializing local player mesh...");
         playerMesh = createPlayerMesh(socketId, gameState.playerName || "Player", 0x1E90FF);
         if (!playerMesh) { console.error("!!! Failed to create local player mesh!"); return; }
         const initialY = 0;
         playerMesh.position.set(0, initialY, 5);
         scene.add(playerMesh);

         if (camera) { // Add check for camera
            camera.position.set(0, config.playerEyeLevel, 0);
            camera.rotation.set(0, 0, 0);
            playerMesh.add(camera);
            console.log("Local player mesh created and camera attached.");
         } else {
             console.error("!!! Camera not initialized before player mesh!");
         }

     } else {
         const currentY = playerMesh.position.y;
         const minY = 0;
         playerMesh.position.y = Math.max(currentY, minY);
         playerMesh.visible = true;
     }
}

function createPlayerMesh(id, name, color) {
    try {
        const group = new THREE.Group();
        group.userData = { id: id, name: name, isPlayer: true };
        const playerBodyHeight = config.playerHeight;
        const playerBodyRadius = config.playerRadius;
        const bodyGeometry = new THREE.CylinderGeometry(playerBodyRadius, playerBodyRadius, playerBodyHeight, 12);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, metalness: 0.1 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = playerBodyHeight / 2;
        body.castShadow = true; body.receiveShadow = true;
        body.userData.isPlayerBody = true;
        group.add(body);
        const nameTag = createNameTag(name || 'Player');
         if (nameTag) {
            nameTag.position.y = playerBodyHeight + 1.0;
            group.add(nameTag);
            group.userData.nameTag = nameTag;
         }
        return group;
    } catch (error) { console.error("[DEBUG] Error in createPlayerMesh:", error); return null; }
}

function createNameTag(name) {
    try {
         const canvas = document.createElement('canvas');
         const context = canvas.getContext('2d');
         if (!context) { throw new Error("Failed to get 2D context"); }
         const fontSize = 48; context.font = `Bold ${fontSize}px Arial`;
         const textMetrics = context.measureText(name);
         const textWidth = Math.max(1, textMetrics.width);
         const padding = 15;
         canvas.width = textWidth + padding * 2;
         canvas.height = fontSize + padding * 2;
         context.font = `Bold ${fontSize}px Arial`;
         context.fillStyle = 'rgba(0, 0, 0, 0.6)'; context.fillRect(0, 0, canvas.width, canvas.height);
         context.fillStyle = 'rgba(255, 255, 255, 0.95)'; context.textAlign = 'center';
         context.textBaseline = 'middle'; context.fillText(name, canvas.width / 2, canvas.height / 2);
         const texture = new THREE.CanvasTexture(canvas); texture.needsUpdate = true;
         const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: true, sizeAttenuation: true });
         const sprite = new THREE.Sprite(material);
         const desiredHeight = 1.5;
         sprite.scale.set((canvas.width / canvas.height) * desiredHeight, desiredHeight, 1.0);
         return sprite;
     } catch(error) { console.error("[DEBUG] Error creating name tag canvas/texture:", error); return null; }
 }
// --- Bullet Handling ---
function createBullet(bulletData) {
    if (!bulletData?.id || !bulletData.position || !bulletData.velocity || !bulletData.ownerId) return;
    try {
        const bulletRadius = 0.2;
        const bulletGeometry = new THREE.SphereGeometry(bulletRadius, 6, 6);
        const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xfff700 });
        const bulletMesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
        bulletMesh.userData = { isBullet: true, ownerId: bulletData.ownerId, bulletId: bulletData.id };
        const finalPosition = new THREE.Vector3().copy(bulletData.position);
        const finalVelocity = new THREE.Vector3().copy(bulletData.velocity);
        if (finalVelocity.lengthSq() === 0) { finalVelocity.set(0, 0, -config.bulletSpeed); }
        bulletMesh.position.copy(finalPosition);
        scene.add(bulletMesh);
        bullets[bulletData.id] = { mesh: bulletMesh, velocity: finalVelocity, ownerId: bulletData.ownerId, spawnTime: clock?.getElapsedTime() ?? 0 }; // Add clock check
    } catch (error) {
        console.error("[DEBUG] Error in createBullet:", error);
        if (bullets[bulletData.id]?.mesh) { scene.remove(bullets[bulletData.id].mesh); } // Add check
        delete bullets[bulletData.id];
    }
}

function updateBullets(delta) {
     const now = clock?.getElapsedTime() ?? 0; // Add check
     const bulletIdsToRemove = [];
     for (const id in bullets) {
        const bullet = bullets[id];
        if (!bullet?.mesh || !bullet.velocity) { bulletIdsToRemove.push(id); continue; } // Add checks
        try {
            bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
            const age = now - bullet.spawnTime;
            const pos = bullet.mesh.position;
            const bound = 250;
            if (age > config.bulletLifetime || Math.abs(pos.x) > bound || Math.abs(pos.y) > bound || Math.abs(pos.z) > bound) {
                bulletIdsToRemove.push(id); continue;
            }
            // Add proper collision checks here if needed client-side
        } catch(error) { console.error(`[DEBUG] Error updating bullet ${id}:`, error); bulletIdsToRemove.push(id); }
    }
    bulletIdsToRemove.forEach(id => {
        if (bullets[id]?.mesh) { // Add check
            if(bullets[id].mesh.geometry) bullets[id].mesh.geometry.dispose();
            if(bullets[id].mesh.material) bullets[id].mesh.material.dispose();
            scene.remove(bullets[id].mesh);
        }
        delete bullets[id];
    });
}
// --- Movement ---
function movePlayer(delta) {
    if (!playerMesh) return;
    if (!gameState.isAlive) {
        playerVelocity.y += config.gravity * delta;
        playerMesh.position.y += playerVelocity.y * delta;
        const deadBodyFloor = 0;
        if (playerMesh.position.y < deadBodyFloor) { playerMesh.position.y = deadBodyFloor; playerVelocity.y = 0; }
        return;
    }

    const moveSpeed = config.movementSpeed;
    const forwardDirection = new THREE.Vector3();
    const rightDirection = new THREE.Vector3();
    playerMesh.getWorldDirection(forwardDirection);
    forwardDirection.y = 0; forwardDirection.normalize();
    rightDirection.crossVectors(new THREE.Vector3(0, 1, 0), forwardDirection).normalize();

    let moveX = 0; let moveZ = 0; let isMoving = false;
    if (isPointerLocked) {
        if (keysPressed['w']) { moveZ -= 1; isMoving = true; }
        if (keysPressed['s']) { moveZ += 1; isMoving = true; }
        if (keysPressed['a']) { moveX -= 1; isMoving = true; }
        if (keysPressed['d']) { moveX += 1; isMoving = true; }
    }
    if (joystickData.active && (Math.abs(joystickData.vector.x) > 0 || Math.abs(joystickData.vector.y) > 0)) {
        moveZ = -joystickData.vector.y; moveX = joystickData.vector.x; isMoving = true;
    }

    let finalMove = new THREE.Vector3();
    if (isMoving) {
        const combinedMove = forwardDirection.clone().multiplyScalar(moveZ).add(rightDirection.clone().multiplyScalar(moveX));
        if (Math.abs(moveZ) > 0.01 && Math.abs(moveX) > 0.01) { combinedMove.normalize(); }
        finalMove.copy(combinedMove).multiplyScalar(moveSpeed * delta);
    }

    if (!isOnGround || playerVelocity.y > 0) { playerVelocity.y += config.gravity * delta; }
    let jumpRequested = (isPointerLocked && keysPressed[' ']) || touchState.jump;
    if (jumpRequested && isOnGround && gameState.isAlive) {
        playerVelocity.y = config.jumpForce; isOnGround = false;
        touchState.jump = false; keysPressed[' '] = false;
    }
    finalMove.y = playerVelocity.y * delta;

    const currentPosition = playerMesh.position.clone();
    const potentialHorizontalPosition = currentPosition.clone().add(new THREE.Vector3(finalMove.x, 0, finalMove.z));
    let actualMoveHorizontal = new THREE.Vector3(finalMove.x, 0, finalMove.z);
    const playerHeight = config.playerHeight;
    const playerRadius = config.playerRadius;
    const playerBox = new THREE.Box3(
         new THREE.Vector3(-playerRadius, 0, -playerRadius),
         new THREE.Vector3(playerRadius, playerHeight, playerRadius)
    );
    playerBox.translate(potentialHorizontalPosition);
    const mapBoundary = 99;
    // Simple collision check (replace with better method if needed)
    for (const mapObj of currentMapObjects) {
        if (!mapObj?.geometry || !mapObj.visible || mapObj.userData.isGround || mapObj.userData.isWater || mapObj.userData.isPlayer || mapObj.userData.isBullet) continue; // Add checks
        const objBox = new THREE.Box3().setFromObject(mapObj);
        if (playerBox.intersectsBox(objBox)) {
             // Basic axis-based blocking
             const testXBox = new THREE.Box3().copy(playerBox).translate(new THREE.Vector3(-finalMove.x, 0, 0));
              if (testXBox.intersectsBox(objBox)) { actualMoveHorizontal.z = 0; }
              else { actualMoveHorizontal.x = 0; }
             // break; // Can break if full stop is acceptable
        }
    }

    playerMesh.position.x += actualMoveHorizontal.x;
    playerMesh.position.z += actualMoveHorizontal.z;
    playerMesh.position.x = Math.max(-mapBoundary + playerRadius, Math.min(mapBoundary - playerRadius, playerMesh.position.x));
    playerMesh.position.z = Math.max(-mapBoundary + playerRadius, Math.min(mapBoundary - playerRadius, playerMesh.position.z));

    const verticalRayOrigin = playerMesh.position.clone(); verticalRayOrigin.y += 0.1;
    const verticalRayDirection = new THREE.Vector3(0, -1, 0);
    const verticalRayLength = 0.2 + Math.abs(finalMove.y > 0 ? 0 : finalMove.y);
    const downRaycaster = new THREE.Raycaster(verticalRayOrigin, verticalRayDirection, 0, verticalRayLength);
    let groundCheckObjects = currentMapObjects.filter(obj =>
        obj !== playerMesh && obj?.visible && !obj?.userData?.isBullet && !obj?.userData?.isWater && !obj?.userData?.isPlayer // Add checks
    );
    const intersects = downRaycaster.intersectObjects(groundCheckObjects, false);
    let foundGround = false;
    if (intersects.length > 0) {
        const groundHitPointY = intersects[0].point.y;
        const potentialFootY = playerMesh.position.y + finalMove.y;
        if (potentialFootY <= groundHitPointY + 0.01) {
             playerMesh.position.y = groundHitPointY; playerVelocity.y = 0; foundGround = true;
        } else { playerMesh.position.y = potentialFootY; foundGround = false; }
    } else { playerMesh.position.y += finalMove.y; foundGround = false; }
    isOnGround = foundGround;

    const absoluteFloor = 0;
    if (playerMesh.position.y < absoluteFloor) {
        playerMesh.position.y = absoluteFloor;
        if (playerVelocity.y < 0) playerVelocity.y = 0;
        isOnGround = true;
    }
}


// --- Shooting and Reloading ---
function shootBullet() {
    if (!gameState.isAlive || gameState.respawning || gameState.isReloading || !gameState.canShoot) return;
    if (gameState.ammo <= 0) {
        if (gameState.ammoReserve > 0 && !gameState.isReloading) { reload(); }
        return;
    }
    gameState.ammo--; updateUI();
    gameState.canShoot = false; setTimeout(() => { gameState.canShoot = true; }, config.touchShootCooldown);
    const bulletDirection = new THREE.Vector3();
    if(camera) camera.getWorldDirection(bulletDirection); // Add camera check
    if (socket && socket.connected) { // Add socket check
        socket.emit('player-shoot', { direction: { x: bulletDirection.x, y: bulletDirection.y, z: bulletDirection.z } });
    }
}

function reload() {
    if (gameState.isReloading || gameState.ammo >= config.ammoCapacity || gameState.ammoReserve <= 0 || !gameState.isAlive) {
        // console.log("Cannot reload."); // Reduce console noise
        return;
    }
    console.log("Requesting reload...");
    gameState.isReloading = true;
    if(ammoElement) ammoElement.textContent = `Ammo: Reloading... [${gameState.ammoReserve}]`; // Add check
    if (socket && socket.connected) { // Add socket check
        socket.emit('request-reload');
    }
}
// --- Health, Death, Respawn ---
function handleLocalPlayerHit(newHealth, attackerId) {
    if (!gameState.isAlive) return;
    gameState.health = Math.max(0, newHealth);
    // console.log(`Took damage, health now ${gameState.health}`); // Reduce noise
    updateUI();
}

function handleLocalPlayerDeath() {
    if (!gameState.isAlive) return;
    console.log("Player died!");
    gameState.isAlive = false; gameState.respawning = true; gameState.health = 0;
    updateUI();
    flashScreen(0x550000, 400);
    if (playerMesh) { playerMesh.visible = false; }
    if (isPointerLocked) { document.exitPointerLock(); }
    joystickData.active = false; joystickData.touchId = null; joystickData.vector = {x:0, y:0};
    lookData.active = false; lookData.touchId = null;
    touchState.shoot = false; touchState.jump = false;
    if(shootButtonElement) shootButtonElement.classList.remove('active');
    if(jumpButtonElement) jumpButtonElement.classList.remove('active');
    if(reloadButtonElement) reloadButtonElement.classList.remove('active');
    if(joystickHandleElement) joystickHandleElement.style.transform = `translate(-50%, -50%)`;
    for (const key in keysPressed) { keysPressed[key] = false; }
}

function handleLocalPlayerRespawn(respawnData) {
    if (!respawnData) return; // Add check
    console.log("Player respawned!");
    gameState.isAlive = true; gameState.respawning = false;
    gameState.health = respawnData.health; gameState.ammo = respawnData.ammo;
    gameState.ammoReserve = respawnData.ammoReserve;
    gameState.isReloading = false; gameState.canShoot = true;
    if (!playerMesh) { initializeLocalPlayerMesh(); }
     if (playerMesh) {
         playerMesh.position.copy(respawnData.position);
         playerMesh.position.y = Math.max(respawnData.position.y, 0);
         playerVelocity.set(0, 0, 0); playerMesh.visible = true;
     } else { console.error("!!! Failed to respawn - player mesh not available."); }
    updateUI();
}
// --- UI Updates ---
function updateUI() {
    if (!uiElement) return;
    if(scoreElement) scoreElement.textContent = `Score: ${gameState.score}`;
    if(healthElement) healthElement.textContent = `Health: ${Math.max(0, gameState.health)}`;
    if (healthBarElement) {
        const healthPercentage = Math.max(0, gameState.health) / config.maxHealth;
        healthBarElement.style.width = `${healthPercentage * 100}%`;
        if (healthPercentage > 0.6) healthBarElement.style.backgroundColor = '#4CAF50';
        else if (healthPercentage > 0.3) healthBarElement.style.backgroundColor = '#FFC107';
        else healthBarElement.style.backgroundColor = '#F44336';
    }
    if (ammoElement) {
        if (gameState.isReloading) { ammoElement.textContent = `Reloading... [${gameState.ammoReserve}]`; }
        else { ammoElement.textContent = `Ammo: ${gameState.ammo} / ${gameState.ammoReserve}`; }
    }
}
function addKillFeedMessage(message) {
    if (!killFeedElement) return; // Add check
    const feedSizeLimit = 5; const messageDuration = 5000;
    const messageElement = document.createElement('div');
    messageElement.className = 'kill-message'; messageElement.textContent = message;
    if (killFeedElement.firstChild) { killFeedElement.insertBefore(messageElement, killFeedElement.firstChild); }
    else { killFeedElement.appendChild(messageElement); }
    while (killFeedElement.children.length > feedSizeLimit) { killFeedElement.removeChild(killFeedElement.lastChild); }
    setTimeout(() => { if (messageElement.parentNode === killFeedElement) { killFeedElement.removeChild(messageElement); } }, messageDuration);
}
function flashScreen(color, duration) {
     const flashDiv = document.createElement('div');
     flashDiv.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: ${new THREE.Color(color).getStyle()}; opacity: 0.4; z-index: 50; pointer-events: none; transition: opacity ${duration * 0.8}ms ease-out;`;
     document.body.appendChild(flashDiv);
     requestAnimationFrame(() => { requestAnimationFrame(() => { flashDiv.style.opacity = '0'; }); });
     setTimeout(() => { if (flashDiv.parentNode === document.body) { document.body.removeChild(flashDiv); } }, duration);
 }
// --- Game Loop ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const delta = clock?.getDelta() ?? 0.016; // Use fallback delta if clock missing
    const clampedDelta = Math.min(delta, 0.05);
    if (touchState.shoot) { shootBullet(); }
    if (playerMesh) { movePlayer(clampedDelta); }
    interpolateRemotePlayers(clampedDelta);
    updateBullets(clampedDelta);
    sendMovementUpdate();
    updateNameTagOrientation();
    if (scene && camera && renderer) { // Add renderer check
        try { renderer.render(scene, camera); }
        catch(error) {
            console.error("!!! Render Error:", error);
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            // Avoid alert loop, just log
            // alert("A rendering error occurred. Please refresh the page.");
        }
    }
}

// --- Helper Functions ---

let lastMoveUpdateTime = 0;
const moveUpdateInterval = 1000 / 20;
let lastPosition = new THREE.Vector3();
let lastRotationY = 0;

function sendMovementUpdate() {
    const now = Date.now();
    if (now - lastMoveUpdateTime > moveUpdateInterval && socket?.connected && playerMesh && gameState.isAlive) { // Add socket check
        const positionChanged = playerMesh.position.distanceToSquared(lastPosition) > 0.001;
        const rotationChanged = Math.abs(playerMesh.rotation.y - lastRotationY) > 0.01;
        if (positionChanged || rotationChanged) {
            socket.emit('player-move', {
                position: { x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z },
                rotation: { y: playerMesh.rotation.y }
            });
            lastPosition.copy(playerMesh.position);
            lastRotationY = playerMesh.rotation.y;
            lastMoveUpdateTime = now;
        }
    }
}

function updateNameTagOrientation() {
     if (!camera) return;
     const cameraWorldPos = new THREE.Vector3();
     camera.getWorldPosition(cameraWorldPos);
     for (const id in players) {
         if (players[id]?.mesh?.userData?.nameTag) { // Add checks
             players[id].mesh.userData.nameTag.lookAt(cameraWorldPos);
         }
     }
     if (playerMesh?.userData?.nameTag) { // Add check
         playerMesh.userData.nameTag.visible = false;
     }
}


function interpolateRemotePlayers(delta) {
    const interpolationFactor = 0.15;
    for (const id in players) {
        const player = players[id];
        if (player?.mesh && player.targetPosition && player.isAlive) { // Add checks
             player.mesh.position.lerp(player.targetPosition, interpolationFactor);
             player.mesh.rotation.y = THREE.MathUtils.lerp(player.mesh.rotation.y, player.targetRotationY, interpolationFactor);
        }
    }
}


// --- Start ---
init(); // Initialize the game setup

// --- END OF FILE game.js ---