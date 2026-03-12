import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { Enemy, EnemyType } from '@/game/Enemy';
import { BossEnemy } from '@/game/BossEnemy';
import { EnemyCommander } from '@/game/EnemyCommander';
import { HUD } from '@/ui/HUD';
import type { SkillSystem } from '@/game/SkillSystem';

// Radius at which enemies spawn around the arena edge
const SPAWN_RADIUS = 20;

export type WaveModifier =
  | 'NONE'
  | 'BERSERKER'
  | 'ARMORED'
  | 'SWARM'
  | 'ELITE'
  | 'PHANTOM'     // enemies become briefly invincible on low HP
  | 'CURSED'      // enemies deal extra damage
  | 'REINFORCED'  // wave partially replenishes once when half are dead
  | 'CORRUPTED';  // enemies are faster and harder but drop extra loot

const MODIFIER_LABELS: Record<WaveModifier, string> = {
  NONE:        '',
  BERSERKER:   '⚡ BERSERKER',
  ARMORED:     '🛡️ ARMORED',
  SWARM:       '🐝 SWARM',
  ELITE:       '👑 ELITE',
  PHANTOM:     '👻 PHANTOM',
  CURSED:      '☠️ CURSED',
  REINFORCED:  '🔒 REINFORCED',
  CORRUPTED:   '💀 CORRUPTED',
};

/**
 * Challenge tiers — visual escalation milestones every 10 waves.
 * Purely cosmetic / announcement; actual scaling comes from
 * `Enemy.applyGlobalScaling(wave)`.
 */
export type ChallengeTier =
  | 'NOVICE'      // waves  1–9
  | 'VETERAN'     // waves 10–19
  | 'CHAMPION'    // waves 20–29
  | 'LEGEND'      // waves 30–39
  | 'MYTHIC'      // waves 40–49
  | 'ETERNAL';    // waves 50+

function getChallengeTier(wave: number): ChallengeTier {
  if (wave < 10)  return 'NOVICE';
  if (wave < 20)  return 'VETERAN';
  if (wave < 30)  return 'CHAMPION';
  if (wave < 40)  return 'LEGEND';
  if (wave < 50)  return 'MYTHIC';
  return 'ETERNAL';
}

const TIER_LABELS: Record<ChallengeTier, string> = {
  NOVICE:   '',
  VETERAN:  '🏆 VETERAN TIER',
  CHAMPION: '⚔️ CHAMPION TIER',
  LEGEND:   '🔥 LEGEND TIER',
  MYTHIC:   '💀 MYTHIC TIER',
  ETERNAL:  '👁 ETERNAL TIER',
};

/**
 * Manages enemy waves: spawning, tracking kills, wave-banner display, and
 * wiring kill/wave counts to the HUD.
 *
 * Wave formula: `count` scales continuously — no hard cap.
 * A 3-second inter-wave pause is shown with a large "WAVE X" banner.
 * Every 5th wave spawns a boss (no normal enemies that wave).
 * Every 10th wave triggers a Challenge Tier milestone announcement.
 * From wave 20+ up to 2 modifiers can be active simultaneously.
 */
export class WaveManager {
  private readonly activeEnemies: Enemy[] = [];

  // Boss enemy (one at a time, boss waves only)
  private _activeBoss: BossEnemy | null = null;

  // Commander enemies (wave 8+)
  private readonly activeCommanders: EnemyCommander[] = [];

  private _currentWave = 0;
  private _totalKills = 0;

  // Inter-wave countdown (-ve means wave is active)
  private waveCountdown = 0;
  private waveStarted = false;

  // Rest period tracking (every 5 waves)
  private isRestPeriod = false;
  private restTimer = 0;
  private readonly REST_DURATION = 5.0;

  // Compound modifier support — up to 2 active from wave 20+
  currentModifiers: WaveModifier[] = ['NONE'];

  // Streaming spawn support — spawn enemies in batches rather than all at once
  private streamingQueue: Array<{ type: EnemyType; sx: number; sz: number }> = [];
  private waveTotal = 0;   // total enemies to kill for wave completion
  private waveKilled = 0;  // enemies killed in current wave
  /** Maximum simultaneously alive enemies (hard cap). */
  private static readonly MAX_ALIVE = 20;
  /** Target alive enemies — spawn new ones until we hit this. */
  private static readonly TARGET_ALIVE = 12;

  /** Convenience accessor for the primary modifier (first in array). */
  get currentModifier(): WaveModifier { return this.currentModifiers[0] ?? 'NONE'; }

  // Reinforced-wave tracking: has the wave already reinforced?
  private reinforcedFired = false;
  private reinforcedHalfCount = 0;

  // DOM banner element
  private readonly bannerEl: HTMLElement;

  // Optional SkillSystem reference — used to apply Time Warp slow to spawned enemies
  skillSystem: SkillSystem | null = null;

  // Optional spawn effect callback (set from main.ts after EnemySpawnVFX is created)
  onEnemySpawn: ((pos: THREE.Vector3) => void) | null = null;

  // Callback when boss wave starts (pass the BossEnemy)
  onBossSpawned: ((boss: BossEnemy) => void) | null = null;

  // Callback when all enemies in a wave are dead (before inter-wave)
  onWaveCleared: (() => void) | null = null;

  // Callback when a new Challenge Tier is reached (milestone every 10 waves)
  onChallengeTier: ((tier: ChallengeTier) => void) | null = null;

  // Track the composition of the current wave for the WaveAnnouncer
  private lastComposition = '';

  // Flag so onWaveCleared fires only once per wave
  private waveClearedFired = false;

  // Track tier so we announce only when it changes
  private lastTier: ChallengeTier = 'NOVICE';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly hud: HUD,
  ) {
    // Create the wave-announcement banner
    this.bannerEl = document.createElement('div');
    Object.assign(this.bannerEl.style, {
      position: 'fixed',
      top: '45%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      fontSize: '72px',
      fontWeight: 'bold',
      letterSpacing: '0.3em',
      textTransform: 'uppercase',
      color: '#e8d5a0',
      textShadow: '0 0 40px rgba(255,100,30,0.95), 0 4px 8px rgba(0,0,0,1)',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '30',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(this.bannerEl);

    // Kick off the first wave after a short delay
    this.beginInterWave();
  }

  get currentWave(): number { return this._currentWave; }
  get totalKills(): number { return this._totalKills; }
  get activeBoss(): BossEnemy | null { return this._activeBoss; }
  get commanders(): readonly EnemyCommander[] { return this.activeCommanders; }

  /** Return a read-only view of active enemies (used by CombatSystem). */
  get enemies(): readonly Enemy[] { return this.activeEnemies; }

  /** Whether the current wave is a boss wave. */
  get isBossWave(): boolean { return this._currentWave % 5 === 0 && this._currentWave > 0; }

  /**
   * Returns a human-readable description of the current wave's enemy composition.
   * E.g. "3 Skeletons + 2 Ghouls".
   */
  getWaveComposition(): string {
    return this.lastComposition;
  }

  /**
   * Called every fixed-rate physics step.
   * Advances enemy physics.
   */
  fixedUpdate(playerPos: THREE.Vector3): void {
    for (const enemy of this.activeEnemies) {
      enemy.fixedUpdate(playerPos);
    }
    this._activeBoss?.fixedUpdate(playerPos);
    for (const commander of this.activeCommanders) {
      if (!commander.isDead) commander.fixedUpdate(playerPos);
    }
  }

  /**
   * Called every visual frame.
   * Handles inter-wave countdown, enemy updates, kill detection, and streaming spawns.
   */
  update(delta: number, playerPos: THREE.Vector3): void {
    // ── Rest period ───────────────────────────────────────────────────────
    if (this.isRestPeriod) {
      this.restTimer -= delta;
      if (this.restTimer <= 0) {
        this.isRestPeriod = false;
        this.beginInterWave();
      }
      return;
    }

    // ── Inter-wave countdown ──────────────────────────────────────────────
    if (!this.waveStarted) {
      this.waveCountdown -= delta;
      if (this.waveCountdown <= 0) {
        this.startWave();
      }
      return;
    }

    // ── Update living enemies ─────────────────────────────────────────────
    for (const enemy of this.activeEnemies) {
      enemy.update(delta, playerPos);
    }

    // ── Update boss ───────────────────────────────────────────────────────
    if (this._activeBoss && !this._activeBoss.isDead) {
      this._activeBoss.update(delta, playerPos);
    }

    // ── Update commanders ─────────────────────────────────────────────────
    for (const commander of this.activeCommanders) {
      if (!commander.isDead) commander.update(delta, playerPos);
    }

    // ── Collect freshly-dead enemies ──────────────────────────────────────
    let killedThisFrame = 0;
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const enemy = this.activeEnemies[i]!;
      if (enemy.isDead) {
        enemy.dispose(this.physics);
        this.activeEnemies.splice(i, 1);
        killedThisFrame++;
        this.waveKilled++;
      }
    }

    // Boss death cleanup
    if (this._activeBoss?.isDead) {
      this._activeBoss.dispose(this.physics);
      this._activeBoss = null;
      killedThisFrame++;
      this.waveKilled++;
    }

    // Commander death cleanup
    for (let i = this.activeCommanders.length - 1; i >= 0; i--) {
      const cmd = this.activeCommanders[i]!;
      if (cmd.isDead) {
        cmd.dispose(this.physics);
        this.activeCommanders.splice(i, 1);
        killedThisFrame++;
        this.waveKilled++;
      }
    }

    if (killedThisFrame > 0) {
      this._totalKills += killedThisFrame;
      this.hud.updateKills(this._totalKills);
    }

    // ── Streaming spawn — fill up to TARGET_ALIVE from the queue ─────────
    if (this.streamingQueue.length > 0) {
      const aliveCount = this.activeEnemies.length + this.activeCommanders.length;
      if (aliveCount < WaveManager.TARGET_ALIVE) {
        const toSpawn = Math.min(
          WaveManager.MAX_ALIVE - aliveCount,
          WaveManager.TARGET_ALIVE - aliveCount,
          this.streamingQueue.length,
        );
        for (let s = 0; s < toSpawn; s++) {
          const entry = this.streamingQueue.shift()!;
          this.spawnOneEnemy(entry.type, entry.sx, entry.sz);
        }
      }
    }

    // ── REINFORCED: spawn a second wave of enemies when half are killed ───
    if (
      this.currentModifiers.includes('REINFORCED') &&
      !this.reinforcedFired &&
      this.reinforcedHalfCount > 0 &&
      this.waveKilled >= Math.ceil(this.reinforcedHalfCount / 2)
    ) {
      this.reinforcedFired = true;
      this.spawnReinforcementWave();
    }

    // ── Check wave completion ─────────────────────────────────────────────
    const queueEmpty = this.streamingQueue.length === 0;
    const allDead = this.activeEnemies.length === 0
      && this._activeBoss === null
      && this.activeCommanders.length === 0;
    if (this.waveStarted && queueEmpty && allDead && this.waveKilled >= this.waveTotal) {
      if (!this.waveClearedFired) {
        this.waveClearedFired = true;
        this.onWaveCleared?.();
      }
    }
  }

  /** Called from main.ts to start the next wave (after skill picker etc.). */
  startNextWave(): void {
    // Every 5th wave (after wave 5) triggers a rest period first
    const nextWave = this._currentWave + 1;
    if (nextWave > 1 && (nextWave - 1) % 5 === 0) {
      this.isRestPeriod = true;
      this.restTimer = this.REST_DURATION;
      this.showBanner('PREPARE YOURSELF...', this.REST_DURATION, false);
      this.onRestPeriod?.();
      return;
    }
    this.beginInterWave();
  }

  /** Optional callback fired when a rest period starts. */
  onRestPeriod: (() => void) | null = null;

  // ── Private ───────────────────────────────────────────────────────────────

  private beginInterWave(): void {
    this.waveStarted = false;
    this.waveClearedFired = false;
    this.reinforcedFired = false;
    this.reinforcedHalfCount = 0;
    this.streamingQueue = [];
    this.waveTotal = 0;
    this.waveKilled = 0;
    this.waveCountdown = 3.0;

    const nextWave = this._currentWave + 1;
    const isBoss = nextWave % 5 === 0 && nextWave > 0;

    // Roll wave modifiers — compound from wave 20+
    if (nextWave >= 5 && !isBoss) {
      this.currentModifiers = this.rollModifiers(nextWave);
    } else {
      this.currentModifiers = ['NONE'];
    }

    // Check for tier change milestone (every 10 waves)
    const newTier = getChallengeTier(nextWave);
    const isMilestone = newTier !== this.lastTier && newTier !== 'NOVICE';
    if (isMilestone) {
      this.lastTier = newTier;
      this.onChallengeTier?.(newTier);
      const tierLabel = TIER_LABELS[newTier];
      // Show milestone banner for a moment before the wave banner
      this.showBanner(`${tierLabel}\nWAVE ${nextWave}`, 2.8, true);
    } else if (isBoss) {
      this.showBanner(`⚔ BOSS WAVE  ${nextWave} ⚔`, 2.4, true);
    } else {
      const modLabels = this.currentModifiers
        .filter(m => m !== 'NONE')
        .map(m => MODIFIER_LABELS[m])
        .join('  ');
      const modLine = modLabels ? `\n${modLabels}` : '';
      this.showBanner(`Wave  ${nextWave}${modLine}`, 2.4, false);
    }
  }

  /**
   * Roll 1 or 2 wave modifiers depending on wave number.
   * From wave 20+ there is a 50% chance of a second modifier.
   * From wave 35+ the second modifier is guaranteed.
   */
  private rollModifiers(wave: number): WaveModifier[] {
    const primary = this.rollOneModifier(wave);
    if (wave < 20 || primary === 'NONE') {
      return [primary];
    }

    const dualChance = wave >= 35 ? 1.0 : 0.5;
    if (Math.random() < dualChance) {
      let secondary: WaveModifier;
      // Avoid picking the same modifier twice
      do {
        secondary = this.rollOneModifier(wave);
      } while (secondary === primary || secondary === 'NONE');
      return [primary, secondary];
    }
    return [primary];
  }

  /** Roll a single modifier; higher waves unlock harder modifiers. */
  private rollOneModifier(wave: number): WaveModifier {
    const pool: WaveModifier[] = ['BERSERKER', 'ARMORED', 'SWARM', 'ELITE'];
    if (wave >= 15) pool.push('PHANTOM', 'CURSED');
    if (wave >= 25) pool.push('REINFORCED', 'CORRUPTED');

    const r = Math.random();
    if (r < 0.12) return 'NONE'; // ~12% clear wave chance
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  private startWave(): void {
    this.waveStarted = true;
    this._currentWave++;
    this.hud.updateWave(this._currentWave);
    this.hideBanner();
    this.spawnEnemies();
  }

  /**
   * Endless base enemy count formula:
   *   waves 1–7:   2 + wave * 2           (4 → 16)
   *   waves 8–14:  16 + (wave - 7) * 1    (grows slowly)
   *   waves 15+:   18 + floor(wave / 3)   (+1 every 3 waves, truly endless)
   *
   * SWARM triples the count; ELITE halves it.
   * Absolute hard cap of 20 to protect performance.
   */
  private baseEnemyCount(): number {
    const w = this._currentWave;
    let count: number;
    if (w <= 7) {
      count = 2 + w * 2;
    } else if (w <= 14) {
      count = 16 + (w - 7);
    } else {
      count = 18 + Math.floor(w / 3);
    }

    const mods = this.currentModifiers;
    if (mods.includes('SWARM'))  count = Math.min(count * 3, 20);
    else if (mods.includes('ELITE')) count = Math.max(1, Math.floor(count / 2));
    else                        count = Math.min(count, 20);

    return count;
  }

  private spawnEnemies(): void {
    // ── Boss wave — spawn single boss instead of normal enemies ──────────
    if (this.isBossWave) {
      const angle = Math.random() * Math.PI * 2;
      const sx = Math.cos(angle) * (SPAWN_RADIUS - 4);
      const sz = Math.sin(angle) * (SPAWN_RADIUS - 4);
      const bossWaveNumber = this._currentWave / 5; // 1 at wave 5, 2 at wave 10...
      const boss = new BossEnemy(this.scene, this.physics, sx, sz, bossWaveNumber);
      this._activeBoss = boss;
      this.onBossSpawned?.(boss);
      this.lastComposition = '⚔ DARK CHAMPION ⚔';
      this.waveTotal = 1;
      if (this.onEnemySpawn) {
        this.onEnemySpawn(new THREE.Vector3(sx, 0, sz));
      }
      return;
    }

    // ── Normal wave — build a streaming queue ─────────────────────────────
    const count = this.baseEnemyCount();

    // Remember count for REINFORCED trigger
    this.reinforcedHalfCount = count;
    this.waveTotal = count;

    // Tally counts per type for composition string
    const typeCounts: Partial<Record<EnemyType, number>> = {};

    // Build the queue of enemies to spawn in batches
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
      const sx = Math.cos(angle) * r;
      const sz = Math.sin(angle) * r;
      const type = this.pickEnemyType();
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      this.streamingQueue.push({ type, sx, sz });
    }

    // Initial burst — spawn up to TARGET_ALIVE immediately
    const initialSpawn = Math.min(WaveManager.TARGET_ALIVE, this.streamingQueue.length);
    for (let i = 0; i < initialSpawn; i++) {
      const entry = this.streamingQueue.shift()!;
      this.spawnOneEnemy(entry.type, entry.sx, entry.sz);
    }

    // ── Spawn Commander (wave 8+) — scale count with wave tier ───────────
    if (this._currentWave >= 8) {
      const commanderCount = Math.min(
        1 + Math.floor((this._currentWave - 8) / 7),
        2, // cap at 2 simultaneous commanders
      );
      for (let c = 0; c < commanderCount; c++) {
        const angle = (c / commanderCount) * Math.PI * 2 + Math.random();
        const sx = Math.cos(angle) * (SPAWN_RADIUS - 2);
        const sz = Math.sin(angle) * (SPAWN_RADIUS - 2);
        const commander = new EnemyCommander(this.scene, this.physics, sx, sz);
        this.activeCommanders.push(commander);
        this.waveTotal++; // commanders also count toward wave total
        if (this.onEnemySpawn) {
          this.onEnemySpawn(new THREE.Vector3(sx, 0, sz));
        }
      }
    }

    // Build composition string
    const parts: string[] = [];
    const typeLabel: Record<EnemyType, string> = {
      [EnemyType.SKELETON]:    'Skeleton',
      [EnemyType.GHOUL]:       'Ghoul',
      [EnemyType.BRUTE]:       'Brute',
      [EnemyType.NECROMANCER]: 'Necromancer',
    };
    for (const [type, cnt] of Object.entries(typeCounts) as Array<[EnemyType, number]>) {
      parts.push(`${cnt} ${typeLabel[type]}${cnt > 1 ? 's' : ''}`);
    }
    if (this.activeCommanders.length > 0) {
      parts.push(`${this.activeCommanders.length} Commander${this.activeCommanders.length > 1 ? 's' : ''}`);
    }
    this.lastComposition = parts.join(' + ');
  }

  /** Spawn a single enemy and apply all active modifiers. */
  private spawnOneEnemy(type: EnemyType, sx: number, sz: number): void {
    const mods = this.currentModifiers;
    const enemy = new Enemy(this.scene, this.physics, sx, sz, type);

    // Apply per-modifier stat changes
    for (const mod of mods) {
      if      (mod === 'BERSERKER')  enemy.applyModifier(1.5, 0.7);
      else if (mod === 'ARMORED')    enemy.applyModifier(0.8, 1.5);
      else if (mod === 'SWARM')      enemy.applyModifier(1.0, 0.5, 0.6);
      else if (mod === 'ELITE')      enemy.applyModifier(1.0, 2.0);
      else if (mod === 'PHANTOM')    enemy.applyModifier(1.2, 1.0);
      else if (mod === 'CURSED')     enemy.applyModifier(1.15, 1.2);
      else if (mod === 'REINFORCED') enemy.applyModifier(1.0, 1.3);
      else if (mod === 'CORRUPTED')  enemy.applyModifier(1.3, 1.3);
    }

    // Apply endless global scaling (kicks in wave 15+)
    enemy.applyGlobalScaling(this._currentWave);

    // Apply Time Warp slow if active
    const slowMult = this.skillSystem?.getEnemySlowMultiplier() ?? 1.0;
    if (slowMult < 1.0) enemy.applyModifier(slowMult, 1.0);

    this.activeEnemies.push(enemy);

    // Trigger spawn VFX
    if (this.onEnemySpawn) {
      this.onEnemySpawn(new THREE.Vector3(sx, 0, sz));
    }
  }

  /**
   * Spawn a reinforcement wave (REINFORCED modifier) — roughly half the
   * original count, same type distribution, no additional modifiers.
   */
  private spawnReinforcementWave(): void {
    const count = Math.max(2, Math.ceil(this.reinforcedHalfCount / 2));
    this.waveTotal += count;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
      const sx = Math.cos(angle) * r;
      const sz = Math.sin(angle) * r;
      const type = this.pickEnemyType();
      this.streamingQueue.push({ type, sx, sz });
    }
  }

  /** Choose enemy type based on current wave. Higher waves skew toward tougher types. */
  private pickEnemyType(): EnemyType {
    const wave = this._currentWave;

    // Necromancers appear from wave 4+; cap scales with wave (max 4 from wave 20+)
    const maxNecros = wave >= 20 ? 4 : wave >= 10 ? 3 : 2;
    const existingNecros = this.activeEnemies.filter(
      e => e.type === EnemyType.NECROMANCER,
    ).length;
    const canSpawnNecro = wave >= 4 && existingNecros < maxNecros;

    if (wave >= 25) {
      // Very high waves: lots of Brutes + Ghouls, still some Skeletons
      const r = Math.random();
      if (canSpawnNecro && r < 0.15) return EnemyType.NECROMANCER;
      if (r < 0.30) return EnemyType.SKELETON;
      if (r < 0.58) return EnemyType.GHOUL;
      return EnemyType.BRUTE;
    }
    if (wave >= 15) {
      const r = Math.random();
      if (canSpawnNecro && r < 0.14) return EnemyType.NECROMANCER;
      if (r < 0.35) return EnemyType.SKELETON;
      if (r < 0.62) return EnemyType.GHOUL;
      return EnemyType.BRUTE;
    }
    if (wave >= 5) {
      const r = Math.random();
      if (canSpawnNecro && r < 0.12) return EnemyType.NECROMANCER;
      if (r < 0.40) return EnemyType.SKELETON;
      if (r < 0.68) return EnemyType.GHOUL;
      return EnemyType.BRUTE;
    }
    if (wave >= 4 && canSpawnNecro && Math.random() < 0.15) {
      return EnemyType.NECROMANCER;
    }
    if (wave >= 3) {
      return Math.random() < 0.5 ? EnemyType.SKELETON : EnemyType.GHOUL;
    }
    return EnemyType.SKELETON;
  }

  private showBanner(text: string, duration: number, isBossWave: boolean): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.display = 'block';
    this.bannerEl.style.opacity = '1';

    // Boss wave: red-gold styling
    if (isBossWave) {
      this.bannerEl.style.color = '#e8d5a0';
      this.bannerEl.style.textShadow =
        '0 0 40px rgba(255,30,30,0.95), 0 0 80px rgba(200,60,0,0.5), 0 4px 8px rgba(0,0,0,1)';
      this.bannerEl.style.fontSize = '56px';
    } else {
      this.bannerEl.style.color = '#e8d5a0';
      this.bannerEl.style.textShadow =
        '0 0 40px rgba(255,100,30,0.95), 0 4px 8px rgba(0,0,0,1)';
      this.bannerEl.style.fontSize = '72px';
    }

    // Fade out near the end of the inter-wave period
    const fadeStart = duration * 0.6 * 1000;
    const totalMs = duration * 1000;
    const start = performance.now();

    const tick = (): void => {
      const elapsed = performance.now() - start;
      if (elapsed >= totalMs) {
        this.bannerEl.style.opacity = '0';
        return;
      }
      if (elapsed > fadeStart) {
        const t = (elapsed - fadeStart) / (totalMs - fadeStart);
        this.bannerEl.style.opacity = String(Math.max(0, 1 - t));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private hideBanner(): void {
    this.bannerEl.style.display = 'none';
  }
}
