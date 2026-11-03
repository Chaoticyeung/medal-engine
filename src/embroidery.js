// 刺绣：刺绣浮雕的线、锁边绳的线。一根根的线、线缝、针眼都在着色器里按位置现算，不进几何
import { THREE } from './three.js';
import { CHANNEL, VERT, tintLine, tintStart } from './shading/common.js';

// 浮雕可以是一块刺绣（relief.stitch(g, { px, py, unit, c, pixel })）：图案在一张图上逐点画出这里是哪种针、线往哪走。
// pixel(针法名, 针向角) 给出这一点该写的 RGBA：R、G 是两倍针向角的 cos、sin（针向转半圈是同一个方向，两倍角才不会在 0° 和 180° 交界处出错），
// B 是针法 × 32 再加一个 0～31 的针长档（0 是默认针长，k 是默认的 k/16 倍，一块填充针的针长可以单独定），A 不用。图案用 putImageData 逐点写，不要用带抗锯齿的路径填充（边上的混色会变成别的针法）。
// 线的颜色照旧画在嵌釉图里，宏观的鼓起照旧用高度图；一根根的线、线缝、针眼在着色器里按位置现算，不进几何。
export const STITCH = { none: 0, twill: 1, fill: 2, satin: 3, run: 4, plain: 5 };
export const stitchPixel = (type, angle, len = 1) => [Math.round(127.5 + 127.5 * Math.cos(2 * angle)), Math.round(127.5 + 127.5 * Math.sin(2 * angle)),
  STITCH[type] * 32 + (len === 1 ? 0 : Math.min(31, Math.max(1, Math.round(len * 16)))), 255];

// 每种针的线距 pitch、一针长 len、相邻行错开 shift（以针长计）、线截面法线的最大偏角 phi、丝光倍数 sheen。
// 缎纹整段线浮在面上，没有针长；斜纹、平纹是织物：针长按织法取，错开一格就是斜纹的斜线
export const THREAD_TYPES = {
  twill: { pitch: 0.0045, len: 0.0135, shift: 1 / 3, phi: 0.6, sheen: 0.2, jitter: 0.05, gap: 0.82 },
  fill: { pitch: 0.008, len: 0.07, shift: 0.31, phi: 0.9, sheen: 0.75, jitter: 0.12, gap: 0.6 },
  satin: { pitch: 0.0075, len: 0, shift: 0, phi: 0.95, sheen: 1, jitter: 0.14, gap: 0.62 },
  run: { pitch: 0.01, len: 0.045, shift: 0, phi: 0.9, sheen: 0.9, jitter: 0.1, gap: 0.6 },
  plain: { pitch: 0.008, len: 0.016, shift: 0.5, phi: 0.6, sheen: 0.25, jitter: 0.08, gap: 0.55 },
};

const THREAD_VERT = `
attribute vec3 aAlong;
attribute vec3 aCord;
varying vec3 vWorldPos;
varying vec3 vObjNormal;
varying vec3 vObjPos;
varying vec2 vUv;
varying vec3 vAlong;
varying vec3 vCord;
void main() {
  vObjNormal = normal;
  vObjPos = position;
  vUv = uv;
  vAlong = aAlong;
  vCord = aCord;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// 线的着色，刺绣浮雕和锁边绳共用。n 是表面法线，A 是和线垂直、在表面内的方向，s 是在这根线截面上的位置（0～1），
// detail 是"一根根画出来"的程度（线细于约两个像素时为 0，只用截面平均）。
// 线是一根根细圆柱：截面上的法线在 n 和 A 之间转，亮光是一条和线垂直拉长的带；漫射染线色，丝光只染一部分
function threadShading(style) {
  const m = { channel: 'r', k: 1.4, diffuse: 0.55, ambient: 0.36, ...style.materials.thread };
  const sh = { channel: 'g', k: 4, strength: 0.5, tint: 0.35, ...m.sheen };
  return `
vec3 threadColor(vec3 c, vec3 n, vec3 A, vec3 nt, float phiMax, float detail, float sheenMul, float envScale) {
  vec3 eAvg = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 5; k++) {
    float ph = (float(k) / 2.0 - 1.0) * phiMax, wk = cos(ph);
    eAvg += envAt(normalize(n * cos(ph) + A * sin(ph)), vec2(0.0)) * wk;
    wsum += wk;
  }
  eAvg /= wsum;
  vec3 eT = envAt(nt, vec2(0.0));
  vec3 eD = mix(eAvg, eT, 0.5 * detail) * envScale, eS = mix(eAvg, eT, detail) * envScale;
  vec3 body = c * (${m.ambient.toFixed(4)} + ${m.diffuse.toFixed(4)} * pow(eD.${CHANNEL[m.channel]}, ${m.k.toFixed(4)}));
  vec3 sheen = ${sh.strength.toFixed(4)} * sheenMul * pow(eS.${CHANNEL[sh.channel]}, ${sh.k.toFixed(4)}) * mix(vec3(1.0), c, ${sh.tint.toFixed(4)});
  return body + sheen;
}`;
}

// 刺绣浮雕的材质：高度图给宏观起伏（缎纹柱子的鼓、叠压的高低、凹处变暗），针迹图给每一处的针法和针向
export function threadMaterial(style, rf, hasPhase, header, uniforms, envScale) {
  const r = rf.relief, types = Object.entries(THREAD_TYPES).map(([k, v]) => [STITCH[k], { ...v, ...r.threads?.[k] }]);
  const f = x => x.toFixed(5);
  const params = types.map(([id, p]) => `if (type == ${id.toFixed(1)}) { pitch = ${f(p.pitch)}; len = ${f(p.len)}; shift = ${f(p.shift)}; phiMax = ${f(p.phi)}; sheenMul = ${f(p.sheen)}; jitter = ${f(p.jitter)}; gap = ${f(p.gap)}; }`).join('\n    ');
  const sx = rf.backSide ? '-1.0' : '1.0';
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT,
    fragmentShader: header + threadShading(style) + `
      uniform sampler2D uHeight, uInlay, uStitch, uPhase;
      uniform vec4 uBox;
      uniform vec2 uTexel;
      void main() {
        vec2 t = (${rf.backSide ? 'vec2(-vObjPos.x, vObjPos.y)' : 'vObjPos.xy'} - uBox.xy) / uBox.zw;
        vec2 hv = texture2D(uHeight, t).rg;
        float hx = (texture2D(uHeight, t + vec2(uTexel.x, 0.0)).r - texture2D(uHeight, t - vec2(uTexel.x, 0.0)).r) / (2.0 * uTexel.x * uBox.z);
        float hy = (texture2D(uHeight, t + vec2(0.0, uTexel.y)).r - texture2D(uHeight, t - vec2(0.0, uTexel.y)).r) / (2.0 * uTexel.y * uBox.w);
        vec3 n = normalize(vObjNormal);
        // bump：高度图对法线的影响。线面的反光主要来自一根根线，柱子整体的鼓只让边上暗下去，不该像金属那样映出一整条连续的亮边
        hx *= ${(r.bump ?? 1).toFixed(3)}; hy *= ${(r.bump ?? 1).toFixed(3)};
        ${rf.backSide ? 'if (n.z < -0.5) n = normalize(n + vec3(hx, -hy, 0.0));' : 'if (n.z > 0.5) n = normalize(n + vec3(-hx, -hy, 0.0));'}
        ${tintStart(style, 'n')}
        vec4 sm = texture2D(uStitch, t);
        float bv = floor(sm.b * 255.0 + 0.5), type = floor(bv / 32.0), lenStep = bv - type * 32.0;
        float th = 0.5 * atan(sm.g * 2.0 - 1.0, sm.r * 2.0 - 1.0);
        float pitch = 0.008, len = 0.0, shift = 0.0, phiMax = 0.0, sheenMul = 0.0, jitter = 0.0, gap = 0.6;
        ${params}
        if (lenStep > 0.0) len *= lenStep / 16.0;
        vec2 p = ${rf.backSide ? 'vec2(-vObjPos.x, vObjPos.y)' : 'vObjPos.xy'};
        vec2 dT = vec2(cos(th), sin(th)), dB = vec2(-dT.y, dT.x);
        vec3 T0 = vec3(dT.x * ${sx}, dT.y, 0.0), B0 = vec3(dB.x * ${sx}, dB.y, 0.0);
        vec3 T = normalize(T0 - n * dot(n, T0)), B = normalize(B0 - n * dot(n, B0));
        float u = dot(p, dB) / pitch;
        ${hasPhase ? 'vec2 ph = texture2D(uPhase, t).rg; if (ph.g > 0.5) u = ph.r / ph.g / pitch;' : ''}
        float row = floor(u), s = fract(u);
        float detail = 1.0 - smoothstep(0.3, 0.7, fwidth(u));
        // 线缝：相邻两根线之间暗一道；每根线的松紧、捻向不一样，亮度各有出入
        float ao = mix(gap, 1.0, smoothstep(0.0, 0.11, s) * smoothstep(1.0, 0.89, s));
        ao *= 1.0 + jitter * (fract(sin(row * 78.233 + type * 12.9898) * 43758.5453) * 2.0 - 1.0) * detail;
        // 一根线是多股细丝，沿线方向亮度有细碎的起伏
        ao *= 1.0 + 0.08 * detail * (fract(sin(row * 12.17 + floor(dot(p, dT) / (pitch * 1.7)) * 3.71) * 24634.6345) - 0.5);
        float tilt = 0.0;
        if (len > 0.0) {
          // 一针的两头扎进布里：往下压、发暗；相邻行按 shift 错开
          float w = fract(dot(p, dT) / len + row * shift), e = min(0.45, 1.6 * pitch / len);
          tilt = (w < e ? -(1.0 - w / e) : w > 1.0 - e ? (w - 1.0 + e) / e : 0.0) * 0.3;
          ao *= mix(mix(gap, 1.0, 0.2), 1.0, sqrt(smoothstep(0.0, e, w) * smoothstep(1.0, 1.0 - e, w)));
        }
        ao = mix(0.86, ao, detail);
        // 每根线、沿线每一小段的朝向都略有出入（多股丝拧在一起，松紧不一），反光碎成一段段的
        float seg = floor(dot(p, dT) / (pitch * 2.3) + row * 0.37);
        float r1 = fract(sin(row * 41.31 + type * 7.7) * 23421.631) - 0.5, r2 = fract(sin(seg * 17.13 + row * 91.7) * 31337.77) - 0.5;
        float phi = (2.0 * s - 1.0) * phiMax + r1 * 0.35 * detail;
        vec3 nt = normalize(n * cos(phi) + B * sin(phi) + T * (tilt + r2 * 0.45) * detail);
        float cav = hv.g;
        float shade = mix(${(r.cavityDark ?? 0.55).toFixed(3)}, 1.0, smoothstep(${(-(r.cavityDepth ?? 0.008)).toFixed(4)}, 0.0, cav));
        vec3 c = texture2D(uInlay, t).rgb;
        gl_FragColor = vec4(threadColor(c, n, B, nt, phiMax, detail, sheenMul, ${envScale}) * ao * shade, 1.0);
        ${tintLine(style, 'n')}
      }`,
  });
}

// 锁边绳的材质：线斜着一圈圈绕过布边，和绕截面的方向成 slant 角；线距 pitch。
// 包缝线是普通涤纶或棉线，不是一根光滑的管子：每圈线的松紧、朝向各有出入（jitter），线距沿绳子慢慢起伏（spacing），
// 线上有细毛（fuzz：一小段一小段的亮暗；fuzzRim：掠射处细毛散开的一圈柔光）；
// 绳子外上侧是两层反向斜绕的线交替压叠，形成一排 V 形线圈（bead 是这一带的宽窄强弱，位置 beadAt 是截面角，0 朝外、π/2 朝上）；
// 绳子扎进布里的内侧每圈一个针眼（needleAt、needleDark）；
// 包缝的线圈不是一整圈贯通的棱，沿绕的方向一段段（loop，段长按截面弧长计），相邻圈错开半段，看起来像针织
export function cordMaterial(style, f, header, uniforms) {
  const c = f.cord, beta = c.slant ?? 0.35, v = (k, d) => (c[k] ?? d).toFixed(4);
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: THREAD_VERT,
    fragmentShader: header + threadShading(style) + `
      uniform vec3 uCord;
      varying vec3 vAlong;
      varying vec3 vCord;
      float cordHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vObjNormal);
        ${tintStart(style, 'n')}
        vec3 A = normalize(vAlong - n * dot(n, vAlong)), R = cross(n, A);
        float cb = ${Math.cos(beta).toFixed(5)}, sb = ${Math.sin(beta).toFixed(5)};
        vec3 P = normalize(A * cb - R * sb);
        float wob = 0.6 * sin(vCord.x * 37.0) + 0.4 * sin(vCord.x * 91.0 + 1.3);
        float q = (vCord.x * cb - vCord.y * sb) / ${(c.pitch ?? 0.009).toFixed(5)} + ${v('spacing', 0)} * wob, s = fract(q), row = floor(q);
        float detail = 1.0 - smoothstep(0.3, 0.7, fwidth(q));
        float r1 = cordHash(vec2(row, 3.7)) - 0.5, r2 = cordHash(vec2(row, floor(vCord.y / ${(1.5 * (c.pitch ?? 0.009)).toFixed(5)}))) - 0.5;
        float ao = mix(${v('gap', 0.55)}, 1.0, smoothstep(0.0, 0.16, s) * smoothstep(1.0, 0.84, s));
        ao *= 1.0 + ${v('jitter', 0)} * 2.0 * r1;
        ao *= 1.0 + ${v('fuzz', 0)} * (cordHash(vec2(floor(q * 3.0), floor(vCord.y / 0.0012))) - 0.5);
        ao = mix(0.82, ao, detail);
        // 绳和章面、背面相接的内侧照不到光
        ao *= mix(1.0, ${(c.innerDark ?? 0.5).toFixed(3)}, smoothstep(-0.2, -0.95, cos(vCord.z)));
        float crest = exp(-pow((vCord.z - ${v('beadAt', 0.45)}) / 0.28, 2.0)) * ${v('bead', 0)}, bead = cos(6.2832 * (q + 0.5));
        float needle = exp(-pow((vCord.z - ${v('needleAt', 2.75)}) / 0.12, 2.0)) * smoothstep(0.7, 1.0, cos(6.2832 * (q - 0.5)));
        ao *= (1.0 - ${v('needleDark', 0)} * needle * detail) * (1.0 + 0.12 * crest * bead * detail);
        // 线圈带里第二层线反向斜绕，和第一层按格子交替压在上面
        float q2 = (vCord.x * cb + vCord.y * sb) / ${(c.pitch ?? 0.009).toFixed(5)}, row2 = floor(q2);
        bool second = crest > 0.35 && mod(row + row2, 2.0) > 0.5;
        if (second) {
          P = normalize(A * cb + R * sb); s = fract(q2);
          ao *= mix(${v('gap', 0.55)}, 1.0, smoothstep(0.0, 0.16, s) * smoothstep(1.0, 0.84, s)) / max(0.3, mix(${v('gap', 0.55)}, 1.0, smoothstep(0.0, 0.16, fract(q)) * smoothstep(1.0, 0.84, fract(q))));
        }
        float tilt = 0.0;
        ${c.loop ? `float wl = fract(vCord.y / ${c.loop.toFixed(5)} + (second ? row2 : row) * 0.5), el = 0.22;
        tilt = (wl < el ? -(1.0 - wl / el) : wl > 1.0 - el ? (wl - 1.0 + el) / el : 0.0) * 0.5;
        ao *= mix(1.0, mix(0.55, 1.0, sqrt(smoothstep(0.0, el, wl) * smoothstep(1.0, 1.0 - el, wl))), detail);` : ''}
        float phiMax = ${(c.phi ?? 1.2).toFixed(4)}, phi = (2.0 * s - 1.0) * phiMax + 0.35 * r1 * detail;
        vec3 nt = normalize(n * cos(phi) + P * sin(phi) + (A * (0.35 * r2 + 0.3 * crest * bead) + cross(P, n) * tilt) * detail);
        vec3 col = threadColor(uCord, n, P, nt, phiMax, detail, ${(c.sheen ?? 1).toFixed(4)}, 1.0) * ao;
        vec3 nw = normalize(mat3(uModel) * n);
        float fres = pow(1.0 - clamp(dot(nw, normalize(cameraPosition - vWorldPos)), 0.0, 1.0), 3.0);
        col += uCord * ${v('fuzzRim', 0)} * fres * envAt(n, vec2(0.0)).x;
        gl_FragColor = vec4(col, 1.0);
        ${tintLine(style, 'n')}
      }`,
  });
}
