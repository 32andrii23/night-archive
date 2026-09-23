import * as THREE from "three";

export type PostParams = {
  grain: number; vignette: number; aberration: number; flash: number; desaturate: number;
  glitch: number; tint: THREE.Color; tintMix: number; exposure: number; blood: number; blackout: number;
};

export const defaultPost = (): PostParams => ({
  grain: .07, vignette: .75, aberration: .35, flash: 0, desaturate: .18, glitch: 0,
  tint: new THREE.Color(1, 1, 1), tintMix: 0, exposure: 1, blood: 0, blackout: 0,
});

const vertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const fragment = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float time, grain, vignette, aberration, flash, desaturate, glitch, tintMix, exposure, blood, blackout;
uniform vec3 tint;
varying vec2 vUv;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  if (glitch > 0.0) {
    float band = floor(uv.y * 48.0);
    float r = rand(vec2(band, floor(time * 18.0)));
    if (r < glitch * 0.35) uv.x += (r - 0.17) * 0.12 * glitch;
    uv.y += (rand(vec2(floor(time * 9.0), 3.0)) - 0.5) * 0.01 * glitch;
  }
  vec2 dir = uv - 0.5;
  float d = length(dir);
  float ab = aberration * d * 0.014 + glitch * 0.01;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * ab).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * ab).b;
  col *= exposure;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), desaturate);
  col = mix(col, tint * (lum * 1.6 + 0.012), tintMix);
  col += flash;
  // Blood seeping in from the edges after being hurt.
  float edge = smoothstep(0.25, 0.85, d + (rand(floor(uv * 90.0)) - 0.5) * 0.04);
  col = mix(col, vec3(0.16, 0.0, 0.0) * (0.5 + lum), clamp(blood * edge * 1.4, 0.0, 0.9));
  col *= 1.0 - vignette * smoothstep(0.32, 0.92, d);
  col *= 1.0 - blackout;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float n = rand(vUv * resolution + fract(time * 7.13)) - 0.5;
  gl_FragColor.rgb += n * grain * (1.0 + glitch * 3.0);
  if (glitch > 0.0) gl_FragColor.rgb *= 1.0 - 0.25 * glitch * step(0.5, fract(vUv.y * resolution.y * 0.25 + time * 40.0));
}
`;

/**
 * Renders a scene into a half-float target, then composites it to the canvas
 * with tone mapping, grain, vignette and per-player effects. Used for both
 * the main view and the creature's picture-in-picture of the visitor.
 */
export class PostFX {
  private targets = new Map<string, THREE.WebGLRenderTarget>();
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  samples = 0;
  pixelated = false;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, depthTest: false, depthWrite: false, toneMapped: true,
      uniforms: {
        tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
        grain: { value: 0 }, vignette: { value: 0 }, aberration: { value: 0 }, flash: { value: 0 }, desaturate: { value: 0 },
        glitch: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) }, tintMix: { value: 0 }, exposure: { value: 1 },
        blood: { value: 0 }, blackout: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  target(name: string, width: number, height: number) {
    let rt = this.targets.get(name);
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    if (rt && (rt.samples !== this.samples)) { rt.dispose(); this.targets.delete(name); rt = undefined; }
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
      this.targets.set(name, rt);
    } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    const filter = this.pixelated ? THREE.NearestFilter : THREE.LinearFilter;
    if (rt.texture.magFilter !== filter) { rt.texture.magFilter = filter; rt.texture.minFilter = filter; rt.texture.needsUpdate = true; }
    return rt;
  }

  /** Scene → offscreen target. Call `composite` afterwards. */
  begin(renderer: THREE.WebGLRenderer, name: string, width: number, height: number) {
    const rt = this.target(name, width, height);
    // setRenderTarget applies the target's own (unscaled) viewport.
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rt);
    renderer.clear();
    return rt;
  }

  /** `viewport` is in CSS pixels, like WebGLRenderer.setViewport. */
  composite(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, viewport: THREE.Vector4, params: PostParams, time: number) {
    const u = this.material.uniforms;
    u.tDiffuse.value = rt.texture;
    u.resolution.value.set(viewport.z * renderer.getPixelRatio(), viewport.w * renderer.getPixelRatio());
    u.time.value = time;
    u.grain.value = params.grain; u.vignette.value = params.vignette; u.aberration.value = params.aberration;
    u.flash.value = params.flash; u.desaturate.value = params.desaturate; u.glitch.value = params.glitch;
    u.tint.value.copy(params.tint); u.tintMix.value = params.tintMix; u.exposure.value = params.exposure;
    u.blood.value = params.blood; u.blackout.value = params.blackout;
    renderer.setRenderTarget(null);
    renderer.setViewport(viewport);
    renderer.setScissor(viewport);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }

  dispose() {
    for (const rt of this.targets.values()) rt.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * Lets each instance of an InstancedMesh pick its own region of a texture
 * atlas through a vec4 `instUv` attribute (offset.xy, scale.zw).
 */
export function atlasMaterial<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 instUv;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vMapUv * instUv.zw + instUv.xy;
#endif
#ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = vEmissiveMapUv * instUv.zw + instUv.xy;
#endif
#ifdef USE_ALPHAMAP
  vAlphaMapUv = vAlphaMapUv * instUv.zw + instUv.xy;
#endif
#ifdef USE_BUMPMAP
  vBumpMapUv = vBumpMapUv * instUv.zw + instUv.xy;
#endif`);
  };
  material.customProgramCacheKey = () => "atlas-v1";
  return material;
}
