import RAPIER from '@dimforge/rapier3d-compat';
import { Renderer } from '@/engine/Renderer';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';
import { GameLoop } from '@/engine/GameLoop';
import { Arena } from '@/game/Arena';
import { PlayerController } from '@/game/PlayerController';
import { CameraController } from '@/game/CameraController';
import { WaveManager } from '@/game/WaveManager';
import { CombatSystem } from '@/game/CombatSystem';
import { VFXManager } from '@/game/VFXManager';
import { StyleMeter } from '@/game/StyleMeter';
import { HUD } from '@/ui/HUD';
import { AudioManager } from '@/engine/AudioManager';

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
  const loading = showLoading();

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
  const physics = new PhysicsWorld();
  const input = new InputManager(canvas);
  const hud = new HUD();

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

  // ── Pre-warm physics so player settles on the ground before first render
  for (let i = 0; i < 30; i++) {
    physics.step();
  }
  // Sync visual mesh to settled physics position immediately
  player.update(0);
  camera.update(player.getPosition(), 0);

  // Hide loading screen
  loading.remove();

  // Seed HUD with initial values
  hud.updateHealth(player.hp, player.maxHp);
  hud.updateStamina(player.stamina, player.maxStamina);
  hud.updateWave(1);
  hud.updateKills(0);

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

  // ── Game loop ──────────────────────────────────────────────────────────
  const loop = new GameLoop(
    // onUpdate  (variable timestep — mesh sync, lerp, camera)
    (delta) => {
      // Always advance elapsed so torches / cape still animate during hitstop
      elapsed += delta;
      arena.update(elapsed, delta);

      if (hitstopRemaining > 0) {
        hitstopRemaining = Math.max(0, hitstopRemaining - delta);
        // Camera still tracks smoothly during freeze
        camera.update(player.getPosition(), delta);
        return;
      }

      player.update(delta);
      camera.update(player.getPosition(), delta);
      waves.update(delta, player.getPosition());

      // ── Audio triggers ────────────────────────────────────────────────
      const nowAttacking = player.isAttackingState();
      if (nowAttacking && !prevAttacking) {
        audio.playSlash();
        audio.playGrunt();
      }
      prevAttacking = nowAttacking;

      const nowDodging = player.anim.currentState === 'DODGE';
      if (nowDodging && !prevDodging) audio.playDodge();
      prevDodging = nowDodging;

      // Player took damage
      if (player.hp < prevPlayerHp) audio.playPlayerHit();
      prevPlayerHp = player.hp;

      // Player died
      if (player.isDead && !prevPlayerDead) audio.playPlayerDeath();
      prevPlayerDead = player.isDead;

      // New wave started
      if (waves.currentWave > prevWave) {
        audio.playWaveStart();
        prevWave = waves.currentWave;
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
        () => { audio.playHit(); },
      );

      // Sword trail — sample tip position every frame during attacks
      vfx.updateSwordTrail(
        player.getSwordTipPosition(),
        player.isAttackingState(),
      );

      styleMeter.update(delta);
      vfx.update(delta);

      // Sync HUD every frame
      hud.updateHealth(player.hp, player.maxHp);
      hud.updateStamina(player.stamina, player.maxStamina);
      hud.updateStyleRank(styleMeter.rank);
    },
    // onFixedUpdate  (deterministic 60 Hz physics + input → velocity)
    () => {
      if (hitstopRemaining > 0) return;

      player.fixedUpdate(camera.yaw);
      waves.fixedUpdate(player.getPosition());
      physics.step();
    },
    // onRender
    () => {
      renderer.render();
    },
  );

  loop.start();

  // ── Resize handler ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.resize();
  });
}

main().catch((err: unknown) => {
  showError(err instanceof Error ? err.message : String(err));
});
