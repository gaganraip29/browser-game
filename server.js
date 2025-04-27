const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require("socket.io");
const THREE = require('three'); // Use three.js for vector math/raycasting

const io = new Server(http);

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static('public'));

console.log('Simple 3D Shooter Server');

// --- Game Constants ---
const config = {
    maxHealth: 100,
    respawnTime: 3000,
    ammoCapacity: 30,
    maxAmmoReserve: 90,
    reloadTime: 2000,
    bulletDamage: 25,
    bulletSpeed: 50, // Match client for consistency if needed
    playerHitRadius: 0.7, // Simplified hitbox radius
    mapBounds: { x: 100, z: 100 }, // Half-width/depth of the playable area
};

// --- Server State ---
let players = {}; // { socketId: { id, name, position, rotation, health, score, ammo, ammoReserve, isReloading, reloadTimeout } }
// Bullets are handled via instant raycast on server in this version


// --- Helper Functions ---
function getRandomSpawnPoint() {
     // Spawn within bounds, avoiding center slightly
     const padding = 10;
     return new THREE.Vector3(
         (Math.random() - 0.5) * (config.mapBounds.x * 2 - padding),
         1, // Standard height start
         (Math.random() - 0.5) * (config.mapBounds.z * 2 - padding)
     );
 }


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`[+] User connected: ${socket.id}`);

    // Send the client their ID
    socket.emit('your-id', socket.id);

    // Handle player joining
    socket.on('player-join', (data) => {
        console.log(`[*] Player ${data.name} (${socket.id}) trying to join.`);
        const playerName = data.name ? data.name.substring(0, 16) : `Player_${socket.id.substring(0, 4)}`; // Sanitize name

        const spawnPoint = getRandomSpawnPoint();

        players[socket.id] = {
            id: socket.id,
            name: playerName,
            position: spawnPoint, // Server decides spawn
            rotation: { y: 0 }, // Initial rotation
            health: config.maxHealth,
            score: 0,
            ammo: config.ammoCapacity,
            ammoReserve: config.maxAmmoReserve,
            isReloading: false,
            reloadTimeout: null
        };

        // Send the current state of all players (including the new one) to the new player
        console.log(`[DEBUG] Emitting 'game-state' to new player ${socket.id}. State: ${Object.keys(players).length} players.`); // <<< DEBUG LOG
        socket.emit('game-state', players);

        // Notify all other players about the new player
        console.log(`[DEBUG] Broadcasting 'player-joined' for ${players[socket.id].name} (${socket.id}).`); // <<< DEBUG LOG
        socket.broadcast.emit('player-joined', players[socket.id]);
        console.log(`[*] Player ${players[socket.id].name} joined at ${JSON.stringify(spawnPoint)}.`);
    });

    // Handle player movement updates
    socket.on('player-move', (data) => {
        const player = players[socket.id];
        if (player && player.health > 0) { // Only update living players
            // Basic validation/sanitization (can be expanded)
            if (data.position && typeof data.position.x === 'number' && typeof data.position.y === 'number' && typeof data.position.z === 'number') {
                 // Add boundary checks
                 player.position.x = Math.max(-config.mapBounds.x, Math.min(config.mapBounds.x, data.position.x));
                 player.position.y = data.position.y; // Trust client height for now (can cause issues)
                 player.position.z = Math.max(-config.mapBounds.z, Math.min(config.mapBounds.z, data.position.z));
            }
            if (data.rotation && typeof data.rotation.y === 'number') {
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
         if (!shooter || shooter.health <= 0 || shooter.isReloading || shooter.ammo <= 0) {
             console.log(`[!] Invalid shoot request from ${socket.id}`);
             return; // Ignore if dead, reloading, or out of ammo
         }

         // Consume ammo
         shooter.ammo--;

         console.log(`[*] ${shooter.name} shot. Ammo left: ${shooter.ammo}`);

         // Calculate bullet velocity vector (needed for client visual)
         const direction = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z).normalize();
         const velocity = direction.clone().multiplyScalar(config.bulletSpeed);

         // Emit bullet fired event for client visuals
         // Use server's authoritative position for bullet origin
         const bulletData = {
             id: `bullet_${socket.id}_${Date.now()}`, // Unique bullet ID
             ownerId: socket.id,
             position: { x: shooter.position.x, y: shooter.position.y + 1.6, z: shooter.position.z }, // Approx eye level
             velocity: { x: velocity.x, y: velocity.y, z: velocity.z }
         };
         console.log('[DEBUG] Emitting bullet-fired:', JSON.stringify(bulletData)); // <<< DEBUG LOG
         io.emit('bullet-fired', bulletData); // Emit to all including shooter

          // --- Server-Side Hit Detection (Raycast) ---
          const rayOrigin = new THREE.Vector3(shooter.position.x, shooter.position.y + 1.6, shooter.position.z); // Eye level
          const raycaster = new THREE.Raycaster(rayOrigin, direction, 0.1, 1000); // Near, Far

          let hitPlayer = null;
          let minDistance = Infinity;

          for (const targetId in players) {
              if (targetId === socket.id) continue; // Can't shoot self
              const target = players[targetId];
              if (target.health <= 0) continue; // Ignore dead players

              // Simplified bounding sphere check for hit
              const targetCenter = new THREE.Vector3(target.position.x, target.position.y + config.maxHealth / 100, target.position.z); // Center of player approx
              const distanceToTarget = rayOrigin.distanceTo(targetCenter);
              const sphere = new THREE.Sphere(targetCenter, config.playerHitRadius);

              const intersectionPoint = new THREE.Vector3();
              if (raycaster.ray.intersectSphere(sphere, intersectionPoint)) {
                  if (distanceToTarget < minDistance) {
                       minDistance = distanceToTarget;
                       hitPlayer = target;
                  }
              }
          }

          // --- Handle Hit ---
          if (hitPlayer) {
              console.log(`[HIT] ${shooter.name} hit ${hitPlayer.name}`);
              hitPlayer.health -= config.bulletDamage;
              hitPlayer.health = Math.max(0, hitPlayer.health); // Clamp health >= 0

              // Broadcast hit event
              io.emit('player-hit', {
                  victimId: hitPlayer.id,
                  attackerId: shooter.id,
                  damage: config.bulletDamage,
                  victimHealth: hitPlayer.health
              });

              // Check for kill
              if (hitPlayer.health <= 0) {
                   shooter.score += 1; // Award score to killer
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
                       respawnPlayer(hitPlayer.id);
                   }, config.respawnTime);
              }
          }
    });

     // Handle player reload request
     socket.on('request-reload', () => {
         const player = players[socket.id];
         if (player && player.health > 0 && !player.isReloading && player.ammo < config.ammoCapacity && player.ammoReserve > 0) {
             player.isReloading = true;
             console.log(`[*] ${player.name} started reloading.`);

             // Clear any previous reload timeout just in case
             if (player.reloadTimeout) clearTimeout(player.reloadTimeout);

             player.reloadTimeout = setTimeout(() => {
                 if (players[socket.id]) { // Check if player still exists
                     const ammoNeeded = config.ammoCapacity - player.ammo;
                     const ammoToReload = Math.min(ammoNeeded, player.ammoReserve);

                     player.ammo += ammoToReload;
                     player.ammoReserve -= ammoToReload;
                     player.isReloading = false;
                     player.reloadTimeout = null;

                     console.log(`[*] ${player.name} finished reloading. Ammo: ${player.ammo}/${player.ammoReserve}`);

                     // Send completion back to the specific client
                     socket.emit('reload-complete', {
                         ammo: player.ammo,
                         ammoReserve: player.ammoReserve
                     });
                 }
             }, config.reloadTime);
         }
     });


    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`[-] User disconnected: ${socket.id}`);
        if (players[socket.id]) {
            const playerName = players[socket.id].name;
            // Clear reload timeout if disconnecting during reload
             if (players[socket.id].reloadTimeout) {
                 clearTimeout(players[socket.id].reloadTimeout);
             }
            delete players[socket.id];
            // Notify other players
            console.log(`[DEBUG] Emitting 'player-left': ${socket.id}`); // <<< DEBUG LOG
            io.emit('player-left', socket.id);
            console.log(`[*] Player ${playerName} left.`);
        }
    });
});

// --- Respawn Logic ---
function respawnPlayer(playerId) {
    const player = players[playerId];
    if (!player) return; // Player might have disconnected before respawn

    const spawnPoint = getRandomSpawnPoint();
    player.position = spawnPoint;
    player.health = config.maxHealth;
    player.ammo = config.ammoCapacity;
    player.ammoReserve = config.maxAmmoReserve; // Restore full reserve on respawn
    player.isReloading = false; // Ensure not stuck reloading
     if (player.reloadTimeout) {
         clearTimeout(player.reloadTimeout);
         player.reloadTimeout = null;
     }


    console.log(`[*] Player ${player.name} respawned at ${JSON.stringify(spawnPoint)}`);

    // Notify all clients about the respawn
    io.emit('player-respawned', {
        id: player.id,
        position: player.position,
        health: player.health,
        ammo: player.ammo,
        ammoReserve: player.ammoReserve
    });
}

// --- Start Server ---
http.listen(PORT, () => {
    console.log(`Server listening on *:${PORT}`);
});