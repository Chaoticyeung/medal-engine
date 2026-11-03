import { THREE } from '../three.js';
import { CHANNEL, envLevelExpr, VNOISE } from './common.js';

// 瓷（design.lathe 时用，参数在 style.materials.ceramic）：胎上一层有厚度的半透明釉。
//   胎：哑光，胎色 body × 按法线取的模糊环境，有细颗粒；
//   釉：光进釉、到胎、再出来，往返的路长随折射角变长（ior），透过率 = 釉色^(釉厚 / ref / cosθt)，釉色就是"ref 厚、正对时"的颜色；
//     釉里的气泡和晶体把一部分光直接散回来（scatter 越大越多、随厚度增加），散回来的光颜色 = 釉色^(scatterPath / cosθt)；
//     釉厚处深、薄处透出胎色，转到斜的角度更深；
//   釉面：菲涅尔（f0）× gloss × 反射方向上中等模糊的环境（glossLevel）的 glossK 次方（环境亮度封顶 1，次方把窗和四周拉开），
//     倒影看得出形状、边是软的；peel 是橘皮纹；
//   刻痕：刻穿釉层，露出 cut 色、不反光，刻深按 carveDepth 改法线；
//   开片（有开片图时，参数在 ceramic.crackle）：裂面在釉层里。沿折射后的视线在釉里分 samples 层取开片图，
//     每层按这条缝的倾斜把它往旁边挪（斜的裂面越往下越偏），所以斜看时一道缝是一条会变宽变窄的带（视差）；
//     缝本身把釉隔开，透出来的光散得多一点，往 line 色提亮；裂面是釉里的一个界面（缝里是空气），
//     视线在这里反射（掠射时全反射），再折射出釉面取环境（模糊级 level 的 k 次方），转到某个角度一片片亮起来，强度 glint；
//   刻痕填色（可选，ceramic.fill = { color, metal, from, level, k, diffuse, ambient }）：刻深超过 from 的刻痕里填一层颜色，
//     盖住釉和开片。金属的（描金）按反射方向取模糊级 level 的环境，k 次方 × diffuse + ambient，乘颜色；
//     颜料（朱砂）哑光，按法线取漫射。芝麻钉这类浅坑刻深不到 from，不填。
//     不给 color 时填的是页面上当前选的"金属"（style.metals 里的颜色），metal 给金属名的数组，选到其中一个就按金属算，
//     这样填色可以在页面上换；给 color 时 metal 是 true/false，颜色固定
export function ceramicMaterial(style, geo, header, uniforms, blurCount, crack) {
  const c = style.materials.ceramic, f = v => v.toFixed(4), v3 = a => `vec3(${a.map(f).join(', ')})`;
  const ch = CHANNEL[c.channel || 'r'];
  const level = (d, lv) => envLevelExpr(d, lv, blurCount);
  const ck = c.crackle || {}, steps = ck.samples ?? 4, tiltMax = ck.tilt ?? 0.6, ior = c.ior ?? 1.5;
  // 开片：返回 vec2(这一点看到的缝, 裂面反光)。t3 是缝的走向、nn 是面内和它垂直的方向，都放到曲面的切平面里
  const crackCode = `
      vec4 crackAt(vec2 p, bool back) {
        vec2 t = p * ${f(geo.uvScale)} + 0.5;
        return back ? texture2D(uCrackB, t) : texture2D(uCrackF, t);
      }
      vec2 crackle(vec3 n, vec3 Vo, float depth, bool back, vec3 vt) {
        float down = max(dot(vt, -n), 0.2);
        vec3 lat = (vt + n * down) / down;
        float vis = 0.0, glint = 0.0;
        for (int k = 0; k < ${steps}; k++) {
          float z = depth * (float(k) + 0.5) / ${steps}.0;
          vec2 q = vObjPos.xy + lat.xy * z;
          vec4 cm = crackAt(q, back);
          float a = cm.g * 3.14159265, tau = (cm.b - 0.5) * 2.0 * ${f(tiltMax)};
          vec2 nn = vec2(-sin(a), cos(a));
          float c0 = crackAt(q - nn * z * tan(tau), back).r;
          if (c0 < 0.02) continue;
          vis = max(vis, c0);
          vec3 t3 = normalize(vec3(cos(a), sin(a), 0.0) - n * dot(vec3(cos(a), sin(a), 0.0), n));
          vec3 nn3 = cross(n, t3);
          vec3 Nc = normalize(cross(t3, normalize(-n * cos(tau) + nn3 * sin(tau))));
          float ci = abs(dot(vt, Nc));
          float st = ${f(ior)} * sqrt(max(0.0, 1.0 - ci * ci));
          float R = st >= 1.0 ? 1.0 : 0.04 + 0.96 * pow(1.0 - sqrt(1.0 - st * st), 5.0);
          vec3 rin = reflect(vt, dot(vt, Nc) > 0.0 ? -Nc : Nc);
          vec3 rout = refract(rin, -n, ${f(ior)});
          if (dot(rout, rout) < 1e-4 || dot(rout, n) <= 0.0) continue;
          vec3 dirC = uEnvMatrix * normalize(mat3(uModel) * rout);
          glint = max(glint, c0 * R * pow(${level('dirC', ck.level ?? 0.5)}.${ch}, ${f(ck.k ?? 2)}));
        }
        return vec2(vis, glint);
      }`;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aGlaze;
      varying vec3 vWorldPos;
      varying vec3 vObjNormal;
      varying vec3 vObjPos;
      varying vec2 vUv;
      varying float vGlaze;
      void main() {
        vObjNormal = normal; vObjPos = position; vUv = uv; vGlaze = aGlaze;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: header + `
      uniform sampler2D uMapF, uMapB${crack ? ', uCrackF, uCrackB' : ''};
      uniform vec3 uGlaze;
      ${c.fill && !c.fill.color ? 'uniform float uFillMetal;' : ''}
      ${Array.from({ length: blurCount }, (_, k) => `uniform samplerCube uEnvB${k};`).join('\n')}
      varying float vGlaze;
      ${VNOISE}
      vec4 mapAt(vec2 p, bool back) {
        vec2 t = p * ${f(geo.uvScale)} + 0.5;
        return back ? texture2D(uMapB, t) : texture2D(uMapF, t);
      }${crack ? crackCode : ''}
      void main() {
        vec3 n = normalize(vObjNormal);
        bool back = n.z < 0.0;
        vec4 m = mapAt(vObjPos.xy, back);
        // 刻痕的坡度按物体坐标求，往外法线的反方向刻进去
        float e = ${f(0.75 / (geo.uvScale * 2048))};
        float gx = (mapAt(vObjPos.xy + vec2(e, 0.0), back).g - mapAt(vObjPos.xy - vec2(e, 0.0), back).g) / (2.0 * e);
        float gy = (mapAt(vObjPos.xy + vec2(0.0, e), back).g - mapAt(vObjPos.xy - vec2(0.0, e), back).g) / (2.0 * e);
        vec3 nc = normalize(n + vec3(gx, gy, 0.0) * ${f(c.carveDepth ?? 0.002)});
        vec2 q = vObjPos.xy * ${f(c.peel?.scale ?? 80)};
        vec3 ng = normalize(nc + vec3((vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * ${f(c.peel?.strength ?? 0)}, 0.0));
        float cut = smoothstep(0.02, 0.15, m.g);
        float cover = m.r * (1.0 - cut);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 nw = normalize(mat3(uModel) * nc);
        float cosI = clamp(dot(nw, V), 0.0, 1.0);
        float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / ${f((c.ior ?? 1.5) ** 2)});
        vec3 dirN = uEnvMatrix * nw;
        float E = ${level('dirN', c.diffuseLevel ?? blurCount)}.${ch};
        float t = vGlaze * cover / ${f(c.ref)};
        vec3 through = pow(uGlaze, vec3(t / cosT));
        float sc = 1.0 - exp(-t * ${f(c.scatter ?? 1)});
        vec3 albedo = mix(${v3(c.body)} * through, pow(uGlaze, vec3(${f(c.scatterPath ?? 0.6)} / cosT)), sc);${crack ? `
        vec3 Vo = normalize(transpose(mat3(uModel)) * V);
        vec3 vt = refract(-Vo, n, ${f(1 / ior)});
        vec2 cr = cover > 0.5 ? crackle(n, Vo, vGlaze * cover, back, vt) : vec2(0.0);
        albedo = mix(albedo, ${v3(ck.lineColor || [1, 1, 1])} * pow(uGlaze, vec3(0.3)), cr.x * ${f(ck.line ?? 0.2)});` : ''}
        float gr = 1.0 + ${f(c.grain ?? 0)} * (vnoise(vObjPos.xy * 700.0) - 0.5) * 2.0;
        vec3 bare = mix(${v3(c.body)}, ${v3(c.cut || c.body)}, cut) * gr;
        albedo = mix(bare, albedo, cover);
        vec3 col = (E * ${f(c.diffuse ?? 1)} + ${f(c.ambient ?? 0)}) * albedo;
        vec3 ngw = normalize(mat3(uModel) * ng);
        float F = ${f(c.f0 ?? 0.04)} + ${f(1 - (c.f0 ?? 0.04))} * pow(1.0 - clamp(dot(ngw, V), 0.0, 1.0), 5.0);
        vec3 dirR = envDir(ng, vec2(0.0));
        float S = pow(${level('dirR', c.glossLevel ?? 1)}.${ch}, ${f(c.glossK ?? 1)});
        col = col * (1.0 - F * cover) + S * F * ${f(c.gloss ?? 1)} * cover;${crack ? `
        col += cr.y * ${f(ck.glint ?? 1)} * (1.0 - F) * pow(uGlaze, vec3(0.5 / cosT));` : ''}
${c.fill ? (() => {
          const fl = c.fill, from = fl.from ?? 0.85;
          const metalLit = `pow(${level('dirF', fl.level ?? 1)}.${ch}, ${f(fl.k ?? 2)}) * ${f(fl.diffuse ?? 1.3)} + ${f(fl.ambient ?? 0.2)}`;
          const paintLit = `E * ${f(fl.paintDiffuse ?? (c.diffuse ?? 1))} + ${f(fl.paintAmbient ?? (c.ambient ?? 0))}`;
          const lit = fl.color ? (fl.metal ? metalLit : paintLit) : `mix(${paintLit}, ${metalLit}, uFillMetal)`;
          return `
        vec3 dirF = envDir(n, vec2(0.0));
        col = mix(col, (${lit}) * ${fl.color ? v3(fl.color) : 'uMetal'}, smoothstep(${f(from - 0.1)}, ${f(from)}, m.g));`;
        })() : ''}
        gl_FragColor = vec4(col * (1.0 - m.b), 1.0);
      }`,
  });
}
