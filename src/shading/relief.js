// 浮雕的材质：高度图逐像素给法线和凹度（凹处压暗、转缎面），嵌珐琅、透明珐琅、螺钿、金粉、分区金属、磨损、自发光
import { THREE } from '../three.js';
import { VERT, tintLine, tintStart } from './common.js';
import { spillLine } from '../effects/spill.js';

// 螺钿的虹彩（浮雕的 shell = { base, strength, film: [lo, hi], bands: { scale, warp, angle }, k, diffuse, ambient }）：
// 珍珠层是一叠薄片，颜色来自薄膜干涉：光程 = 厚度 × 视线在贝里的折射角余弦，色相随视线和表面的夹角变，转动时颜色流动。
// 厚度由三样决定：每片贝的偏移（嵌釉的 shell）、贝壳的生长纹（弯曲的平行带）、整体范围 film。
// 三个通道按 650、550、470 纳米的倒数取相位；亮度仍乘环境（贝面是镜面，背着光就暗）。base 是贝本身的颜色：青贝暗、厚贝白
function nacreCode(s) {
  const f = v => v.toFixed(4), b = s.bands || {};
  const ang = (b.angle ?? 30) * Math.PI / 180;
  return `vec4 sh = texture2D(uInlayShell, t);
          if (sh.r > 0.5) {
            float cosI = clamp(dot(nw, normalize(cameraPosition - vWorldPos)), 0.0, 1.0);
            float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / 2.34);
            vec2 bq = vObjPos.xy * ${f(b.scale ?? 120)};
            float band = sin(dot(bq, vec2(${f(Math.cos(ang))}, ${f(Math.sin(ang))})) + ${f(b.warp ?? 3)} * (vnoise(bq * 0.08) - 0.5) * 6.2832);
            float opd = mix(${f(s.film[0])}, ${f(s.film[1])}, 0.5 + 0.5 * sin(6.2832 * (sh.g + 0.12 * band + 0.05 * vnoise(bq * 0.5)))) * cosT;
            vec3 irid = 0.5 + 0.5 * cos(6.2832 * opd * vec3(1.0, 1.18, 1.38));
            vec3 col = vec3(${s.base.map(f).join(', ')}) + ${f(s.strength)} * irid;
            body = (pow(env.y, ${f(s.k ?? 2)}) * ${f(s.diffuse ?? 1)} + ${f(s.ambient ?? 0.3)}) * col;
          }`;
}

// maps 是这块浮雕的贴图：height、inlay，可选 inlayParams、emissive、inlayGloss、inlayShell、powder、metalMap
export function reliefMaterial(b, rf, maps, envScale) {
  const { style, common, header, metalColor } = b;
  const r = rf.relief, gain = (style.output.emissiveGain ?? 1).toFixed(3);
  const translucent = !!maps.inlayParams, inlayGloss = !!maps.inlayGloss;
  const T = r.paintMetal ? 'baseTint' : 'uTint';
  return new THREE.ShaderMaterial({
    uniforms: {
      ...common, uHeight: { value: maps.height }, uInlay: { value: maps.inlay },
      uBox: { value: new THREE.Vector4(...rf.box) }, uTexel: { value: new THREE.Vector2(1 / rf.nx, 1 / rf.ny) },
      uTint: { value: r.metal ? new THREE.Color(...r.metal) : metalColor },
      uPatina: { value: new THREE.Color(...(r.patina || [1, 1, 1])) },
      uWear: { value: new THREE.Color(...(r.wear?.color || [1, 1, 1])) },
      uInlayParams: { value: maps.inlayParams || null }, uEmissive: { value: maps.emissive || null },
      uInlayGloss: { value: maps.inlayGloss || null }, uInlayShell: { value: maps.inlayShell || null }, uPowder: { value: maps.powder || null }, uMetalMap: { value: maps.metalMap || null },
    },
    vertexShader: VERT,
    fragmentShader: header + `
      uniform sampler2D uHeight, uInlay, uInlayParams, uEmissive, uInlayGloss, uInlayShell, uPowder${r.paintMetal ? ', uMetalMap' : ''};
      uniform vec4 uBox;
      uniform vec2 uTexel;
      uniform vec3 uTint, uPatina, uWear;
      // 凹处的细麻面：值噪声扰动法线，只在不抛光的地方起作用（旧鎏金凹处是哑的、凸处是亮的）
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 t = (${rf.backSide ? 'vec2(-vObjPos.x, vObjPos.y)' : 'vObjPos.xy'} - uBox.xy) / uBox.zw;
        vec2 hv = texture2D(uHeight, t).rg;
        float hx = (texture2D(uHeight, t + vec2(uTexel.x, 0.0)).r - texture2D(uHeight, t - vec2(uTexel.x, 0.0)).r) / (2.0 * uTexel.x * uBox.z);
        float hy = (texture2D(uHeight, t + vec2(0.0, uTexel.y)).r - texture2D(uHeight, t - vec2(0.0, uTexel.y)).r) / (2.0 * uTexel.y * uBox.w);
        vec3 n = normalize(vObjNormal);
        ${r.glassTop ? 'vec3 n0 = n;' : ''}
        ${rf.backSide ? 'if (n.z < -0.5) n = normalize(n + vec3(hx, -hy, 0.0));' : 'if (n.z > 0.5) n = normalize(n + vec3(-hx, -hy, 0.0));'}
        ${tintStart(style, 'n')}
        float cav = hv.g;
        float polish = smoothstep(${(-(r.satinBelow ?? 0.003)).toFixed(4)}, 0.002, cav);
        // 麻面只给金属：珐琅是磨平的，不跟着发毛
        vec2 q = vObjPos.xy * ${(r.grainScale ?? 600).toFixed(1)};
        vec2 gn = vec2(vnoise(q), vnoise(q + 17.3)) - 0.5;
        vec3 nm = normalize(n + vec3(gn * ${(r.grain ?? 0).toFixed(3)} * (1.0 - polish), 0.0));
        ${r.powder ? `// 金粉：按物体坐标分成小格（格子斜着放，免得排成横竖的行），每格一粒，法线各偏一个随机方向，转动时一粒粒分别亮起来。
        // 强弱由 powder.paint 画的图定（没有就处处一样）；透明漆下的金（研出、绘梨子地）也用这个法线
        vec2 pq = mat2(0.8, 0.6, -0.6, 0.8) * vObjPos.xy * ${r.powder.scale.toFixed(1)};
        vec2 pc = floor(pq);
        float pw = ${r.powder.paint ? 'texture2D(uPowder, t).r' : '1.0'} * ${r.powder.tilt.toFixed(3)};
        nm = normalize(nm + vec3((vec2(hash(pc), hash(pc + 7.31)) - 0.5) * pw, 0.0));` : ''}
        vec3 envM = envAt(nm, vec2(0.0)) * ${envScale}, env = envAt(n, vec2(0.0)) * ${envScale};
        ${r.powder ? 'vec3 envP = envAt(nm, vec2(0.0)) * ' + envScale + ';' : ''}
        float shade = mix(${(r.cavityDark ?? 0.55).toFixed(3)}, 1.0, smoothstep(-0.008, 0.0, cav));
        ${r.paintMetal ? 'vec4 mm = texture2D(uMetalMap, t); vec3 baseTint = mix(uTint, mm.rgb, mm.a);' : ''}
        vec3 tint = mix(${T} * uPatina, ${T}, smoothstep(-0.006, 0.0, cav));
        // 凸处磨损：镀层磨掉，露出底下的金属（wear.color），从凸度 from 到 to 渐变
        ${r.wear ? `tint = mix(tint, uWear, smoothstep(${r.wear.from.toFixed(4)}, ${r.wear.to.toFixed(4)}, cav));` : ''}
        ${style.materials.polished.scratches && r.scratches !== false ? `vec4 sc = scratchAt(vObjPos);
        envM = envAt(scratched(nm, sc), vec2(0.0)) * ${envScale};
        polish *= 1.0 - sc.b * ${(style.materials.polished.scratches.dull ?? 0.6).toFixed(4)};` : ''}
        vec3 metal = mix(vec3(satinLight(envM)), vec3(polishedLight(envM)), polish) * tint * shade;
        vec4 inl = texture2D(uInlay, t);
        vec3 nw = normalize(mat3(uModel) * n);
        float fres = pow(1.0 - clamp(dot(nw, normalize(cameraPosition - vWorldPos)), 0.0, 1.0), 5.0);
        vec3 body = enamelLight(env) * inl.rgb;
        ${translucent ? `body = mix(body, polishedLight(${r.powder ? 'envP' : 'env'}) * ${T} * inl.rgb, texture2D(uInlayParams, t).r);` : ''}
        ${r.shell ? nacreCode(r.shell) : ''}
        ${r.glassTop ? `vec3 envG = envAt(n0, vec2(0.0)) * ${envScale};
        float fresG = pow(1.0 - clamp(dot(normalize(mat3(uModel) * n0), normalize(cameraPosition - vWorldPos)), 0.0, 1.0), 5.0);` : ''}
        vec3 enamel = body + enamelGloss(${r.glassTop ? 'envG, fresG' : 'env, fres'})${inlayGloss ? ' * texture2D(uInlayGloss, t).r * (255.0 / 128.0)' : ''};
        gl_FragColor = vec4(mix(metal, enamel, inl.a), 1.0);
        ${tintLine(style, 'n')}
        ${rf.backSide ? '' : spillLine(style, 'metal', 'tint * (1.0 - inl.a)')}
        ${r.emissive ? `gl_FragColor.rgb += texture2D(uEmissive, t).rgb * ${gain};` : ''}
      }`,
  });
}
