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
    this.buildPillars();
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
      color: 0x3c3630,
      roughness: 0.92,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(0, -0.2, 0);
    this.scene.add(mesh);

    // Static physics body — flat slab
    const body = this.physics.createStaticBody(0, -0.2, 0);
    this.physics.createCuboidCollider(body, RADIUS, 0.2, RADIUS);
  }

  // ── Pillars ──────────────────────────────────────────────────────────────

  private buildPillars(): void {
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x4a443a,
      roughness: 0.88,
      metalness: 0.05,
    });

    const COUNT = 10;
    const RING_RADIUS = 26;

    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * RING_RADIUS;
      const z = Math.sin(angle) * RING_RADIUS;

      // Randomise height and slight tilt for a "ruined" look
      const height = 3 + Math.random() * 5;
      const tiltAngle = (Math.random() - 0.5) * 0.12;
      const tiltAxis = new THREE.Vector3(
        Math.random() - 0.5,
        0,
        Math.random() - 0.5,
      ).normalize();

      const geo = new THREE.CylinderGeometry(0.5, 0.6, height, 8);
      const mesh = new THREE.Mesh(geo, pillarMat);
      mesh.position.set(x, height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.setRotationFromAxisAngle(tiltAxis, tiltAngle);
      this.scene.add(mesh);

      // Upright physics collider (approximation — good enough for gameplay)
      const body = this.physics.createStaticBody(x, height / 2, z);
      this.physics.createCylinderCollider(body, height / 2, 0.6);

      // Attach a torch to every other pillar
      if (i % 2 === 0) {
        this.addTorch(x * 0.85, height + 0.5, z * 0.85);
      }
    }
  }

  // ── Torches ──────────────────────────────────────────────────────────────

  private addTorch(x: number, y: number, z: number): void {
    const light = new THREE.PointLight(0xff6622, 6.0, 28, 2);
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
      base: 6.0,
    });

    // Create ember particle system for this torch
    this.createEmberSystem(x, y, z);
  }

  // ── Lighting ─────────────────────────────────────────────────────────────

  private buildLighting(): void {
    // Pale moonlight — raised for arena floor readability
    const moon = new THREE.DirectionalLight(0x6688cc, 2.2);
    moon.position.set(20, 40, 10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 120;
    moon.shadow.camera.left = -40;
    moon.shadow.camera.right = 40;
    moon.shadow.camera.top = 40;
    moon.shadow.camera.bottom = -40;
    moon.shadow.bias = -0.001;
    this.scene.add(moon);

    // Dim warm ambient — hints of volcanic heat deep below
    const ambient = new THREE.AmbientLight(0x443355, 1.1);
    this.scene.add(ambient);

    // Hemisphere light for sky/ground fill — cool sky, warm ground
    const hemi = new THREE.HemisphereLight(0x445577, 0x331100, 0.9);
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

      // Fade out near end of particle life — use a simple loop to avoid allocation.
      const mat = sys.points.material as THREE.PointsMaterial;
      let ageSum = 0;
      for (let i = 0; i < count; i++) ageSum += sys.ages[i]!;
      const avgAge = ageSum / count;
      mat.opacity = Math.max(0.3, 0.9 * (1 - avgAge / sys.life));
    }
  }
}
