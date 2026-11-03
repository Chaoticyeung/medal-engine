// Clipper 包装。用全局的 ClipperLib（clipper-lib 6.4.2），坐标放大 CS 倍取整后交给它
import { signedArea } from './geom2d.js';

export const CS = 1e5;
export const C = () => globalThis.ClipperLib;
export const toPath = pts => pts.map(([x, y]) => ({ X: Math.round(x * CS), Y: Math.round(y * CS) }));
export const fromPath = path => path.map(q => [q.X / CS, q.Y / CS]);
export const paths = () => new (C().Paths)();

// 布尔运算，两边都按非零规则。type 是 'union'、'difference'、'intersection'；out 可以给 PolyTree
export function boolean(type, subject, clip, out = paths()) {
  const c = new (C().Clipper)();
  c.AddPaths(subject, C().PolyType.ptSubject, true);
  if (clip) c.AddPaths(clip, C().PolyType.ptClip, true);
  const ct = { union: C().ClipType.ctUnion, difference: C().ClipType.ctDifference, intersection: C().ClipType.ctIntersection }[type];
  c.Execute(ct, out, C().PolyFillType.pftNonZero, C().PolyFillType.pftNonZero);
  return out;
}

export function clipperOffset(list, delta, endType, out, join = C().JoinType.jtRound) {
  const co = new (C().ClipperOffset)(2, 0.0003 * CS);
  co.AddPaths(list, join, endType);
  co.Execute(out, delta * CS);
  return out;
}

// 闭合多边形组整体外扩（正）或内缩（负）
export const offsetPaths = (list, d, out = paths()) => clipperOffset(list, d, C().EndType.etClosedPolygon, out);

// 一大堆多边形求并集。Clipper 把多边形插进有序链表，个数一多就按平方变慢，所以先分小批求并、再两两合并。
// 只用于各自方向正确的闭合多边形（外圈逆时针、孔顺时针成对出现在同一个多边形组里）
export function unionAll(list) {
  const run = part => boolean('union', part);
  let level = [];
  for (let i = 0; i < list.length; i += 48) level.push(run(list.slice(i, i + 48)));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? run([...level[i], ...level[i + 1]]) : level[i]);
    level = next;
  }
  return level[0] || paths();
}

// 把多边形分成互不相邻的组：边相距不到 gap 的归一组。外框的外框盒子盖住整个勋章，所以不能按外框盒子判断：
// 把每条边按 gap 大小的格子画出来，占到相同或相邻格子的多边形算相邻。孔（反向的多边形）一定和包住它的外圈同组，
// 否则单独拿出来会被当成实心（外框那一圈的内孔离外沿比 gap 远，不能靠相邻判断）
export function nearGroups(list, gap) {
  const parent = list.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  const mark = (cx, cy, i) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const key = (cx + dx) * 1e6 + (cy + dy);
      const o = owner.get(key);
      if (o === undefined) { if (dx === 0 && dy === 0) owner.set(key, i); }
      else if (find(o) !== find(i)) parent[find(o)] = find(i);
    }
  };
  list.forEach((p, i) => {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b.X - a.X, b.Y - a.Y) / (gap / 2)));
      for (let t = 0; t <= n; t++) mark(Math.floor((a.X + (b.X - a.X) * t / n) / gap), Math.floor((a.Y + (b.Y - a.Y) * t / n) / gap), i);
    }
  });
  const area = list.map(p => C().Clipper.Area(p));
  list.forEach((hole, i) => {
    if (area[i] >= 0) return;
    let best = -1;
    list.forEach((outer, j) => {
      if (area[j] > 0 && (best < 0 || area[j] < area[best]) && C().Clipper.PointInPolygon(hole[0], outer) !== 0) best = j;
    });
    if (best >= 0) parent[find(i)] = find(best);
  });
  const groups = new Map();
  list.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, paths()); groups.get(r).push(p); });
  return [...groups.values()];
}

// 闭合多边形整体外扩（正）或内缩（负），返回若干闭合轮廓
export function offsetPolygon(pts, delta) {
  return offsetPaths([toPath(pts)], delta).map(fromPath);
}

// 轮廓内缩 d 以后最大的那一圈
export function insetRing(ring, d) {
  return offsetPolygon(ring, -d).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
}

// 点在不在一组 Clipper 多边形的任何一个里（含边上）
export const insideAny = (list, [x, y]) => list.some(p => C().Clipper.PointInPolygon({ X: Math.round(x * CS), Y: Math.round(y * CS) }, p) !== 0);

