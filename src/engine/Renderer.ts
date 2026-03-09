import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ── Vignette shader ──────────────────────────────────────────────────────────
const VignetteShader = {
  name: 'VignetteShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset:   { value: 0.75 },
    darkness: { value: 0.7 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vignette = 1.0 - smoothstep(offset, offset + 0.35, dot(uv, uv));
      color.rgb *= mix(1.0 - darkness, 1.0, vignette);
      gl_FragColor = color;
    }
  `,
};

// ── Color grading shader — warm shadows, slight desaturation, boosted contrast ──
const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // Slight contrast boost
      c = (c - 0.5) * 1.08 + 0.5;

      // Desaturate slightly (gritty Skyrim look)
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(lum), 0.12);

      // Warm the shadows — add orange tint in dark tones
      float shadow = clamp(1.0 - lum * 2.5, 0.0, 1.0);
      c += shadow * vec3(0.05, 0.02, 0.0);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

/**
 * Wraps Three.js WebGLRenderer + Scene with the project's visual settings.
 * Shadow maps, tone-mapping, fog and background colour are all set up here.
 * Post-processing: UnrealBloomPass for glowing emissives + vignette ShaderPass.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly composer: EffectComposer;

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

    // Colour grading — bright daylight look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // clear Mediterranean sky
    // Golden atmospheric haze — makes distant tiers fade with depth
    this.scene.fog = new THREE.FogExp2(0xd4c8a0, 0.002);

    // ── Camera ──────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );

    // ── Post-processing pipeline ─────────────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);

    // Base scene render pass
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom — makes emissive runes, sword trail, and torch flames glow
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,  // strength
      0.5,  // radius
      0.7,  // threshold
    );
    this.composer.addPass(bloomPass);

    // Cinematic vignette — subtle darkening at screen edges
    const vignettePass = new ShaderPass(VignetteShader);
    this.composer.addPass(vignettePass);

    // Color grading — warm shadows, desaturation, contrast boost
    const colorGradePass = new ShaderPass(ColorGradeShader);
    this.composer.addPass(colorGradePass);
  }

  /** Resize renderer + camera to current window dimensions. */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw the scene from the active camera using the post-processing pipeline. */
  render(): void {
    this.composer.render();
  }
}
