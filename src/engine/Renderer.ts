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

    // Colour grading — dark cinematic look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);
    // Exponential fog creates the Nordic hellscape atmosphere
    this.scene.fog = new THREE.FogExp2(0x0a0a0f, 0.025);

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
