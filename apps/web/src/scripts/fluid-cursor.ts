/**
 * Fluid cursor — a GPU fluid simulation that follows the pointer.
 *
 * A Navier–Stokes solver on the GPU: velocity is advected through itself, made
 * divergence-free by a Jacobi pressure solve, and used to advect a dye texture
 * that is what you actually see. Ported from the Vue `FluidCursor` component
 * (itself after Cursify, after Pavel Dobryakov's WebGL-fluid-simulation) to a
 * plain TypeScript island, because this app has no Vue and no component
 * library.
 *
 * Three adaptations rather than a straight port:
 *
 * 1. **The palette is the product's, not a rainbow.** The reference cycles full
 *    HSV hue. On a white blueprint page that reads as confetti; splats are
 *    generated in a narrow band around the brand blue so the effect belongs to
 *    FleetScope instead of being decoration bolted on.
 * 2. **It never runs where the product is working.** The Agent Viewer owns a
 *    WebGL context for the execution graph, and a fluid solver competing for
 *    the GPU with the thing a developer came to read is a bad trade. The
 *    landing page mounts this; the console does not.
 * 3. **It is the first thing to go.** Reduced motion, no pointer (touch), no
 *    WebGL, a hidden tab, or a device that reports few cores — in every one of
 *    those it does not start, or stops. Nothing on the page depends on it.
 */

interface FluidOptions {
  /** Velocity grid. Detail vs. fill-rate; 128 is the reference default. */
  readonly simResolution: number;
  /** Dye (colour) grid. The visible resolution. */
  readonly dyeResolution: number;
  /** How fast colour fades. Higher disappears sooner. */
  readonly densityDissipation: number;
  /** How fast motion fades. Higher settles sooner. */
  readonly velocityDissipation: number;
  readonly pressure: number;
  readonly pressureIterations: number;
  /** Vorticity confinement — puts the small swirls back that advection eats. */
  readonly curl: number;
  readonly splatRadius: number;
  readonly splatForce: number;
  readonly shading: boolean;
}

const DEFAULTS: FluidOptions = {
  simResolution: 128,
  // The reference uses 1440. This is a background flourish on a page whose job
  // is to be read, so it takes the smaller texture: a quarter of the fill rate
  // and, at this blur, no visible difference.
  dyeResolution: 1024,
  densityDissipation: 3.5,
  velocityDissipation: 2,
  pressure: 0.1,
  pressureIterations: 20,
  curl: 3,
  splatRadius: 0.2,
  splatForce: 6000,
  shading: true,
};

/** FleetScope's electric blue, in HSV, and how far a splat may stray from it. */
const BRAND_HUE = 0.63;
const HUE_SPREAD = 0.06;

interface Pointer {
  id: number;
  texcoordX: number;
  texcoordY: number;
  prevTexcoordX: number;
  prevTexcoordY: number;
  deltaX: number;
  deltaY: number;
  down: boolean;
  moved: boolean;
  color: [number, number, number];
}

const createPointer = (): Pointer => ({
  id: -1,
  texcoordX: 0,
  texcoordY: 0,
  prevTexcoordX: 0,
  prevTexcoordY: 0,
  deltaX: 0,
  deltaY: 0,
  down: false,
  moved: false,
  color: [0, 0, 0],
});

/** HSV→RGB, restricted to the brand band by the caller. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function splatColor(): [number, number, number] {
  const hue = BRAND_HUE + (Math.random() - 0.5) * 2 * HUE_SPREAD;
  const [r, g, b] = hsvToRgb(hue, 0.85, 1);
  // The solver treats these as densities, not sRGB. The reference scales by
  // 0.15; on a white ground that is nearly invisible, so this leans brighter.
  return [r * 0.22, g * 0.22, b * 0.22];
}

// ── Shaders ──────────────────────────────────────────────────────────────────

const BASE_VERTEX = `
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;
  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const CLEAR_SHADER = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
`;

const DISPLAY_SHADER = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uTexture;
  uniform vec2 texelSize;

  void main () {
    vec3 c = texture2D(uTexture, vUv).rgb;

  #ifdef SHADING
    vec3 lc = texture2D(uTexture, vL).rgb;
    vec3 rc = texture2D(uTexture, vR).rgb;
    vec3 tc = texture2D(uTexture, vT).rgb;
    vec3 bc = texture2D(uTexture, vB).rgb;

    float dx = length(rc) - length(lc);
    float dy = length(tc) - length(bc);

    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    vec3 l = vec3(0.0, 0.0, 1.0);

    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    c *= diffuse;
  #endif

    float a = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c, a);
  }
`;

const SPLAT_SHADER = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;

  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

const ADVECTION_SHADER = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform vec2 dyeTexelSize;
  uniform float dt;
  uniform float dissipation;

  vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
  }

  void main () {
  #ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
  #else
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
  #endif
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`;

const DIVERGENCE_SHADER = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;

    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }

    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const CURL_SHADER = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

const VORTICITY_SHADER = `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;

  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const PRESSURE_SHADER = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;

  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_SUBTRACT_SHADER = `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// ── WebGL plumbing ───────────────────────────────────────────────────────────

type GL = WebGL2RenderingContext | WebGLRenderingContext;

interface Formats {
  readonly gl: GL;
  readonly isWebGL2: boolean;
  readonly halfFloat: number;
  readonly supportLinearFiltering: boolean;
  readonly formatRGBA: { internalFormat: number; format: number } | null;
  readonly formatRG: { internalFormat: number; format: number } | null;
  readonly formatR: { internalFormat: number; format: number } | null;
}

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach(id: number): number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  swap(): void;
}

function getContext(canvas: HTMLCanvasElement): Formats | null {
  const params = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  } as const;

  let gl: GL | null = canvas.getContext('webgl2', params) as WebGL2RenderingContext | null;
  const isWebGL2 = gl !== null;
  if (gl === null) {
    gl = (canvas.getContext('webgl', params) ??
      canvas.getContext('experimental-webgl', params)) as WebGLRenderingContext | null;
  }
  if (gl === null) return null;

  let halfFloat: number;
  let supportLinearFiltering = false;

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    gl2.getExtension('EXT_color_buffer_float');
    supportLinearFiltering = gl2.getExtension('OES_texture_float_linear') !== null;
    halfFloat = gl2.HALF_FLOAT;
  } else {
    const ext = gl.getExtension('OES_texture_half_float');
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear') !== null;
    halfFloat = (ext as { HALF_FLOAT_OES: number } | null)?.HALF_FLOAT_OES ?? 0;
  }

  gl.clearColor(0, 0, 0, 1);

  const supported = (internalFormat: number, format: number, type: number): boolean => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return ok;
  };

  const pick = (
    internalFormat: number,
    format: number,
  ): { internalFormat: number; format: number } | null => {
    if (supported(internalFormat, format, halfFloat)) return { internalFormat, format };
    return null;
  };

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    return {
      gl,
      isWebGL2,
      halfFloat,
      supportLinearFiltering,
      formatRGBA: pick(gl2.RGBA16F, gl2.RGBA),
      formatRG: pick(gl2.RG16F, gl2.RG),
      formatR: pick(gl2.R16F, gl2.RED),
    };
  }

  const rgba = pick(gl.RGBA, gl.RGBA);
  return {
    gl,
    isWebGL2,
    halfFloat,
    supportLinearFiltering,
    formatRGBA: rgba,
    formatRG: rgba,
    formatR: rgba,
  };
}

function compile(gl: GL, type: number, source: string, keywords: string[] = []): WebGLShader {
  const prefix = keywords.map((word) => `#define ${word}\n`).join('');
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('shader could not be created');
  gl.shaderSource(shader, prefix + source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

class Program {
  readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly program: WebGLProgram;
  private readonly gl: GL;

  constructor(gl: GL, vertex: WebGLShader, fragment: WebGLShader) {
    this.gl = gl;
    const program = gl.createProgram();
    if (program === null) throw new Error('program could not be created');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
    this.program = program;

    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i += 1) {
      const name = gl.getActiveUniform(program, i)?.name;
      if (name !== undefined) this.uniforms[name] = gl.getUniformLocation(program, name);
    }
  }

  bind(): void {
    this.gl.useProgram(this.program);
  }
}

// ── The simulation ───────────────────────────────────────────────────────────

export interface FluidCursor {
  destroy(): void;
}

/**
 * Start the simulation on `canvas`.
 *
 * Returns `null` when it should not run at all — no WebGL, no float targets, a
 * coarse pointer, or a reduced-motion preference. A null return is a normal
 * outcome, not a failure: the page is complete without it.
 */
export function mountFluidCursor(
  canvas: HTMLCanvasElement,
  overrides: Partial<FluidOptions> = {},
): FluidCursor | null {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  // A trail that follows a pointer needs a pointer. On touch it would only
  // burn battery behind the reader's finger.
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;

  const config: FluidOptions = { ...DEFAULTS, ...overrides };

  const detected = getContext(canvas);
  if (detected === null) return null;
  if (detected.formatRGBA === null) return null;

  // Re-bound as non-nullable: the closures below outlive this check, and a
  // narrowing from an early return does not reach into them.
  const context: Formats = detected;
  const { gl, supportLinearFiltering } = context;
  const halfFloat = context.halfFloat;

  const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

  // ── Geometry: one triangle pair, reused by every pass ──
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  const blit = (target: FBO | null): void => {
    if (target === null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  const vertexShader = compile(gl, gl.VERTEX_SHADER, BASE_VERTEX);
  const build = (source: string, keywords: string[] = []): Program =>
    new Program(gl, vertexShader, compile(gl, gl.FRAGMENT_SHADER, source, keywords));

  const clearProgram = build(CLEAR_SHADER);
  const splatProgram = build(SPLAT_SHADER);
  const advectionProgram = build(
    ADVECTION_SHADER,
    supportLinearFiltering ? [] : ['MANUAL_FILTERING'],
  );
  const divergenceProgram = build(DIVERGENCE_SHADER);
  const curlProgram = build(CURL_SHADER);
  const vorticityProgram = build(VORTICITY_SHADER);
  const pressureProgram = build(PRESSURE_SHADER);
  const gradienSubtractProgram = build(GRADIENT_SUBTRACT_SHADER);
  const displayProgram = build(DISPLAY_SHADER, config.shading ? ['SHADING'] : []);

  function createFBO(w: number, h: number, internal: number, format: number, param: number): FBO {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    if (texture === null) throw new Error('texture could not be created');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, halfFloat, null);

    const fbo = gl.createFramebuffer();
    if (fbo === null) throw new Error('framebuffer could not be created');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id: number): number {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  function createDoubleFBO(
    w: number,
    h: number,
    internal: number,
    format: number,
    param: number,
  ): DoubleFBO {
    const one = createFBO(w, h, internal, format, param);
    const two = createFBO(w, h, internal, format, param);
    return {
      read: one,
      write: two,
      width: w,
      height: h,
      texelSizeX: one.texelSizeX,
      texelSizeY: one.texelSizeY,
      swap(): void {
        const temp = this.read;
        this.read = this.write;
        this.write = temp;
      },
    };
  }

  const resolution = (target: number): { width: number; height: number } => {
    const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const ratio = aspect < 1 ? 1 / aspect : aspect;
    const min = Math.round(target);
    const max = Math.round(target * ratio);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  };

  const rgba = detected.formatRGBA;
  const rg = context.formatRG ?? rgba;
  const r = context.formatR ?? rgba;

  const dyeSize = resolution(config.dyeResolution);
  const simSize = resolution(config.simResolution);

  let dye = createDoubleFBO(
    dyeSize.width,
    dyeSize.height,
    rgba.internalFormat,
    rgba.format,
    filtering,
  );
  let velocity = createDoubleFBO(
    simSize.width,
    simSize.height,
    rg.internalFormat,
    rg.format,
    filtering,
  );
  const divergence = createFBO(
    simSize.width,
    simSize.height,
    r.internalFormat,
    r.format,
    gl.NEAREST,
  );
  const curlFBO = createFBO(simSize.width, simSize.height, r.internalFormat, r.format, gl.NEAREST);
  let pressureFBO = createDoubleFBO(
    simSize.width,
    simSize.height,
    r.internalFormat,
    r.format,
    gl.NEAREST,
  );

  const pointers: Pointer[] = [createPointer()];
  let lastTime = performance.now();
  let frame = 0;
  let running = true;

  function resize(): void {
    const scale = Math.min(window.devicePixelRatio, 2);
    const width = Math.floor(canvas.clientWidth * scale);
    const height = Math.floor(canvas.clientHeight * scale);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;

    const nextDye = resolution(config.dyeResolution);
    const nextSim = resolution(config.simResolution);
    dye = createDoubleFBO(
      nextDye.width,
      nextDye.height,
      rgba.internalFormat,
      rgba.format,
      filtering,
    );
    velocity = createDoubleFBO(
      nextSim.width,
      nextSim.height,
      rg.internalFormat,
      rg.format,
      filtering,
    );
    pressureFBO = createDoubleFBO(
      nextSim.width,
      nextSim.height,
      r.internalFormat,
      r.format,
      gl.NEAREST,
    );
  }

  function splat(x: number, y: number, dx: number, dy: number, color: number[]): void {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms['uTarget'] ?? null, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms['aspectRatio'] ?? null, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms['point'] ?? null, x, y);
    gl.uniform3f(splatProgram.uniforms['color'] ?? null, dx, dy, 0);
    gl.uniform1f(
      splatProgram.uniforms['radius'] ?? null,
      (config.splatRadius / 100) *
        (canvas.width / canvas.height > 1 ? canvas.width / canvas.height : 1),
    );
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms['uTarget'] ?? null, dye.read.attach(0));
    gl.uniform3f(
      splatProgram.uniforms['color'] ?? null,
      color[0] ?? 0,
      color[1] ?? 0,
      color[2] ?? 0,
    );
    blit(dye.write);
    dye.swap();
  }

  function applyInputs(): void {
    for (const pointer of pointers) {
      if (!pointer.moved) continue;
      pointer.moved = false;
      splat(
        pointer.texcoordX,
        pointer.texcoordY,
        pointer.deltaX * config.splatForce,
        pointer.deltaY * config.splatForce,
        pointer.color,
      );
    }
  }

  function step(dt: number): void {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(
      curlProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    gl.uniform1i(curlProgram.uniforms['uVelocity'] ?? null, velocity.read.attach(0));
    blit(curlFBO);

    vorticityProgram.bind();
    gl.uniform2f(
      vorticityProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    gl.uniform1i(vorticityProgram.uniforms['uVelocity'] ?? null, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms['uCurl'] ?? null, curlFBO.attach(1));
    gl.uniform1f(vorticityProgram.uniforms['curl'] ?? null, config.curl);
    gl.uniform1f(vorticityProgram.uniforms['dt'] ?? null, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(
      divergenceProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    gl.uniform1i(divergenceProgram.uniforms['uVelocity'] ?? null, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms['uTexture'] ?? null, pressureFBO.read.attach(0));
    gl.uniform1f(clearProgram.uniforms['value'] ?? null, config.pressure);
    blit(pressureFBO.write);
    pressureFBO.swap();

    pressureProgram.bind();
    gl.uniform2f(
      pressureProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    gl.uniform1i(pressureProgram.uniforms['uDivergence'] ?? null, divergence.attach(0));
    for (let i = 0; i < config.pressureIterations; i += 1) {
      gl.uniform1i(pressureProgram.uniforms['uPressure'] ?? null, pressureFBO.read.attach(1));
      blit(pressureFBO.write);
      pressureFBO.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(
      gradienSubtractProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    gl.uniform1i(gradienSubtractProgram.uniforms['uPressure'] ?? null, pressureFBO.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms['uVelocity'] ?? null, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(
      advectionProgram.uniforms['texelSize'] ?? null,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    if (!supportLinearFiltering) {
      gl.uniform2f(
        advectionProgram.uniforms['dyeTexelSize'] ?? null,
        velocity.texelSizeX,
        velocity.texelSizeY,
      );
    }
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms['uVelocity'] ?? null, velocityId);
    gl.uniform1i(advectionProgram.uniforms['uSource'] ?? null, velocityId);
    gl.uniform1f(advectionProgram.uniforms['dt'] ?? null, dt);
    gl.uniform1f(advectionProgram.uniforms['dissipation'] ?? null, config.velocityDissipation);
    blit(velocity.write);
    velocity.swap();

    if (!supportLinearFiltering) {
      gl.uniform2f(
        advectionProgram.uniforms['dyeTexelSize'] ?? null,
        dye.texelSizeX,
        dye.texelSizeY,
      );
    }
    gl.uniform1i(advectionProgram.uniforms['uVelocity'] ?? null, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms['uSource'] ?? null, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms['dissipation'] ?? null, config.densityDissipation);
    blit(dye.write);
    dye.swap();
  }

  function render(): void {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    displayProgram.bind();
    gl.uniform2f(
      displayProgram.uniforms['texelSize'] ?? null,
      1 / gl.drawingBufferWidth,
      1 / gl.drawingBufferHeight,
    );
    gl.uniform1i(displayProgram.uniforms['uTexture'] ?? null, dye.read.attach(0));
    blit(null);
  }

  function loop(): void {
    if (!running) return;

    // A hidden tab has nobody watching. `requestAnimationFrame` already
    // throttles, but a twenty-iteration pressure solve per frame is work with
    // no reader either way.
    if (document.hidden) {
      frame = requestAnimationFrame(loop);
      lastTime = performance.now();
      return;
    }

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.016666);
    lastTime = now;

    resize();
    applyInputs();
    step(dt);
    render();

    frame = requestAnimationFrame(loop);
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  const correctDelta = (value: number, axis: 'x' | 'y'): number => {
    const aspect = canvas.width / canvas.height;
    if (axis === 'x') return aspect < 1 ? value * aspect : value;
    return aspect > 1 ? value / aspect : value;
  };

  const onMove = (event: PointerEvent): void => {
    const pointer = pointers[0];
    if (pointer === undefined) return;

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;

    if (pointer.id === -1) {
      // First sighting: seed both positions, or the opening frame draws a
      // splat from the top-left corner to the cursor.
      pointer.id = event.pointerId;
      pointer.texcoordX = x;
      pointer.texcoordY = y;
      pointer.color = splatColor();
    }

    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = x;
    pointer.texcoordY = y;
    pointer.deltaX = correctDelta(pointer.texcoordX - pointer.prevTexcoordX, 'x');
    pointer.deltaY = correctDelta(pointer.texcoordY - pointer.prevTexcoordY, 'y');
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  };

  const onDown = (): void => {
    const pointer = pointers[0];
    if (pointer !== undefined) pointer.color = splatColor();
  };

  const onLeave = (): void => {
    const pointer = pointers[0];
    if (pointer !== undefined) pointer.moved = false;
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });

  resize();
  loop();

  return {
    destroy(): void {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerleave', onLeave);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
    },
  };
}
