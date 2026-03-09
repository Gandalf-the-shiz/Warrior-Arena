import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ── Chromatic Aberration shader ───────────────────────────────────────────────
const ChromaticAberrationShader = {
  name: 'ChromaticAberrationShader',
  uniforms: {
    tDiffuse:  { value: null as THREE.Texture | null },
    strength:  { value: 0.0 }, // 0 = off, 1 = max (clamped to subtle range)
    resolution: { value: new THREE.Vector2(1920, 1080) },
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
    uniform float strength;
    uniform vec2 resolution;
    varying vec2 vUv;
    void main() {
      vec2 offset = strength * 2.0 / resolution;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};


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
 * Post-processing: UnrealBloomPass for glowing emissives + vignette ShaderPass
 * + chromatic aberration (Phase 3).
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly composer: EffectComposer;
  private readonly chromaticAberrationPass: ShaderPass;

  // Saved baseline scene state for weather restore
  private readonly baseFogColor = new THREE.Color(0xd4c8a0);
  private readonly baseFogDensity = 0.002;
  private readonly baseBgColor = new THREE.Color(0x87ceeb);

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

    // Chromatic aberration — subtle RGB channel offset during intense moments
    this.chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaticAberrationPass.uniforms['resolution']!.value.set(
      window.innerWidth,
      window.innerHeight,
    );
    this.composer.addPass(this.chromaticAberrationPass);
  }

  /**
   * Set chromatic aberration strength (0 = off, 1 = maximum).
   * Called by the game when StyleMeter reaches A/S rank.
   */
  setChromaticAberration(strength: number): void {
    const uniforms = this.chromaticAberrationPass.uniforms;
    if (uniforms['strength']) {
      uniforms['strength'].value = Math.max(0, Math.min(1, strength));
    }
  }

  /**
   * Apply weather-driven scene overrides.
   * @param fogColor  Target fog/bg tint colour (null = restore default)
   * @param fogDensity  Fog density (null = restore default 0.002)
   * @param bgColor  Sky background colour (null = restore default)
   */
  setWeatherOverrides(
    fogColor: THREE.Color | null,
    fogDensity: number | null,
    bgColor: THREE.Color | null,
  ): void {
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog instanceof THREE.FogExp2) {
      fog.color.copy(fogColor ?? this.baseFogColor);
      fog.density = fogDensity ?? this.baseFogDensity;
    }
    (this.scene.background as THREE.Color).copy(bgColor ?? this.baseBgColor);
  }

  /** Resize renderer + camera to current window dimensions. */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const uniforms = this.chromaticAberrationPass.uniforms;
    if (uniforms['resolution']) {
      uniforms['resolution'].value.set(w, h);
    }
  }

  /** Draw the scene from the active camera using the post-processing pipeline. */
  render(): void {
    this.composer.render();
  }
}
