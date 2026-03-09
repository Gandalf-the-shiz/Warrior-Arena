import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

// Per-torch ember particle burst
interface TorchEmbers {
  points: THREE.Points;
  velocities: Float32Array; // 3 floats per particle
  ages: Float32Array;
  life: number;
  origins?: Float32Array;   // spawn positions, initialised on first update
}

/**
 * The gladiator arena: ground, broken pillars, torchlight and invisible walls.
 */
export class Arena {
  private readonly torches: Array<{
    light: THREE.PointLight;
    speed: number;
    base: number;
  }> = [];

  private readonly emberSystems: TorchEmbers[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.buildGround();
    this.buildColosseum();
    this.buildLighting();
    this.buildBoundaryWalls();
  }

  /** Call every frame with elapsed time (seconds) and delta to animate torches and particles. */
  update(time: number, delta = 1 / 60): void {
    for (const torch of this.torches) {
      torch.light.intensity = torch.base + Math.sin(time * torch.speed) * 0.5;
    }
    this.updateEmbers(delta);
  }

  // ── Ground ──────────────────────────────────────────────────────────────

  private buildGround(): void {
    const RADIUS = 30;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.4, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc8a96e, // warm sand
      roughness: 1.0,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(0, -0.2, 0);
    this.scene.add(mesh);

    // Static physics body — flat slab
    const body = this.physics.createStaticBody(0, -0.2, 0);
    this.physics.createCuboidCollider(body, RADIUS, 0.2, RADIUS);
  }

  // ── Colosseum ─────────────────────────────────────────────────────────────

  private buildColosseum(): void {
    // Warm limestone / sandstone colour shared by all structural surfaces.
    // DoubleSide ensures every face (inner curved walls, ledge undersides, etc.)
    // is visible from wherever the camera happens to be.
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xe0d0b8,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    // Slightly brighter tone for the decorative columns at arena level
    const colMat = new THREE.MeshStandardMaterial({
      color: 0xf0e0c8,
      roughness: 0.80,
      metalness: 0.02,
    });

    // ── Transition ring: sand floor edge → perimeter wall ─────────────────
    // Fills the gap between the sand cylinder (r = 30) and the wall base (r = 32).
    const transRing = new THREE.Mesh(
      new THREE.RingGeometry(30, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xd4b888, roughness: 1.0, side: THREE.DoubleSide }),
    );
    transRing.rotation.x = -Math.PI / 2;
    transRing.position.set(0, 0, 0);
    transRing.receiveShadow = true;
    this.scene.add(transRing);

    // ── Tier 1: Vertical arena perimeter wall (r = 32, h = 5) ────────────
    const wall1 = new THREE.Mesh(
      new THREE.CylinderGeometry(32, 32, 5, 64, 1, true),
      stoneMat,
    );
    wall1.position.set(0, 2.5, 0);
    wall1.receiveShadow = true;
    this.scene.add(wall1);

    // Flat ledge at top of tier 1 (r 32 → 38, y = 5)
    const ledge1 = new THREE.Mesh(new THREE.RingGeometry(32, 38, 32), stoneMat);
    ledge1.rotation.x = -Math.PI / 2;
    ledge1.position.set(0, 5, 0);
    ledge1.receiveShadow = true;
    this.scene.add(ledge1);

    // ── Tier 2: Sloped bleacher seating (r 38 → 52, h = 14) ──────────────
    // The frustum widens upward so the inner face looks like rising seats.
    const tier2 = new THREE.Mesh(
      new THREE.CylinderGeometry(52, 38, 14, 64, 1, true),
      stoneMat,
    );
    tier2.position.set(0, 12, 0); // bottom at y = 5, top at y = 19
    tier2.receiveShadow = true;
    this.scene.add(tier2);

    // Flat ledge between tier 2 and tier 3 (r 52 → 58, y = 19)
    const ledge2 = new THREE.Mesh(new THREE.RingGeometry(52, 58, 32), stoneMat);
    ledge2.rotation.x = -Math.PI / 2;
    ledge2.position.set(0, 19, 0);
    ledge2.receiveShadow = true;
    this.scene.add(ledge2);

    // ── Tier 3: Upper bleacher seating (r 58 → 70, h = 14) ───────────────
    const tier3 = new THREE.Mesh(
      new THREE.CylinderGeometry(70, 58, 14, 64, 1, true),
      stoneMat,
    );
    tier3.position.set(0, 26, 0); // bottom at y = 19, top at y = 33
    tier3.receiveShadow = true;
    this.scene.add(tier3);

    // Top rim cap (r 58 → 72, y = 33) — closes off the upper edge
    const topCap = new THREE.Mesh(new THREE.RingGeometry(58, 72, 32), stoneMat);
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.set(0, 33, 0);
    this.scene.add(topCap);

    // Thin outer parapet wall standing on the top rim
    const parapet = new THREE.Mesh(
      new THREE.CylinderGeometry(71, 71, 3, 64, 1, true),
      stoneMat,
    );
    parapet.position.set(0, 34.5, 0);
    this.scene.add(parapet);

    // ── Decorative columns along the arena perimeter ──────────────────────
    const COL_COUNT = 24;
    const COL_RADIUS = 31.5;
    for (let i = 0; i < COL_COUNT; i++) {
      const angle = (i / COL_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * COL_RADIUS;
      const z = Math.sin(angle) * COL_RADIUS;

      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 5, 8),
        colMat,
      );
      col.position.set(x, 2.5, z);
      col.castShadow = true;
      col.receiveShadow = true;
      this.scene.add(col);

      // Small capital (top block) on each column
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.35, 0.9),
        colMat,
      );
      cap.position.set(x, 5.18, z);
      cap.castShadow = true;
      this.scene.add(cap);
    }
  }

  // ── Torches ──────────────────────────────────────────────────────────────

  private addTorch(x: number, y: number, z: number): void {
    const light = new THREE.PointLight(0xff6622, 3.5, 25, 2);
    light.position.set(x, y, z);
    light.castShadow = false; // too many shadow maps — skip for performance
    this.scene.add(light);

    // Small visual ember mesh
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 4),
      new THREE.MeshStandardMaterial({
        color: 0xff8833,
        emissive: 0xff4400,
        emissiveIntensity: 2,
      }),
    );
    ember.position.copy(light.position);
    this.scene.add(ember);

    this.torches.push({
      light,
      speed: 2 + Math.random() * 3,
      base: 3.5,
    });

    // Create ember particle system for this torch
    this.createEmberSystem(x, y, z);
  }

  // ── Lighting ─────────────────────────────────────────────────────────────

  private buildLighting(): void {
    // Bright Mediterranean sun — warm, high-angle, strong shadows
    const sun = new THREE.DirectionalLight(0xfff0c8, 2.5);
    sun.position.set(40, 70, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    // Warm fill light — bounced light from the sandy arena floor
    const ambient = new THREE.AmbientLight(0xffefd5, 0.9);
    this.scene.add(ambient);

    // Hemisphere light — clear blue sky above, warm sand below
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0xd4a96e, 1.2);
    this.scene.add(hemi);
  }

  // ── Invisible boundary walls ─────────────────────────────────────────────

  private buildBoundaryWalls(): void {
    const WALL_RADIUS = 30.5;
    const WALL_HEIGHT = 8;
    const SEGMENTS = 16;

    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const nextAngle = ((i + 1) / SEGMENTS) * Math.PI * 2;
      const midAngle = (angle + nextAngle) / 2;

      const x = Math.cos(midAngle) * WALL_RADIUS;
      const z = Math.sin(midAngle) * WALL_RADIUS;
      // Width of one segment chord
      const segWidth = 2 * WALL_RADIUS * Math.sin(Math.PI / SEGMENTS) + 0.1;

      const body = this.physics.createStaticBody(x, WALL_HEIGHT / 2, z);
      const collider = this.physics.createCuboidCollider(
        body,
        segWidth / 2,
        WALL_HEIGHT / 2,
        0.3,
      );
      // Rotate collider to face toward the arena centre
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, midAngle, 0));
      collider.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    }
  }

  // ── Torch ember particles ────────────────────────────────────────────────

  private createEmberSystem(x: number, y: number, z: number): void {
    const PARTICLE_COUNT = 12;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = x + (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 1] = y + Math.random() * 0.3;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.06,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const ages = new Float32Array(PARTICLE_COUNT);
    const life = 1.2 + Math.random() * 0.8;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      velocities[i * 3]     = (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = 0.4 + Math.random() * 0.8;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      ages[i] = Math.random() * life; // stagger start ages
    }

    this.emberSystems.push({ points, velocities, ages, life });
  }

  private updateEmbers(delta: number): void {
    for (const sys of this.emberSystems) {
      const posAttr = sys.points.geometry.attributes.position as THREE.BufferAttribute;
      const count = posAttr.count;

      // Store spawn origins on first use
      if (!sys.origins) {
        sys.origins = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          sys.origins[i * 3]     = posAttr.getX(i);
          sys.origins[i * 3 + 1] = posAttr.getY(i);
          sys.origins[i * 3 + 2] = posAttr.getZ(i);
        }
      }
      const origins = sys.origins;

      for (let i = 0; i < count; i++) {
        sys.ages[i] += delta;
        if (sys.ages[i] >= sys.life) {
          // Respawn at origin
          sys.ages[i] = 0;
          posAttr.setXYZ(i, origins[i * 3]!, origins[i * 3 + 1]!, origins[i * 3 + 2]!);
          sys.velocities[i * 3]!     = (Math.random() - 0.5) * 0.3;
          sys.velocities[i * 3 + 1]! = 0.4 + Math.random() * 0.8;
          sys.velocities[i * 3 + 2]! = (Math.random() - 0.5) * 0.3;
          continue;
        }

        const nx = posAttr.getX(i) + sys.velocities[i * 3]!     * delta;
        const ny = posAttr.getY(i) + sys.velocities[i * 3 + 1]! * delta;
        const nz = posAttr.getZ(i) + sys.velocities[i * 3 + 2]! * delta;
        posAttr.setXYZ(i, nx, ny, nz);

        // Mild drag
        sys.velocities[i * 3]!     *= 0.98;
        sys.velocities[i * 3 + 2]! *= 0.98;
      }

      posAttr.needsUpdate = true;

      // Fade out near end of particle life
      const mat = sys.points.material as THREE.PointsMaterial;
      const avgAge = Array.from(sys.ages).reduce((a, b) => a + b, 0) / count;
      mat.opacity = Math.max(0.3, 0.9 * (1 - avgAge / sys.life));
    }
  }
}
