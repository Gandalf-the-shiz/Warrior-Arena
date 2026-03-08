import * as THREE from 'three';

/**
 * Wraps Three.js WebGLRenderer + Scene with the project's visual settings.
 * Shadow maps, tone-mapping, fog and background colour are all set up here.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement) {
    // ── WebGL Renderer ──────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Shadows
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Colour grading — Reinhard avoids ACES's crushed-dark midtones; exposure
    // raised to 5.5 so dim dark-fantasy surfaces stay clearly readable without
    // blowing out bright emissives.
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 5.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    // Slightly lifted background so geometry doesn't vanish into pure black.
    this.scene.background = new THREE.Color(0x1e2040);
    // Low-density fog preserves atmosphere without swallowing floor/pillars.
    this.scene.fog = new THREE.FogExp2(0x1e2040, 0.003);

    // ── Camera ──────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
  }

  /** Resize renderer + camera to current window dimensions. */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw the scene from the active camera. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
