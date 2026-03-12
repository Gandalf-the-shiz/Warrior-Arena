import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Renderer } from '@/engine/Renderer';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';
import { GameLoop } from '@/engine/GameLoop';
import { PerformanceMonitor } from '@/engine/PerformanceMonitor';
import { QualityManager } from '@/engine/QualityManager';
import { Arena } from '@/game/Arena';
import { PlayerController } from '@/game/PlayerController';
import { CameraController } from '@/game/CameraController';
import { WaveManager } from '@/game/WaveManager';
import { CombatSystem } from '@/game/CombatSystem';
import { VFXManager } from '@/game/VFXManager';
import { StyleMeter } from '@/game/StyleMeter';
import type { StyleRank } from '@/game/StyleMeter';
import { HUD } from '@/ui/HUD';
import { AudioManager } from '@/engine/AudioManager';
import { TitleScreen } from '@/ui/TitleScreen';
import { GameOverScreen } from '@/ui/GameOverScreen';
import { Minimap } from '@/ui/Minimap';
import { EnemyHealthBars } from '@/ui/EnemyHealthBars';
import { LootSystem } from '@/game/LootSystem';
import { DamageNumbers } from '@/ui/DamageNumbers';
import { WaveAnnouncer } from '@/ui/WaveAnnouncer';
import { PauseMenu } from '@/ui/PauseMenu';
import { ComboDisplay } from '@/ui/ComboDisplay';
import { ScreenEffects } from '@/ui/ScreenEffects';
import { EnemySpawnVFX } from '@/game/EnemySpawnVFX';
import { ScoreManager } from '@/game/ScoreManager';
import { ErrorHandler } from '@/utils/ErrorHandler';
// ── Phase 3 imports ──────────────────────────────────────────────────────
import { ArenaHazards } from '@/game/ArenaHazards';
import { SkillSystem } from '@/game/SkillSystem';
import { SkillPicker } from '@/ui/SkillPicker';
import { WeatherSystem } from '@/game/WeatherSystem';
import { FinisherSystem } from '@/game/FinisherSystem';
import { BossHealthBar } from '@/ui/BossHealthBar';
import type { BossEnemy } from '@/game/BossEnemy';
// ── Phase 3 (continued) imports ──────────────────────────────────────────────────────
import { LevelSystem } from '@/game/LevelSystem';
import type { EnemyXPType } from '@/game/LevelSystem';
import { LevelHUD } from '@/ui/LevelHUD';
import { WeatherHUD } from '@/ui/WeatherHUD';
// ── PR 2: Dismemberment & Gore systems ───────────────────────────────────────
import { DismembermentSystem } from '@/game/DismembermentSystem';
import { SeveredPartManager } from '@/game/SeveredPartManager';

// ── Loading / error overlay helpers ───────────────────────────────────────
function showLoading(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'loading-screen';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#05050a',
    color: '#e8d5a0',
    fontFamily: "'Palatino Linotype', Georgia, serif",
    fontSize: '20px',
    letterSpacing: '0.2em',
    zIndex: '100',
  });
  el.textContent = 'LOADING…';
  document.body.appendChild(el);
  return el;
}

function showError(message: string): void {
  const existing = document.getElementById('loading-screen');
  const el = existing ?? document.createElement('div');
  if (!existing) {
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#05050a',
      fontFamily: "'Palatino Linotype', Georgia, serif",
      zIndex: '100',
    });
    document.body.appendChild(el);
  }
  el.style.color = '#c0392b';
  el.style.fontSize = '16px';
  el.style.letterSpacing = '0.05em';
  el.textContent = `Failed to initialise: ${message}`;
}

async function main(): Promise<void> {
  // ── Install global error handlers as early as possible ────────────────
  ErrorHandler.install();

  const loading = showLoading();

  // ── Seconds after player death before the game-over overlay appears ────
  const GAME_OVER_DELAY = 2.0;

  // ── Initialise Rapier WASM ─────────────────────────────────────────────
  try {
    await RAPIER.init();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  // ── Core systems ───────────────────────────────────────────────────────
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  // Build procedural environment cubemap — provides IBL reflections for all PBR materials
  renderer.buildEnvironmentMap();
  const physics = new PhysicsWorld();
  const input = new InputManager(canvas);
  const hud = new HUD();

  // ── Performance instrumentation + adaptive quality ─────────────────────
  const perf = new PerformanceMonitor();
  const quality = new QualityManager();
  // Apply initial quality settings immediately
  renderer.applyQualitySettings(quality.getSettings());
  // Re-apply whenever QualityManager changes tier
  quality.onTierChange = (settings) => {
    renderer.applyQualitySettings(settings);
    console.info('[Quality] Applied tier:', settings.tier);
  };

  // ── Game objects ───────────────────────────────────────────────────────
  const arena = new Arena(renderer.scene, physics);
  const player = new PlayerController(
    renderer.scene,
    physics,
    input,
    0,
    2,
    0,
  );
  const camera = new CameraController(renderer.camera, input, physics);

  // ── Gameplay systems ───────────────────────────────────────────────────
  const vfx = new VFXManager(renderer.scene, camera);
  const combat = new CombatSystem();
  const waves = new WaveManager(renderer.scene, physics, hud);
  const styleMeter = new StyleMeter();
  const audio = new AudioManager();

  // ── New gameplay / UI systems ──────────────────────────────────────────
  const titleScreen    = new TitleScreen();
  const gameOverScreen = new GameOverScreen();
  const minimap        = new Minimap();
  const enemyHealthBars = new EnemyHealthBars(renderer.camera);
  const loot           = new LootSystem(renderer.scene, audio);
  const damageNumbers  = new DamageNumbers(renderer.camera);

  // ── Phase 2 systems ────────────────────────────────────────────────────
  const waveAnnouncer  = new WaveAnnouncer();
  const pauseMenu      = new PauseMenu(audio, input);
  const comboDisplay   = new ComboDisplay();
  const screenEffects  = new ScreenEffects();
  const spawnVFX       = new EnemySpawnVFX(renderer.scene);
  const scoreManager   = new ScoreManager();

  // ── Phase 3 systems ────────────────────────────────────────────────────
  const hazards     = new ArenaHazards(renderer.scene, physics);
  const skillSystem = new SkillSystem();
  const skillPicker = new SkillPicker();
  const weather     = new WeatherSystem(renderer, audio);
  const finisher    = new FinisherSystem(audio, vfx, camera);
  const bossHealthBar = new BossHealthBar();

  // ── New systems (continued from Phase 3) ────────────────────────────────────────────────────
  const levelSystem = new LevelSystem();
  const levelHUD    = new LevelHUD();
  const weatherHUD  = new WeatherHUD();

  // ── PR 2: Dismemberment & Gore systems ────────────────────────────────────
  const severedPartManager = new SeveredPartManager(renderer.scene, physics);
  const dismemberment = new DismembermentSystem(severedPartManager, vfx, audio);

  // Wire dismemberment into finisher system (100% chance on F-key execution)
  finisher.dismemberment = dismemberment;

  // Wire SkillSystem into PlayerController
  player.skillSystem = skillSystem;

  // Wire SkillSystem into WaveManager (for Time Warp slow)
  waves.skillSystem = skillSystem;

  // Wire audio into hazards
  hazards.setAudio(audio);

  // Track boss state
  let activeBoss: BossEnemy | null = null;
  waves.onBossSpawned = (boss) => {
    activeBoss = boss;
    bossHealthBar.show();
    audio.playBossRoar();
  };

  // Challenge Tier milestone — announce when player reaches a new tier
  waves.onChallengeTier = (_tier) => {
    audio.playBossRoar();  // repurpose dramatic sting for milestone
    vfx.shakeCamera(0.2, 0.5);
  };

  // Level-up effects
  levelSystem.onLevelUp = (newLevel) => {
    audio.playLevelUp();
    levelHUD.onLevelUp();
    // Golden particle burst + screen flash
    vfx.spawnGroundSlam(player.getPosition());
    screenEffects.flashHeal();
    // Apply stat bonuses to player
    const hpBonus = levelSystem.getMaxHpBonus();
    const staminaBonus = levelSystem.getMaxStaminaBonus();
    // Update player stats dynamically
    (player as unknown as Record<string, number>)['maxHp'] = 100 + hpBonus;
    player.hp = Math.min(player.hp + 10, 100 + hpBonus);
    (player as unknown as Record<string, number>)['maxStamina'] = 100 + staminaBonus;
    void newLevel;
  };

  // Wire wave-cleared → skill picker → next wave
  let skillPickerActive = false;
  waves.onWaveCleared = () => {
    if (player.isDead) return;
    // Victory horn + crowd roar on wave clear
    audio.playVictoryHorn();
    audio.crowdRoar();
    skillPickerActive = true;
    loop.pause();
    skillSystem.onNewWave();
    hazards.setWave(waves.currentWave + 1);
    weather.maybeTransition(waves.currentWave + 1, waveAnnouncer);
    skillPicker.show(skillSystem, player).then(() => {
      audio.playSkillSelect();
      skillPickerActive = false;
      loop.unpause();
      waves.startNextWave();
      // Advance armor degradation wave wear after the new wave begins
      player.armorDegradation.onWaveAdvanced(waves.currentWave);
    });
  };

  // Rest period callback
  waves.onRestPeriod = () => {
    // Spawn health orb and stamina crystal at arena center
    loot.spawnDrop(new THREE.Vector3(0, 1, 0));
    loot.spawnDrop(new THREE.Vector3(1, 1, 1));
    // Regen 30% HP
    player.hp = Math.min(player.hp + Math.round(player.maxHp * 0.3), player.maxHp);
  };

  // Kill streak tracking for audio
  let killStreakCount = 0;

  // ── Crowd audio system state tracking ─────────────────────────────────────
  let timeSinceLastKill = 0;
  let waveHasFirstHit = false;
  let prevHpForGasp = player.hp;
  let crowdGaspTriggered = false;
  let hasCrowdBooed = false;

  // Show best scores on title screen
  titleScreen.showBestScores(scoreManager.getBest());

  // Wire spawn VFX into WaveManager
  waves.onEnemySpawn = (pos) => { spawnVFX.spawnEffect(pos); };

  // ── Pre-warm physics so player settles on the ground before first render
  for (let i = 0; i < 30; i++) {
    physics.step();
  }
  // Sync visual mesh to settled physics position immediately
  player.update(0);
  camera.update(player.getPosition(), 0, player.getFacingYaw());

  // Hide loading screen
  loading.remove();

  // Seed HUD with initial values
  hud.updateHealth(player.hp, player.maxHp);
  hud.updateStamina(player.stamina, player.maxStamina);
  hud.updateWave(1);
  hud.updateKills(0);

  // ── Await user gesture on title screen, then start audio ──────────────
  await titleScreen.waitForStart();
  audio.resume();
  // Start background crowd murmur
  audio.crowdMurmur();

  let elapsed = 0;

  // Hitstop: when > 0 the game freezes (camera and rendering still run)
  let hitstopRemaining = 0;

  // ── Audio state tracking ───────────────────────────────────────────────
  let prevAttacking = false;
  let prevDodging = false;
  let prevPlayerHp = player.hp;
  let prevPlayerDead = false;
  let prevWave = waves.currentWave;
  let prevEnemyCount = waves.enemies.length;

  // ── New skill state tracking ───────────────────────────────────────────
  let bloodPriceDrainAccum = 0;       // accumulated drain timer for Blood Price
  let deathMarkKillCounter = 0;       // rolling kill counter for Death Mark
  let undyingWillConsumed = false;    // once-per-activation latch for Undying Will

  // ── Game-over tracking ─────────────────────────────────────────────────
  let gameOverTimer = 0;
  let gameOverShown = false;

  // ── Death sequence tracking ────────────────────────────────────────────
  const DEATH_SLOWMO_DURATION = 2.0;
  let deathSequenceTimer = 0;
  let deathSequenceStarted = false;
  let scoresSaved = false;
  // Best style rank tracker — updated each frame so ScoreManager can access it cleanly
  let bestRankThisRun: StyleRank = 'D';

  // ── Loot pickup tracking for screen flash ─────────────────────────────
  let prevPlayerHpForHeal = player.hp;

  // ── UI throttle timers (driven by QualityManager.uiUpdateInterval) ────
  let minimapTimer = 0;
  let healthBarTimer = 0;

  // ── Game loop ──────────────────────────────────────────────────────────
  const loop = new GameLoop(
    // onUpdate  (variable timestep — mesh sync, lerp, camera)
    (delta) => {
      perf.beginFrame();
      perf.beginPhase('update');

      // ── Pause check ───────────────────────────────────────────────────
      // Don't allow pause while skill picker is open
      if (!skillPickerActive) {
        pauseMenu.checkInput();
      }

      // Always advance elapsed so torches / cape still animate during hitstop
      elapsed += delta;
      arena.update(elapsed, delta);

      if (hitstopRemaining > 0) {
        hitstopRemaining = Math.max(0, hitstopRemaining - delta);
        // Camera still tracks smoothly during freeze
        camera.update(player.getPosition(), delta, player.getFacingYaw());
        perf.endPhase('update');
        perf.endFrame(renderer.renderer);
        return;
      }

      // ── Death sequence slow-motion ─────────────────────────────────────
      let gameDelta = delta; // may be reduced for slow-motion
      if (player.isDead && !deathSequenceStarted) {
        deathSequenceStarted = true;
        deathSequenceTimer = 0;
        audio.playDeathSequence();
      }
      if (deathSequenceStarted && deathSequenceTimer < DEATH_SLOWMO_DURATION) {
        deathSequenceTimer += delta; // advance with real time
        const t = Math.min(1, deathSequenceTimer / DEATH_SLOWMO_DURATION);
        gameDelta = delta * 0.3; // slow-motion for game systems
        camera.setDeathZoom(t);
        // Desaturate canvas (canvas reference already held from line 90)
        canvas.style.filter = `grayscale(${Math.round(t * 80)}%)`;
      }
      // Finisher slow-mo (takes priority if not in death sequence)
      if (!deathSequenceStarted && finisher.isExecuting) {
        gameDelta = delta * 0.5;
      }

      player.update(gameDelta);
      camera.update(player.getPosition(), delta, player.getFacingYaw());
      waves.update(gameDelta, player.getPosition());

      // ── Phase 3: Finisher system ───────────────────────────────────────
      const wasExecuting = finisher.isExecuting;
      finisher.update(
        gameDelta,
        player,
        waves.enemies,
        input,
        renderer.camera,
        styleMeter,
        (pos) => { loot.spawnDrop(pos); },
      );
      // Crowd screams when finisher starts
      if (finisher.isExecuting && !wasExecuting) {
        audio.crowdScream();
      }

      // ── Audio triggers ────────────────────────────────────────────────
      const nowAttacking = player.isAttackingState();
      if (nowAttacking && !prevAttacking) {
        audio.playSlash();
        audio.playGrunt();
        // First hit of wave triggers crowd roar
        if (!waveHasFirstHit && waves.enemies.length > 0) {
          waveHasFirstHit = true;
          audio.crowdRoar();
        }
      }
      prevAttacking = nowAttacking;

      const nowDodging = player.anim.currentState === 'DODGE';
      if (nowDodging && !prevDodging) audio.playDodge();
      prevDodging = nowDodging;

      // Player took damage — screen flash + audio
      if (player.hp < prevPlayerHp) {
        audio.playPlayerHit();
        audio.playArmorClank();
        screenEffects.flashDamage();
        timeSinceLastKill = 0; // reset kill timer on damage taken
      }
      prevPlayerHp = player.hp;

      // ── Undying Will: intercept lethal damage once ──────────────────────
      if (skillSystem.hasUndyingWill() && !undyingWillConsumed && player.hp <= 0 && !player.isDead) {
        player.hp = 1;
        undyingWillConsumed = true;
        screenEffects.flashHeal();
        vfx.shakeCamera(0.3, 0.4);
      }
      // Reset latch when skill expires (no longer active)
      if (!skillSystem.hasUndyingWill()) undyingWillConsumed = false;

      // ── Blood Price: -2 HP/s drain while active ─────────────────────────
      if (skillSystem.hasBloodPrice() && !player.isDead) {
        bloodPriceDrainAccum += gameDelta;
        if (bloodPriceDrainAccum >= 0.5) { // drain 1 HP every 0.5 s (= 2 HP/s)
          bloodPriceDrainAccum -= 0.5;
          player.hp = Math.max(1, player.hp - 1); // never kill the player outright
        }
      } else {
        bloodPriceDrainAccum = 0;
      }

      // Crowd gasp when HP drops below 25% for the first time this run
      if (!crowdGaspTriggered && player.hp / player.maxHp < 0.25 && prevHpForGasp / player.maxHp >= 0.25) {
        audio.playCrowdGasp();
        crowdGaspTriggered = true;
      }
      prevHpForGasp = player.hp;

      // Player died
      if (player.isDead && !prevPlayerDead) audio.playPlayerDeath();
      prevPlayerDead = player.isDead;

      // New wave started — trigger wave announcer
      if (waves.currentWave > prevWave) {
        audio.playWaveStart();
        audio.playWaveAnnounce();
        waveAnnouncer.announce(waves.currentWave, waves.getWaveComposition());
        prevWave = waves.currentWave;
        // Reset per-wave crowd state
        waveHasFirstHit = false;
        timeSinceLastKill = 0;
        hasCrowdBooed = false;
        crowdGaspTriggered = false;
      }

      // Enemy killed this frame
      const nowEnemyCount = waves.enemies.length;
      if (nowEnemyCount < prevEnemyCount) audio.playEnemyDeath();
      prevEnemyCount = nowEnemyCount;

      // Combat intensity — ramp up when enemies are close and we're attacking
      const closestEnemyDist = waves.enemies.reduce((min, e) => {
        const d = e.getPosition().distanceTo(player.getPosition());
        return d < min ? d : min;
      }, 999);
      const nearFactor = Math.max(0, 1 - closestEnemyDist / 20);
      const combatIntensity = Math.min(1, nearFactor + (nowAttacking ? 0.4 : 0));
      audio.setCombatIntensity(combatIntensity);

      // Combat hit-detection + VFX
      combat.update(
        player,
        waves.enemies,
        vfx,
        (duration) => { hitstopRemaining = Math.max(hitstopRemaining, duration); },
        styleMeter,
        () => {
          audio.playHit();
          // Soul harvest: killing an enemy restores HP
          if (skillSystem.hasSoulHarvest()) {
            player.hp = Math.min(player.hp + 10, player.maxHp);
          }
          // Vampiric Blade: each hit restores 3 HP
          if (skillSystem.hasVampiricBlade()) {
            player.hp = Math.min(player.hp + 3, player.maxHp);
          }
        },
        (pos, damage, isHeavy, isFinisher) => {
          damageNumbers.spawn(pos, damage, isHeavy, isFinisher, styleMeter.rank);
          comboDisplay.onHit(styleMeter.combo, styleMeter.rank);
        },
        (pos) => {
          loot.spawnDrop(pos);
          if (skillSystem.hasSoulHarvest()) {
            player.hp = Math.min(player.hp + 10, player.maxHp);
          }
          // Death Mark: every 5th kill causes a ground slam VFX explosion
          deathMarkKillCounter++;
          if (skillSystem.hasDeathMark() && deathMarkKillCounter % 5 === 0) {
            vfx.spawnGroundSlam(pos);
            vfx.shakeCamera(0.25, 0.3);
          }
          // Award XP scaled by wave — higher waves have tougher (higher-XP) enemy mixes
          const wave = waves.currentWave;
          let xpType: EnemyXPType = 'SKELETON';
          if (wave >= 5) {
            const r = Math.random();
            if (r < 0.40) xpType = 'SKELETON';
            else if (r < 0.68) xpType = 'GHOUL';
            else xpType = 'BRUTE';
          } else if (wave >= 3) {
            xpType = Math.random() < 0.5 ? 'SKELETON' : 'GHOUL';
          }
          levelSystem.addXP(xpType, styleMeter.rank);
          killStreakCount++;
          arena.onEnemyKilled();
          player.armorDegradation.onEnemyKilled();
          vfx.onKill(player.getPosition());
          timeSinceLastKill = 0; // reset crowd-boo timer on kill
          hasCrowdBooed = false; // allow boo to fire again if player slows down
          if (killStreakCount === 5) {
            audio.playKillStreak5();
            audio.crowdChant();
          } else if (killStreakCount === 10) {
            audio.playKillStreak10();
            audio.crowdChant();
          }
        },
        waves.activeBoss,
        waves.commanders,
        dismemberment,
      );

      // Sword trail — sample tip position every frame during attacks
      vfx.updateSwordTrail(
        player.getSwordTipPosition(),
        player.isAttackingState(),
      );

      styleMeter.update(gameDelta);
      vfx.update(gameDelta, player.getPosition());

      // ── PR 2: Severed part lifecycle (physics sync + blood trails + despawn) ──
      severedPartManager.update(gameDelta, (pos, dir) => {
        vfx.spawnBlood(pos, dir);
      });

      // ── Phase 2 system updates ─────────────────────────────────────────
      waveAnnouncer.update(delta);
      comboDisplay.update(delta, styleMeter.rank);
      screenEffects.update(delta, player.hp, player.maxHp, player.damageMultiplier);
      spawnVFX.update(delta);

      // Heal flash: HP increased (loot pickup)
      if (player.hp > prevPlayerHpForHeal) screenEffects.flashHeal();
      prevPlayerHpForHeal = player.hp;

      // ── Screen effect triggers ─────────────────────────────────────────
      // Speed lines during dash attack
      if (player.anim.currentState === 'DASH_ATTACK' && !prevAttacking) {
        screenEffects.triggerSpeedLines();
      }
      // Impact frame on heavy attack land (when hit fires during heavy)
      if (player.anim.currentState === 'ATTACK_HEAVY' &&
          player.anim.getStateProgress() >= 0.15 &&
          player.anim.getStateProgress() <= 0.25 && nowAttacking && !prevAttacking) {
        screenEffects.triggerImpactFrame();
      }

      // ── Phase 3 system updates ──────────────────────────────────────────
      // Arena hazards
      hazards.update(gameDelta, player, waves.enemies);

      // Weather
      weather.update(
        delta,
        () => { screenEffects.flashDamage(); }, // lightning flash
        (intensity, duration) => { vfx.shakeCamera(intensity, duration); },
      );
      // Blood moon screen tint
      screenEffects.setBloodMoon(weather.currentWeather === 'BLOOD_MOON');

      // ── Crowd system update ─────────────────────────────────────────────
      // Track time since last kill during active waves
      if (waves.enemies.length > 0 && !player.isDead) {
        timeSinceLastKill += gameDelta;
        // Crowd boos once when 15s pass without a kill — flag resets on next kill
        if (timeSinceLastKill >= 15 && !hasCrowdBooed) {
          hasCrowdBooed = true;
          audio.crowdBoo();
        }
      }
      // Scale crowd intensity: proximity to enemies + kill streak + style rank
      {
        const RANK_CROWD: Record<StyleRank, number> = { D: 0, C: 0.1, B: 0.2, A: 0.35, S: 0.5 };
        const streakBoost = Math.min(killStreakCount / 10, 0.4);
        const crowdLevel = Math.min(1, nearFactor * 0.5 + streakBoost + (RANK_CROWD[styleMeter.rank] ?? 0));
        audio.setCrowdIntensity(crowdLevel);
      }

      // Boss health bar update
      if (activeBoss && !activeBoss.isDead) {
        bossHealthBar.update(activeBoss);
      } else if (activeBoss?.isDead) {
        bossHealthBar.hide();
        activeBoss = null;
        // Boss death: extra loot + effects (handled by WaveManager via onEnemyKilled)
        audio.playBossSlam();
        vfx.shakeCamera(0.4, 0.6);
      }

      // Chromatic aberration driven by style rank
      {
        const rankStrength: Record<StyleRank, number> = {
          D: 0, C: 0, B: 0, A: 0.4, S: 0.9,
        };
        renderer.setChromaticAberration(rankStrength[styleMeter.rank] ?? 0);
      }

      // ── Original system updates (throttled by quality tier) ─────────────
      const qs = quality.getSettings();
      minimapTimer += delta;
      healthBarTimer += delta;
      if (minimapTimer >= qs.uiUpdateInterval) {
        minimapTimer = 0;
        minimap.update(player.getPosition(), player.getFacingYaw(), waves.enemies);
      }
      if (healthBarTimer >= qs.healthBarUpdateInterval) {
        healthBarTimer = 0;
        enemyHealthBars.update(waves.enemies);
      }
      loot.update(gameDelta, player);
      damageNumbers.update(delta);

      // ── New system updates ────────────────────────────────────────────────
      levelHUD.update(levelSystem.level, levelSystem.xpFraction, delta);
      weatherHUD.update(weather.currentWeather);

      // Kill streak reset when player takes damage
      if (player.hp < prevPlayerHp) {
        killStreakCount = 0;
        vfx.resetKillStreak();
      }

      // Footstep sounds during run animation
      if (player.anim.currentState === 'RUN' && !player.isDead) {
        // Throttle to avoid too frequent calls (already throttled by dust timer internally)
        if (Math.random() < 0.012) audio.playFootstep();
      }

      // Track best style rank for game-over screen and score saving
      gameOverScreen.updateBestRank(styleMeter.rank);
      {
        const RANK_ORDER: StyleRank[] = ['D', 'C', 'B', 'A', 'S'];
        if (RANK_ORDER.indexOf(styleMeter.rank) > RANK_ORDER.indexOf(bestRankThisRun)) {
          bestRankThisRun = styleMeter.rank;
        }
      }

      // Game-over: wait GAME_OVER_DELAY s after death slow-mo, then show overlay
      if (player.isDead && !gameOverShown) {
        gameOverTimer += delta;
        if (gameOverTimer >= GAME_OVER_DELAY) {
          gameOverShown = true;
          if (!scoresSaved) {
            scoresSaved = true;
            scoreManager.save(waves.currentWave, waves.totalKills, bestRankThisRun);
          }
          gameOverScreen.show(waves.currentWave, waves.totalKills);
          gameOverScreen.showBestScores(scoreManager.getBest());
        }
      }

      // Sync HUD every frame
      hud.updateHealth(player.hp, player.maxHp);
      hud.updateStamina(player.stamina, player.maxStamina);
      hud.updateStyleRank(styleMeter.rank);

      // ── Performance monitor + adaptive quality ──────────────────────────
      perf.activeEnemies = waves.enemies.length;
      perf.endPhase('update');
      // Feed loop timing into QualityManager for adaptive scaling
      quality.update(delta, perf.frameTimeAvgMs);
    },
    // onFixedUpdate  (deterministic 60 Hz physics + input → velocity)
    () => {
      perf.beginPhase('fixedUpdate');
      if (hitstopRemaining > 0) {
        perf.endPhase('fixedUpdate');
        return;
      }

      player.fixedUpdate(camera.yaw);
      waves.fixedUpdate(player.getPosition());
      hazards.fixedUpdate();
      physics.step();
      perf.endPhase('fixedUpdate');
    },
    // onRender
    () => {
      perf.beginPhase('render');
      renderer.render(elapsed);
      perf.endPhase('render');
      perf.endFrame(renderer.renderer);
    },
  );

  loop.start();

  // Wire pause menu to game loop
  pauseMenu.setGameLoop(loop);

  // ── Resize handler ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.resize();
  });
}

main().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : String(err));
});
