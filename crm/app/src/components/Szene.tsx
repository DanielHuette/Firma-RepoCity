// Background of the CRM, drawn by one fragment shader on a fixed canvas behind everything: the
// navy, slightly grained surface of the RepoCity reference render with a soft spotlight from the upper
// left and a dark falloff to the right. The spotlight hangs on a spring and follows the pointer;
// a few gold motes drift through the light and are pushed aside by the pointer. Full strength
// behind the sign-in, quieter inside the app. Without WebGL 2 or with reduced motion the canvas
// stays empty or still; the page never depends on it.
import { useEffect, useRef } from "preact/hooks";

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// uStaerke: 1 = sign-in, about 0.55 = quiet background. uLicht: spotlight centre in screen units.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uAufloesung;
uniform float uZeit;
uniform float uStaerke;
uniform vec2 uLicht;
uniform vec2 uMaus;
out vec4 farbe;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Exact sRGB curve: the plain 2.2 power lifts the deep navy into grey
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 uv = gl_FragCoord.xy / uAufloesung;
  vec2 p = (gl_FragCoord.xy - 0.5 * uAufloesung) / uAufloesung.y;
  float aspect = uAufloesung.x / uAufloesung.y;

  // Surface: deep navy, falling off to near black towards the right and the bottom (linear light)
  vec3 tief = vec3(0.0003, 0.0012, 0.0030);
  vec3 navy = vec3(0.0034, 0.0103, 0.0330);
  vec3 c = mix(navy, tief, smoothstep(-0.2, 1.1, uv.x * 0.8 + (1.0 - uv.y) * 0.45));

  // Spotlight: wide soft cone plus a brighter core, slightly elongated like a lamp from above
  vec2 d = p - uLicht;
  d.x *= 0.78;
  float kegel = exp(-dot(d, d) * 3.2);
  float kern = exp(-dot(d, d) * 11.0);
  vec3 licht = vec3(0.110, 0.205, 0.400);
  c += licht * (kegel * 0.32 + kern * 0.68) * (0.45 + 0.55 * uStaerke);

  // Fine grain of the coated surface, a little stronger inside the light
  float korn = noise(gl_FragCoord.xy * 0.9) * 0.6 + noise(gl_FragCoord.xy * 0.23) * 0.4;
  c *= 0.93 + 0.14 * korn * (0.4 + kegel);

  // Gold motes drifting upwards through the light; the pointer pushes them aside
  vec3 gold = vec3(0.95, 0.62, 0.22);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float massstab = 7.0 + fi * 5.0;
    vec2 q = p;
    vec2 weg = q - uMaus;
    q += normalize(weg + 1e-4) * 0.06 * exp(-dot(weg, weg) * 14.0);
    q = q * massstab + vec2(sin(uZeit * 0.11 + fi) * 0.6, -uZeit * (0.05 + fi * 0.025));
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5 - (vec2(hash(id + fi * 3.1), hash(id + fi * 7.3)) - 0.5) * 0.7;
    float da = step(0.95, hash(id + 13.0 + fi));
    float funkeln = 0.55 + 0.45 * sin(uZeit * (0.8 + hash(id) * 1.6) + hash(id + 5.0) * 30.0);
    float mote = smoothstep(0.045, 0.0, length(f)) * da * funkeln;
    c += gold * mote * (0.10 + kegel * 0.35) * (0.4 + 0.6 * uStaerke);
  }

  // Edge darkening, a slow light sheen and dithering against banding
  vec2 v = uv - vec2(0.42, 0.62);
  c *= 1.0 - dot(v * vec2(aspect * 0.55, 1.0), v * vec2(aspect * 0.55, 1.0)) * 0.55;
  float glanz = exp(-pow((uv.x + uv.y * 0.6) - mod(uZeit * 0.035, 3.0) + 0.6, 2.0) * 18.0);
  c += licht * glanz * 0.05 * uStaerke;
  // Dither after the gamma step, one code value wide, so dark areas stay dark
  vec3 aus = srgb(max(c, 0.0)) + (hash(gl_FragCoord.xy + fract(uZeit) * 100.0) - 0.5) / 255.0;
  farbe = vec4(aus, 1.0);
}
`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const compiled = gl.createShader(type);
  if (compiled === null) return null;
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  // A shader that does not compile leaves the background plain night blue.
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) return null;
  return compiled;
}

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (vertex === null || fragment === null) return null;
  const linked = gl.createProgram();
  gl.attachShader(linked, vertex);
  gl.attachShader(linked, fragment);
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) return null;
  gl.useProgram(linked);
  // One triangle that covers the whole screen.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(linked, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return linked;
}

type Uniforms = Record<"resolution" | "time" | "strength" | "light" | "pointer", WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, linked: WebGLProgram): Uniforms {
  return {
    resolution: gl.getUniformLocation(linked, "uAufloesung"),
    time: gl.getUniformLocation(linked, "uZeit"),
    strength: gl.getUniformLocation(linked, "uStaerke"),
    light: gl.getUniformLocation(linked, "uLicht"),
    pointer: gl.getUniformLocation(linked, "uMaus"),
  };
}

// The background is soft: a pixel ratio of at most 1.25 is enough and spares the battery.
function fitCanvas(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): () => void {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
  const fit = () => {
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  fit();
  window.addEventListener("resize", fit);
  return () => { window.removeEventListener("resize", fit); };
}

interface Motion {
  pointer: { x: number; y: number; tx: number; ty: number };
  light: { x: number; y: number; vx: number; vy: number; tx: number; ty: number };
}

const restingLight = () => ({ x: -0.22 * (window.innerWidth / window.innerHeight), y: 0.42 });

// Pointer in the shader's screen units (height = 1, origin in the middle).
function followPointer(motion: Motion): () => void {
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const x = (event.clientX - window.innerWidth / 2) / window.innerHeight;
    const y = -(event.clientY - window.innerHeight / 2) / window.innerHeight;
    motion.pointer.tx = x;
    motion.pointer.ty = y;
    // The light leans towards the pointer but stays above the content.
    const rest = restingLight();
    motion.light.tx = rest.x + (x - rest.x) * 0.35;
    motion.light.ty = rest.y + (y - rest.y) * 0.25;
  };
  window.addEventListener("pointermove", move, { passive: true });
  return () => { window.removeEventListener("pointermove", move); };
}

// Spring for the spotlight (slightly underdamped, so it settles with a soft swing).
function stepMotion(motion: Motion, dt: number, reduced: boolean): void {
  const { pointer, light } = motion;
  pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 6);
  pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 6);
  const stiffness = 18, damping = 6.5;
  light.vx += ((light.tx - light.x) * stiffness - light.vx * damping) * dt;
  light.vy += ((light.ty - light.y) * stiffness - light.vy * damping) * dt;
  light.x += reduced ? light.tx - light.x : light.vx * dt;
  light.y += reduced ? light.ty - light.y : light.vy * dt;
}

function animate(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, slots: Uniforms, target: { current: { strength: number } }): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rest = restingLight();
  const motion: Motion = { pointer: { x: 9, y: 9, tx: 9, ty: 9 }, light: { ...rest, vx: 0, vy: 0, tx: rest.x, ty: rest.y } };
  const stopPointer = followPointer(motion);
  const state = { strength: target.current.strength, last: 0, frame: 0, lost: false };
  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); state.lost = true; });
  const draw = (time: number) => {
    state.frame = requestAnimationFrame(draw);
    if (state.lost || document.hidden || time - state.last < (reduced ? 500 : 0)) return;
    const dt = Math.min(0.05, (time - state.last) / 1000);
    state.last = time;
    state.strength += (target.current.strength - state.strength) * (reduced ? 1 : Math.min(1, dt * 2.5));
    stepMotion(motion, dt, reduced);
    gl.uniform2f(slots.resolution, canvas.width, canvas.height);
    gl.uniform1f(slots.time, reduced ? 12 : time / 1000);
    gl.uniform1f(slots.strength, state.strength);
    gl.uniform2f(slots.light, motion.light.x, motion.light.y);
    gl.uniform2f(slots.pointer, motion.pointer.x, motion.pointer.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  state.frame = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(state.frame); stopPointer(); };
}

export function Szene({ leise }: { leise: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = useRef({ strength: leise ? 0.55 : 1 });
  target.current = { strength: leise ? 0.55 : 1 };
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" }) ?? null;
    if (canvas === null || gl === null) return;
    const linked = program(gl);
    if (linked === null) return;
    const stopFit = fitCanvas(gl, canvas);
    const stopAnimation = animate(gl, canvas, uniforms(gl, linked), target);
    return () => {
      stopAnimation();
      stopFit();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);
  return <canvas ref={canvasRef} class="buehne" aria-hidden="true" />;
}
