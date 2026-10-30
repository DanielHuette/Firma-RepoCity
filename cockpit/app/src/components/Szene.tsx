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

function shader(gl: WebGL2RenderingContext, typ: number, quelle: string): WebGLShader | null {
  const s = gl.createShader(typ);
  if (s === null) return null;
  gl.shaderSource(s, quelle);
  gl.compileShader(s);
  // Kompiliert der Shader nicht, bleibt der Hintergrund einfach nachtblau
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
  return s;
}

// Ein bildschirmfüllendes Dreieck mit dem Shader-Programm; null, wenn WebGL 2 nicht mitspielt
function programm(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (vs === null || fs === null) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const ort = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(ort);
  gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);
  return prog;
}

type Uniforms = Record<"aufloesung" | "zeit" | "staerke" | "licht" | "maus", WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram): Uniforms {
  const ort = (name: string) => gl.getUniformLocation(prog, name);
  return { aufloesung: ort("uAufloesung"), zeit: ort("uZeit"), staerke: ort("uStaerke"), licht: ort("uLicht"), maus: ort("uMaus") };
}

// Pointer in the shader's screen units (height = 1, origin in the middle)
function zuEinheit(x: number, y: number): { x: number; y: number } {
  return { x: (x - window.innerWidth / 2) / window.innerHeight, y: -(y - window.innerHeight / 2) / window.innerHeight };
}

function ruhe(): { x: number; y: number } {
  return { x: -0.22 * (window.innerWidth / window.innerHeight), y: 0.42 };
}

interface Bewegung {
  maus: { x: number; y: number; zx: number; zy: number };
  licht: { x: number; y: number; vx: number; vy: number; zx: number; zy: number };
  staerke: number;
}

function bewegung(staerke: number): Bewegung {
  const start = ruhe();
  return { maus: { x: 9, y: 9, zx: 9, zy: 9 }, licht: { ...start, vx: 0, vy: 0, zx: start.x, zy: start.y }, staerke };
}

function zeigerFolgen(stand: Bewegung, e: PointerEvent): void {
  if (e.pointerType !== "mouse") return;
  const punkt = zuEinheit(e.clientX, e.clientY);
  stand.maus.zx = punkt.x;
  stand.maus.zy = punkt.y;
  // The light leans towards the pointer but stays above the content
  const basis = ruhe();
  stand.licht.zx = basis.x + (punkt.x - basis.x) * 0.35;
  stand.licht.zy = basis.y + (punkt.y - basis.y) * 0.25;
}

function schritt(stand: Bewegung, dt: number, ruhig: boolean, zielStaerke: number): void {
  const { maus, licht } = stand;
  stand.staerke += (zielStaerke - stand.staerke) * (ruhig ? 1 : Math.min(1, dt * 2.5));
  maus.x += (maus.zx - maus.x) * Math.min(1, dt * 6);
  maus.y += (maus.zy - maus.y) * Math.min(1, dt * 6);
  // Spring for the spotlight (slightly underdamped, so it settles with a soft swing)
  const steif = 18, daempf = 6.5;
  licht.vx += ((licht.zx - licht.x) * steif - licht.vx * daempf) * dt;
  licht.vy += ((licht.zy - licht.y) * steif - licht.vy * daempf) * dt;
  licht.x += ruhig ? licht.zx - licht.x : licht.vx * dt;
  licht.y += ruhig ? licht.zy - licht.y : licht.vy * dt;
}

function malen(gl: WebGL2RenderingContext, u: Uniforms, stand: Bewegung, zeit: number): void {
  gl.uniform2f(u.aufloesung, gl.canvas.width, gl.canvas.height);
  gl.uniform1f(u.zeit, zeit);
  gl.uniform1f(u.staerke, stand.staerke);
  gl.uniform2f(u.licht, stand.licht.x, stand.licht.y);
  gl.uniform2f(u.maus, stand.maus.x, stand.maus.y);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Runs the frame loop until the returned function stops it. */
function schleife(gl: WebGL2RenderingContext, u: Uniforms, stand: Bewegung, ziel: { current: { staerke: number } }): () => void {
  const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let zuletzt = 0;
  let lauf = 0;
  let verloren = false;
  gl.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); verloren = true; });
  const zeichnen = (t: number) => {
    lauf = requestAnimationFrame(zeichnen);
    if (verloren || document.hidden || t - zuletzt < (ruhig ? 500 : 0)) return;
    const dt = Math.min(0.05, (t - zuletzt) / 1000);
    zuletzt = t;
    schritt(stand, dt, ruhig, ziel.current.staerke);
    malen(gl, u, stand, ruhig ? 12 : t / 1000);
  };
  lauf = requestAnimationFrame(zeichnen);
  return () => { cancelAnimationFrame(lauf); };
}

function starten(canvas: HTMLCanvasElement, ziel: { current: { staerke: number } }): (() => void) | undefined {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (gl === null) return undefined;
  const prog = programm(gl);
  if (prog === null) return undefined;
  // Der Hintergrund ist weich: höchstens Pixelverhältnis 1,25 reicht und schont den Akku
  const pixel = Math.min(window.devicePixelRatio || 1, 1.25);
  const anpassen = () => {
    canvas.width = Math.round(window.innerWidth * pixel);
    canvas.height = Math.round(window.innerHeight * pixel);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  anpassen();
  window.addEventListener("resize", anpassen);
  const stand = bewegung(ziel.current.staerke);
  const bewegen = (e: PointerEvent) => { zeigerFolgen(stand, e); };
  window.addEventListener("pointermove", bewegen, { passive: true });
  const anhalten = schleife(gl, uniforms(gl, prog), stand, ziel);
  return () => {
    anhalten();
    window.removeEventListener("resize", anpassen);
    window.removeEventListener("pointermove", bewegen);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

export function Szene({ leise }: { leise: boolean }) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const ziel = useRef({ staerke: leise ? 0.55 : 1 });
  ziel.current = { staerke: leise ? 0.55 : 1 };
  useEffect(() => (leinwand.current === null ? undefined : starten(leinwand.current, ziel)), []);
  return <canvas ref={leinwand} class="buehne" aria-hidden="true" />;
}
