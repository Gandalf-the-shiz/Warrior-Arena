import RAPIER from '@dimforge/rapier3d-compat';
import { Renderer } from '@/engine/Renderer';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';
import { GameLoop } from '@/engine/GameLoop';
import { Arena } from '@/game/Arena';
import { PlayerController } from '@/game/PlayerController';
import { CameraController } from '@/game/CameraController';
import { HUD } from '@/ui/HUD';

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
  hud.updateHealth(100, 100);
  hud.updateStamina(100, 100);
  hud.updateWave(1);
  hud.updateKills(0);

  let elapsed = 0;

  // ── Game loop ──────────────────────────────────────────────────────────
  const loop = new GameLoop(
    // onUpdate  (variable timestep — mesh sync, lerp, camera)
    (delta) => {
      elapsed += delta;
      arena.update(elapsed);
      player.update(delta);
      camera.update(player.getPosition(), delta);
    },
    // onFixedUpdate  (deterministic 60 Hz physics + input → velocity)
    () => {
      // Pass current camera yaw so movement is always camera-relative
      player.fixedUpdate(camera.yaw);
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
