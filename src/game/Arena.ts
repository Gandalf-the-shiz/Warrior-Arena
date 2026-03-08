import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';

/**
 * The gladiator arena: ground, broken pillars, torchlight and invisible walls.
 */
export class Arena {
  private readonly torches: Array<{
    light: THREE.PointLight;
    speed: number;
    base: number;
  }> = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.buildGround();
    this.buildPillars();
    this.buildLighting();
    this.buildBoundaryWalls();
  }

  /** Call every frame with elapsed time (seconds) to animate torches. */
  update(time: number): void {
    for (const torch of this.torches) {
      torch.light.intensity = torch.base + Math.sin(time * torch.speed) * 0.3;
    }
  }

  // ── Ground ──────────────────────────────────────────────────────────────

  private buildGround(): void {
    const RADIUS = 30;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.4, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1812,
      roughness: 0.95,
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
      color: 0x28241e,
      roughness: 0.9,
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
    const light = new THREE.PointLight(0xff6622, 2.2, 15, 2);
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
      base: 2.0,
    });
  }

  // ── Lighting ─────────────────────────────────────────────────────────────

  private buildLighting(): void {
    // Pale moonlight
    const moon = new THREE.DirectionalLight(0x4466aa, 0.6);
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

    // Very dim warm ambient — hints of volcanic heat deep below
    const ambient = new THREE.AmbientLight(0x221111, 0.3);
    this.scene.add(ambient);
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
}
