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
    // NOTE: Some of these values seem quite high (playerHeight, Radius, jumpForce).
    // This might affect collision and visual scale. Adjust if needed.
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
    playerHeight: 4.8,
    playerRadius: 2.5,
    playerEyeLevel: 4.6, // Approx eye level from feet
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
const playButton = document.getElementById('play-button');
const playerNameInput = document.getElementById('player-name');
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
let scene, camera, renderer, clock, ground;
let playerMesh; // Local player's visual representation
let playerVelocity = new THREE.Vector3(); // For physics simulation
let isOnGround = false;
let animationFrameId = null; // <--- DECLARED GLOBALLY HERE (Using let)

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
    setupLighting();
    createEnvironment();
    setupEventListeners(); // Sets up keyboard/mouse AND touch
    connectToServer();
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    clock = new THREE.Clock();
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 75);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x4CAF50, 0.3);
    scene.add(hemiLight);
}

function createEnvironment() {
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x4CAF50 });
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Adjust box positions based on potential large player size
    const boxGeometry = new THREE.BoxGeometry(5, 5, 5);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8 });
    const positions = [
        { x: 15, y: 2.5, z: 10 }, { x: -10, y: 2.5, z: -15 }, { x: 0, y: 2.5, z: 20 },
        { x: -20, y: 2.5, z: 5 }, { x: 25, y: 2.5, z: -20 },
    ];
    positions.forEach(pos => {
        const box = new THREE.Mesh(boxGeometry, boxMaterial);
        box.position.set(pos.x, pos.y, pos.z); // Place boxes at their base y=0
        box.castShadow = true; box.receiveShadow = true; scene.add(box);
    });
}

function setupEventListeners() {
    // --- Menu ---
    playButton.addEventListener('click', joinGame);
    playerNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinGame(); });

    // --- Window Resize ---
    window.addEventListener('resize', onWindowResize);

    // --- Keyboard/Mouse Controls (Desktop) ---
    document.addEventListener('pointerlockchange', handlePointerLockChange, false);
    document.addEventListener('click', handleDesktopClick); // Separate handler
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', onMouseMove);

    // --- Touch Controls (Mobile) ---
    joystickElement.addEventListener('touchstart', handleJoystickStart, { passive: false });
    joystickElement.addEventListener('touchmove', handleJoystickMove, { passive: false });
    joystickElement.addEventListener('touchend', handleJoystickEnd, { passive: false });
    joystickElement.addEventListener('touchcancel', handleJoystickEnd, { passive: false });

    shootButtonElement.addEventListener('touchstart', handleShootButtonStart, { passive: false });
    shootButtonElement.addEventListener('touchend', handleShootButtonEnd, { passive: false });
    shootButtonElement.addEventListener('touchcancel', handleShootButtonEnd, { passive: false });

    jumpButtonElement.addEventListener('touchstart', handleJumpButtonStart, { passive: false });
    jumpButtonElement.addEventListener('touchend', handleJumpButtonEnd, { passive: false });
    jumpButtonElement.addEventListener('touchcancel', handleJumpButtonEnd, { passive: false });

    reloadButtonElement.addEventListener('touchstart', handleReloadButtonStart, { passive: false });

    renderer.domElement.addEventListener('touchstart', handleLookStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', handleLookMove, { passive: false });
    renderer.domElement.addEventListener('touchend', handleLookEnd, { passive: false });
    renderer.domElement.addEventListener('touchcancel', handleLookEnd, { passive: false });
}

// --- Touch Event Handlers ---
function handleJoystickStart(event) {
    event.preventDefault();
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
                updateJoystickVisuals();
                break;
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
                joystickData.active = false;
                joystickData.touchId = null;
                joystickData.vector = { x: 0, y: 0 };
                joystickHandleElement.style.transform = `translate(-50%, -50%)`;
                break;
            }
        }
    }
}

function updateJoystickVisuals() {
    const dx = joystickData.currentPos.x - joystickData.startPos.x;
    const dy = joystickData.currentPos.y - joystickData.startPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = joystickElement.offsetWidth / 2 - joystickHandleElement.offsetWidth / 4;

    const clampedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(dy, dx);

    const handleX = Math.cos(angle) * clampedDistance;
    const handleY = Math.sin(angle) * clampedDistance;

    joystickHandleElement.style.transform = `translate(calc(-50% + ${handleX}px), calc(-50% + ${handleY}px))`;

    if (distance > joystickElement.offsetWidth * config.joystickDeadzone) {
         joystickData.vector.x = Math.cos(angle) * (clampedDistance / maxDistance);
         // This maps screen Y to movement vector Y. Screen UP is negative dy, angle is -PI/2.
         // sin(-PI/2) is -1. The negative sign makes vector.y = +1 when joystick is UP.
         // This assumes moveZ = +1 corresponds to FORWARD in movePlayer.
         joystickData.vector.y = -Math.sin(angle) * (clampedDistance / maxDistance);
    } else {
         joystickData.vector.x = 0;
         joystickData.vector.y = 0;
    }
}


function handleShootButtonStart(event) { event.preventDefault(); touchState.shoot = true; shootButtonElement.classList.add('active'); }
function handleShootButtonEnd(event) { event.preventDefault(); touchState.shoot = false; shootButtonElement.classList.remove('active'); }

function handleJumpButtonStart(event) { event.preventDefault(); touchState.jump = true; jumpButtonElement.classList.add('active');}
function handleJumpButtonEnd(event) { event.preventDefault(); jumpButtonElement.classList.remove('active'); /* Flag reset in movePlayer */ }

function handleReloadButtonStart(event) {
    event.preventDefault();
    reloadButtonElement.classList.add('active');
    reload();
    setTimeout(() => reloadButtonElement.classList.remove('active'), 150);
}

function handleLookStart(event) {
    const targetElement = event.target;
     if (targetElement === renderer.domElement && !lookData.active && !joystickData.active && !isEventTargetButton(targetElement, event)) {
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
                event.preventDefault();
                const currentPos = { x: touch.clientX, y: touch.clientY };
                const deltaX = currentPos.x - lookData.lastPos.x;
                const deltaY = currentPos.y - lookData.lastPos.y;
                rotateCamera(deltaX, deltaY, config.touchLookSensitivity);
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
                 event.preventDefault();
                 lookData.active = false;
                 lookData.touchId = null;
                 break;
            }
        }
    }
}

function isEventTargetButton(targetElement, event) {
     let element = event.target;
     while (element && element !== document.body) {
         if (element === joystickElement || element === shootButtonElement || element === jumpButtonElement || element === reloadButtonElement) {
             return true;
         }
         element = element.parentElement;
     }
     return false;
 }

// --- Keyboard/Mouse Event Handlers ---
function handleDesktopClick() {
    if (!gameState.isAlive) return;
    if (!isPointerLocked) {
         if (!('ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0)) {
              document.body.requestPointerLock();
         }
    } else if (gameState.isAlive && !gameState.respawning && !gameState.isReloading) {
        shootBullet();
    }
}

function handleKeyDown(event) {
     if (!isPointerLocked && !joystickData.active) return;
     const key = event.key.toLowerCase();
     keysPressed[key] = true;
     if (key === 'r' && !gameState.isReloading && gameState.ammo < config.ammoCapacity && gameState.ammoReserve > 0 && gameState.isAlive) {
         reload();
     }
}
function handleKeyUp(event) { keysPressed[event.key.toLowerCase()] = false; }

function onMouseMove(event) {
    if (!isPointerLocked) return;
    if (gameState.isAlive) {
        rotateCamera(event.movementX, event.movementY, 0.002);
    }
}

function rotateCamera(deltaX, deltaY, sensitivity) {
    if (!playerMesh || !gameState.isAlive) return;
     playerMesh.rotation.y -= deltaX * sensitivity;
     camera.rotation.x -= deltaY * sensitivity;
     camera.rotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, camera.rotation.x));
}

function handlePointerLockChange() {
    isPointerLocked = document.pointerLockElement === document.body;
    crosshairElement.style.display = document.body.classList.contains('game-active') ? 'block' : 'none';
    if (!isPointerLocked) {
        for (const key in keysPressed) { keysPressed[key] = false; }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Multiplayer Connection and Game Logic ---
function connectToServer() {
    socket = io();

    socket.on('connect', () => { console.log('Connected to server.'); });
    socket.on('disconnect', () => { console.log('Disconnected from server.'); alert('Lost connection.'); resetGame(); });
    socket.on('connect_error', (err) => { console.error('Connection Error:', err); alert('Could not connect.'); resetGame(); });
    socket.on('your-id', (id) => { socketId = id; console.log('My Socket ID:', socketId); });

    socket.on('game-state', (serverPlayers) => {
        console.log('[DEBUG] Received initial game-state. Player Count:', Object.keys(serverPlayers).length);
        for (const id in players) { if (players[id].mesh) scene.remove(players[id].mesh); }
        players = {};
        for (const id in serverPlayers) {
            if (id !== socketId) { addPlayer(serverPlayers[id]); }
            else {
                const myData = serverPlayers[id];
                if (!playerMesh) { initializeLocalPlayerMesh(); }
                if(playerMesh) {
                    playerMesh.position.copy(myData.position);
                    if (myData.rotation) { playerMesh.rotation.y = myData.rotation.y; }
                } else { console.error("Failed to initialize local player mesh!"); }
                gameState.health = myData.health;
                gameState.score = myData.score;
                gameState.ammo = myData.ammo;
                gameState.ammoReserve = myData.ammoReserve;
                gameState.isAlive = myData.health > 0;
                updateUI();
            }
        }
    });

    socket.on('player-joined', (playerData) => {
        if (playerData.id !== socketId) { addPlayer(playerData); }
    });

    socket.on('player-left', (id) => {
        if (players[id]) { if (players[id].mesh) scene.remove(players[id].mesh); delete players[id]; }
    });

    socket.on('player-moved', (data) => {
        if (data.id !== socketId && players[data.id] && players[data.id].mesh) {
             const targetPosition = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
             players[data.id].mesh.position.lerp(targetPosition, 0.3);
             players[data.id].mesh.rotation.y = data.rotation.y;
        }
    });

    socket.on('bullet-fired', (bulletData) => { createBullet(bulletData); });

    socket.on('player-hit', (data) => {
          if (data.victimId === socketId) { handleLocalPlayerHit(data.victimHealth, data.attackerId); flashScreen(0xff0000, 150); }
          else if (players[data.victimId]) { players[data.victimId].health = data.victimHealth; }
    });

    socket.on('player-died', (data) => {
           console.log(`${data.attackerName} killed ${data.victimName}`);
           addKillFeedMessage(`${data.attackerName} killed ${data.victimName}`);
           if (data.victimId === socketId) { handleLocalPlayerDeath(); }
           else if (players[data.victimId]) {
                if (players[data.victimId].mesh) { players[data.victimId].mesh.visible = false; }
                players[data.victimId].health = 0;
           }
           if (data.attackerId === socketId) { gameState.score = data.attackerScore; updateUI(); }
    });

    socket.on('player-respawned', (data) => {
             if (data.id === socketId) { handleLocalPlayerRespawn(data); }
             else if (players[data.id]) {
                   if (players[data.id].mesh) {
                       players[data.id].mesh.position.copy(data.position);
                       players[data.id].mesh.visible = true;
                       players[data.id].health = data.health;
                   }
             } else { addPlayer(data); if(players[data.id] && players[data.id].mesh) { players[data.id].mesh.visible = true; players[data.id].health = data.health; } }
    });

    socket.on('reload-complete', (data) => {
           if (gameState.isReloading) {
               gameState.ammo = data.ammo;
               gameState.ammoReserve = data.ammoReserve;
               gameState.isReloading = false;
               updateUI();
           }
    });
}
// --- Join/Reset Game ---

function joinGame() {
    const name = playerNameInput.value.trim() || `Player_${Math.floor(Math.random() * 1000)}`;
    if (name.length > 16) { alert("Name cannot exceed 16 characters."); return; }
    gameState.playerName = name;

    initializeLocalPlayerMesh();
    socket.emit('player-join', { name: gameState.playerName });

    menuElement.style.display = 'none';
    uiElement.style.display = 'block';
    crosshairElement.style.display = 'block';
    document.body.classList.add('game-active');

    if (!animationFrameId) { animate(); }
    updateUI();
}

function resetGame() {
     menuElement.style.display = 'block';
     uiElement.style.display = 'none';
     crosshairElement.style.display = 'none';
     document.body.classList.remove('game-active');

     for (const id in players) { if (players[id].mesh) scene.remove(players[id].mesh); }
     players = {};
     for (const id in bullets) { if (bullets[id].mesh) scene.remove(bullets[id].mesh); }
     bullets = {};
     if (playerMesh) { scene.remove(playerMesh); playerMesh = null; }

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
         // Adjust Y position based on potentially large playerHeight
         const initialY = config.playerHeight / 2;
         playerMesh = createPlayerMesh(socketId, gameState.playerName, 0x1E90FF);
         if (!playerMesh) { console.error("!!! Failed to create local player mesh!"); return; }
         playerMesh.position.set(0, initialY, 5); // Start slightly above ground
         scene.add(playerMesh);
         playerMesh.add(camera);
         // Camera position relative to player mesh origin (feet)
         camera.position.set(0, config.playerEyeLevel, 0);
         console.log("Local player mesh created.");
     }
}

function addPlayer(playerData) {
     if (!playerData || !playerData.id || !playerData.position || typeof playerData.health === 'undefined') { return; }
     const playerName = playerData.name || `Player_${playerData.id.substring(0,4)}`;
     if (players[playerData.id]) {
         players[playerData.id].name = playerName;
         if(players[playerData.id].mesh) {
              players[playerData.id].mesh.position.copy(playerData.position);
              players[playerData.id].mesh.visible = playerData.health > 0;
         }
         players[playerData.id].health = playerData.health;
         return;
    }
    const remotePlayerMesh = createPlayerMesh(playerData.id, playerName, 0xFF4500);
     if (!remotePlayerMesh) { return; }
    remotePlayerMesh.position.copy(playerData.position);
    if (playerData.rotation) { remotePlayerMesh.rotation.y = playerData.rotation.y; }
    remotePlayerMesh.visible = playerData.health > 0;
    scene.add(remotePlayerMesh);
    players[playerData.id] = { mesh: remotePlayerMesh, name: playerName, health: playerData.health };
}

function createPlayerMesh(id, name, color) {
    try {
        const group = new THREE.Group();
        group.userData = { id: id, name: name };

        // Body dimensions based on config
        const playerBodyHeight = config.playerHeight * 0.8; // Body is 80% of total height
        const playerBodyRadius = config.playerRadius;      // Use configured radius
        const bodyGeometry = new THREE.CylinderGeometry(playerBodyRadius, playerBodyRadius, playerBodyHeight, 12);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color: color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        // Position body so its *bottom* is at the group's origin (y=0)
        body.position.y = playerBodyHeight / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const nameTag = createNameTag(name || 'Player');
         if (nameTag) {
            // Position nametag relative to the top of the body
            nameTag.position.y = playerBodyHeight + 0.5;
            group.add(nameTag);
            group.userData.nameTag = nameTag;
         }
        return group;
    } catch (error) {
        console.error("[DEBUG] Error in createPlayerMesh:", error);
        return null;
    }
}

function createNameTag(name) {
    try {
         const canvas = document.createElement('canvas');
         const context = canvas.getContext('2d');
         if (!context) { throw new Error("Failed to get 2D context"); }
         const fontSize = 48;
         context.font = `Bold ${fontSize}px Arial`;
         const textMetrics = context.measureText(name);
         const textWidth = Math.max(1, textMetrics.width);
         const padding = 10;
         canvas.width = textWidth + padding * 2;
         canvas.height = fontSize + padding * 2;
         context.font = `Bold ${fontSize}px Arial`;
         context.fillStyle = 'rgba(0, 0, 0, 0.7)';
         context.fillRect(0, 0, canvas.width, canvas.height);
         context.fillStyle = 'rgba(255, 255, 255, 0.95)';
         context.textAlign = 'center';
         context.textBaseline = 'middle';
         context.fillText(name, canvas.width / 2, canvas.height / 2);
         const texture = new THREE.CanvasTexture(canvas);
         texture.needsUpdate = true;
         const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: true, sizeAttenuation: true });
         const sprite = new THREE.Sprite(material);
         const scaleMultiplier = 1.0; // Adjust this value (Try 0.5 to 2.0)
         sprite.scale.set((canvas.width / canvas.height) * scaleMultiplier, scaleMultiplier, 1.0);
         return sprite;
     } catch(error) {
         console.error("[DEBUG] Error creating name tag canvas/texture:", error);
         return null;
     }
 }
// --- Bullet Handling ---
function createBullet(bulletData) {
    try {
        // <<< FIX: Increase Bullet Size - Adjust the first number (radius) >>>
        const bulletRadius = 0.4; // Example: Increased size
        const bulletGeometry = new THREE.SphereGeometry(bulletRadius, 8, 8);

        const bulletMaterial = new THREE.MeshStandardMaterial({
            color: 0xffaa00, emissive: 0xffaa00, metalness: 0.1, roughness: 0.6
         });
        const bulletMesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
        bulletMesh.userData.isBullet = true; // <<< ADDED: Flag for collision filtering

        let finalPosition;
        if (!bulletData.position || isNaN(bulletData.position.x) || isNaN(bulletData.position.y) || isNaN(bulletData.position.z)) {
            console.error("!!! Invalid bullet position. Using camera fallback.", bulletData);
            const fallbackPos = new THREE.Vector3(); camera.getWorldPosition(fallbackPos);
            const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
            fallbackPos.add(direction.multiplyScalar(1)); finalPosition = fallbackPos;
        } else { finalPosition = new THREE.Vector3().copy(bulletData.position); }
        bulletMesh.position.copy(finalPosition);

        let finalVelocity;
        if (!bulletData.velocity || isNaN(bulletData.velocity.x) || isNaN(bulletData.velocity.y) || isNaN(bulletData.velocity.z) || new THREE.Vector3(bulletData.velocity.x, bulletData.velocity.y, bulletData.velocity.z).lengthSq() === 0) {
            console.error("!!! Invalid or zero bullet velocity. Using camera fallback.", bulletData.velocity);
            const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
            finalVelocity = direction.multiplyScalar(config.bulletSpeed);
             if (finalVelocity.lengthSq() === 0) { finalVelocity = new THREE.Vector3(0, 0, -1).multiplyScalar(config.bulletSpeed); }
        } else { finalVelocity = new THREE.Vector3().copy(bulletData.velocity); }

        scene.add(bulletMesh);
        bullets[bulletData.id] = { mesh: bulletMesh, velocity: finalVelocity, ownerId: bulletData.ownerId, spawnTime: clock.getElapsedTime() };
    } catch (error) { console.error("[DEBUG] Error in createBullet:", error); }
}

function updateBullets(delta) {
     const now = clock.getElapsedTime();
     for (const id in bullets) {
        const bullet = bullets[id];
        if (!bullet || !bullet.mesh || !bullet.velocity) { if (bullet && bullet.mesh) scene.remove(bullet.mesh); delete bullets[id]; continue; }
        try {
            bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
            const age = now - bullet.spawnTime; const pos = bullet.mesh.position; const bound = 200;
            if (age > config.bulletLifetime || Math.abs(pos.x) > bound || Math.abs(pos.y) > bound || Math.abs(pos.z) > bound) {
                scene.remove(bullet.mesh); delete bullets[id];
            }
        } catch(error) { console.error(`[DEBUG] Error updating/removing bullet ${id}:`, error); if (bullet && bullet.mesh) scene.remove(bullet.mesh); delete bullets[id]; }
    }
}
// --- Movement ---
function movePlayer(delta) {
    if (!playerMesh) return;

    // Apply gravity
    if (!isOnGround || playerVelocity.y > 0) {
         playerVelocity.y += config.gravity * delta;
    }

    if (!gameState.isAlive || gameState.respawning) {
        // Simplified dead movement (just gravity and floor collision)
        playerMesh.position.y += playerVelocity.y * delta;
        const deadBodyFloor = 0 + config.playerRadius; // Bottom of cylinder touches ground
        if (playerMesh.position.y < deadBodyFloor) {
            playerMesh.position.y = deadBodyFloor;
            playerVelocity.y = 0;
        }
        return;
    }

    // --- Process Movement Input ---
    const moveSpeed = config.movementSpeed;
    const forwardDirection = new THREE.Vector3();
    const rightDirection = new THREE.Vector3();
    playerMesh.getWorldDirection(forwardDirection);
    forwardDirection.y = 0; forwardDirection.normalize();
    rightDirection.crossVectors(camera.up, forwardDirection).normalize();

    let moveX = 0; let moveZ = 0; let isMoving = false;

    if (isPointerLocked) {
         // <<< FIX: Inverted Controls - Swapped W/S logic >>>
         // W should move forward (positive Z relative to player)
         // S should move backward (negative Z relative to player)
        if (keysPressed['w']) { moveZ += 1; isMoving = true; }
        if (keysPressed['s']) { moveZ -= 1; isMoving = true; }
        if (keysPressed['a']) { moveX -= 1; isMoving = true; } // Left
        if (keysPressed['d']) { moveX += 1; isMoving = true; } // Right
    }

    if (joystickData.active && (joystickData.vector.x !== 0 || joystickData.vector.y !== 0)) {
        moveZ = joystickData.vector.y; // Joystick Up/Down maps to Forward/Backward
        moveX = joystickData.vector.x; // Joystick Left/Right maps to Left/Right
        isMoving = true;
    }

    if (isMoving) {
        const combinedMove = forwardDirection.clone().multiplyScalar(moveZ).add(rightDirection.clone().multiplyScalar(moveX));
         if (Math.abs(moveZ) > 0.01 && Math.abs(moveX) > 0.01) { combinedMove.normalize(); }
        combinedMove.multiplyScalar(moveSpeed * delta);
        const potentialPosition = playerMesh.position.clone().add(combinedMove);
        const mapBoundary = 99;
        potentialPosition.x = Math.max(-mapBoundary + config.playerRadius, Math.min(mapBoundary - config.playerRadius, potentialPosition.x));
        potentialPosition.z = Math.max(-mapBoundary + config.playerRadius, Math.min(mapBoundary - config.playerRadius, potentialPosition.z));
        // TODO: Add collision checks with environment boxes here
        playerMesh.position.copy(potentialPosition);
    }

    // --- Vertical Movement (Jump/Gravity) ---
    // Player's feet position for raycasting
    const feetY = playerMesh.position.y - config.playerHeight / 2;
    const rayOriginOffset = 0.1;
    const downRayOrigin = new THREE.Vector3(playerMesh.position.x, feetY + rayOriginOffset, playerMesh.position.z);
    const rayLength = rayOriginOffset + 0.15;
    const downRaycaster = new THREE.Raycaster(downRayOrigin, new THREE.Vector3(0, -1, 0), 0, rayLength);

    // <<< FIX: Collision Filter - Use userData >>>
    let groundCheckObjectArray = scene.children.filter(obj =>
        obj !== playerMesh && obj.type === 'Mesh' && obj.visible && !obj.userData.isBullet
    );

    const intersects = downRaycaster.intersectObjects(groundCheckObjectArray, false);
    isOnGround = intersects.length > 0;

    const groundCheckY = playerMesh.position.y - config.playerHeight / 2; // Position of player's feet

    if (isOnGround) {
        const groundY = intersects[0].point.y;
        // Snap feet to ground if close/penetrating
        if (groundCheckY < groundY + 0.05) {
             playerMesh.position.y = groundY + config.playerHeight / 2;
             playerVelocity.y = Math.max(0, playerVelocity.y); // Stop falling only when truly grounded
        }

        let jumpRequested = (isPointerLocked && keysPressed[' ']) || touchState.jump;
        if (jumpRequested) {
            playerVelocity.y = config.jumpForce;
            isOnGround = false;
            touchState.jump = false;
            keysPressed[' '] = false;
        }
    }

    // Apply vertical velocity
    playerMesh.position.y += playerVelocity.y * delta;

    // Final absolute floor check (base of the player model)
    const absoluteFloor = 0; // Ground plane Y
    if (playerMesh.position.y < absoluteFloor + config.playerHeight / 2) {
        playerMesh.position.y = absoluteFloor + config.playerHeight / 2;
        playerVelocity.y = 0;
        isOnGround = true;
    }
}
// --- Shooting and Reloading ---
function shootBullet() {
    if (!gameState.isAlive || gameState.respawning || gameState.isReloading || !gameState.canShoot) return;
    if (gameState.ammo <= 0) { if (gameState.ammoReserve > 0 && !gameState.isReloading) reload(); return; }
    gameState.ammo--; updateUI();
    gameState.canShoot = false; setTimeout(() => { gameState.canShoot = true; }, config.touchShootCooldown);
    const bulletDirection = new THREE.Vector3(); camera.getWorldDirection(bulletDirection);
    socket.emit('player-shoot', { direction: { x: bulletDirection.x, y: bulletDirection.y, z: bulletDirection.z } });
}
function reload() {
    if (gameState.isReloading || gameState.ammo >= config.ammoCapacity || gameState.ammoReserve <= 0 || !gameState.isAlive) return;
    gameState.isReloading = true; ammoElement.textContent = `Ammo: Reloading... [${gameState.ammoReserve}]`;
    socket.emit('request-reload');
}
// --- Health, Death, Respawn ---
function handleLocalPlayerHit(newHealth, attackerId) { if (!gameState.isAlive) return; gameState.health = newHealth; updateUI(); }
function handleLocalPlayerDeath() {
    if (!gameState.isAlive) return; console.log("I died!"); gameState.isAlive = false; gameState.respawning = true; gameState.health = 0; updateUI();
    if (playerMesh) { playerMesh.visible = false; } if (isPointerLocked) { document.exitPointerLock(); }
    joystickData.active = false; joystickData.touchId = null; joystickData.vector = {x:0, y:0}; lookData.active = false; lookData.touchId = null;
    touchState.shoot = false; touchState.jump = false; shootButtonElement.classList.remove('active'); jumpButtonElement.classList.remove('active');
    reloadButtonElement.classList.remove('active'); joystickHandleElement.style.transform = `translate(-50%, -50%)`;
}
function handleLocalPlayerRespawn(respawnData) {
    console.log("I respawned!"); gameState.isAlive = true; gameState.respawning = false; gameState.health = respawnData.health; gameState.ammo = respawnData.ammo;
    gameState.ammoReserve = respawnData.ammoReserve; gameState.isReloading = false; gameState.canShoot = true;
    if (!playerMesh) { initializeLocalPlayerMesh(); }
     if (playerMesh) { playerMesh.position.copy(respawnData.position); playerVelocity.set(0, 0, 0); playerMesh.visible = true; }
     else { console.error("!!! Failed to respawn - player mesh not available."); }
    updateUI();
}
// --- UI Updates ---
function updateUI() {
    scoreElement.textContent = `Score: ${gameState.score}`; healthElement.textContent = `Health: ${gameState.health}`;
    const healthPercentage = Math.max(0, gameState.health) / config.maxHealth; healthBarElement.style.width = `${healthPercentage * 100}%`;
    if (gameState.isReloading) { ammoElement.textContent = `Ammo: Reloading... [${gameState.ammoReserve}]`; }
    else { ammoElement.textContent = `Ammo: ${gameState.ammo}/${gameState.ammoReserve}`; }
}
function addKillFeedMessage(message) {
    const feedSizeLimit = 5; const messageDuration = 5000; const messageElement = document.createElement('div'); messageElement.className = 'kill-message'; messageElement.textContent = message;
    if (killFeedElement.firstChild) { killFeedElement.insertBefore(messageElement, killFeedElement.firstChild); } else { killFeedElement.appendChild(messageElement); }
    while (killFeedElement.children.length > feedSizeLimit) { killFeedElement.removeChild(killFeedElement.lastChild); }
    setTimeout(() => { if (messageElement.parentNode === killFeedElement) { killFeedElement.removeChild(messageElement); } }, messageDuration);
}
function flashScreen(color, duration) {
     const flashDiv = document.createElement('div'); flashDiv.style.position = 'fixed'; flashDiv.style.top = '0'; flashDiv.style.left = '0'; flashDiv.style.width = '100vw';
     flashDiv.style.height = '100vh'; flashDiv.style.backgroundColor = new THREE.Color(color).getStyle(); flashDiv.style.opacity = '0.5'; flashDiv.style.zIndex = '50';
     flashDiv.style.pointerEvents = 'none'; flashDiv.style.transition = `opacity ${duration * 0.8}ms ease-out`; document.body.appendChild(flashDiv);
     requestAnimationFrame(() => { requestAnimationFrame(() => { flashDiv.style.opacity = '0'; }); });
     setTimeout(() => { if (flashDiv.parentNode === document.body) { document.body.removeChild(flashDiv); } }, duration);
 }
// --- Game Loop ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const delta = clock.getDelta(); const clampedDelta = Math.min(delta, 0.05);
    if (touchState.shoot) { shootBullet(); } if (playerMesh) { movePlayer(clampedDelta); }
    updateBullets(clampedDelta); sendMovementUpdate(); updateNameTagOrientation();
    if (scene && camera) { try { renderer.render(scene, camera); } catch(error) { console.error("!!! Render Error:", error); cancelAnimationFrame(animationFrameId); animationFrameId = null; } }
}
// --- Helper Functions ---
let lastMoveUpdateTime = 0; const moveUpdateInterval = 1000 / 20; let lastPosition = new THREE.Vector3(); let lastRotationY = 0;
function sendMovementUpdate() {
    const now = Date.now();
    if (now - lastMoveUpdateTime > moveUpdateInterval && socket && socket.connected && playerMesh && gameState.isAlive) {
        const positionChanged = playerMesh.position.distanceToSquared(lastPosition) > 0.0001; const rotationChanged = Math.abs(playerMesh.rotation.y - lastRotationY) > 0.001;
        if (positionChanged || rotationChanged) {
            socket.emit('player-move', { position: { x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z }, rotation: { y: playerMesh.rotation.y } });
            lastPosition.copy(playerMesh.position); lastRotationY = playerMesh.rotation.y; lastMoveUpdateTime = now;
        }
    }
}
function updateNameTagOrientation() {
     if (!camera) return; for (const id in players) { if (players[id]?.mesh?.userData?.nameTag) { players[id].mesh.userData.nameTag.lookAt(camera.position); } }
     if (playerMesh?.userData?.nameTag) { playerMesh.userData.nameTag.visible = false; } // Hide local name tag
}
// --- Start ---
init(); // Initialize the game setup