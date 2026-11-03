// 锁边绳（form.cord = { width, top, under, segments }）：沿外轮廓扫一根椭圆截面的管子，最外沿正好是外轮廓，
// 顶在正面以上 top、底在背面以下 under，把布边从正面包到背面。只适合外凸的轮廓（锁边机也只能锁这种）。
// 顶点带沿轮廓的切向（aAlong）和 (沿轮廓的弧长, 绕截面的弧长, 截面角)（aCord），着色时按它们算斜绕的线（见 shading/thread.js）
import { densifyLoop, loopNormals } from '../geom2d.js';
import { bufferGeometry } from '../mesh.js';

export function buildCord(outline, f, dome) {
  const c = f.cord, a = c.width / 2;
  const zTop = c.top, zBot = -f.shell - (c.under ?? 0.004);
  const z0 = (zTop + zBot) / 2, b = (zTop - zBot) / 2;
  const out = loopNormals(outline, 1);
  const ring = densifyLoop(outline.map(([x, y], i) => [x - out[i][0] * a, y - out[i][1] * a]), 0.004);
  const rn = loopNormals(ring, 1), n = ring.length, M = c.segments ?? 28;
  const len = [0];
  for (let i = 1; i <= n; i++) len.push(len[i - 1] + Math.hypot(ring[i % n][0] - ring[i - 1][0], ring[i % n][1] - ring[i - 1][1]));
  const around = [0];
  for (let j = 1; j <= M; j++) {
    const p = q => [a * Math.cos(2 * Math.PI * q / M), b * Math.sin(2 * Math.PI * q / M)];
    const [x0, y0] = p(j - 1), [x1, y1] = p(j);
    around.push(around[j - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const pos = [], nrm = [], along = [], cuv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = ring[i % n], [ox, oy] = rn[i % n];
    const h = dome(x, y);
    for (let j = 0; j <= M; j++) {
      const psi = 2 * Math.PI * j / M, cs = Math.cos(psi), sn = Math.sin(psi);
      pos.push(x + ox * a * cs, y + oy * a * cs, h + z0 + b * sn);
      const nx = ox * cs / a, ny = oy * cs / a, nz = sn / b, l = Math.hypot(nx, ny, nz);
      nrm.push(nx / l, ny / l, nz / l);
      along.push(-oy, ox, 0);
      cuv.push(len[i], around[j], psi);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < M; j++) {
    const k = i * (M + 1) + j, k2 = k + M + 1;
    idx.push(k, k2, k + 1, k + 1, k2, k2 + 1);
  }
  return { geometry: bufferGeometry({ position: [pos, 3], normal: [nrm, 3], aAlong: [along, 3], aCord: [cuv, 3] }, idx), length: len[n] };
}
