const express = require('express');
const app = express();
// <<< Use require('node:http') for built-in module >>>
const http = require('node:http').createServer(app);
const { Server } = require("socket.io");
const THREE = require('three'); // Use three.js for vector math/raycasting

const io = new Server(http, {
    // Optional: Configure transports, ping intervals if needed
    // pingInterval: 10000,
    // pingTimeout: 5000,
});

const PORT = process.env.PORT || 3000;

// --- Serve static files (HTML, JS, CSS, assets) ---
// Ensure this path matches where your index.html, game.js, mapLoader.js are.
// If they are in the root directory alongside server.js, use '.'
// If they are in a 'public' subdirectory, use 'public'
app.use(express.static('.')); // Serve files from the root directory

console.log('Simple 3D Shooter Server - v2 (Map Awareness)');

// --- Game Constants ---
const config = {
    maxHealth: 300, // <<< Match client config >>>
    respawnTime: 3000,
    ammoCapacity: 30,
    maxAmmoReserve: 90,
    reloadTime: 2000,
    bulletDamage: 25, // <<< Adjust damage as needed >>>
    bulletSpeed: 80, // <<< Match client config >>>
    // Hit detection uses raycasting, radius is less critical now, but can be used for rough checks
    playerHitboxHeight: 4.8, // Match client playerHeight for vertical checks
    playerHitboxRadius: 1.5, // Smaller radius for hitbox than visual model
    mapBounds: { x: 100, z: 100 }, // Half-width/depth - Adjust if maps have different sizes
    defaultMap: 'forest', // <<< Define the default map >>>
};

// --- Server State ---
let players = {}; // { socketId: { id, name, position, rotation, health, score, ammo, ammoReserve, isReloading, reloadTimeout } }
let currentMapName = config.defaultMap; // <<< Track the current map >>>
// Bullets are handled via instant raycast on server in this version


// --- Helper Functions ---
function getRandomSpawnPoint() {
     // TODO: Implement map-specific spawn points if needed
     // For now, use general bounds based on current map (if bounds varied)
     const bounds = config.mapBounds; // Use global bounds for now
     const padding = 10;
     // Ensure spawn Y is appropriate (consider player base at Y=0)
     const spawnY = config.playerHitboxHeight / 2; // Center Y for collision checking later? Or 0 for base? Let's use 0 for base.
     return { // Return as plain object for JSON serialization
         x: (Math.random() - 0.5) * (bounds.x * 2 - padding),
         y: 0, // Player base starts at Y=0
         z: (Math.random() - 0.5) * (bounds.z * 2 - padding)
     };
 }

// --- Map Change Function ---
function changeMap(newMapName) {
    // TODO: Add validation if needed (e.g., check if map exists in a server-side map config)
    console.log(`[Server] Changing map to ${newMapName}...`);
    currentMapName = newMapName;

    // Reset players (optional: depends on game rules - new map might mean new round)
    // For simplicity, let's just reposition everyone to new spawns. Health/score could persist or reset.
    for (const playerId in players) {
        const player = players[playerId];
        const spawnPoint = getRandomSpawnPoint();
        player.position = spawnPoint;
        // player.health = config.maxHealth; // Optional: Reset health
        // player.ammo = config.ammoCapacity; // Optional: Reset ammo
        // player.ammoReserve = config.maxAmmoReserve; // Optional: Reset reserve
        // player.score = 0; // Optional: Reset score
        player.isReloading = false; // Cancel reload on map change
        if (player.reloadTimeout) {
            clearTimeout(player.reloadTimeout);
            player.reloadTimeout = null;
        }
        // We'll notify clients about the change below, they'll handle their own reset/positioning.
    }


    // Notify all clients about the map change
    console.log(`[Server] Broadcasting 'map-change': ${currentMapName}`);
    io.emit('map-change', currentMapName); // Send the new map name

    // After map change, you might need to send an updated game-state
    // Or rely on clients requesting it / handling the map-change event properly
    // Let's emit the new state after a short delay to allow clients to process the map change event
    setTimeout(() => {
         console.log("[Server] Emitting game-state after map change.");
         io.emit('game-state', { players: players, mapName: currentMapName });
    }, 100); // 100ms delay
}


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`[+] User connected: ${socket.id}`);

    // Send the client their ID (optional, ID is available on connect)
    // socket.emit('your-id', socket.id);

    // Handle player joining
    socket.on('player-join', (data) => {
        const playerName = data?.name ? data.name.trim().substring(0, 16) : `Player_${socket.id.substring(0, 4)}`; // Sanitize name

        // Check if player already exists (e.g., refresh)
        if (players[socket.id]) {
            console.warn(`[*] Player ${playerName} (${socket.id}) rejoining or already exists.`);
            // Update name if changed?
            players[socket.id].name = playerName;
            // TODO: Decide how to handle rejoin (send full state again?)
        } else {
            console.log(`[*] Player ${playerName} (${socket.id}) trying to join.`);
            const spawnPoint = getRandomSpawnPoint();

            players[socket.id] = {
                id: socket.id,
                name: playerName,
                position: spawnPoint, // Server decides spawn based on current map logic
                rotation: { y: 0 },   // Initial rotation
                health: config.maxHealth,
                score: 0,
                ammo: config.ammoCapacity,
                ammoReserve: config.maxAmmoReserve,
                isReloading: false,
                reloadTimeout: null
            };
            console.log(`[*] Player ${players[socket.id].name} created at ${JSON.stringify(spawnPoint)}.`);
        }


        // Send the current game state (players AND current map) to the new player
        const currentGameState = {
             players: players,
             mapName: currentMapName // <<< Include current map name
        };
        console.log(`[DEBUG] Emitting 'game-state' to new player ${socket.id}. Map: ${currentMapName}, Players: ${Object.keys(players).length}`);
        socket.emit('game-state', currentGameState);

        // Notify all OTHER players about the new/updated player
        // Use the player object directly to ensure correct data is sent
        console.log(`[DEBUG] Broadcasting 'player-joined' for ${players[socket.id].name} (${socket.id}).`);
        socket.broadcast.emit('player-joined', players[socket.id]);

    });

    // Handle player movement updates
    socket.on('player-move', (data) => {
        const player = players[socket.id];
        // Only update living players and check if data is valid
        if (player && player.health > 0 && data?.position && data?.rotation) {
            // Basic validation/sanitization (can be expanded)
            if (typeof data.position.x === 'number' && typeof data.position.y === 'number' && typeof data.position.z === 'number') {
                 // Add boundary checks based on config
                 const bounds = config.mapBounds;
                 player.position.x = Math.max(-bounds.x, Math.min(bounds.x, data.position.x));
                 // Trust client Y for now, but clamp it reasonably? Base should be >= 0
                 player.position.y = Math.max(0, data.position.y);
                 player.position.z = Math.max(-bounds.z, Math.min(bounds.z, data.position.z));
            }
            if (typeof data.rotation.y === 'number') {
                player.rotation.y = data.rotation.y;
            }

            // Broadcast updated state to all other players
            // Throttling could be added here if needed
            socket.broadcast.emit('player-moved', {
                 id: socket.id,
                 position: player.position,
                 rotation: player.rotation
            });
        }
    });

    // Handle player shooting (Server-side Raycast)
    socket.on('player-shoot', (data) => {
         const shooter = players[socket.id];
         // Validate shooter state and input data
         if (!shooter || shooter.health <= 0 || shooter.isReloading || shooter.ammo <= 0 || !data?.direction) {
             // console.log(`[!] Invalid shoot request from ${socket.id}`); // Reduce logging noise
             return;
         }

         // Consume ammo
         shooter.ammo--;

         // --- Prepare Bullet Data for Client Visuals ---
         // Calculate direction and velocity (even though server uses raycast for hit)
         const direction = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z).normalize();
         const velocity = direction.clone().multiplyScalar(config.bulletSpeed);

         // Use server's authoritative position + eye level offset for bullet origin
         const eyeLevelOffset = config.playerHitboxHeight * 0.8; // Approx eye level based on hitbox height
         const spawnY = shooter.position.y + eyeLevelOffset;
         const bulletSpawnPos = { x: shooter.position.x, y: spawnY, z: shooter.position.z };

         const bulletData = {
             id: `bullet_${socket.id}_${Date.now()}`,
             ownerId: socket.id,
             position: bulletSpawnPos,
             velocity: { x: velocity.x, y: velocity.y, z: velocity.z }
         };
         // console.log('[DEBUG] Emitting bullet-fired:', JSON.stringify(bulletData));
         io.emit('bullet-fired', bulletData); // Emit to all including shooter

          // --- Server-Side Hit Detection (Raycast) ---
          const rayOrigin = new THREE.Vector3(bulletSpawnPos.x, bulletSpawnPos.y, bulletSpawnPos.z);
          const raycaster = new THREE.Raycaster(rayOrigin, direction, 0.1, 1000); // Near, Far

          let hitPlayer = null;
          let minDistanceSq = Infinity; // Use squared distance for efficiency

          for (const targetId in players) {
              if (targetId === socket.id) continue; // Can't shoot self
              const target = players[targetId];
              if (!target || target.health <= 0) continue; // Ignore dead or invalid players

              // Use a simplified capsule/cylinder check or Bounding Box check
              // Bounding Box check is simpler here:
              const targetBox = new THREE.Box3(
                    // Assuming target.position.y is the base
                    new THREE.Vector3(
                        target.position.x - config.playerHitboxRadius,
                        target.position.y, // Base
                        target.position.z - config.playerHitboxRadius
                    ),
                    new THREE.Vector3(
                        target.position.x + config.playerHitboxRadius,
                        target.position.y + config.playerHitboxHeight, // Top
                        target.position.z + config.playerHitboxRadius
                    )
              );

              const intersectionPoint = new THREE.Vector3();
              // Check if ray intersects the target's bounding box
              if (raycaster.ray.intersectBox(targetBox, intersectionPoint)) {
                  const distanceSq = rayOrigin.distanceToSquared(intersectionPoint);
                  if (distanceSq < minDistanceSq) {
                       minDistanceSq = distanceSq;
                       hitPlayer = target; // Store the player object
                  }
              }
              // TODO: Add raycast checks against map obstacles here if needed
          }

          // --- Handle Hit ---
          if (hitPlayer) {
              // console.log(`[HIT] ${shooter.name} hit ${hitPlayer.name}`);
              hitPlayer.health -= config.bulletDamage;
              hitPlayer.health = Math.max(0, hitPlayer.health); // Clamp health >= 0

              // Broadcast hit event
              io.emit('player-hit', {
                  victimId: hitPlayer.id,
                  attackerId: shooter.id,
                  damage: config.bulletDamage, // Optional: send damage amount
                  victimHealth: hitPlayer.health
              });

              // Check for kill
              if (hitPlayer.health <= 0) {
                   shooter.score++; // Award score to killer
                   console.log(`[KILL] ${shooter.name} killed ${hitPlayer.name}. Score: ${shooter.score}`);

                   // Broadcast death event
                   io.emit('player-died', {
                        victimId: hitPlayer.id,
                        attackerId: shooter.id,
                        victimName: hitPlayer.name,
                        attackerName: shooter.name,
                        attackerScore: shooter.score // Send updated score
                   });

                   // Schedule respawn for the victim
                   setTimeout(() => {
                       // Check if player still exists (might disconnect before respawn)
                       if(players[hitPlayer.id]) {
                           respawnPlayer(hitPlayer.id);
                       }
                   }, config.respawnTime);
              }
          }
         // Check if shooter is now out of ammo (after shooting)
         if(shooter.ammo <= 0 && shooter.ammoReserve > 0) {
             // Optional: Automatically trigger reload server-side? Or rely on client request?
             // Let's rely on client request for now via 'request-reload'.
         }
    });

     // Handle player reload request
     socket.on('request-reload', () => {
         const player = players[socket.id];
         if (player && player.health > 0 && !player.isReloading && player.ammo < config.ammoCapacity && player.ammoReserve > 0) {
             player.isReloading = true;
             console.log(`[*] ${player.name} started reloading.`);

             if (player.reloadTimeout) clearTimeout(player.reloadTimeout); // Clear previous timeout

             player.reloadTimeout = setTimeout(() => {
                 // Ensure player hasn't disconnected or died during reload
                 if (players[socket.id] && players[socket.id].health > 0) {
                     const playerNow = players[socket.id]; // Re-fetch in case data changed
                     const ammoNeeded = config.ammoCapacity - playerNow.ammo;
                     const ammoToReload = Math.min(ammoNeeded, playerNow.ammoReserve);

                     playerNow.ammo += ammoToReload;
                     playerNow.ammoReserve -= ammoToReload;
                     playerNow.isReloading = false;
                     playerNow.reloadTimeout = null;

                     console.log(`[*] ${playerNow.name} finished reloading. Ammo: ${playerNow.ammo}/${playerNow.ammoReserve}`);

                     // Send completion back to the specific client
                     socket.emit('reload-complete', {
                         ammo: playerNow.ammo,
                         ammoReserve: playerNow.ammoReserve
                     });
                 } else {
                     // Player disconnected or died during reload, clear flags if they exist
                     if(players[socket.id]) {
                          players[socket.id].isReloading = false;
                          players[socket.id].reloadTimeout = null;
                     }
                     console.log(`[!] Reload cancelled for ${socket.id} (disconnected or died).`);
                 }
             }, config.reloadTime);
         }
     });


    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log(`[-] User disconnected: ${socket.id}. Reason: ${reason}`);
        if (players[socket.id]) {
            const playerName = players[socket.id].name;
             if (players[socket.id].reloadTimeout) {
                 clearTimeout(players[socket.id].reloadTimeout);
             }
            delete players[socket.id];
            // Notify other players
            console.log(`[DEBUG] Emitting 'player-left': ${socket.id}`);
            io.emit('player-left', socket.id);
            console.log(`[*] Player ${playerName} left.`);
        }
    });
});

// --- Respawn Logic ---
function respawnPlayer(playerId) {
    const player = players[playerId];
    if (!player) {
        console.warn(`[!] Tried to respawn non-existent player: ${playerId}`);
        return; // Player already disconnected
    }

    const spawnPoint = getRandomSpawnPoint();
    player.position = spawnPoint;
    player.health = config.maxHealth;
    player.ammo = config.ammoCapacity;
    // player.ammoReserve = config.maxAmmoReserve; // Decide if reserve resets
    player.isReloading = false;
     if (player.reloadTimeout) {
         clearTimeout(player.reloadTimeout);
         player.reloadTimeout = null;
     }

    console.log(`[*] Player ${player.name} respawned at ${JSON.stringify(spawnPoint)}`);

    // Notify all clients about the respawn
    io.emit('player-respawned', {
        id: player.id,
        position: player.position, // Send new position
        health: player.health,
        ammo: player.ammo,
        ammoReserve: player.ammoReserve
    });
}

// --- Start Server ---
http.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});

// Example of how to trigger a map change manually from server console (for testing)
// process.stdin.on('data', (input) => {
//   const command = input.toString().trim();
//   if (command.startsWith('map ')) {
//     const newMap = command.split(' ')[1];
//     if (newMap) { // Add check for map existence later if needed
//       changeMap(newMap);
//     } else {
//       console.log("Usage: map <mapname>");
//     }
//   }
// });