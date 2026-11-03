// 示例图案"树"：正面一圈放射的刻槽围着中间的一棵树，背面是同心的起线和辐条。
// 浮雕在 build(field) 里堆高度场：add/max 叠形状，mask 是平滑的多边形遮罩，groove 刻槽、ridge 起线（重叠处取最深、最高）
import { arcPts } from '../../src/geom2d.js';

const R = 1, r = 0.9;
const disk = arcPts(0, 0, r, r, 0, 2 * Math.PI, 180);
const branch = (x, y, a, len) => [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]];

export default {
  name: '树',
  outline: () => arcPts(0, 0, R, R, 0, 2 * Math.PI, 256),
  strokes: () => [],
  regions: () => [],
  reliefs: () => [
    {
      outline: disk, raise: 0, step: 0.002, cavityRadius: 0.02,
      patina: [0.4, 0.33, 0.26], grain: 0.5, grainScale: 500,
      build(f) {
        f.add((x, y) => 0.025 * Math.max(0, 1 - (x * x + y * y) / (r * r)));
        // 中间一块平台：mask 是边上 0.5、往里平滑升到 1 的遮罩，按格点下标叠上去
        const plateau = f.mask(arcPts(0, 0, 0.5, 0.5, 0, 2 * Math.PI, 120), 0.02);
        f.map((x, y, h, k) => h + 0.01 * plateau[k]);
        for (let k = 0; k < 24; k++) {
          const a = k / 24 * 2 * Math.PI;
          f.groove([[0.62 * Math.cos(a), 0.62 * Math.sin(a)], [0.84 * Math.cos(a), 0.84 * Math.sin(a)]], 0.022, 0.008);
        }
        f.ridge(arcPts(0, 0, 0.56, 0.56, 0, 2 * Math.PI, 160), 0.03, 0.01);
        // 树：一根树干，左右分三层枝
        f.ridge([[0, -0.42], [0, 0.36]], 0.07, 0.03);
        for (const [y, len] of [[-0.1, 0.3], [0.08, 0.24], [0.24, 0.16]]) {
          f.ridge(branch(0, y, Math.PI * 0.2, len), 0.045, 0.022);
          f.ridge(branch(0, y, Math.PI * 0.8, len), 0.045, 0.022);
        }
        f.ridge([[-0.3, -0.42], [0.3, -0.42]], 0.035, 0.015);
      },
    },
    {
      side: 'back', outline: disk, raise: 0, step: 0.002, envScale: 'back',
      patina: [0.45, 0.38, 0.3],
      build(f) {
        f.add((x, y) => 0.015 * Math.max(0, 1 - (x * x + y * y) / (r * r)));
        for (const rr of [0.82, 0.72, 0.3]) f.ridge(arcPts(0, 0, rr, rr, 0, 2 * Math.PI, 160), 0.025, 0.012);
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * 2 * Math.PI;
          f.ridge([[0.34 * Math.cos(a), 0.34 * Math.sin(a)], [0.68 * Math.cos(a), 0.68 * Math.sin(a)]], 0.018, 0.008);
        }
      },
    },
  ],
};
