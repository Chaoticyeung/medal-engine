import { THREE } from '../three.js';
import { CHANNEL, VERT, envLevelExpr, VNOISE } from './common.js';

// 透明塑料外壳（form.body 时用，参数在 style.materials.shell）。每帧先把壳里的东西（inside 浮雕）画到一张离屏图 uInterior，
// 外壳再去取：
//   折射：视线进壳后拐弯（ior），按拐弯前后方向之差 × refract 在屏幕上偏一点取；
//   吸收：透过率 = 塑料色^(1 / cosθt)，塑料色是"正对时穿过一层壁"剩下的比例（前壳是当前配色，后壳是 back.tint），
//     斜着看走得远、颜色深，cosθt 最小取 slant；从前面看时，照进壳里的光已经穿过一次前壳，再乘 mix(1, 前壳色, inner)
//     （从背后看时光主要从后壳进来，不乘）；
//   磨砂（磨砂图）：取离屏图的模糊级（frost × lod，在低 1.5 级上围一圈取 8 点），再往乳白的散射光（milk）混，散射光按法线取模糊环境（diffuseLevel）；
//   表面：菲涅尔（f0）× gloss.strength × 反射方向环境的 gloss.k 次方，磨砂处取 gloss.frostLevel 那一级模糊环境、再弱 gloss.frostDim；
//   分模线：前后壳在 z = part 处相接，侧面上一道宽 groove.width 的暗线；
//   表面起伏（可选，wave = [[scale, strength], …]）：注塑面不是绝对平的，按几层值噪声的坡度扰动法线，倒影和折射都跟着微微变形；
//   第二道反射（可选，wall = { offset, strength }）：光进壳后在内面再反射一次，出来时被塑料染了两遍色；
//     内面的反射点比外面错开一段（沿折射方向），弯的地方法线不同，所以第二道倒影和第一道错开，offset 是错开的程度；
//   按距离变糊（可选，depthBlur = { lod, range }）：离屏图带深度，里面的东西离外壳越远越糊，range 处加到 lod 级
export function shellMaterial(style, geo, header, uniforms, blurCount) {
  const s = style.materials.shell, f = v => v.toFixed(4), v3 = a => `vec3(${a.map(f).join(', ')})`;
  const level = (d, lv) => envLevelExpr(d, lv, blurCount);
  const gl = s.gloss, ch = CHANNEL[gl.channel || 'g'], chD = CHANNEL[s.channel || 'r'];
  const ior = s.ior ?? 1.585, fr = s.front, bk = s.back;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, side: THREE.DoubleSide,
    fragmentShader: header + `
      uniform sampler2D uInterior, uMapF, uMapB${s.depthBlur ? ', uDepth' : ''};
      uniform mat4 projectionMatrix;
      uniform vec2 uRes;
      uniform vec3 uTint;
      ${s.depthBlur ? 'uniform vec2 uNearFar;' : ''}
      ${Array.from({ length: blurCount }, (_, k) => `uniform samplerCube uEnvB${k};`).join('\n')}
      ${s.wave ? `${VNOISE}
      vec2 waveGrad(vec2 p) {
        vec2 g = vec2(0.0);
        ${s.wave.map(([sc, st], k) => `{ vec2 q = p * ${f(sc)} + ${f(k * 17.3)}; float e = 0.05;
          g += vec2(vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0)), vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e))) / (2.0 * e) * ${f(st)}; }`).join('\n        ')}
        return g;
      }` : ''}
      void main() {
        vec3 n = normalize(vObjNormal);
        ${s.wave ? 'n = normalize(n - vec3(waveGrad(vObjPos.xy + vObjPos.z), 0.0));' : ''}
        bool back = vObjPos.z < ${f(s.part)};
        vec2 t = vObjPos.xy * ${f(geo.uvScale)} + 0.5;
        float frost = (back ? texture2D(uMapB, t) : texture2D(uMapF, t)).r;
        vec3 nw = normalize(mat3(uModel) * n);
        vec3 V = normalize(cameraPosition - vWorldPos);
        if (dot(nw, V) < 0.0) nw = -nw;
        float cosI = clamp(dot(nw, V), 0.0, 1.0);
        float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / ${f(ior * ior)}, 0.0));
        vec3 rd = refract(-V, nw, ${f(1 / ior)});
        vec4 c0 = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
        vec4 c1 = projectionMatrix * viewMatrix * vec4(vWorldPos + (rd + V) * ${f(s.refract ?? 0.1)}, 1.0);
        vec2 uv = clamp(gl_FragCoord.xy / uRes + (c1.xy / c1.w - c0.xy / c0.w) * 0.5, vec2(0.001), vec2(0.999));
        // 磨砂：在低一两级的多级纹理上围一圈取 8 点平均（直接取高层级会出一格格方块）
        float lod = frost * (back ? ${f(bk.lod ?? 5)} : ${f(fr.lod ?? 5)});${s.depthBlur ? `
        float zd = texture2D(uDepth, uv).r * 2.0 - 1.0;
        float zi = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - zd * (uNearFar.y - uNearFar.x));
        float zs = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
        lod += ${f(s.depthBlur.lod)} * clamp((zi - zs) / ${f(s.depthBlur.range)}, 0.0, 1.0);` : ''}
        vec3 seen = textureLod(uInterior, uv, 0.0).rgb;
        if (lod > 0.01) {
          vec2 px = exp2(lod) / uRes;
          seen = vec3(0.0);
          for (int k = 0; k < 8; k++) {
            float a = float(k) * 2.39996 + 0.5, r = sqrt((float(k) + 0.5) / 8.0);
            seen += textureLod(uInterior, clamp(uv + vec2(cos(a), sin(a)) * r * px, vec2(0.001), vec2(0.999)), max(lod - 1.5, 0.0)).rgb;
          }
          seen /= 8.0;
        }
        vec3 T = back ? ${v3(bk.tint)} : uTint;
        vec3 col = seen * pow(T, vec3(1.0 / max(cosT, ${f(s.slant ?? 0.2)}))) * mix(vec3(1.0), uTint, back ? 0.0 : ${f(s.inner ?? 0.5)});
        vec3 dirN = uEnvMatrix * nw;
        float E = ${level('dirN', s.diffuseLevel ?? blurCount)}.${chD};
        vec3 milk = ${v3(s.milkColor || [0.95, 0.95, 0.95])} * mix(vec3(1.0), T, 0.5) * (E * ${f(s.diffuse ?? 1)} + ${f(s.ambient ?? 0.3)});
        col = mix(col, milk, frost * (back ? ${f(bk.milk ?? 0)} : ${f(fr.milk ?? 0)}));
        float F = ${f(gl.f0 ?? 0.05)} + ${f(1 - (gl.f0 ?? 0.05))} * pow(1.0 - cosI, 5.0);
        vec3 dirR = envDir(n, vec2(0.0));
        float S = pow(mix(${level('dirR', 0)}.${ch}, ${level('dirR', gl.frostLevel ?? blurCount)}.${ch}, frost), ${f(gl.k ?? 2)});
        col = col * (1.0 - F) + S * F * ${f(gl.strength ?? 1)} * (1.0 - frost * ${f(gl.frostDim ?? 0.5)});${s.wall ? `
        vec3 Vo = normalize(transpose(mat3(uModel)) * V);
        vec3 rt = refract(-Vo, n.z * Vo.z < 0.0 ? -n : n, ${f(1 / ior)});
        vec3 n2 = normalize(n - (rt - n * dot(rt, n)) * ${f(s.wall.offset)});
        float F2 = ${f(gl.f0 ?? 0.05)} + ${f(1 - (gl.f0 ?? 0.05))} * pow(1.0 - cosT, 5.0);
        float S2 = pow(${level('envDir(n2, vec2(0.0))', 0)}.${ch}, ${f(gl.k ?? 2)});
        col += S2 * F2 * ${f(gl.strength ?? 1)} * ${f(s.wall.strength)} * (1.0 - F) * (1.0 - F) * pow(T, vec3(2.0 / max(cosT, ${f(s.slant ?? 0.2)}))) * (1.0 - frost * ${f(gl.frostDim ?? 0.5)});` : ''}
        float groove = (1.0 - smoothstep(0.0, ${f(s.groove?.width ?? 0.004)}, abs(vObjPos.z - ${f(s.part)}))) * (1.0 - smoothstep(0.5, 0.8, abs(n.z)));
        gl_FragColor = vec4(col * (1.0 - groove * ${f(s.groove?.dark ?? 0.5)}), 1.0);
      }`,
  });
}
