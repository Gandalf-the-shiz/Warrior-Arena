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

// Atmospheric dust motes
interface DustSystem {
  points: THREE.Points;
  velocities: Float32Array; // 3 floats per mote
  origins: Float32Array;    // spawn x/z bounds for wrapping
}

// Instanced spectator row entry
interface SpectatorRow {
  mesh: THREE.InstancedMesh;
  count: number;
  phases: Float32Array;  // random swaying phases per instance
  speeds: Float32Array;  // random swaying speeds per instance
}

/**
 * The gladiator arena: ground, Roman colosseum, torchlight and invisible walls.
 */
export class Arena {
  private readonly torches: Array<{
    light: THREE.PointLight;
    speed: number;
    base: number;
  }> = [];

  private readonly emberSystems: TorchEmbers[] = [];
  private dustSystem: DustSystem | null = null;
  private readonly spectatorRows: SpectatorRow[] = [];
  private skyDomeMaterial: THREE.ShaderMaterial | null = null;

  /** Ground material — saved for blood accumulation updates. */
  private floorMat: THREE.MeshPhysicalMaterial | null = null;
  /** Total enemy kills accumulated — used to darken the sand. */
  private killCount = 0;

  /** Sandy pristine color → dark blood-soaked crimson */
  private readonly SAND_COLOR   = new THREE.Color(0xc8a070);
  private readonly BLOOD_COLOR  = new THREE.Color(0x3a0a08);
  private readonly _colorScratch = new THREE.Color();

  /** Number of kills after which the floor reaches full blood saturation. */
  private static readonly MAX_KILLS_FOR_BLOOD_SATURATION = 60;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    this.buildSkyDome();
    this.buildGround();
    this.buildArenaFloorDetails();
    this.buildColosseum();
    this.buildLighting();
    this.buildBoundaryWalls();
    this.buildAtmosphericDust();
  }

  /** Call every frame with elapsed time (seconds) and delta to animate torches and particles. */
  update(time: number, delta = 1 / 60): void {
    // Torch flicker — noise pattern for ±15% intensity variation
    for (const torch of this.torches) {
      const flicker = Math.sin(time * torch.speed) * 0.5 +
                      Math.sin(time * torch.speed * 2.3 + 1.1) * 0.25 +
                      Math.sin(time * torch.speed * 0.7 + 2.4) * 0.25;
      torch.light.intensity = torch.base + flicker * torch.base * 0.15;
    }
    // Animate sky dome time uniform
    if (this.skyDomeMaterial?.uniforms['time']) {
      this.skyDomeMaterial.uniforms['time'].value = time;
    }
    this.updateEmbers(delta);
    this.updateDust(delta);
    this.updateSpectators(time);
  }

  // ── Sky Dome ────────────────────────────────────────────────────────────

  /**
   * Call whenever an enemy is killed to progressively soak the arena floor
   * in blood. Color lerps from sandy (#c8a070) to dark crimson (#3a0a08)
   * over the first 60 kills, then stays fully blood-soaked.
   */
  onEnemyKilled(): void {
    this.killCount++;
    if (this.floorMat === null) return;
    // Full blood-soak after MAX_KILLS_FOR_BLOOD_SATURATION kills
    const t = Math.min(this.killCount / Arena.MAX_KILLS_FOR_BLOOD_SATURATION, 1.0);
    this._colorScratch.lerpColors(this.SAND_COLOR, this.BLOOD_COLOR, t);
    // Roughness decreases slightly as wet blood covers the sand
    this.floorMat.color.copy(this._colorScratch);
    this.floorMat.roughness = THREE.MathUtils.lerp(0.85, 0.55, t);
    this.floorMat.needsUpdate = true;
  }

  private buildSkyDome(): void {
    // Inside-facing sphere for procedural gradient sky
    const skyGeo = new THREE.SphereGeometry(490, 32, 16);
    this.skyDomeMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float time;
        varying vec3 vWorldDir;
        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);

          // Gradient: warm orange/amber horizon → deep dark blue zenith
          vec3 horizon = vec3(0.831, 0.584, 0.416); // #d4956a
          vec3 zenith  = vec3(0.102, 0.102, 0.243); // #1a1a3e
          vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.75, h));

          // Horizon glow band — extra warmth just above horizon
          float glow = smoothstep(0.15, 0.0, h) * 0.4;
          sky += vec3(0.8, 0.3, 0.05) * glow;

          // Procedural cloud noise using sin/cos wave combinations
          float nx = dir.x * 4.0 + time * 0.018;
          float nz = dir.z * 4.0 + time * 0.012;
          float cloud  = sin(nx * 2.1 + nz * 1.7) * 0.5 + 0.5;
          cloud *= sin(nx * 3.7 - nz * 2.3 + time * 0.025) * 0.5 + 0.5;
          cloud *= sin(nx * 0.8 + nz * 3.1 - time * 0.01) * 0.5 + 0.5;
          cloud = pow(cloud, 2.5) * 0.22 * smoothstep(0.0, 0.35, h) * smoothstep(0.9, 0.4, h);
          sky += vec3(cloud * 0.8, cloud * 0.65, cloud * 0.5);

          // Sun disk near light source direction (35, 65, 25 normalized)
          // 0.997 ≈ cos(4.4°) — angular half-angle of the sun disk in the shader
          vec3 sunDir = normalize(vec3(35.0, 65.0, 25.0));
          float sunDot = dot(dir, sunDir);
          const float SUN_DISK_EDGE  = 0.997; // cos(~4.4°) — sun disk boundary
          const float SUN_HALO_EDGE  = 0.970; // cos(~14°)  — halo outer edge
          float sunDisk = smoothstep(SUN_DISK_EDGE, 1.0, sunDot);
          float sunHalo = smoothstep(SUN_HALO_EDGE, SUN_DISK_EDGE, sunDot) * 0.35;
          sky += vec3(1.0, 0.85, 0.5) * (sunDisk + sunHalo);

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    const skyMesh = new THREE.Mesh(skyGeo, this.skyDomeMaterial);
    skyMesh.renderOrder = -1;
    this.scene.add(skyMesh);
  }

  // ── Ground ──────────────────────────────────────────────────────────────

  private buildGround(): void {
    const RADIUS = 30;

    // Generate a simple procedural noise DataTexture for the ground normal map
    // Generate a procedural tangent-space normal map DataTexture for the ground.
    // Uses finite-difference derivatives of a multi-octave height function to
    // produce properly normalized tangent-space normals: R=X, G=Y, B=Z in [0,255].
    const N = 128;
    const noiseData = new Uint8Array(N * N * 4);
    // Height function: multi-octave sin/cos noise for bumpy sand surface
    const height = (x: number, y: number): number =>
      (Math.sin(x * 37.1 + y * 23.7) * 0.5 + 0.5) * 0.5 +
      (Math.sin(x * 89.3 - y * 61.1) * 0.5 + 0.5) * 0.3 +
      (Math.sin(x * 151.7 + y * 117.3) * 0.5 + 0.5) * 0.2;

    const EPS = 0.004;   // finite-difference step in UV space
    const BUMP_SCALE = 6.0; // controls bump height prominence
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const idx = (i * N + j) * 4;
        const fx = j / N;
        const fy = i / N;
        // Central-difference gradient → raw tangent-space XY components
        const dhx = (height(fx + EPS, fy) - height(fx - EPS, fy)) / (2 * EPS);
        const dhy = (height(fx, fy + EPS) - height(fx, fy - EPS)) / (2 * EPS);
        // Tangent-space normal: (-∂h/∂x, -∂h/∂y, 1) normalised
        const nx = -dhx * BUMP_SCALE;
        const ny = -dhy * BUMP_SCALE;
        const nz = 1.0;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        // Map from [-1,1] → [0,255]
        noiseData[idx]     = Math.round(((nx / len) * 0.5 + 0.5) * 255); // R = X
        noiseData[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255); // G = Y
        noiseData[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255); // B = Z
        noiseData[idx + 3] = 255;
      }
    }
    const normalTex = new THREE.DataTexture(noiseData, N, N, THREE.RGBAFormat);
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.repeat.set(6, 6);
    normalTex.needsUpdate = true;

    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, 0.4, 64);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xc8a070,
      roughness: 0.85,
      metalness: 0.0,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    this.floorMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(0, -0.2, 0);
    this.scene.add(mesh);

    // Stone tile ring around outer edge (r=25-30)
    const tileRingMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a60,
      roughness: 0.7,
      metalness: 0.0,
    });
    const tileRing = new THREE.Mesh(new THREE.RingGeometry(25, 30, 64), tileRingMat);
    tileRing.rotation.x = -Math.PI / 2;
    tileRing.position.set(0, 0.02, 0);
    tileRing.receiveShadow = true;
    this.scene.add(tileRing);

    // Decorative center medallion
    this.buildCenterMedallion();

    // Static physics body — flat slab
    const body = this.physics.createStaticBody(0, -0.2, 0);
    this.physics.createCuboidCollider(body, RADIUS, 0.2, RADIUS);
  }

  /** Decorative stone medallion/emblem at arena center. */
  private buildCenterMedallion(): void {
    const mat1 = new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 0.8 });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.7 });
    const mat3 = new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.9 });

    // Outermost ring
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(4.2, 5.0, 32), mat3);
    ring1.rotation.x = -Math.PI / 2; ring1.position.y = 0.02;
    this.scene.add(ring1);

    // Middle ring
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(2.8, 4.0, 32), mat1);
    ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.02;
    this.scene.add(ring2);

    // Inner ring
    const ring3 = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.6, 32), mat2);
    ring3.rotation.x = -Math.PI / 2; ring3.position.y = 0.02;
    this.scene.add(ring3);

    // Center disk
    const center = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), mat3);
    center.rotation.x = -Math.PI / 2; center.position.y = 0.02;
    this.scene.add(center);

    // 8-pointed star spokes radiating from center
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 3.5), mat3);
      spoke.rotation.x = -Math.PI / 2;
      spoke.rotation.z = angle;
      spoke.position.y = 0.022;
      this.scene.add(spoke);
    }
  }

  /** Add blood stains, sand tracks, and weapon-rack props around arena floor. */
  private buildArenaFloorDetails(): void {
    // Blood stain decals — 22 stains with varying age/freshness
    const FRESH_BLOOD_PROBABILITY = 0.5; // 50% chance each stain is fresh vs. dried
    for (let i = 0; i < 22; i++) {
      const fresh = Math.random() > FRESH_BLOOD_PROBABILITY;
      const bloodMat = new THREE.MeshStandardMaterial({
        color: fresh ? 0x8b1a1a : 0x3a0808,    // fresh = brighter red, old = dark
        roughness: 1.0,
        transparent: true,
        opacity: fresh ? (0.6 + Math.random() * 0.35) : (0.25 + Math.random() * 0.3),
        depthWrite: false,
      });
      const angle = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 24;
      const w = 0.5 + Math.random() * 2.0;
      const d = 0.3 + Math.random() * 1.5;
      const stain = new THREE.Mesh(new THREE.PlaneGeometry(w, d), bloodMat);
      stain.rotation.x = -Math.PI / 2;
      stain.rotation.z = Math.random() * Math.PI;
      stain.position.set(Math.cos(angle) * r, 0.012, Math.sin(angle) * r);
      stain.receiveShadow = false;
      this.scene.add(stain);
    }

    // Sand groove radial lines from center
    const trackMat = new THREE.MeshStandardMaterial({ color: 0xa88855, roughness: 1.0 });
    const TRACK_COUNT = 8;
    for (let i = 0; i < TRACK_COUNT; i++) {
      const angle = (i / TRACK_COUNT) * Math.PI * 2;
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 27), trackMat);
      track.rotation.y = angle;
      track.position.set(0, 0.01, 0);
      track.receiveShadow = false;
      this.scene.add(track);
    }

    // Weapon racks (simple boxes + thin cylinders) near edges
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x4a3820, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x7a8898, metalness: 0.8, roughness: 0.3 });
    const RACK_ANGLES = [0.4, 2.2, 3.8, 5.2];
    for (const ang of RACK_ANGLES) {
      const rx = Math.cos(ang) * 26;
      const rz = Math.sin(ang) * 26;
      // Rack frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.2, 0.3), rackMat);
      frame.position.set(rx, 0.4, rz);
      frame.rotation.y = ang;
      frame.castShadow = true;
      this.scene.add(frame);
      // Weapons leaning (thin cylinders)
      for (let w = 0; w < 3; w++) {
        const weapon = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), metalMat);
        weapon.position.set(
          rx + Math.cos(ang) * (w - 1) * 0.55,
          1.0,
          rz + Math.sin(ang) * (w - 1) * 0.55,
        );
        weapon.rotation.z = 0.15;
        weapon.castShadow = true;
        this.scene.add(weapon);
      }
    }
  }

  // ── Colosseum ─────────────────────────────────────────────────────────────

  private buildColosseum(): void {
    // ── Shared materials — MeshPhysicalMaterial for aged Roman stone ──────
    const podiumMat = new THREE.MeshPhysicalMaterial({
      color: 0xd4c4a0, // warm limestone
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x1a1008),
      emissiveIntensity: 0.08, // subtle warm tint for torch-lit surfaces
    });
    const seatMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8a880, // slightly darker stone for seating
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const colMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0d4c0, // lighter limestone for columns
      roughness: 0.75,
      metalness: 0.0,
      clearcoat: 0.05, // slight aged polish
      clearcoatRoughness: 0.8,
    });
    const archFillMat = new THREE.MeshStandardMaterial({
      color: 0x101010, // dark shadow inside arches / gate tunnels
      roughness: 1.0,
    });
    const imperialMat = new THREE.MeshStandardMaterial({
      color: 0xd4a840,
      roughness: 0.5,
      metalness: 0.3,
      emissive: new THREE.Color(0x6a4000),
      emissiveIntensity: 0.3,
    });

    // ── Transition ring ───────────────────────────────────────────────────
    const transRing = new THREE.Mesh(
      new THREE.RingGeometry(30, 32, 64),
      new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 1.0, side: THREE.DoubleSide }),
    );
    transRing.rotation.x = -Math.PI / 2;
    transRing.position.set(0, 0, 0);
    transRing.receiveShadow = true;
    this.scene.add(transRing);

    // ── Podium wall (r=32, h=4) with arch niches ─────────────────────────
    const podWall = new THREE.Mesh(
      new THREE.CylinderGeometry(32, 32, 4, 64, 1, true),
      podiumMat,
    );
    podWall.position.set(0, 2.0, 0);
    podWall.receiveShadow = true;
    podWall.castShadow = true;
    this.scene.add(podWall);

    // Stone course seam lines on podium wall — darker horizontal bands
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a5a,
      roughness: 1.0,
    });
    for (let s = 0; s < 3; s++) {
      const seamY = 0.8 + s * 1.0;
      const seam = new THREE.Mesh(
        new THREE.CylinderGeometry(32.02, 32.02, 0.04, 64, 1, true),
        seamMat,
      );
      seam.position.set(0, seamY, 0);
      this.scene.add(seam);
    }

    // Moss/stain patches on lower wall portions (below y=3)
    const mossMat = new THREE.MeshStandardMaterial({
      color: 0x3a5a30, // dark moss green
      roughness: 1.0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let m = 0; m < 20; m++) {
      const angle = Math.random() * Math.PI * 2;
      const mx = Math.cos(angle) * 31.9;
      const mz = Math.sin(angle) * 31.9;
      const mossW = 0.8 + Math.random() * 2.0;
      const mossH = 0.5 + Math.random() * 1.5;
      const moss = new THREE.Mesh(new THREE.PlaneGeometry(mossW, mossH), mossMat);
      moss.position.set(mx, 0.8 + Math.random() * 1.5, mz);
      moss.rotation.y = angle + Math.PI; // face inward
      this.scene.add(moss);
    }

    // Arch niches on podium wall (rectangular alcoves)
    const NICHE_COUNT = 16;
    const NICHE_R = 31.9;
    for (let i = 0; i < NICHE_COUNT; i++) {
      const angle = (i / NICHE_COUNT) * Math.PI * 2;
      // Skip niche positions near the 4 gate angles
      const nearGate = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].some(
        (g) => Math.abs(((angle - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3,
      );
      if (nearGate) continue;
      const nx = Math.cos(angle) * NICHE_R;
      const nz = Math.sin(angle) * NICHE_R;
      const niche = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 1.2), archFillMat);
      niche.position.set(nx, 1.8, nz);
      niche.rotation.y = angle;
      this.scene.add(niche);
    }

    // Podium ledge top (r 32 → 37, y = 4)
    const ledge1 = new THREE.Mesh(new THREE.RingGeometry(32, 37, 64), podiumMat);
    ledge1.rotation.x = -Math.PI / 2;
    ledge1.position.set(0, 4, 0);
    ledge1.receiveShadow = true;
    this.scene.add(ledge1);

    // ── Arena gates (4 large arched openings) ────────────────────────────
    const GATE_ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (const gAngle of GATE_ANGLES) {
      this.buildGate(gAngle, 32, archFillMat, podiumMat);
    }

    // ── First tier stepped seating (r 37 → 44) ───────────────────────────
    const SEAT_ROWS = 5;
    for (let row = 0; row < SEAT_ROWS; row++) {
      const innerR = 37 + row * 1.4;
      const outerR = innerR + 1.3;
      const yBase = 4 + row * 1.5;

      // Bench surface
      const seatRing = new THREE.Mesh(new THREE.RingGeometry(innerR, outerR, 64), seatMat);
      seatRing.rotation.x = -Math.PI / 2;
      seatRing.position.set(0, yBase, 0);
      seatRing.receiveShadow = true;
      this.scene.add(seatRing);

      // Riser (vertical face)
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(innerR, innerR, 1.5, 64, 1, true),
        seatMat,
      );
      riser.position.set(0, yBase - 0.75, 0);
      riser.receiveShadow = true;
      this.scene.add(riser);
    }
    // Spectators on first tier
    this.buildSpectatorRow(39.5, 5.2, 60, 0.72, colMat);
    this.buildSpectatorRow(41.0, 6.7, 70, 0.70, colMat);
    this.buildSpectatorRow(42.5, 8.2, 80, 0.68, colMat);

    // ── Second tier colonnaded ring (r 44 → 52, h 11.5 → 19) ─────────────
    // Inner wall
    const t2wall = new THREE.Mesh(
      new THREE.CylinderGeometry(44, 44, 7.5, 64, 1, true),
      podiumMat,
    );
    t2wall.position.set(0, 15.25, 0);
    t2wall.receiveShadow = true;
    this.scene.add(t2wall);

    // Tier 2 seating
    for (let row = 0; row < 4; row++) {
      const innerR = 44 + row * 1.8;
      const outerR = innerR + 1.7;
      const yBase = 11.5 + row * 1.9;
      const tier2seat = new THREE.Mesh(new THREE.RingGeometry(innerR, outerR, 64), seatMat);
      tier2seat.rotation.x = -Math.PI / 2;
      tier2seat.position.set(0, yBase, 0);
      this.scene.add(tier2seat);
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(innerR, innerR, 1.9, 64, 1, true),
        seatMat,
      );
      riser.position.set(0, yBase - 0.95, 0);
      this.scene.add(riser);
    }
    // Tier 2 colonnade of arched columns
    const T2_COL_COUNT = 28;
    const T2_COL_R = 51.0;
    for (let i = 0; i < T2_COL_COUNT; i++) {
      const angle = (i / T2_COL_COUNT) * Math.PI * 2;
      const cx = Math.cos(angle) * T2_COL_R;
      const cz = Math.sin(angle) * T2_COL_R;
      const col2 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 8, 8), colMat);
      col2.position.set(cx, 15, cz);
      col2.castShadow = true;
      this.scene.add(col2);
      const cap2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.0), colMat);
      cap2.position.set(cx, 19.2, cz);
      this.scene.add(cap2);
    }
    // Spectators on second tier
    this.buildSpectatorRow(46.0, 13.2, 90, 0.62, colMat);
    this.buildSpectatorRow(47.8, 15.1, 100, 0.60, colMat);
    this.buildSpectatorRow(49.5, 17.0, 110, 0.58, colMat);

    // Tier 2 lintel ring connecting columns
    const t2lintel = new THREE.Mesh(
      new THREE.CylinderGeometry(51.2, 51.2, 0.6, 64, 1, true),
      podiumMat,
    );
    t2lintel.position.set(0, 19.1, 0);
    this.scene.add(t2lintel);

    // ── Third tier gallery (r 52 → 60) ────────────────────────────────────
    const t3wall = new THREE.Mesh(
      new THREE.CylinderGeometry(52, 52, 6.5, 64, 1, true),
      podiumMat,
    );
    t3wall.position.set(0, 22.25, 0);
    this.scene.add(t3wall);

    // Top gallery colonnade
    const T3_COL_COUNT = 36;
    const T3_COL_R = 59.0;
    for (let i = 0; i < T3_COL_COUNT; i++) {
      const angle = (i / T3_COL_COUNT) * Math.PI * 2;
      const cx = Math.cos(angle) * T3_COL_R;
      const cz = Math.sin(angle) * T3_COL_R;
      const col3 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 6, 8), colMat);
      col3.position.set(cx, 22, cz);
      col3.castShadow = true;
      this.scene.add(col3);
    }
    // Tier 3 spectator ring
    this.buildSpectatorRow(54.0, 19.5, 130, 0.52, colMat);
    this.buildSpectatorRow(56.0, 21.0, 140, 0.50, colMat);

    // Top lintel + parapet
    const t3lintel = new THREE.Mesh(
      new THREE.CylinderGeometry(59.5, 59.5, 0.7, 64, 1, true),
      podiumMat,
    );
    t3lintel.position.set(0, 25.1, 0);
    this.scene.add(t3lintel);

    const topCap = new THREE.Mesh(new THREE.RingGeometry(52, 62, 64), podiumMat);
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.set(0, 25.5, 0);
    this.scene.add(topCap);

    const parapet = new THREE.Mesh(
      new THREE.CylinderGeometry(61, 61, 2.5, 64, 1, true),
      podiumMat,
    );
    parapet.position.set(0, 26.75, 0);
    this.scene.add(parapet);

    // ── Velarium mast poles around top rim ────────────────────────────────
    const MAST_COUNT = 12;
    for (let i = 0; i < MAST_COUNT; i++) {
      const angle = (i / MAST_COUNT) * Math.PI * 2;
      const mx = Math.cos(angle) * 60.5;
      const mz = Math.sin(angle) * 60.5;
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 5, 6),
        new THREE.MeshStandardMaterial({ color: 0xa08060, roughness: 0.8 }),
      );
      mast.position.set(mx, 30, mz);
      mast.rotation.z = Math.sin(angle) * 0.15;
      mast.rotation.x = Math.cos(angle) * 0.15;
      mast.castShadow = true;
      this.scene.add(mast);
    }

    // ── Imperial box (VIP balcony, angle ≈ 0 / facing +Z) ─────────────────
    this.buildImperialBox(imperialMat, colMat);

    // ── Perimeter decorative columns at arena level ────────────────────────
    const COL_COUNT = 24;
    const COL_RADIUS = 31.5;
    for (let i = 0; i < COL_COUNT; i++) {
      const angle = (i / COL_COUNT) * Math.PI * 2;
      const nearGate = GATE_ANGLES.some(
        (g) => Math.abs(((angle - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.25,
      );
      if (nearGate) continue;
      const x = Math.cos(angle) * COL_RADIUS;
      const z = Math.sin(angle) * COL_RADIUS;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 5, 8), colMat);
      col.position.set(x, 2.5, z);
      col.castShadow = true;
      col.receiveShadow = true;
      this.scene.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), colMat);
      cap.position.set(x, 5.18, z);
      cap.castShadow = true;
      this.scene.add(cap);
    }
  }

  /** Build a gladiator gate arch at a given radial angle in the podium wall. */
  private buildGate(
    angle: number,
    wallR: number,
    darkMat: THREE.Material,
    stoneMat: THREE.Material,
  ): void {
    const gx = Math.cos(angle) * (wallR - 0.2);
    const gz = Math.sin(angle) * (wallR - 0.2);

    // Dark tunnel interior
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4.2, 1.0), darkMat);
    tunnel.position.set(gx, 2.1, gz);
    tunnel.rotation.y = angle;
    this.scene.add(tunnel);

    // Arch lintel above gate
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.5, 0.8), stoneMat);
    lintel.position.set(Math.cos(angle) * wallR, 4.4, Math.sin(angle) * wallR);
    lintel.rotation.y = angle;
    this.scene.add(lintel);

    // Iron portcullis bars (thin cylinders in a grid)
    const barMat = new THREE.MeshStandardMaterial({ color: 0x303030, metalness: 0.9, roughness: 0.4 });
    for (let b = -1; b <= 1; b++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.0, 5), barMat);
      const ox = Math.cos(angle + Math.PI / 2) * (b * 0.9);
      const oz = Math.sin(angle + Math.PI / 2) * (b * 0.9);
      bar.position.set(gx + ox, 2.0, gz + oz);
      this.scene.add(bar);
    }
    // Horizontal crossbars
    for (let h = 0; h < 3; h++) {
      const hbar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 5), barMat);
      hbar.position.set(gx, 0.8 + h * 1.2, gz);
      hbar.rotation.z = Math.PI / 2;
      hbar.rotation.y = angle;
      this.scene.add(hbar);
    }
  }

  /** Build the Imperial VIP balcony on the podium wall facing the arena. */
  private buildImperialBox(imperialMat: THREE.Material, colMat: THREE.Material): void {
    // Balcony platform protruding inward at angle=π (toward -Z side)
    const angle = Math.PI;
    const bx = Math.cos(angle) * 30;
    const bz = Math.sin(angle) * 30;

    const platform = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.4, 2.5), imperialMat);
    platform.position.set(bx, 4.2, bz);
    platform.rotation.y = angle;
    this.scene.add(platform);

    // Low balustrade
    const railing = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.6, 0.15), imperialMat);
    railing.position.set(bx + Math.cos(angle) * 1.2, 4.9, bz + Math.sin(angle) * 1.2);
    railing.rotation.y = angle;
    this.scene.add(railing);

    // Two flanking columns
    for (const side of [-1, 1]) {
      const cx = bx + Math.cos(angle + Math.PI / 2) * (side * 2.6);
      const cz = bz + Math.sin(angle + Math.PI / 2) * (side * 2.6);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 4.5, 8), colMat);
      col.position.set(cx, 6.6, cz);
      this.scene.add(col);
    }

    // 3 emperor/court spectator figures (slightly larger, special material)
    const empMat = new THREE.MeshStandardMaterial({
      color: 0xcc9922,
      roughness: 0.6,
      metalness: 0.1,
      emissive: new THREE.Color(0x441100),
      emissiveIntensity: 0.15,
    });
    for (let f = -1; f <= 1; f++) {
      const fx = bx + Math.cos(angle + Math.PI / 2) * (f * 1.5);
      const fz = bz + Math.sin(angle + Math.PI / 2) * (f * 1.5);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), empMat);
      body.position.set(fx, 5.3, fz);
      this.scene.add(body);
    }
  }

  /** Add an instanced row of spectators along a ring at radius r, height y. */
  private buildSpectatorRow(
    radius: number,
    y: number,
    count: number,
    scale: number,
    _colMat: THREE.Material,
  ): void {
    // 5 robe colors cycling
    const ROBE_COLORS = [0xcc3333, 0x3355aa, 0xeeeecc, 0x558855, 0xaa7733];
    const colorIdx = this.spectatorRows.length % ROBE_COLORS.length;
    const specMat = new THREE.MeshStandardMaterial({
      color: ROBE_COLORS[colorIdx],
      roughness: 0.85,
    });
    const geo = new THREE.CapsuleGeometry(0.18, 0.48, 3, 6);
    const mesh = new THREE.InstancedMesh(geo, specMat, count);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = radius + (Math.random() - 0.5) * 0.5;
      dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      const s = scale * (0.85 + Math.random() * 0.3);
      dummy.scale.setScalar(s);
      dummy.rotation.y = angle + Math.PI + (Math.random() - 0.5) * 0.5;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.5 + Math.random() * 1.5;
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.spectatorRows.push({ mesh, count, phases, speeds });
  }

  /** Animate spectator swaying. */
  private updateSpectators(time: number): void {
    const dummy = new THREE.Object3D();
    for (const row of this.spectatorRows) {
      for (let i = 0; i < row.count; i++) {
        row.mesh.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        // Compute base Y rotation from position direction
        const baseYaw = Math.atan2(dummy.position.x, dummy.position.z) + Math.PI;
        const sway = Math.sin(time * (row.speeds[i] ?? 1) + (row.phases[i] ?? 0)) * 0.04;
        dummy.rotation.setFromQuaternion(dummy.quaternion);
        dummy.rotation.y = baseYaw + sway;
        dummy.updateMatrix();
        row.mesh.setMatrixAt(i, dummy.matrix);
      }
      row.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ── Torches ──────────────────────────────────────────────────────────────

  private addTorch(x: number, y: number, z: number): void {
    // Stronger point light with larger range for dramatic torch-lit surfaces
    const light = new THREE.PointLight(0xff6622, 8.0, 40, 2);
    light.position.set(x, y, z);
    light.castShadow = false;
    this.scene.add(light);

    // Main fire billboard — larger, brighter
    const fireMat = new THREE.MeshStandardMaterial({
      color: 0xff9944,
      emissive: new THREE.Color(0xff5500),
      emissiveIntensity: 4.0,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const firePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), fireMat);
    firePlane.position.set(x, y + 0.25, z);
    this.scene.add(firePlane);

    // Second fire billboard at 90° — gives volumetric cross appearance
    const firePlane2 = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.65), fireMat);
    firePlane2.position.set(x, y + 0.2, z);
    firePlane2.rotation.y = Math.PI / 2;
    this.scene.add(firePlane2);

    // Emissive glow halo — additive blending soft disc
    const haloMat = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: new THREE.Color(0xff6600),
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), haloMat);
    halo.position.set(x, y + 0.15, z);
    halo.rotation.y = Math.PI / 4;
    this.scene.add(halo);

    this.torches.push({
      light,
      speed: 2 + Math.random() * 3,
      base: 8.0,
    });

    this.createEmberSystem(x, y, z);
  }

  // ── Lighting ─────────────────────────────────────────────────────────────

  private buildLighting(): void {
    // Key light — warm golden sun, angled for long dramatic shadows
    const sun = new THREE.DirectionalLight(0xffd4a0, 2.5);
    sun.position.set(35, 65, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.001; // crisp shadows
    this.scene.add(sun);

    // Fill light — cool blue-white from opposite side, no shadows
    const fill = new THREE.DirectionalLight(0xb0c8ff, 0.3);
    fill.position.set(-30, 30, -20);
    this.scene.add(fill);

    // Rim light — subtle edge highlights on warrior from above/behind
    const rim = new THREE.DirectionalLight(0xffd8a0, 0.4);
    rim.position.set(-10, 50, -40);
    this.scene.add(rim);

    // Ambient — reduced for more dramatic contrast
    const ambient = new THREE.AmbientLight(0xffefd5, 0.2);
    this.scene.add(ambient);

    // Hemisphere — cool sky blue top, warm sand bounce bottom
    const hemi = new THREE.HemisphereLight(0x8888cc, 0xc8a060, 0.5);
    this.scene.add(hemi);

    // 8 torches evenly spaced on the column ring at height 4.8
    const TORCH_COUNT = 8;
    const TORCH_RADIUS = 31.5;
    for (let i = 0; i < TORCH_COUNT; i++) {
      const angle = (i / TORCH_COUNT) * Math.PI * 2;
      const x = Math.cos(angle) * TORCH_RADIUS;
      const z = Math.sin(angle) * TORCH_RADIUS;
      this.addTorch(x, 4.8, z);
    }
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

  // ── Atmospheric dust ─────────────────────────────────────────────────────

  private buildAtmosphericDust(): void {
    const COUNT = 200;
    const ARENA_R = 26;
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    const origins = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * ARENA_R;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = Math.random() * 2.5; // hover between 0 and 2.5m

      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      origins[i * 3]       = x;
      origins[i * 3 + 1]   = y;
      origins[i * 3 + 2]   = z;

      // Slow drifting velocities (gentle wind)
      velocities[i * 3]     = (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xd4b888,
      size: 0.04,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.dustSystem = { points, velocities, origins };
  }

  private updateDust(delta: number): void {
    if (!this.dustSystem) return;

    const { points, velocities, origins } = this.dustSystem;
    const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
    const count = posAttr.count;
    const ARENA_R = 26;

    for (let i = 0; i < count; i++) {
      let px = posAttr.getX(i) + velocities[i * 3]!     * delta;
      let py = posAttr.getY(i) + velocities[i * 3 + 1]! * delta;
      let pz = posAttr.getZ(i) + velocities[i * 3 + 2]! * delta;

      // Gentle upward drift, clamp height
      if (py < 0) py = 0;
      if (py > 3) { py = 3; velocities[i * 3 + 1]! *= -1; }

      // Wrap at arena boundary
      const dist = Math.sqrt(px * px + pz * pz);
      if (dist > ARENA_R) {
        px = origins[i * 3]!;
        pz = origins[i * 3 + 2]!;
      }

      posAttr.setXYZ(i, px, py, pz);

      // Slight random drift variance
      velocities[i * 3]!     += (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 2]! += (Math.random() - 0.5) * 0.02;

      // Dampen to prevent runaway speeds
      velocities[i * 3]!     *= 0.99;
      velocities[i * 3 + 2]! *= 0.99;
    }

    posAttr.needsUpdate = true;
  }
}
