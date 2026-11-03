// 旋转体（可选，design.lathe(form) = { profile, segments }）：一条截面曲线绕 z 轴转一圈，得到整件器物（洗、盘、碗）。
// profile 是 [r, z, 釉厚] 的折线，从正面中心出发，沿里面往外、翻过口沿、沿外壁往下、绕过圈足、回到背面中心；
// 法线取走向的左侧（正面中心处朝 +z），曲线要由图案画得足够密、拐角要圆。整件都用瓷的材质（见 shading/ceramic.js），
// 没有金属外框、侧壁和背板，正面、金属、背面三份几何留空
import { bufferGeometry, emptyGeometry } from '../mesh.js';

export function buildLathe(style, design) {
  const { profile, segments = 256 } = design.lathe(style.form);
  const extent = Math.max(...profile.map(p => p[0])) * 1.05;
  const uvScale = 0.5 / extent;
  const outline = Array.from({ length: 256 }, (_, i) => [Math.cos(i / 256 * 2 * Math.PI) * extent / 1.05, Math.sin(i / 256 * 2 * Math.PI) * extent / 1.05]);
  const ctx = { form: style.form, outline, extent };
  const n = profile.length;
  const nrm = profile.map((_, i) => {
    const a = profile[Math.max(i - 1, 0)], b = profile[Math.min(i + 1, n - 1)];
    const dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1;
    return [-dz / l, dr / l];
  });
  const pos = [], nor = [], uv = [], glaze = [], idx = [];
  for (let j = 0; j <= segments; j++) {
    const phi = j / segments * 2 * Math.PI, c = Math.cos(phi), sn = Math.sin(phi);
    for (let i = 0; i < n; i++) {
      const [r, z, d] = profile[i], [nr, nz] = nrm[i];
      pos.push(r * c, r * sn, z); nor.push(nr * c, nr * sn, nz);
      uv.push(r * c * uvScale + 0.5, r * sn * uvScale + 0.5); glaze.push(d ?? 0);
    }
  }
  for (let j = 0; j < segments; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + n;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const lathe = bufferGeometry({ position: [pos, 3], normal: [nor, 3], uv: [uv, 2], aGlaze: [glaze, 1] }, idx);
  return { metal: emptyGeometry(), face: emptyGeometry(), back: emptyGeometry(), reliefs: [], covered: false, ctx, uvScale, cord: null, lathe };
}
