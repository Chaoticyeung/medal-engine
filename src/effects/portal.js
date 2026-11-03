// 另一个空间（design.portal）：只看视线方向，像一张无限远的环境图，所以转动时里面的东西跟着视角大幅移动，
// 看起来比勋章厚得多。里面是一片网格地面伸向地平线（视线先往下压 pitch 度），地平线一道光，越远越暗。
//   color 网格和地平线的颜色，base 空处的底色，scale 网格间距（地面在视点下方 1 个单位），fog 远处变暗的快慢，
//   glow 地平线光的强度，width 网格线宽（像素）
export function portalFn(p) {
  const v3 = c => `vec3(${c.map(v => v.toFixed(4)).join(', ')})`;
  const pitch = ((p.pitch ?? 12) * Math.PI / 180).toFixed(4);
  return `vec3 portalColor(vec3 d) {
    float cp = cos(${pitch}), sp = sin(${pitch});
    vec3 q = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
    float up = q.y, fwd = max(-q.z, 1e-3);
    vec3 col = ${v3(p.base ?? [0, 0, 0])} + ${v3(p.color)} * ${(p.glow ?? 0.6).toFixed(4)} * exp(-abs(up / fwd) * 18.0);
    if (up < -1e-3) {
      float t = 1.0 / -up;
      vec2 g = vec2(q.x, fwd) * t / ${(p.scale ?? 0.5).toFixed(4)};
      vec2 w = fwidth(g) * ${(p.width ?? 1.2).toFixed(4)};
      vec2 a = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
      float line = 1.0 - min(min(a.x, a.y), 1.0);
      col += ${v3(p.color)} * line * exp(-t * ${(p.fog ?? 0.08).toFixed(4)});
    }
    return col;
  }`;
}
