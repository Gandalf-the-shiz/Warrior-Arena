import * as THREE from 'three';

// ── Shared materials ────────────────────────────────────────────────────────
const MAT_IRON = new THREE.MeshStandardMaterial({
  color: 0x8898b8, // brighter polished steel blue
  metalness: 0.85,
  roughness: 0.25,
});
const MAT_SKIN = new THREE.MeshStandardMaterial({
  color: 0xc49a6c, // warm tan skin
  roughness: 0.7,
});
const MAT_HELMET = new THREE.MeshStandardMaterial({
  color: 0x7a7a90, // visible steel
  metalness: 0.8,
  roughness: 0.3,
});
const MAT_VISOR = new THREE.MeshStandardMaterial({
  color: 0x881111,
  emissive: new THREE.Color(0x881111),
  emissiveIntensity: 2.5,
});
const MAT_HORN = new THREE.MeshStandardMaterial({
  color: 0x8a7040, // visible bone/ivory
  roughness: 0.6,
});
const MAT_PAULDRON = new THREE.MeshStandardMaterial({
  color: 0x6a6a88, // brighter steel, visible
  metalness: 0.8,
  roughness: 0.3,
});
const MAT_GAUNTLET = new THREE.MeshStandardMaterial({
  color: 0x4a4a68, // dark steel, visible
  metalness: 0.9,
  roughness: 0.2,
});
const MAT_BOOT = new THREE.MeshStandardMaterial({
  color: 0x5a4a38, // leather brown
  roughness: 0.8,
});
const MAT_CAPE = new THREE.MeshStandardMaterial({
  color: 0x8a1515, // rich crimson red
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.88,
});
const MAT_BLADE = new THREE.MeshStandardMaterial({
  color: 0x8899aa,
  metalness: 0.95,
  roughness: 0.1,
  emissive: new THREE.Color(0x6666ff),
  emissiveIntensity: 1.5,
});
const MAT_GROOVE = new THREE.MeshStandardMaterial({
  color: 0x445566,
  metalness: 0.9,
  roughness: 0.15,
});
const MAT_CROSSGUARD = new THREE.MeshStandardMaterial({
  color: 0x5a4a3a, // bronze
  metalness: 0.7,
  roughness: 0.4,
});
const MAT_GRIP = new THREE.MeshStandardMaterial({
  color: 0x4a3828, // leather
  roughness: 0.8,
});

function mkMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = castShadow;
  return m;
}

/**
 * Procedural warrior character built entirely from Three.js primitives.
 *
 * The model root sits at the centre of the physics capsule (y = 0).
 * Feet are at y ≈ −1.0, top of helmet at y ≈ +1.0, total height ≈ 2.0 units.
 *
 * Sub-groups exposed for AnimationStateMachine:
 *   torsoGroup, headGroup, leftArmGroup, rightArmGroup,
 *   leftLegGroup, rightLegGroup, swordGroup, capeGroup
 */
export class WarriorModel {
  readonly group: THREE.Group;

  // Animation-accessible sub-groups
  readonly torsoGroup: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly leftArmGroup: THREE.Group;
  readonly rightArmGroup: THREE.Group;
  readonly leftLegGroup: THREE.Group;
  readonly rightLegGroup: THREE.Group;
  readonly swordGroup: THREE.Group;
  readonly capeGroup: THREE.Group;

  // Cape geometry reference for vertex-wave animation
  private readonly capeGeo: THREE.BufferGeometry;
  private readonly capeBasePositions: Float32Array;

  constructor() {
    this.group = new THREE.Group();

    // ── Torso ──────────────────────────────────────────────────────────────
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.05, 0);

    const torso = mkMesh(new THREE.CapsuleGeometry(0.28, 0.5, 8, 16), MAT_IRON);
    this.torsoGroup.add(torso);

    // Chest plate — wider box over the front of the torso for proper knight silhouette
    const chestPlate = mkMesh(new THREE.BoxGeometry(0.54, 0.44, 0.18), MAT_IRON);
    chestPlate.position.set(0, 0.08, 0.08);
    this.torsoGroup.add(chestPlate);

    // Belt / waist piece at the bottom of the torso
    const belt = mkMesh(new THREE.BoxGeometry(0.50, 0.08, 0.22), MAT_GAUNTLET);
    belt.position.set(0, -0.22, 0);
    this.torsoGroup.add(belt);

    // Chainmail tasset / skirt — covers hip joint area where legs connect
    const tasset = mkMesh(new THREE.CylinderGeometry(0.30, 0.26, 0.22, 12), MAT_IRON);
    tasset.position.set(0, -0.38, 0);
    this.torsoGroup.add(tasset);

    // Pauldrons (shoulder armour — larger, more dramatic half-spheres)
    const pauldronGeo = new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const pauldronL = mkMesh(pauldronGeo, MAT_PAULDRON);
    pauldronL.position.set(-0.46, 0.38, 0);
    pauldronL.rotation.z = Math.PI / 2;
    this.torsoGroup.add(pauldronL);

    const pauldronR = mkMesh(pauldronGeo, MAT_PAULDRON);
    pauldronR.position.set(0.46, 0.38, 0);
    pauldronR.rotation.z = -Math.PI / 2;
    this.torsoGroup.add(pauldronR);

    // ── Head ───────────────────────────────────────────────────────────────
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.72, 0);

    // Base head (mostly hidden by helmet)
    const head = mkMesh(new THREE.SphereGeometry(0.19, 12, 10), MAT_SKIN);
    head.scale.set(1, 0.95, 0.95);
    this.headGroup.add(head);

    // Helmet dome — slightly taller/more imposing than before
    const helmet = mkMesh(
      new THREE.SphereGeometry(0.225, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      MAT_HELMET,
    );
    helmet.position.set(0, 0.04, 0);
    helmet.scale.set(1, 1.1, 1); // taller dome for more imposing look
    this.headGroup.add(helmet);

    // Face plate — covers front of helmet for full-face protection
    const facePlate = mkMesh(new THREE.BoxGeometry(0.26, 0.18, 0.06), MAT_HELMET);
    facePlate.position.set(0, -0.04, 0.18);
    this.headGroup.add(facePlate);

    // Visor T-slit — horizontal bar (glowing red eye slit)
    const visorH = mkMesh(new THREE.BoxGeometry(0.15, 0.038, 0.06), MAT_VISOR);
    visorH.position.set(0, 0.03, 0.21);
    this.headGroup.add(visorH);

    // Nasal guard — vertical bar
    const nasal = mkMesh(new THREE.BoxGeometry(0.03, 0.11, 0.05), MAT_HELMET);
    nasal.position.set(0, -0.03, 0.215);
    this.headGroup.add(nasal);

    // Neck guard / aventail — armour piece below the helmet
    const neckGuard = mkMesh(new THREE.CylinderGeometry(0.195, 0.215, 0.12, 12, 1, true), MAT_HELMET);
    neckGuard.position.set(0, -0.185, 0);
    this.headGroup.add(neckGuard);

    // Viking horns
    const hornGeo = new THREE.ConeGeometry(0.04, 0.22, 6);
    const hornL = mkMesh(hornGeo, MAT_HORN);
    hornL.position.set(-0.21, 0.14, 0);
    hornL.rotation.z = Math.PI / 2 + 0.25;
    this.headGroup.add(hornL);

    const hornR = mkMesh(hornGeo, MAT_HORN);
    hornR.position.set(0.21, 0.14, 0);
    hornR.rotation.z = -(Math.PI / 2 + 0.25);
    this.headGroup.add(hornR);

    this.torsoGroup.add(this.headGroup);

    // ── Left arm ──────────────────────────────────────────────────────────
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.44, 0.28, 0);

    const leftUpper = mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.6, 12), MAT_IRON);
    leftUpper.position.set(0, -0.3, 0);
    this.leftArmGroup.add(leftUpper);

    const leftGauntlet = mkMesh(new THREE.CylinderGeometry(0.1, 0.09, 0.18, 12), MAT_GAUNTLET);
    leftGauntlet.position.set(0, -0.66, 0);
    this.leftArmGroup.add(leftGauntlet);

    this.torsoGroup.add(this.leftArmGroup);

    // ── Right arm ─────────────────────────────────────────────────────────
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.44, 0.28, 0);

    const rightUpper = mkMesh(new THREE.CylinderGeometry(0.08, 0.07, 0.6, 12), MAT_IRON);
    rightUpper.position.set(0, -0.3, 0);
    this.rightArmGroup.add(rightUpper);

    const rightGauntlet = mkMesh(new THREE.CylinderGeometry(0.1, 0.09, 0.18, 12), MAT_GAUNTLET);
    rightGauntlet.position.set(0, -0.66, 0);
    this.rightArmGroup.add(rightGauntlet);

    this.torsoGroup.add(this.rightArmGroup);

    // ── Left leg ──────────────────────────────────────────────────────────
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.15, -0.22, 0);

    const leftThigh = mkMesh(new THREE.CylinderGeometry(0.11, 0.1, 0.52, 12), MAT_IRON);
    leftThigh.position.set(0, -0.26, 0);
    this.leftLegGroup.add(leftThigh);

    const leftKnee = mkMesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), MAT_GAUNTLET);
    leftKnee.position.set(0, -0.52, 0.02);
    this.leftLegGroup.add(leftKnee);

    const leftShin = mkMesh(new THREE.CylinderGeometry(0.09, 0.08, 0.42, 12), MAT_IRON);
    leftShin.position.set(0, -0.72, 0);
    this.leftLegGroup.add(leftShin);

    const leftBoot = mkMesh(new THREE.CylinderGeometry(0.12, 0.11, 0.2, 12), MAT_BOOT);
    leftBoot.position.set(0, -0.97, 0);
    this.leftLegGroup.add(leftBoot);

    this.torsoGroup.add(this.leftLegGroup);

    // ── Right leg ─────────────────────────────────────────────────────────
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.15, -0.22, 0);

    const rightThigh = mkMesh(new THREE.CylinderGeometry(0.11, 0.1, 0.52, 12), MAT_IRON);
    rightThigh.position.set(0, -0.26, 0);
    this.rightLegGroup.add(rightThigh);

    const rightKnee = mkMesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), MAT_GAUNTLET);
    rightKnee.position.set(0, -0.52, 0.02);
    this.rightLegGroup.add(rightKnee);

    const rightShin = mkMesh(new THREE.CylinderGeometry(0.09, 0.08, 0.42, 12), MAT_IRON);
    rightShin.position.set(0, -0.72, 0);
    this.rightLegGroup.add(rightShin);

    const rightBoot = mkMesh(new THREE.CylinderGeometry(0.12, 0.11, 0.2, 12), MAT_BOOT);
    rightBoot.position.set(0, -0.97, 0);
    this.rightLegGroup.add(rightBoot);

    this.torsoGroup.add(this.rightLegGroup);

    // ── Cape ──────────────────────────────────────────────────────────────
    this.capeGroup = new THREE.Group();
    this.capeGroup.position.set(0, 0.32, -0.3);

    this.capeGeo = new THREE.PlaneGeometry(0.65, 1.0, 3, 8);
    const capeMesh = mkMesh(this.capeGeo, MAT_CAPE, false);
    // Tilt top of cape forward slightly so it hangs from shoulders
    capeMesh.rotation.x = 0.15;
    this.capeGroup.add(capeMesh);

    // Store a copy of the initial positions for animation reference
    const basePosAttr = this.capeGeo.attributes.position as THREE.BufferAttribute;
    this.capeBasePositions = new Float32Array(basePosAttr.array as Float32Array);

    this.torsoGroup.add(this.capeGroup);

    // ── Greatsword ────────────────────────────────────────────────────────
    this.swordGroup = new THREE.Group();
    // Position grip at hand (gauntlet) level, slightly forward from arm; flip so blade points DOWN
    this.swordGroup.position.set(0, -0.81, 0.15);
    this.swordGroup.rotation.set(Math.PI, 0, 0); // blade points down in idle stance

    // Blade
    const blade = mkMesh(new THREE.BoxGeometry(0.06, 1.25, 0.012), MAT_BLADE);
    blade.position.set(0, 0.58, 0);
    this.swordGroup.add(blade);

    // Blood groove (runs along centre of blade)
    const groove = mkMesh(new THREE.BoxGeometry(0.016, 1.05, 0.014), MAT_GROOVE);
    groove.position.set(0, 0.58, 0.007);
    this.swordGroup.add(groove);

    // Crossguard
    const crossguard = mkMesh(new THREE.BoxGeometry(0.44, 0.06, 0.055), MAT_CROSSGUARD);
    crossguard.position.set(0, 0, 0);
    this.swordGroup.add(crossguard);

    // Grip
    const grip = mkMesh(new THREE.CylinderGeometry(0.035, 0.03, 0.3, 10), MAT_GRIP);
    grip.position.set(0, -0.15, 0);
    this.swordGroup.add(grip);

    // Pommel
    const pommel = mkMesh(new THREE.SphereGeometry(0.065, 7, 5), MAT_CROSSGUARD);
    pommel.position.set(0, -0.31, 0);
    this.swordGroup.add(pommel);

    this.rightArmGroup.add(this.swordGroup);

    // ── Assemble ──────────────────────────────────────────────────────────
    this.group.add(this.torsoGroup);
  }

  /**
   * Animate the cape with a gentle sine-wave vertex deformation.
   * @param time  Elapsed time in seconds.
   */
  updateCape(time: number): void {
    const posAttr = this.capeGeo.attributes.position as THREE.BufferAttribute;
    const base = this.capeBasePositions;
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      const bx = base[i * 3]!;
      const by = base[i * 3 + 1]!;
      // More wave amplitude toward the bottom of the cape
      const tNorm = 1 - (by + 0.5) / 1.0; // 0 at top, 1 at bottom
      const wave = Math.sin(time * 2.5 + by * 5 + bx * 2) * 0.05 * tNorm;
      posAttr.setX(i, bx + wave);
    }
    posAttr.needsUpdate = true;
  }

  /**
   * Toggle dodge i-frame transparency on all warrior meshes.
   * Cape retains its original partial transparency when restoring.
   */
  setDodgeTransparency(active: boolean): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (active) {
          mat.transparent = true;
          mat.opacity = 0.5;
        } else {
          const isCape = mat === MAT_CAPE;
          mat.transparent = isCape;
          mat.opacity = isCape ? 0.88 : 1.0;
        }
      }
    });
  }
}
