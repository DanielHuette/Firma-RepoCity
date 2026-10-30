// 3D background of the cockpit, drawn by one fragment shader on a fixed canvas behind everything:
// night sky, a ground plane with the gold radar rings of the RepoCity mark, a small golden skyline on
// the horizon and gold sparks rising from it. Full strength behind the sign-in, quiet inside the app.
// Without WebGL 2 or with reduced motion the canvas stays empty or still; the page never depends on it.
import { useEffect, useRef } from "preact/hooks";

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// uStaerke: 1 = sign-in scene, about 0.45 = quiet background. uHorizont: height of the horizon in screen units.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uAufloesung;
uniform float uZeit;
uniform float uStaerke;
uniform float uHorizont;
uniform vec2 uMaus;
out vec4 farbe;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 srgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uAufloesung) / uAufloesung.y;
  p += uMaus * 0.015;
  float h0 = uHorizont;
  vec3 gold = vec3(1.0, 0.66, 0.26);

  // Himmel: Zenit fast schwarz, Horizont tiefblau
  vec3 c = mix(vec3(0.016, 0.04, 0.105), vec3(0.004, 0.006, 0.014), smoothstep(h0, h0 + 0.7, p.y));

  // Sterne
  if (p.y > h0) {
    vec2 z = floor(p * 90.0);
    float s = hash(z);
    vec2 f = fract(p * 90.0) - 0.5 - (vec2(hash(z + 3.1), hash(z + 7.7)) - 0.5) * 0.6;
    float stern = step(0.985, s) * smoothstep(0.12, 0.0, length(f)) * (0.6 + 0.4 * sin(uZeit * (1.0 + s * 3.0) + s * 40.0));
    c += vec3(0.75, 0.8, 1.0) * stern * smoothstep(h0, h0 + 0.2, p.y) * 0.8;
  }

  // Boden mit Radarringen in Perspektive
  if (p.y < h0) {
    float tiefe = 0.32 / max(h0 - p.y, 0.001);
    vec2 welt = vec2(p.x * tiefe, tiefe);
    float r = length(welt - vec2(0.0, 2.6));
    float wellen = fract(r * 1.6 - uZeit * 0.035);
    float breite = fwidth(r * 1.6) * 1.2;
    float ring = smoothstep(breite, 0.0, abs(wellen - 0.5) - 0.006);
    float nah = exp(-tiefe * 0.18);
    c = mix(vec3(0.008, 0.016, 0.04), vec3(0.004, 0.008, 0.02), nah);
    c += gold * ring * 0.22 * uStaerke * smoothstep(0.0, 0.6, nah + 0.1) * exp(-r * 0.12);
  }

  // Glühen der Stadt am Horizont
  vec2 g = vec2(p.x * 0.55, (p.y - h0) * 1.6);
  c += gold * exp(-dot(g, g) * 26.0) * 0.5 * uStaerke;

  // Skyline: Häuser als Säulen mit Fenstern, glockenförmig um die Mitte
  float spalte = floor(p.x * 70.0);
  float huelle = exp(-pow(p.x / 0.2, 2.0));
  float haus = (0.006 + huelle * (0.015 + 0.075 * hash(vec2(spalte, 1.0)))) * smoothstep(0.32, 0.0, abs(p.x));
  float y = p.y - h0;
  if (y > 0.0 && y < haus) {
    c = mix(vec3(0.02, 0.03, 0.06), c, 0.15);
    vec2 fz = vec2(fract(p.x * 70.0 * 3.0), fract(y * 260.0));
    vec2 fid = vec2(floor(p.x * 210.0), floor(y * 260.0));
    float fenster = step(0.3, fz.x) * step(fz.x, 0.75) * step(0.35, fz.y) * step(fz.y, 0.75) * step(0.5, hash(fid));
    c += gold * fenster * 1.2 * (0.55 + 0.45 * uStaerke);
  }

  // Funken steigen aus der Stadt auf
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = p * (10.0 + fi * 6.0);
    q.y -= uZeit * (0.25 + fi * 0.12);
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5 - (vec2(hash(id + fi), hash(id + fi + 9.0)) - 0.5) * 0.7;
    float da = step(0.86, hash(id + 17.0 + fi));
    float funke = smoothstep(0.08, 0.0, length(f)) * da;
    float raum = exp(-pow(p.x / 0.45, 2.0)) * smoothstep(h0 - 0.05, h0 + 0.08, p.y) * exp(-(p.y - h0) * 1.6);
    c += gold * funke * raum * 0.9 * uStaerke;
  }

  // Randabdunklung und Korn gegen Banding
  vec2 v = gl_FragCoord.xy / uAufloesung - 0.5;
  c *= 1.0 - dot(v, v) * 0.9;
  c += (hash(gl_FragCoord.xy + fract(uZeit) * 100.0) - 0.5) * 0.012;
  farbe = vec4(srgb(max(c, 0.0)), 1.0);
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

export function Szene({ leise }: { leise: boolean }) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const ziel = useRef({ staerke: leise ? 0.45 : 1, horizont: leise ? -0.42 : -0.33 });
  ziel.current = { staerke: leise ? 0.45 : 1, horizont: leise ? -0.42 : -0.33 };

  useEffect(() => {
    const canvas = leinwand.current;
    if (canvas === null) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (gl === null) return;
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (vs === null || fs === null) return;
    const programm = gl.createProgram();
    gl.attachShader(programm, vs);
    gl.attachShader(programm, fs);
    gl.linkProgram(programm);
    if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) return;
    gl.useProgram(programm);

    // Ein bildschirmfüllendes Dreieck
    const puffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const ort = gl.getAttribLocation(programm, "aPos");
    gl.enableVertexAttribArray(ort);
    gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);

    const u = {
      aufloesung: gl.getUniformLocation(programm, "uAufloesung"),
      zeit: gl.getUniformLocation(programm, "uZeit"),
      staerke: gl.getUniformLocation(programm, "uStaerke"),
      horizont: gl.getUniformLocation(programm, "uHorizont"),
      maus: gl.getUniformLocation(programm, "uMaus"),
    };

    // Der Hintergrund ist weich: höchstens Pixelverhältnis 1,25 reicht und schont den Akku
    const pixel = Math.min(window.devicePixelRatio || 1, 1.25);
    const anpassen = () => {
      canvas.width = Math.round(window.innerWidth * pixel);
      canvas.height = Math.round(window.innerHeight * pixel);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    anpassen();
    window.addEventListener("resize", anpassen);

    const maus = { x: 0, y: 0, zx: 0, zy: 0 };
    const bewegen = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      maus.zx = (e.clientX / window.innerWidth) * 2 - 1;
      maus.zy = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", bewegen, { passive: true });

    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const jetzt = { staerke: ziel.current.staerke, horizont: ziel.current.horizont };
    let zuletzt = 0;
    let lauf = 0;
    let verloren = false;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); verloren = true; });

    const zeichnen = (t: number) => {
      lauf = requestAnimationFrame(zeichnen);
      if (verloren || document.hidden) return;
      // Innen genügen 30 Bilder pro Sekunde; die Anmeldung läuft flüssig mit voller Rate
      const intervall = ruhig ? 500 : ziel.current.staerke < 0.9 ? 1000 / 30 : 0;
      if (t - zuletzt < intervall) return;
      const dt = Math.min(0.05, (t - zuletzt) / 1000);
      zuletzt = t;
      const folgen = ruhig ? 1 : Math.min(1, dt * 2.5);
      jetzt.staerke += (ziel.current.staerke - jetzt.staerke) * folgen;
      jetzt.horizont += (ziel.current.horizont - jetzt.horizont) * folgen;
      maus.x += (maus.zx - maus.x) * Math.min(1, dt * 3);
      maus.y += (maus.zy - maus.y) * Math.min(1, dt * 3);
      gl.uniform2f(u.aufloesung, canvas.width, canvas.height);
      gl.uniform1f(u.zeit, ruhig ? 12 : t / 1000);
      gl.uniform1f(u.staerke, jetzt.staerke);
      gl.uniform1f(u.horizont, jetzt.horizont);
      gl.uniform2f(u.maus, maus.x, maus.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    lauf = requestAnimationFrame(zeichnen);

    return () => {
      cancelAnimationFrame(lauf);
      window.removeEventListener("resize", anpassen);
      window.removeEventListener("pointermove", bewegen);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={leinwand} class="buehne" aria-hidden="true" />;
}
