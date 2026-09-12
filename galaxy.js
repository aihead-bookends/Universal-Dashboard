/* Universal Dashboard — the 3D galaxy behind the page, and app logos rising in on scroll.
 *
 * Plain WebGL, no library. The galaxy is modelled loosely on a real spiral:
 *  - stars orbit at speeds from a flat rotation curve, so the inner disc turns
 *    faster than the rim (differential rotation);
 *  - the two arms are a density wave turning at one steady pattern speed, so
 *    they never wind up: stars brighten while passing through an arm, and
 *    nebulae and dust lanes ride with the arms;
 *  - old warm stars fill the bulge, young blue-white stars light the arms.
 * The camera follows scroll: above and far away at the top of the page, diving
 * toward the disc as you scroll; scroll speed runs galaxy time forward or back.
 * Moving the pointer paints a smooth flow field over the screen: star points
 * near its path are carried along the way it moves, like specks in water around
 * a hand, then ease back onto their orbits without waves.
 * Without WebGL the CSS backdrop in index.html shows instead; with reduced
 * motion one still frame is drawn.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 700px)').matches;

  /* ------------------------------------------ mouse parallax and cursor */
  let pointerX = 0;
  let pointerY = 0;
  // The pointer in clip space (y up).
  let aimX = 0;
  let aimY = 0;
  let aiming = false;
  let snap = false;
  const follow = (e) => {
    const nx = (e.clientX / innerWidth) * 2 - 1;
    const ny = 1 - (e.clientY / innerHeight) * 2;
    if (e.pointerType === 'mouse') {
      pointerX = nx;
      pointerY = -ny;
    }
    if (!aiming) snap = true; // first contact or re-entering the page: no stroke from the old spot
    aimX = nx;
    aimY = ny;
    aiming = true;
  };
  addEventListener('pointermove', follow, { passive: true });
  addEventListener('pointerdown', follow, { passive: true });
  root.addEventListener('pointerleave', () => { aiming = false; });

  /* ------------------------------------------------------------ galaxy */
  const canvas = document.getElementById('galaxy');
  const gl = canvas && canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) {
    canvas?.remove();
    return;
  }

  // Kinds (aMisc.y): 0 disc star, 1 bulge star, 2 distant star, 3 nebula or glow, 4 dust.
  const VS = `
attribute vec4 aOrbit; // orbit radius, start angle, height, arm offset
attribute vec4 aCol;   // rgb, alpha
attribute vec3 aMisc;  // size, kind, how strongly the arms brighten it
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uScale;
uniform float uMax;
uniform float uStarMax;
uniform vec2 uShift;
#ifdef FLOW
uniform sampler2D uFlowTex; // the pointer's carry field over the screen (galaxy.js)
#endif
#ifdef FLOW_FLOAT
uniform vec2 uFieldSize;    // flow grid size, in texels
#endif
uniform float uFlow;    // strongest carry in the field: 0 once everything has settled
uniform float uAspect;
varying vec4 vCol;
varying float vSoft;

const float CARRY = 0.2;    // largest carry, in clip-space heights; matches galaxy.js
const float SPEED = 1.0;    // flat part of the rotation curve
const float CORE = 0.7;     // radius where the curve turns flat
const float PATTERN = 0.24; // arm pattern speed: corotation near r = 4
const float ARMS = 2.0;

void main() {
  float r = aOrbit.x;
  float kind = aMisc.y;
  float angle = aOrbit.y;
  if (kind < 1.5) angle += uTime * SPEED / sqrt(r * r + CORE * CORE); // stars: faster inside
  else if (kind > 2.5) angle += uTime * PATTERN;                       // nebulae, dust: with the arms

  vec4 mv = uView * vec4(r * cos(angle), aOrbit.z, r * sin(angle), 1.0);
  float d = max(-mv.z, 0.001);
  float alpha = aCol.a;
  float size = aMisc.x;

  if (kind < 0.5) {
    // Density wave: brightest on an arm crest, faint between arms, no arms inside the bulge.
    float wave = pow(0.5 + 0.5 * cos(ARMS * (angle - uTime * PATTERN + aOrbit.w)), 3.0);
    wave *= smoothstep(0.6, 1.8, r);
    alpha *= 1.0 - aMisc.z * (1.0 - wave);
    size *= 0.8 + 0.8 * wave;
  }

  float px = size * uScale * 9.0 / d;
  float soft = kind > 2.5 ? 1.0 : 0.0;
  vSoft = soft;
  // Sub-pixel points dim instead of shrinking; anything brushing the camera fades out,
  // nebulae from further away so they never swell into blobs.
  vCol = vec4(aCol.rgb, alpha * min(px * 1.3, 1.0) * smoothstep(0.3, 1.5, d) * mix(1.0, smoothstep(1.5, 4.0, d), soft));
  gl_PointSize = clamp(px, 1.0, soft > 0.5 ? uMax : uStarMax);
  gl_Position = uProj * mv;
  gl_Position.xy += uShift * gl_Position.w;

#ifdef FLOW
  // Flow: star points ride the pointer's carry field like specks in water, each by its own amount.
  // The field is blended between grid cells, so neighbouring stars move together smoothly.
  // The core glow, nebulae and dust ride it too, at a lower weight: they are broad and soft, so they
  // drift with the stroke rather than snapping to it. Nothing is stored per point: as the field eases
  // back to zero every one of them returns to exactly where its orbit puts it.
  if (uFlow > 0.0 && gl_Position.w > 0.0) {
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 uv = ndc * 0.5 + 0.5;
#ifdef FLOW_FLOAT
    // Float field, blended here by hand: the exact carry, with no 8-bit steps however slowly it changes.
    vec2 st = uv * uFieldSize - 0.5;
    vec2 cell = floor(st);
    vec2 f = st - cell;
    vec2 texel = 1.0 / uFieldSize;
    vec2 s00 = texture2D(uFlowTex, (cell + vec2(0.5, 0.5)) * texel).rg;
    vec2 s10 = texture2D(uFlowTex, (cell + vec2(1.5, 0.5)) * texel).rg;
    vec2 s01 = texture2D(uFlowTex, (cell + vec2(0.5, 1.5)) * texel).rg;
    vec2 s11 = texture2D(uFlowTex, (cell + vec2(1.5, 1.5)) * texel).rg;
    vec2 carry = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
#else
    vec2 carry = (texture2D(uFlowTex, uv).rg * 255.0 - 128.0) / 127.0 * CARRY;
#endif
    float seed = fract(sin(aOrbit.y * 12.9898 + aOrbit.x * 78.233) * 43758.5453);
    carry *= kind < 1.5 ? 0.75 + 0.5 * seed : (kind < 2.5 ? 0.3 : 0.55); // stars, distant stars, then glow and dust
    gl_Position.xy = (ndc + vec2(carry.x / uAspect, carry.y)) * gl_Position.w;
  }
#endif
}`;
  const FS = `
precision mediump float;
uniform float uDust;
varying vec4 vCol;
varying float vSoft;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  // Stars get a tight gaussian core, a clean point of light; nebulae and dust a soft falloff.
  float a = mix(exp(-d * d * 11.0), (1.0 - d) * (1.0 - d), vSoft) * vCol.a;
  gl_FragColor = uDust > 0.5 ? vec4(0.0, 0.0, 0.0, a) : vec4(vCol.rgb * a * 1.35, 1.0);
}`;

  // Stars ride the pointer's flow field only where the GPU can read textures in the vertex shader.
  const vtf = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
  // Where float textures exist the carry is uploaded exactly; otherwise as bytes.
  const floatField = vtf && !!gl.getExtension('OES_texture_float');
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram();
  const defines = (vtf ? '#define FLOW\n' : '') + (floatField ? '#define FLOW_FLOAT\n' : '');
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, defines + VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.remove();
    return;
  }
  gl.useProgram(prog);

  // Seeded, so the galaxy has the same shape on every load.
  let seed = 911;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const pick = (list) => list[Math.floor(rand() * list.length)];

  // Log-spiral arms: a crest at radius r sits at angle -ln(r) / tan(pitch), which trails the rotation.
  const TAN_PITCH = 0.3;
  const armOffset = (r) => Math.log(r) / TAN_PITCH;
  // Star colours by temperature.
  const OLD = [[1, 0.74, 0.5], [1, 0.84, 0.66], [1, 0.92, 0.82]];
  const YOUNG = [[0.98, 0.97, 1], [0.8, 0.87, 1], [0.66, 0.76, 1]];
  const PINK = [1, 0.42, 0.62];
  const BLUE = [0.5, 0.62, 1];

  const N = small
    ? { far: 1600, bulge: 4200, disc: 17000, nebula: 900, glow: 60, dust: 500 }
    : { far: 3200, bulge: 9000, disc: 42000, nebula: 1800, glow: 60, dust: 1000 };
  const EMIT = N.far + N.bulge + N.disc + N.nebula + N.glow; // drawn additively, then dust darkens
  const COUNT = EMIT + N.dust;

  const orbit = new Float32Array(COUNT * 4);
  const col = new Float32Array(COUNT * 4);
  const misc = new Float32Array(COUNT * 3);
  let n = 0;
  const add = (r, angle, y, arm, rgb, alpha, size, kind, response = 0) => {
    orbit.set([r, angle, y, arm], n * 4);
    col.set([rgb[0], rgb[1], rgb[2], alpha], n * 4);
    misc.set([size, kind, response], n * 3);
    n++;
  };

  for (let i = 0; i < N.far; i++) {
    // Distant stars on a shell around everything; they stay put.
    const u = rand() * 2 - 1;
    const d = 35 + rand() * 30;
    add(Math.sqrt(1 - u * u) * d, rand() * Math.PI * 2, u * d, 0, pick([...OLD, ...YOUNG]), 0.35 + rand() * 0.55, 5 + rand() * 6, 2);
  }
  for (let i = 0; i < N.bulge; i++) {
    // Bulge: a flattened ball of old stars.
    const x = gauss() * 0.5;
    const z = gauss() * 0.5;
    add(Math.hypot(x, z), Math.atan2(z, x), gauss() * 0.3, 0, pick(OLD), 0.8 + rand() * 0.5, 0.9 + rand() * 0.8, 1);
  }
  for (let i = 0; i < N.disc; i++) {
    // Exponential disc (scale length 1.7), stars spread evenly in angle; the arms come from the wave.
    let r;
    do r = -1.7 * Math.log(rand() * rand() + 1e-9); while (r > 7.5 || r < 0.25);
    const young = rand() < 0.4;
    add(r, rand() * Math.PI * 2, gauss() * (young ? 0.05 : 0.13) * (1 + r * 0.08),
      armOffset(r) + gauss() * 0.22, // ragged arm edges
      pick(young ? YOUNG : OLD),
      young ? 1.1 + rand() * 0.4 : 0.55 + rand() * 0.4,
      young ? 1.2 + rand() * 1.4 : 0.9 + rand() * 1.0,
      0, young ? 0.95 : 0.6);
  }
  for (let i = 0; i < N.nebula;) {
    // Pink star-forming knots and long stretches of blue glow, on an arm crest.
    const r = 1.3 + Math.pow(rand(), 0.8) * 5.2;
    const base = Math.floor(rand() * 2) * Math.PI + gauss() * 0.1 - armOffset(r);
    const knot = rand() < 0.45;
    const parts = knot ? 3 + Math.floor(rand() * 4) : 1;
    for (let k = 0; k < parts && i < N.nebula; k++, i++) {
      add(r + gauss() * (knot ? 0.08 : 0.25), base + gauss() * (knot ? 0.03 : 0.08), gauss() * 0.04, 0,
        knot ? PINK : BLUE, knot ? 0.1 + rand() * 0.12 : 0.07 + rand() * 0.06, knot ? 5 + rand() * 9 : 30 + rand() * 40, 3);
    }
  }
  for (let i = 0; i < N.glow; i++) {
    // Soft light pooled over the core, and a small hot nucleus.
    const nucleus = i < 12;
    add(Math.abs(gauss()) * (nucleus ? 0.06 : 0.5), rand() * Math.PI * 2, gauss() * (nucleus ? 0.03 : 0.1), 0,
      nucleus ? [1, 0.93, 0.8] : [1, 0.8, 0.55], nucleus ? 0.3 : 0.09, nucleus ? 12 + rand() * 12 : 40 + rand() * 60, 3);
  }
  for (let i = 0; i < N.dust; i++) {
    // Dust lanes hug the inner edge of each arm.
    const r = 1.1 + Math.pow(rand(), 0.9) * 5.4;
    add(r, Math.floor(rand() * 2) * Math.PI - armOffset(r + 0.35) + gauss() * 0.05, gauss() * 0.03, 0,
      [0, 0, 0], 0.3 + rand() * 0.3, 10 + rand() * 18, 4);
  }

  const attribute = (name, data, width) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, width, gl.FLOAT, false, 0, 0);
  };
  attribute('aOrbit', orbit, 4);
  attribute('aCol', col, 4);
  attribute('aMisc', misc, 3);

  const U = Object.fromEntries(['uProj', 'uView', 'uTime', 'uScale', 'uMax', 'uStarMax', 'uShift', 'uDust', 'uFlowTex', 'uFlow', 'uAspect', 'uFieldSize']
    .map((k) => [k, gl.getUniformLocation(prog, k)]));
  gl.uniform1f(U.uMax, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);

  /* ------------------------------------------------ pointer flow field */
  // A coarse grid over the screen holding how far pointer strokes have carried the stars at each spot,
  // in clip-space heights (row 0 at the bottom). Each frame it is painted along the pointer's smoothed
  // path, eased back toward zero and softly blurred, then uploaded as a texture that the vertex shader
  // samples with linear filtering, so the carry is continuous in both space and time.
  const GW = 160;
  const GH = 90;
  const SIGMA = 0.075; // brush radius, in clip-space heights
  const CARRY = 0.2; // largest carry; matches the shader
  const fieldX = new Float32Array(GW * GH);
  const fieldY = new Float32Array(GW * GH);
  const blurH = new Float32Array(GW * GH);
  const softX = new Float32Array(GW * GH);
  const softY = new Float32Array(GW * GH);
  const shownX = new Float32Array(GW * GH); // what the stars ride: eases after the field
  const shownY = new Float32Array(GW * GH);
  // Uploaded as floats where supported (no 8-bit steps when the carry changes slowly), else as bytes around 128.
  const texels = floatField ? new Float32Array(GW * GH * 4) : new Uint8Array(GW * GH * 4).fill(128);
  if (vtf) {
    const filter = floatField ? gl.NEAREST : gl.LINEAR; // float texels are blended in the shader
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, floatField ? gl.FLOAT : gl.UNSIGNED_BYTE, texels);
    gl.uniform1i(U.uFlowTex, 0);
    gl.uniform2f(U.uFieldSize, GW, GH);
  }

  // For app.js: where the galaxy's core is on screen (logos fly out from around it), and a way for
  // those flying logos to stir the stars they pass, through the same flow field as the pointer.
  let coreX = innerWidth / 2;
  let coreY = innerHeight / 2;
  let nudged = false;
  window.UNISIS_GALAXY = {
    core: () => [coreX, coreY],
    stir(px, py, dxPx, dyPx, amount = 1) {
      if (!vtf || still) return;
      const half = innerHeight / 2;
      const k = 0.9 * amount;
      splat((px / innerWidth) * 2 - 1, 1 - (py / innerHeight) * 2, (dxPx / half) * k, (-dyPx / half) * k);
      nudged = true;
    },
  };

  // Adds carry (mx, my) around clip-space point (x, y) with a gaussian falloff.
  function splat(x, y, mx, my) {
    const sx = (SIGMA / (innerWidth / innerHeight)) * (GW / 2); // brush radius in columns
    const sy = SIGMA * (GH / 2); // and in rows
    const cx = ((x + 1) / 2) * GW - 0.5;
    const cy = ((y + 1) / 2) * GH - 0.5;
    const i0 = Math.max(0, Math.floor(cx - 2.5 * sx));
    const i1 = Math.min(GW - 1, Math.ceil(cx + 2.5 * sx));
    const j0 = Math.max(0, Math.floor(cy - 2.5 * sy));
    const j1 = Math.min(GH - 1, Math.ceil(cy + 2.5 * sy));
    for (let j = j0; j <= j1; j++) {
      const ry = (j - cy) / sy;
      for (let i = i0; i <= i1; i++) {
        const rx = (i - cx) / sx;
        const w = Math.exp(-(rx * rx + ry * ry));
        fieldX[j * GW + i] += mx * w;
        fieldY[j * GW + i] += my * w;
      }
    }
  }

  // A [1 2 1] blur across, then down; edges clamp.
  function blur(src, out) {
    for (let j = 0; j < GH; j++) {
      const row = j * GW;
      for (let i = 0; i < GW; i++) {
        blurH[row + i] = (src[row + Math.max(0, i - 1)] + 2 * src[row + i] + src[row + Math.min(GW - 1, i + 1)]) * 0.25;
      }
    }
    for (let j = 0; j < GH; j++) {
      const row = j * GW;
      const up = Math.min(GH - 1, j + 1) * GW;
      const down = Math.max(0, j - 1) * GW;
      for (let i = 0; i < GW; i++) {
        out[row + i] = (blurH[down + i] + 2 * blurH[row + i] + blurH[up + i]) * 0.25;
      }
    }
  }

  function stirField(dt) {
    if (snap) {
      followX = aimX;
      followY = aimY;
      followVX = followVY = 0;
      snap = false;
    }
    const aspect = innerWidth / innerHeight;
    // The brush follows the pointer on a critically damped spring, in small substeps, so its path is a
    // smooth unbroken curve however unevenly mouse events or frames arrive.
    const steps = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / steps;
    let moved = false;
    for (let s = 0; s < steps; s++) {
      const fromX = followX;
      const fromY = followY;
      followVX += (FOLLOW * FOLLOW * (aimX - followX) - 2 * FOLLOW * followVX) * h;
      followVY += (FOLLOW * FOLLOW * (aimY - followY) - 2 * FOLLOW * followVY) * h;
      followX += followVX * h;
      followY += followVY * h;
      const mx = (followX - fromX) * aspect; // movement, in clip-space heights
      const my = followY - fromY;
      const len = Math.hypot(mx, my);
      if (len < 1e-6) continue;
      moved = true;
      // Faster strokes carry further, like a quicker hand through water.
      const push = 1.15 * (0.6 + Math.min(1.4, (len / h) * 0.7));
      splat(followX, followY, mx * push, my * push);
    }
    if (!moved && !nudged && flow === 0) return;
    nudged = false;

    // Ease back and soften: the field relaxes slowly toward zero and blurs a little every frame, so the
    // carry spreads like water and never overshoots into ripples. The stars then follow the field through
    // a second easing, so they glide into place instead of keeping step with the brush.
    const keep = Math.exp(-dt * 1.0);
    const soften = Math.min(1, dt * 4);
    const glide = 1 - Math.exp(-dt / 0.16);
    blur(fieldX, softX);
    blur(fieldY, softY);
    let peak = 0;
    for (let k = 0; k < fieldX.length; k++) {
      let fx = (fieldX[k] + (softX[k] - fieldX[k]) * soften) * keep;
      let fy = (fieldY[k] + (softY[k] - fieldY[k]) * soften) * keep;
      const size = Math.hypot(fx, fy);
      if (size > CARRY) {
        fx *= CARRY / size;
        fy *= CARRY / size;
      }
      fieldX[k] = fx;
      fieldY[k] = fy;
      const gx = (shownX[k] += (fx - shownX[k]) * glide);
      const gy = (shownY[k] += (fy - shownY[k]) * glide);
      peak = Math.max(peak, size, Math.abs(gx) + Math.abs(gy));
      if (floatField) {
        texels[k * 4] = gx;
        texels[k * 4 + 1] = gy;
      } else {
        texels[k * 4] = 128 + Math.round((gx / CARRY) * 127);
        texels[k * 4 + 1] = 128 + Math.round((gy / CARRY) * 127);
      }
    }
    if (peak < 0.0005) {
      // Settled: clear the last traces so no star is left a fraction of a pixel off.
      fieldX.fill(0);
      fieldY.fill(0);
      shownX.fill(0);
      shownY.fill(0);
      texels.fill(floatField ? 0 : 128);
      flow = 0;
    } else {
      flow = peak;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RGBA, floatField ? gl.FLOAT : gl.UNSIGNED_BYTE, texels);
  }
  gl.enable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);

  /* column-major 4x4 matrices */
  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    proj.fill(0);
    proj[0] = f / aspect;
    proj[5] = f;
    proj[10] = (far + near) * nf;
    proj[11] = -1;
    proj[14] = 2 * far * near * nf;
  }
  // Camera at (ex, ey, ez) looking at the galaxy's centre, +Y up.
  function lookAt(ex, ey, ez) {
    const zl = Math.hypot(ex, ey, ez);
    const zx = ex / zl, zy = ey / zl, zz = ez / zl;
    const xl = Math.hypot(zz, zx);
    const xx = zz / xl, xz = -zx / xl;
    const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
    view.set([
      xx, yx, zx, 0,
      0, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1,
    ]);
  }

  let shiftX = 0;
  let shiftY = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const aspect = innerWidth / innerHeight;
    gl.uniform1f(U.uAspect, aspect);
    const wide = aspect > 1.1;
    perspective(((wide ? 55 : 70) * Math.PI) / 180, aspect, 0.05, 200);
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniform1f(U.uScale, dpr * Math.max(0.7, innerHeight / 900));
    gl.uniform1f(U.uStarMax, 5 * dpr); // stars stay crisp points even up close
    // At the top the galaxy sits beside the headline: to the right on wide screens, above it on phones.
    [shiftX, shiftY] = wide ? [0.36, 0.1] : [0, 0.45];
  }

  let target = 0;
  function measure() {
    const max = root.scrollHeight - innerHeight;
    target = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }

  let sp = 0;
  let time = 30;
  // Flow brush: follows the pointer on a critically damped spring (FOLLOW is its stiffness, per second).
  const FOLLOW = 22;
  let followX = 0;
  let followY = 0;
  let followVX = 0;
  let followVY = 0;
  let flow = 0; // strongest carry in the field: 0 once everything has settled
  let px = 0;
  let py = 0;
  function draw() {
    const e = sp * sp * (3 - 2 * sp);
    const dist = 10 - 6 * e;
    const elev = 1 - 0.76 * e + py * 0.05;
    const az = px * 0.12;
    lookAt(dist * Math.cos(elev) * Math.sin(az), dist * Math.sin(elev), dist * Math.cos(elev) * Math.cos(az));
    gl.uniformMatrix4fv(U.uView, false, view);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uFlow, flow);
    gl.uniform2f(U.uShift, shiftX * (1 - e), shiftY * (1 - e));
    // Where the core lands on screen: the origin through view and projection, plus the shift above.
    const coreW = -view[14];
    if (coreW > 0) {
      coreX = ((proj[0] * view[12]) / coreW + shiftX * (1 - e) + 1) * 0.5 * innerWidth;
      coreY = (1 - ((proj[5] * view[13]) / coreW + shiftY * (1 - e))) * 0.5 * innerHeight;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE); // light adds up
    gl.uniform1f(U.uDust, 0);
    gl.drawArrays(gl.POINTS, 0, EMIT);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // dust takes light away
    gl.uniform1f(U.uDust, 1);
    gl.drawArrays(gl.POINTS, EMIT, COUNT - EMIT);
  }

  resize();
  if (still) {
    draw();
    addEventListener('resize', () => { resize(); draw(); });
    return;
  }

  measure();
  sp = target;
  addEventListener('scroll', measure, { passive: true });
  addEventListener('resize', () => { resize(); measure(); });
  new ResizeObserver(measure).observe(document.body); // search filtering changes the page height

  let raf = 0;
  let last = performance.now();
  let lastY = scrollY;
  let boost = 0;
  let shown = -1;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 3);
    sp += (target - sp) * k;
    px += (pointerX - px) * k;
    py += (pointerY - py) * k;
    const dy = scrollY - lastY;
    lastY = scrollY;
    boost = Math.max(-1.2, Math.min(1.2, (boost + dy * 0.004) * Math.exp(-dt * 2.5)));
    time += dt * (0.12 + boost);

    if (vtf) stirField(dt);
    if (Math.abs(sp - shown) > 0.002) {
      shown = sp;
      root.style.setProperty('--sp', sp.toFixed(3));
    }
    draw();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    canvas.remove();
  });
})();
