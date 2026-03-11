import * as THREE from 'three';

/**
 * ArmorDegradation — tracks wear, dents, and blood accumulation on the warrior's armor.
 *
 * degradation: 0.0 = pristine gleaming steel, 1.0 = battle-worn, blood-soaked wreck.
 *
 * Progressive degradation as the warrior battles:
 *   - roughness  : 0.15 → 0.75  (armor dulls, loses shine)
 *   - metalness  : 0.90 → 0.35  (loses metallic sheen)
 *   - clearcoat  : 0.35 → 0.00  (protective lacquer worn off)
 *   - color      : steel blue (#a0b0d0) → battle-worn rusty tone (#4a3828)
 *   - normalMap  : canvas-based dent impacts accumulate over time
 *   - emissiveMap: canvas-based blood accumulates per kill and per hit
 */

/** Materials that represent armor plates on the warrior. */
export interface ArmorMaterialSet {
  iron: THREE.MeshPhysicalMaterial;
  helmet: THREE.MeshPhysicalMaterial;
  pauldron: THREE.MeshPhysicalMaterial;
  gauntlet: THREE.MeshPhysicalMaterial;
}

// Pristine armor baseline values
const PRISTINE_ROUGHNESS = 0.15;
const WORN_ROUGHNESS     = 0.70;

const PRISTINE_METALNESS = 0.90;
const WORN_METALNESS     = 0.30;

const PRISTINE_CLEARCOAT = 0.35;
const WORN_CLEARCOAT     = 0.00;

const PRISTINE_STEEL  = new THREE.Color(0xa0b0d0);
const WORN_IRON       = new THREE.Color(0x4a3828);

/** How much degradation each incoming hit adds (before capping at 1.0). */
export const DEGRADATION_PER_HIT = 0.025;

/** Normal-map canvas size (both axes). */
const NM_SIZE = 256;
/** Blood canvas size (both axes). */
const BLOOD_SIZE = 256;

export class ArmorDegradation {
  /** 0 = pristine, 1 = fully degraded. Never resets within a run. */
  private _level = 0.0;
  /** Accumulated blood coverage [0, 1]. */
  private _bloodCoverage = 0.0;

  private readonly materials: ArmorMaterialSet;
  private readonly _colorScratch = new THREE.Color();

  // ── Blood accumulation canvas (used as emissiveMap) ────────────────────
  private readonly _bloodCanvas: HTMLCanvasElement;
  private readonly _bloodCtx: CanvasRenderingContext2D;
  private readonly _bloodTexture: THREE.CanvasTexture;

  // ── Dent / surface-detail normal map canvas ────────────────────────────
  private readonly _normalCanvas: HTMLCanvasElement;
  private readonly _normalCtx: CanvasRenderingContext2D;
  private readonly _normalTexture: THREE.CanvasTexture;

  constructor(materials: ArmorMaterialSet) {
    this.materials = materials;

    // ── Blood canvas ──────────────────────────────────────────────────────
    this._bloodCanvas = document.createElement('canvas');
    this._bloodCanvas.width  = BLOOD_SIZE;
    this._bloodCanvas.height = BLOOD_SIZE;
    this._bloodCtx = this._bloodCanvas.getContext('2d')!;
    // Start completely transparent (no blood)
    this._bloodCtx.clearRect(0, 0, BLOOD_SIZE, BLOOD_SIZE);
    this._bloodTexture = new THREE.CanvasTexture(this._bloodCanvas);

    // ── Normal map canvas ─────────────────────────────────────────────────
    this._normalCanvas = document.createElement('canvas');
    this._normalCanvas.width  = NM_SIZE;
    this._normalCanvas.height = NM_SIZE;
    this._normalCtx = this._normalCanvas.getContext('2d')!;
    this._buildBaseNormalMap();
    this._normalTexture = new THREE.CanvasTexture(this._normalCanvas);
    this._normalTexture.needsUpdate = true;

    // Assign dynamic textures to every armor material
    for (const mat of this._allMats()) {
      mat.emissiveMap  = this._bloodTexture;
      mat.normalMap    = this._normalTexture;
      mat.needsUpdate  = true;
    }

    // Apply pristine baseline values
    this._applyToMaterials();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Current degradation level in [0, 1]. */
  get level(): number { return this._level; }

  /**
   * Call when the player takes a hit from any source.
   * Increments degradation and paints a small dent + blood spot.
   * Backward-compatible alias for code that does not have a world position.
   */
  onHit(): void {
    this._level = Math.min(1.0, this._level + DEGRADATION_PER_HIT);
    this._paintRandomDent();
    this._paintBloodSpot(
      Math.random() * BLOOD_SIZE,
      Math.random() * BLOOD_SIZE,
      10 + Math.random() * 15,
    );
    this._applyToMaterials();
  }

  /**
   * Call when the player takes damage at a specific world-space position.
   * Paints a visible dent and blood spot near the impact location on the armor texture.
   * @param impactWorldPos  World position of the hit (used to map to UV space).
   */
  onHitTaken(impactWorldPos: THREE.Vector3): void {
    this._level = Math.min(1.0, this._level + DEGRADATION_PER_HIT);
    this._paintDentAt(impactWorldPos);
    this._paintBloodAt(impactWorldPos, 12 + Math.random() * 18);
    this._applyToMaterials();
  }

  /**
   * Call each time the warrior kills an enemy.
   * Splashes blood across the armor — more coverage per kill.
   */
  onEnemyKilled(): void {
    this._bloodCoverage = Math.min(1.0, this._bloodCoverage + 0.08);
    const splatterCount = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < splatterCount; i++) {
      this._paintBloodSplatter();
    }
    this._bloodTexture.needsUpdate = true;
    this._applyToMaterials();
  }

  /**
   * Call when the wave number advances.
   * Ramps up overall wear level — by wave 15 the warrior looks battered.
   * @param waveNumber  1-based current wave number.
   */
  onWaveAdvanced(waveNumber: number): void {
    const waveWear = Math.min(1.0, waveNumber / 15.0);
    // Never reduce degradation — only push it higher via wave progression
    this._level = Math.max(this._level, waveWear * 0.7);
    this._applyToMaterials();
  }

  /**
   * Per-frame update — propagates canvas changes to GPU textures.
   * Call from PlayerController.update() or the main game loop.
   */
  update(_delta: number): void {
    // Canvas textures set needsUpdate flags inline as they are painted;
    // this method is reserved for future animated transitions.
  }

  /** Force a specific degradation level (e.g. for testing / save-load). */
  setLevel(level: number): void {
    this._level = Math.max(0.0, Math.min(1.0, level));
    this._applyToMaterials();
  }

  /** Reset to pristine state (new game / new run). */
  reset(): void {
    this._level        = 0.0;
    this._bloodCoverage = 0.0;

    this._bloodCtx.clearRect(0, 0, BLOOD_SIZE, BLOOD_SIZE);
    this._bloodTexture.needsUpdate = true;

    this._buildBaseNormalMap();
    this._normalTexture.needsUpdate = true;

    this._applyToMaterials();
  }

  // ── Canvas helpers ─────────────────────────────────────────────────────────

  /**
   * Build the base normal map: flat neutral normal + rivet grid + panel seam lines.
   * This gives pristine armor visible surface detail even at degradation 0.
   */
  private _buildBaseNormalMap(): void {
    // Flat neutral normal — RGB(128, 128, 255)
    this._normalCtx.fillStyle = `rgb(128,128,255)`;
    this._normalCtx.fillRect(0, 0, NM_SIZE, NM_SIZE);

    // Rivet grid — slight raised-bump effect every 32 px
    const SPACING = 32;
    for (let ry = SPACING / 2; ry < NM_SIZE; ry += SPACING) {
      for (let rx = SPACING / 2; rx < NM_SIZE; rx += SPACING) {
        const grad = this._normalCtx.createRadialGradient(rx, ry, 0, rx, ry, 5);
        grad.addColorStop(0,   `rgba(180,180,255,0.85)`); // raised bump highlight
        grad.addColorStop(0.6, `rgba(145,145,255,0.45)`);
        grad.addColorStop(1,   `rgba(128,128,255,0)`);
        this._normalCtx.fillStyle = grad;
        this._normalCtx.beginPath();
        this._normalCtx.arc(rx, ry, 5, 0, Math.PI * 2);
        this._normalCtx.fill();
      }
    }

    // Horizontal panel-seam lines every 64 px (plate boundaries)
    this._normalCtx.strokeStyle = `rgba(100,100,230,0.55)`;
    this._normalCtx.lineWidth = 1.5;
    for (let py = 64; py < NM_SIZE; py += 64) {
      this._normalCtx.beginPath();
      this._normalCtx.moveTo(0, py);
      this._normalCtx.lineTo(NM_SIZE, py);
      this._normalCtx.stroke();
    }
  }

  /** Map a world position (X/Y) to canvas UV coordinates. */
  private _worldToCanvas(
    worldPos: THREE.Vector3,
    canvasSize: number,
  ): [number, number] {
    // Rough mapping — the warrior model spans roughly ±1 in X and -1..1 in Y
    const u = ((worldPos.x * 0.4 + 0.5) * canvasSize + canvasSize * 10) % canvasSize;
    const v = ((-worldPos.y * 0.3 + 0.5) * canvasSize + canvasSize * 10) % canvasSize;
    return [u, v];
  }

  /** Paint a dent perturbation on the normal map at a world-space position. */
  private _paintDentAt(worldPos: THREE.Vector3): void {
    const [cx, cy] = this._worldToCanvas(worldPos, NM_SIZE);
    this._paintDentCircle(cx, cy, 12 + Math.random() * 10);
  }

  /** Paint a dent at a random canvas location. */
  private _paintRandomDent(): void {
    this._paintDentCircle(
      Math.random() * NM_SIZE,
      Math.random() * NM_SIZE,
      10 + Math.random() * 12,
    );
  }

  /**
   * Paint a concave dent at (cx, cy) with the given radius on the normal-map canvas.
   * Center: darker blue-Z (surface pushed inward). Rim: brighter highlight.
   */
  private _paintDentCircle(cx: number, cy: number, radius: number): void {
    const grad = this._normalCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   `rgba(90,90,195,0.95)`);  // deep dent — low Z normal
    grad.addColorStop(0.55,`rgba(110,100,220,0.7)`); // mid-dent wall
    grad.addColorStop(0.8, `rgba(165,155,255,0.55)`);// rim highlight
    grad.addColorStop(1,   `rgba(128,128,255,0)`);   // blend back to flat
    this._normalCtx.fillStyle = grad;
    this._normalCtx.beginPath();
    this._normalCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    this._normalCtx.fill();
    this._normalTexture.needsUpdate = true;
  }

  /** Paint a blood spot at a world-space position. */
  private _paintBloodAt(worldPos: THREE.Vector3, radius: number): void {
    const [cx, cy] = this._worldToCanvas(worldPos, BLOOD_SIZE);
    this._paintBloodSpot(cx, cy, radius);
  }

  /**
   * Paint a blood spot at canvas coordinates (cx, cy).
   * Cycles between dark crimson (#8B0000) and bright arterial red (#FF0000).
   */
  private _paintBloodSpot(cx: number, cy: number, radius: number): void {
    const r = Math.floor(139 + Math.random() * 116); // 139 (#8B) → 255 (#FF)
    const grad = this._bloodCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   `rgba(${r},0,0,0.92)`);
    grad.addColorStop(0.65,`rgba(${Math.floor(r * 0.6)},0,0,0.6)`);
    grad.addColorStop(1,   `rgba(80,0,0,0)`);
    this._bloodCtx.fillStyle = grad;
    this._bloodCtx.beginPath();
    this._bloodCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    this._bloodCtx.fill();
    this._bloodTexture.needsUpdate = true;
  }

  /**
   * Paint a larger blood splatter with randomised drip streaks.
   * Called on enemy kills.
   */
  private _paintBloodSplatter(): void {
    const cx = Math.random() * BLOOD_SIZE;
    const cy = Math.random() * BLOOD_SIZE;
    const radius = 20 + Math.random() * 40;
    this._paintBloodSpot(cx, cy, radius);

    // Drip streaks — a few thin lines extending downward from the splatter
    const dripCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < dripCount; i++) {
      const dx = cx + (Math.random() - 0.5) * radius * 0.8;
      const dy = cy + Math.random() * radius * 0.5;
      const dripLen = 25 + Math.random() * 50;
      const r = Math.floor(100 + Math.random() * 155);
      this._bloodCtx.strokeStyle = `rgba(${r},0,0,${0.5 + Math.random() * 0.45})`;
      this._bloodCtx.lineWidth   = 1 + Math.random() * 2.5;
      this._bloodCtx.beginPath();
      this._bloodCtx.moveTo(dx, dy);
      this._bloodCtx.lineTo(dx + (Math.random() - 0.5) * 6, dy + dripLen);
      this._bloodCtx.stroke();
    }
    this._bloodTexture.needsUpdate = true;
  }

  // ── Material application ───────────────────────────────────────────────────

  private _allMats(): THREE.MeshPhysicalMaterial[] {
    return [
      this.materials.iron,
      this.materials.helmet,
      this.materials.pauldron,
      this.materials.gauntlet,
    ];
  }

  private _applyToMaterials(): void {
    const t = this._level;

    const roughness = THREE.MathUtils.lerp(PRISTINE_ROUGHNESS, WORN_ROUGHNESS, t);
    const metalness = THREE.MathUtils.lerp(PRISTINE_METALNESS, WORN_METALNESS, t);
    const clearcoat = THREE.MathUtils.lerp(PRISTINE_CLEARCOAT, WORN_CLEARCOAT, t);

    this._colorScratch.lerpColors(PRISTINE_STEEL, WORN_IRON, t);

    // Blood emissive: quadratic ramp from degradation + linear from blood coverage
    const bloodEmissiveIntensity = Math.max(
      t * t * 0.55,
      this._bloodCoverage * 0.85,
    );

    for (const mat of this._allMats()) {
      mat.roughness = roughness;
      mat.metalness = metalness;
      mat.clearcoat = clearcoat;
      mat.color.copy(this._colorScratch);
      // Emissive color is a saturated crimson — the emissiveMap canvas acts as the mask
      mat.emissive.set(0xff0000);
      mat.emissiveIntensity = bloodEmissiveIntensity;
      mat.needsUpdate = true;
    }
  }
}

