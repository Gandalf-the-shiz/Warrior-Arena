import RAPIER from '@dimforge/rapier3d-compat';
import { Renderer } from '@/engine/Renderer';
import { PhysicsWorld } from '@/engine/PhysicsWorld';
import { InputManager } from '@/engine/InputManager';
import { GameLoop } from '@/engine/GameLoop';
import { Arena } from '@/game/Arena';
import { PlayerController } from '@/game/PlayerController';
import { CameraController } from '@/game/CameraController';
import { HUD } from '@/ui/HUD';

async function main(): Promise<void> {
  // ── Initialise Rapier WASM ─────────────────────────────────────────────
  await RAPIER.init();

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
      player.update();
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

main().catch(console.error);
