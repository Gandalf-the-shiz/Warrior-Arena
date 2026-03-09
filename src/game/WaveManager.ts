import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { Enemy, EnemyType } from '@/game/Enemy';
import { BossEnemy } from '@/game/BossEnemy';
import { EnemyCommander } from '@/game/EnemyCommander';
import { HUD } from '@/ui/HUD';

// Radius at which enemies spawn around the arena edge
const SPAWN_RADIUS = 20;

export type WaveModifier = 'NONE' | 'BERSERKER' | 'ARMORED' | 'SWARM' | 'ELITE';

const MODIFIER_LABELS: Record<WaveModifier, string> = {
  NONE: '',
  BERSERKER: '⚡ BERSERKER',
  ARMORED: '🛡️ ARMORED',
  SWARM: '🐝 SWARM',
  ELITE: '👑 ELITE',
};

/**
 * Manages enemy waves: spawning, tracking kills, wave-banner display, and
 * wiring kill/wave counts to the HUD.
 *
 * Wave formula: `count = Math.min(2 + wave * 2, 15)`.
 * A 3-second inter-wave pause is shown with a large "WAVE X" banner.
 * Every 5th wave spawns a boss (no normal enemies that wave).
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

  // Current wave modifier
  currentModifier: WaveModifier = 'NONE';

  // DOM banner element
  private readonly bannerEl: HTMLElement;

  // Optional spawn effect callback (set from main.ts after EnemySpawnVFX is created)
  onEnemySpawn: ((pos: THREE.Vector3) => void) | null = null;

  // Callback when boss wave starts (pass the BossEnemy)
  onBossSpawned: ((boss: BossEnemy) => void) | null = null;

  // Callback when all enemies in a wave are dead (before inter-wave)
  onWaveCleared: (() => void) | null = null;

  // Track the composition of the current wave for the WaveAnnouncer
  private lastComposition = '';

  // Flag so onWaveCleared fires only once per wave
  private waveClearedFired = false;

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
   * Handles inter-wave countdown, enemy updates, and kill detection.
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
      }
    }

    // Boss death cleanup
    if (this._activeBoss?.isDead) {
      this._activeBoss.dispose(this.physics);
      this._activeBoss = null;
      killedThisFrame++;
    }

    // Commander death cleanup
    for (let i = this.activeCommanders.length - 1; i >= 0; i--) {
      const cmd = this.activeCommanders[i]!;
      if (cmd.isDead) {
        cmd.dispose(this.physics);
        this.activeCommanders.splice(i, 1);
        killedThisFrame++;
      }
    }

    if (killedThisFrame > 0) {
      this._totalKills += killedThisFrame;
      this.hud.updateKills(this._totalKills);
    }

    // ── Check wave completion ─────────────────────────────────────────────
    const allDead = this.activeEnemies.length === 0
      && this._activeBoss === null
      && this.activeCommanders.length === 0;
    if (this.waveStarted && allDead) {
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
    this.waveCountdown = 3.0;

    const nextWave = this._currentWave + 1;
    const isBoss = nextWave % 5 === 0 && nextWave > 0;
    // Roll wave modifier for wave 5+
    if (nextWave >= 5 && !isBoss) {
      this.currentModifier = this.rollModifier();
    } else {
      this.currentModifier = 'NONE';
    }

    if (isBoss) {
      this.showBanner(`⚔ BOSS WAVE  ${nextWave} ⚔`, 2.4, true);
    } else {
      const modLabel = this.currentModifier !== 'NONE' ? `\n${MODIFIER_LABELS[this.currentModifier]}` : '';
      this.showBanner(`Wave  ${nextWave}${modLabel}`, 2.4, false);
    }
  }

  private rollModifier(): WaveModifier {
    const r = Math.random();
    if (r < 0.25) return 'BERSERKER';
    if (r < 0.50) return 'ARMORED';
    if (r < 0.75) return 'SWARM';
    if (r < 0.88) return 'ELITE';
    return 'NONE'; // ~12% chance for a clear wave
  }

  private startWave(): void {
    this.waveStarted = true;
    this._currentWave++;
    this.hud.updateWave(this._currentWave);
    this.hideBanner();
    this.spawnEnemies();
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
      if (this.onEnemySpawn) {
        this.onEnemySpawn(new THREE.Vector3(sx, 0, sz));
      }
      return;
    }

    // ── Normal wave ────────────────────────────────────────────────────────
    const mod = this.currentModifier;

    // Base count (SWARM doubles, ELITE halves)
    let count = Math.min(2 + this._currentWave * 2, 15);
    if (mod === 'SWARM') count = Math.min(count * 2, 24);
    else if (mod === 'ELITE') count = Math.max(1, Math.floor(count / 2));

    // Tally counts per type for composition string
    const typeCounts: Partial<Record<EnemyType, number>> = {};

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
      const sx = Math.cos(angle) * r;
      const sz = Math.sin(angle) * r;

      const type = this.pickEnemyType();
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;

      const enemy = new Enemy(this.scene, this.physics, sx, sz, type);
      // Apply wave modifier stats
      if (mod === 'BERSERKER') {
        enemy.applyModifier(1.5, 0.7); // 50% speed, -30% HP
      } else if (mod === 'ARMORED') {
        enemy.applyModifier(0.8, 1.5); // -20% speed, +50% HP
      } else if (mod === 'SWARM') {
        enemy.applyModifier(1.0, 0.5, 0.6); // half HP, 0.6 scale
      } else if (mod === 'ELITE') {
        enemy.applyModifier(1.0, 2.0); // 2x HP
      }
      this.activeEnemies.push(enemy);

      // Trigger spawn VFX
      if (this.onEnemySpawn) {
        const pos = new THREE.Vector3(sx, 0, sz);
        this.onEnemySpawn(pos);
      }
    }

    // ── Spawn Commander (wave 8+) ─────────────────────────────────────────
    if (this._currentWave >= 8) {
      const commanderCount = this._currentWave >= 15 ? 2 : 1;
      for (let c = 0; c < commanderCount; c++) {
        const angle = (c / commanderCount) * Math.PI * 2 + Math.random();
        const sx = Math.cos(angle) * (SPAWN_RADIUS - 2);
        const sz = Math.sin(angle) * (SPAWN_RADIUS - 2);
        const commander = new EnemyCommander(this.scene, this.physics, sx, sz);
        this.activeCommanders.push(commander);
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

  /** Choose enemy type based on current wave. */
  private pickEnemyType(): EnemyType {
    const wave = this._currentWave;

    // Necromancers appear from wave 4+, max 2 per wave
    const existingNecros = this.activeEnemies.filter(
      e => e.type === EnemyType.NECROMANCER,
    ).length;
    const canSpawnNecro = wave >= 4 && existingNecros < 2;

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
