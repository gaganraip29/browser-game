// --- START OF FILE mapLoader.js ---

// Ensure THREE is loaded (optional check, good practice)
if (typeof THREE === 'undefined') {
    console.error("THREE.js library not loaded before mapLoader.js!");
}

// Map configurations (Keep this data structure)
const maps = {
    forest: {
        name: "Forest Glade", // Added descriptive name
        terrainColor: 0x8BC34A, // Lush Green
        skyColor: 0x87CEEB,     // Bright Sky Blue
        waterColor: 0x1E88E5,   // Deep Blue Water
        ambientLightIntensity: 0.6,
        directionalLightIntensity: 0.8,
        hemisphereLightGround: 0x4CAF50, // Match ground
        obstacles: [ // Rocks
            // Position: [x, y_center, z], Scale: [width, height, depth]
            // Note: We adjust Y position in loadMap based on scale[1]
            { position: [15, 0, 10], scale: [5, 5, 5], color: 0x808080 }, // Grey rock
            { position: [-10, 0, -15], scale: [8, 6, 8], color: 0x8D6E63 }, // Brownish rock
            { position: [0, 0, 20], scale: [6, 4, 10], color: 0x757575 },
            { position: [-20, 0, 5], scale: [4, 3, 4], color: 0xA1887F },
            { position: [25, 0, -20], scale: [7, 7, 6], color: 0x616161 },
            // Example of a taller obstacle
            { position: [-5, 0, 25], scale: [3, 10, 3], color: 0x5D4037 }, // Tall dark rock pillar
        ],
        trees: [ // Simple cylinder trunk + cone foliage
            // Position: [x, y_base_of_trunk, z], Scale: [trunk_radius, trunk_height, foliage_radius, foliage_height]
            { position: [10, 0, -5], scale: [0.8, 8, 2.5, 5] },
            { position: [-10, 0, -5], scale: [1, 10, 3, 6] },
            { position: [20, 0, 0], scale: [0.7, 7, 2, 4] },
            { position: [-15, 0, 15], scale: [1.2, 12, 4, 7] },
            { position: [5, 0, -25], scale: [0.9, 9, 3, 5.5] },
            { position: [-25, 0, -10], scale: [1.1, 11, 3.5, 6.5] },
        ],
        // Water plane (optional) - Position is center, Scale is width/depth
        water: { position: [0, -0.2, 40], scale: [200, 80], color: 0x1E88E5 } // Wider water area at the back
    },
    desert: {
        name: "Sandy Ruins",
        terrainColor: 0xEDC9AF, // Sandy Beige
        skyColor: 0xFFA07A,     // Light Salmon (Sunset/Sunrise)
        ambientLightIntensity: 0.5,
        directionalLightIntensity: 1.0, // Harsher sun
        hemisphereLightGround: 0xEDC9AF, // Match ground
        obstacles: [
            // Position: [x, y_center, z], Scale: [width, height, depth]
            { position: [0, 0, -15], scale: [10, 8, 10], type: 'pyramid', color: 0xD2B48C }, // Tan pyramid
            { position: [-15, 0, -5], scale: [6, 4, 6], type: 'ruin_cube', color: 0xB08D57 }, // Crumbling cube
            { position: [15, 0, -5], scale: [5, 5, 5], type: 'ruin_cylinder', color: 0xAE8E6A }, // Broken column
            { position: [-8, 0, 10], scale: [3, 2, 3], type: 'rock', color: 0xC19A6B }, // Sandstone rock
            { position: [8, 0, 15], scale: [4, 3, 2], type: 'rock', color: 0xBDA474 },
            { position: [0, 0, 25], scale: [20, 4, 3], type: 'wall', color: 0xA47C48 }, // Low wall
        ],
        cacti: [
            // Position: [x, y_base, z], Scale: [main_radius, main_height, arm_radius, arm_length]
            { position: [12, 0, -8], scale: [0.5, 3, 0.3, 1.5] },
            { position: [-12, 0, 8], scale: [0.6, 4, 0.35, 1.8] },
            { position: [20, 0, 15], scale: [0.4, 2.5, 0.25, 1.2] },
            { position: [-20, 0, -15], scale: [0.7, 5, 0.4, 2.0] },
        ]
        // No water in the desert
    },
    // Add more maps here following the same structure
    // Example: Snowy Tundra
    snow: {
        name: "Frozen Peak",
        terrainColor: 0xE0F2F7, // Very Light Blue/White
        skyColor: 0xB0E0E6,     // Powdery Blue Sky
        ambientLightIntensity: 0.7,
        directionalLightIntensity: 0.6,
        hemisphereLightGround: 0xFFFFFF, // White ground light
        obstacles: [ // Ice shards / rocks
            { position: [-5, 0, -10], scale: [4, 8, 4], color: 0xADD8E6 }, // Light blue ice
            { position: [10, 0, 5], scale: [6, 5, 6], color: 0x90CAF9 }, // Slightly darker blue
            { position: [-15, 0, 15], scale: [3, 12, 3], color: 0xFFFFFF }, // White snowdrift/ice pillar
            { position: [20, 0, -15], scale: [8, 6, 5], color: 0xB3E5FC },
        ],
        trees: [ // Pine trees
            // Using simpler cone for snow-covered look
             // Position: [x, y_base, z], Scale: [radius, height]
            { position: [0, 0, 20], scale: [3, 15], color: 0xCFD8DC }, // Snow covered
            { position: [-20, 0, 0], scale: [2.5, 12], color: 0xB0BEC5 },
            { position: [15, 0, -25], scale: [4, 18], color: 0xECEFF1 },
            { position: [-10, 0, 25], scale: [2, 10], color: 0xFFFFFF },
        ]
    }
};


/**
 * Clears existing map objects and loads a new map into the scene.
 * @param {string} mapName - The key of the map to load (e.g., 'forest', 'desert').
 * @param {THREE.Scene} scene - The Three.js scene to add objects to.
 * @param {THREE.AmbientLight} ambientLight - The ambient light to potentially adjust.
 * @param {THREE.DirectionalLight} directionalLight - The directional light to potentially adjust.
 * @param {THREE.HemisphereLight} hemisphereLight - The hemisphere light to potentially adjust.
 * @returns {Array<THREE.Mesh>} An array of the THREE.Mesh objects created for the map.
 */
function loadMap(mapName, scene, ambientLight, directionalLight, hemisphereLight) {
    const mapConfig = maps[mapName];
    if (!mapConfig) {
        console.error(`Map "${mapName}" not found!`);
        return []; // Return empty array if map doesn't exist
    }

    const createdObjects = []; // Store meshes created by this function

    // --- Basic Environment Setup ---

    // Terrain
    const terrainGeometry = new THREE.PlaneGeometry(200, 200); // Match original game.js size
    const terrainMaterial = new THREE.MeshLambertMaterial({ color: mapConfig.terrainColor }); // Use Lambert for less shine
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true; // Terrain should receive shadows
    terrain.userData.isGround = true; // Add a flag for potential specific checks
    scene.add(terrain);
    createdObjects.push(terrain);

    // Sky Color
    scene.background = new THREE.Color(mapConfig.skyColor);

    // Lighting Adjustment (optional, based on map config)
    if (ambientLight && mapConfig.ambientLightIntensity !== undefined) {
        ambientLight.intensity = mapConfig.ambientLightIntensity;
    }
    if (directionalLight && mapConfig.directionalLightIntensity !== undefined) {
        directionalLight.intensity = mapConfig.directionalLightIntensity;
        // Optional: Adjust sun direction per map?
        // directionalLight.position.set(x, y, z);
    }
     if (hemisphereLight && mapConfig.hemisphereLightGround !== undefined) {
        hemisphereLight.groundColor = new THREE.Color(mapConfig.hemisphereLightGround);
        // Optional: Adjust sky color of hemisphere light?
        // hemisphereLight.color = new THREE.Color(mapConfig.skyColor);
    }


    // --- Obstacles ---
    if (mapConfig.obstacles) {
        mapConfig.obstacles.forEach(obstacleData => {
            let geometry;
            const scale = obstacleData.scale; // [width, height, depth] or special meaning
            const position = obstacleData.position; // [x, y_center, z]
            const color = obstacleData.color || 0xaaaaaa; // Default grey
             const material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8, metalness: 0.1 });

            switch (obstacleData.type) {
                case 'pyramid':
                    // ConeGeometry(radius, height, radialSegments)
                    geometry = new THREE.ConeGeometry(scale[0] / 2, scale[1], 4); // scale[0] is base width, scale[1] is height
                    break;
                case 'ruin_cube':
                    geometry = new THREE.BoxGeometry(scale[0], scale[1], scale[2]);
                    // Optional: Add some randomness or damage effect here later
                    break;
                 case 'ruin_cylinder':
                    // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
                    geometry = new THREE.CylinderGeometry(scale[0]/2, scale[0]/2 * 0.8, scale[1], 12); // Slightly tapered top
                    break;
                case 'wall':
                    geometry = new THREE.BoxGeometry(scale[0], scale[1], scale[2]);
                    break;
                case 'rock': // Default to BoxGeometry if type is 'rock' or undefined/standard box
                default:
                    geometry = new THREE.BoxGeometry(scale[0], scale[1], scale[2]);
                    break;
            }

            const mesh = new THREE.Mesh(geometry, material);
             // Set position - Obstacle Y position is its center, so add half height to place base at y=0
            mesh.position.set(position[0], position[1] + scale[1] / 2, position[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.isObstacle = true; // Flag for collision type
            scene.add(mesh);
            createdObjects.push(mesh);
        });
    }

    // --- Trees (Forest Map Example) ---
    if (mapConfig.trees) {
        mapConfig.trees.forEach(treeData => {
            const position = treeData.position; // [x, y_base, z]
            const scale = treeData.scale; // [trunk_radius, trunk_height, foliage_radius, foliage_height]
            const trunkColor = 0x8B4513; // Brown
            const foliageColor = 0x2E8B57; // Forest Green

            // Tree trunk
            const trunkGeometry = new THREE.CylinderGeometry(scale[0], scale[0] * 0.8, scale[1], 8); // Slightly tapered
            const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.9 });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            // Position trunk base at y=0
            trunk.position.set(position[0], position[1] + scale[1] / 2, position[2]);
            trunk.castShadow = true;
            trunk.receiveShadow = true;
            trunk.userData.isTreePart = true;
            scene.add(trunk);
            createdObjects.push(trunk);

            // Tree foliage (Cone)
            const foliageGeometry = new THREE.ConeGeometry(scale[2], scale[3], 8);
            const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.8 });
            const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
            // Position foliage base slightly above trunk top
            foliage.position.set(position[0], position[1] + scale[1] + scale[3] / 2 - 0.5, position[2]); // Adjust Y based on trunk height and foliage height
            foliage.castShadow = true;
            foliage.receiveShadow = false; // Foliage often looks better not receiving shadows
            foliage.userData.isTreePart = true;
            scene.add(foliage);
            createdObjects.push(foliage);
        });
    }

    // --- Cacti (Desert Map Example) ---
    if (mapConfig.cacti) {
        mapConfig.cacti.forEach(cactusData => {
            const position = cactusData.position; // [x, y_base, z]
            const scale = cactusData.scale; // [main_radius, main_height, arm_radius, arm_length]
            const cactusColor = 0x556B2F; // Dark Olive Green

            const cactusMaterial = new THREE.MeshStandardMaterial({ color: cactusColor, roughness: 0.7 });

            // Main cactus body
            const bodyGeometry = new THREE.CylinderGeometry(scale[0], scale[0]*0.9, scale[1], 10); // Slightly tapered
            const cactusBody = new THREE.Mesh(bodyGeometry, cactusMaterial);
             cactusBody.position.set(position[0], position[1] + scale[1] / 2, position[2]);
            cactusBody.castShadow = true;
            cactusBody.receiveShadow = true;
            cactusBody.userData.isCactusPart = true;
            scene.add(cactusBody);
            createdObjects.push(cactusBody);

            // Add cactus arms (simple example)
            const armGeometry = new THREE.CylinderGeometry(scale[2], scale[2], scale[3], 6);

            // Arm 1 (bent upwards)
            const arm1 = new THREE.Mesh(armGeometry, cactusMaterial);
            arm1.position.set(position[0] + scale[0], position[1] + scale[1] * 0.6, position[2]); // Attach partway up
            arm1.rotation.z = Math.PI / 4; // Angle upwards
            arm1.castShadow = true;
            arm1.receiveShadow = true;
             arm1.userData.isCactusPart = true;
            scene.add(arm1);
            createdObjects.push(arm1);

             // Arm 2 (bent upwards)
            const arm2 = new THREE.Mesh(armGeometry, cactusMaterial);
            arm2.position.set(position[0] - scale[0], position[1] + scale[1] * 0.7, position[2]); // Attach slightly higher
            arm2.rotation.z = -Math.PI / 3; // Angle upwards differently
            arm2.castShadow = true;
            arm2.receiveShadow = true;
            arm2.userData.isCactusPart = true;
            scene.add(arm2);
            createdObjects.push(arm2);
        });
    }
     // --- Pine Trees (Snow Map Example) ---
    if (mapConfig.name === "Frozen Peak" && mapConfig.trees) { // Specific check for snow map trees
        mapConfig.trees.forEach(treeData => {
            const position = treeData.position; // [x, y_base, z]
            const scale = treeData.scale; // [radius, height]
            const treeColor = treeData.color || 0xE0F2F7; // Default to snowy color

            // Simple cone for a snow-covered pine tree
            const treeGeometry = new THREE.ConeGeometry(scale[0], scale[1], 10);
            const treeMaterial = new THREE.MeshStandardMaterial({ color: treeColor, roughness: 0.9 });
            const tree = new THREE.Mesh(treeGeometry, treeMaterial);
            // Position base of cone at y=0
            tree.position.set(position[0], position[1] + scale[1] / 2, position[2]);
            tree.castShadow = true;
            tree.receiveShadow = true;
            tree.userData.isTreePart = true;
            scene.add(tree);
            createdObjects.push(tree);
        });
    }


    // --- Water ---
    if (mapConfig.water) {
        const waterData = mapConfig.water;
        const waterGeometry = new THREE.PlaneGeometry(waterData.scale[0], waterData.scale[1]); // width, depth
        const waterMaterial = new THREE.MeshStandardMaterial({
            color: waterData.color || 0x1E88E5,
            transparent: true,
            opacity: 0.85,
            roughness: 0.2,
            metalness: 0.1,
             // side: THREE.DoubleSide // Render both sides if needed
        });
        const water = new THREE.Mesh(waterGeometry, waterMaterial);
        water.rotation.x = -Math.PI / 2;
        water.position.set(waterData.position[0], waterData.position[1], waterData.position[2]);
        water.receiveShadow = true; // Water can receive shadows (subtly)
        water.userData.isWater = true; // Flag for specific interactions (e.g., slow movement)
        scene.add(water);
        createdObjects.push(water);
    }

    console.log(`Loaded map: ${mapConfig.name || mapName}. Added ${createdObjects.length} objects.`);
    return createdObjects; // Return the list of meshes added
}


// Export the function and maps object so game.js can use them
export { loadMap, maps };

// --- END OF FILE mapLoader.js ---