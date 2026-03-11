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
    offset:   { value: 0.7 },
    darkness: { value: 0.8 },
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

// ── Film Grain shader — subtle cinematic noise ────────────────────────────────
const FilmGrainShader = {
  name: 'FilmGrainShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time:     { value: 0.0 },
    strength: { value: 0.025 }, // 2.5% grain
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
    uniform float time;
    uniform float strength;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float grain = rand(vUv + fract(time * 0.07)) * 2.0 - 1.0;
      color.rgb += grain * strength;
      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }
  `,
};


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
  private readonly filmGrainPass: ShaderPass;

  // Saved baseline scene state for weather restore
  private readonly baseFogColor = new THREE.Color(0xc8a080);
  private readonly baseFogDensity = 0.003;
  private readonly baseBgColor = new THREE.Color(0x1a1a3e);

  constructor(canvas: HTMLCanvasElement) {
    // ── WebGL Renderer ──────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Shadows — use VSMShadowMap for smooth, high-quality soft shadows on
    // PBR armor surfaces; VSM avoids the "peter-panning" artifact of PCF at
    // the cost of a tiny memory overhead.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;

    // Colour grading — slightly higher exposure for polished PBR metals
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a3e); // deep dark blue (sky dome covers this)
    // Warm amber atmospheric haze — evokes Skyrim-style golden dusk
    this.scene.fog = new THREE.FogExp2(0xc8a080, 0.003);

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

    // Bloom — lower threshold so torches, emissive sword, visor glow all pop
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,  // strength — stronger glow
      0.6,  // radius
      0.5,  // threshold — lower so more emissives bloom
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

    // Film grain — subtle cinematic noise texture
    this.filmGrainPass = new ShaderPass(FilmGrainShader);
    this.composer.addPass(this.filmGrainPass);
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

  /**
   * Generate and apply a procedural environment map to the scene.
   * Creates a warm arena cubemap (amber torchlight + dark stone) using PMREMGenerator.
   * Calling this allows all MeshPhysicalMaterial objects to receive IBL reflections.
   */
  buildEnvironmentMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    // Build a tiny equirectangular gradient DataTexture that encodes the
    // warm arena lighting environment: amber/orange top half, dark stone bottom.
    const W = 256, H = 128;
    const BYTES_PER_PIXEL = 4; // RGBA
    const data = new Uint8Array(W * H * BYTES_PER_PIXEL);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * BYTES_PER_PIXEL;
        // Normalised vertical position: 0 = bottom (floor/dark stone), 1 = top (sky/torchlight)
        const t = 1.0 - y / H;
        // Top: warm amber torch glow  (#c86428 → #7a3214)
        // Bottom: dark cold stone     (#0a0808)
        const r = Math.round(t * t * 200 + (1 - t) * 10);
        const g = Math.round(t * t * 80  + (1 - t) * 8);
        const b = Math.round(t * t * 20  + (1 - t) * 8);
        data[idx]     = Math.min(255, r);
        data[idx + 1] = Math.min(255, g);
        data[idx + 2] = Math.min(255, b);
        data[idx + 3] = 255;
      }
    }
    const equirectTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    equirectTex.mapping = THREE.EquirectangularReflectionMapping;
    equirectTex.needsUpdate = true;

    const envMap = pmrem.fromEquirectangular(equirectTex).texture;
    this.scene.environment = envMap;

    equirectTex.dispose();
    pmrem.dispose();
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
  render(time = 0): void {
    // Animate film grain
    if (this.filmGrainPass.uniforms['time']) {
      this.filmGrainPass.uniforms['time'].value = time;
    }
    this.composer.render();
  }
}
