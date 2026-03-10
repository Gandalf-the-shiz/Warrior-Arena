import * as THREE from 'three';

/**
 * ArmorDegradation — tracks wear and blood accumulation on the warrior's armor.
 *
 * degradation: 0.0 = pristine gleaming steel, 1.0 = battle-worn, blood-soaked wreck.
 *
 * As degradation increases:
 *   - roughness  : 0.15 → 0.75  (armor dulls)
 *   - metalness  : 0.90 → 0.35  (loses metallic sheen)
 *   - clearcoat  : 0.35 → 0.00  (protective lacquer worn off)
 *   - color      : steel blue (#a0b0d0) → dark iron (#4a3828)
 *   - emissive   : slight dark-red blood absorption at high degradation
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
const WORN_ROUGHNESS     = 0.75;

const PRISTINE_METALNESS = 0.90;
const WORN_METALNESS     = 0.35;

const PRISTINE_CLEARCOAT = 0.35;
const WORN_CLEARCOAT     = 0.00;

const PRISTINE_STEEL  = new THREE.Color(0xa0b0d0);
const WORN_IRON       = new THREE.Color(0x4a3828);

const BLOOD_EMISSIVE  = new THREE.Color(0x3a0000);

/** How much degradation each incoming hit adds (before capping at 1.0). */
export const DEGRADATION_PER_HIT = 0.025;

/** Maximum emissive intensity of the blood-tint at full degradation. */
const MAX_BLOOD_EMISSIVE_INTENSITY = 0.6;

export class ArmorDegradation {
  /** 0 = pristine, 1 = fully degraded. Never resets within a run. */
  private _level = 0.0;

  private readonly materials: ArmorMaterialSet;

  // Working color buffer to avoid allocations per frame
  private readonly _colorScratch = new THREE.Color();

  constructor(materials: ArmorMaterialSet) {
    this.materials = materials;
    // Ensure baselines are applied at level 0
    this._applyToMaterials();
  }

  /** Current degradation level in [0, 1]. */
  get level(): number {
    return this._level;
  }

  /**
   * Call when the player takes damage.
   * Each hit increments degradation by DEGRADATION_PER_HIT, capped at 1.0.
   */
  onHit(): void {
    this._level = Math.min(1.0, this._level + DEGRADATION_PER_HIT);
    this._applyToMaterials();
  }

  /** Force a specific degradation level (e.g. for save/load). */
  setLevel(level: number): void {
    this._level = Math.max(0.0, Math.min(1.0, level));
    this._applyToMaterials();
  }

  /** Reset to pristine (call on new game). */
  reset(): void {
    this._level = 0.0;
    this._applyToMaterials();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _applyToMaterials(): void {
    const t = this._level;

    const roughness = THREE.MathUtils.lerp(PRISTINE_ROUGHNESS, WORN_ROUGHNESS, t);
    const metalness = THREE.MathUtils.lerp(PRISTINE_METALNESS, WORN_METALNESS, t);
    const clearcoat = THREE.MathUtils.lerp(PRISTINE_CLEARCOAT, WORN_CLEARCOAT, t);

    // Color lerp: steel blue → dark iron
    this._colorScratch.lerpColors(PRISTINE_STEEL, WORN_IRON, t);

    // Emissive: very subtle dark-red tint builds at high degradation (blood absorption)
    const emissiveIntensity = t * t * MAX_BLOOD_EMISSIVE_INTENSITY; // quadratic ramp

    const mats = [
      this.materials.iron,
      this.materials.helmet,
      this.materials.pauldron,
      this.materials.gauntlet,
    ] as const;

    for (const mat of mats) {
      mat.roughness = roughness;
      mat.metalness = metalness;
      mat.clearcoat = clearcoat;
      mat.color.copy(this._colorScratch);
      mat.emissive.copy(BLOOD_EMISSIVE);
      mat.emissiveIntensity = emissiveIntensity;
      mat.needsUpdate = true;
    }
  }
}
