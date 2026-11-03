// 金属丝：图案的笔画（strokes）按凸起高度分组，每组各自求并集、修凹角、做倒角和侧壁，顶面贴着正面曲面。
// 中心线留到外框中间为止，伸进外框的部分被外框盖住
import { THREE } from '../three.js';
import { densifyOpen, densifyLoop, signedArea, loopNormals, splitRun } from '../geom2d.js';
import { CS, C, toPath, fromPath, paths, boolean, clipperOffset, offsetPaths, unionAll, nearGroups, offsetPolygon, insideAny } from '../clipper.js';
import { strip, surface } from '../mesh.js';

// 笔画的选项：
//   pts      中心线（首尾重合就是闭合的），width 线宽（数字，或 form.wires 里的名字）；cap: 'butt' 两头平切，默认半圆头；
//   shape    直接给金属顶面的轮廓（字形），代替 pts；embolden 整体加粗；
//   raise、bevel  这组笔画的凸起和倒角（数字，或 form 里的项名），默认 form.raise、form.bevel；
//   tone     金属色的倍数；covered 被珐琅（阻焊漆）盖住，颜色和光泽取珐琅层的，lift 是提亮倍数（默认 1.06）。
// 返回有没有 covered 的笔画
export function buildWires(metal, { f, outline, strokes, rimPieces, outerArea, dome, domeNormal }) {
  const clipPolys = offsetPolygon(outline, -f.rim * 0.7).map(toPath);
  const inside = p => insideAny(clipPolys, p);
  const groups = new Map();
  const group = (raise, bevel, tone) => {
    const key = `${raise}|${bevel}|${tone}`;
    if (!groups.has(key)) groups.set(key, { raise, bevel, tone, smooth: false, pieces: paths() });
    return groups.get(key);
  };
  const named = (v, fallback) => (typeof v === 'string' ? f[v] : v ?? fallback);
  const base = group(f.raise, f.bevel, 1);
  // covered 的笔画用负的 tone 标记，着色时按珐琅画
  let covered = false;
  for (const s of strokes) {
    if (s.covered) covered = true;
    const tone = s.covered ? -(s.lift ?? 1.06) : s.tone ?? 1;
    const g = s.raise === undefined && s.bevel === undefined && s.tone === undefined && !s.covered ? base
      : group(named(s.raise, f.raise), named(s.bevel, f.bevel), tone);
    if (s.shape) { addShape(g, s); continue; }
    const w = typeof s.width === 'string' ? f.wires[s.width] : s.width;
    const closed = Math.hypot(s.pts[0][0] - s.pts.at(-1)[0], s.pts[0][1] - s.pts.at(-1)[1]) < 1e-6;
    const pts = densifyOpen(s.pts, 0.006);
    if (closed) pts.pop();
    for (const run of splitRun(pts, closed, inside)) {
      const end = run.closed ? C().EndType.etClosedLine : s.cap === 'butt' ? C().EndType.etOpenButt : C().EndType.etOpenRound;
      clipperOffset([toPath(run.pts)], w / 2 - g.bevel, end, paths()).forEach(p => g.pieces.push(p));
    }
  }
  for (const g of groups.values()) {
    metal.tone = g.tone;
    const union = g === base ? unionWithRim(g.pieces, outline, f, rimPieces) : unionAll(g.pieces);
    // 凹角修圆：先扩后缩，缩的时候凹角处补圆弧。扩用尖角（凸角处不加圆弧，顶点少得多），缩回来凸角还是原样。
    // 只影响相距不到两倍圆角的多边形，按远近分组各做各的
    const exPolys = nearGroups(union, 2.5 * f.fillet * CS).flatMap(part => {
      const grown = clipperOffset(part, f.fillet, C().EndType.etClosedPolygon, paths(), C().JoinType.jtMiter);
      return C().JS.PolyTreeToExPolygons(offsetPaths(grown, -f.fillet, new (C().PolyTree)()));
    });
    for (const ep of exPolys) wirePiece(metal, ep, g, outerArea, dome, domeNormal);
  }
  return covered;
}

// shape：直接给出金属顶面的轮廓（比如字体的字形），轮廓之间按非零规则先合并，再收进一个倒角。
// 书法字形的边缘有很多细小的凹口和毛刺，倒角往外做时会在这些地方自交、出锯齿，所以先按 1.5 倍倒角宽度
// 做一次先扩后缩（填平凹口）、再先缩后扩（磨掉毛刺）
function addShape(g, s) {
  const merged = boolean('union', s.shape.map(toPath));
  const r = 1.5 * g.bevel;
  g.smooth = true;
  // embolden：整体加粗这么多（字形在小尺寸下笔画太细时用）
  const bold = s.embolden ? offsetPaths(merged, s.embolden) : merged;
  offsetPaths(offsetPaths(offsetPaths(offsetPaths(bold, r), -2 * r), r), -g.bevel).forEach(p => g.pieces.push(p));
}

// 默认那组笔画和外框顶面一起求并。互不接触的笔画各自求并（并集就是各组并集拼起来），只有挨着外框的才和外框一起求
function unionWithRim(pieces, outline, f, rimPieces) {
  const inner = offsetPolygon(outline, -(f.rim - f.bevel) - 0.01).map(toPath);
  const nearRim = g => g.some(p => p.some(q => inner.every(r => C().Clipper.PointInPolygon(q, r) === 0)));
  const touching = [], parts = [];
  for (const g of nearGroups(pieces, 0.002 * CS)) (nearRim(g) ? touching.push(...g) : parts.push(...unionAll(g)));
  return [...boolean('union', [...unionAll(touching), ...rimPieces]), ...parts];
}

// 一块金属顶面：每一圈轮廓做倒角和侧壁（侧壁伸到正面以下一点），中间铺顶面
function wirePiece(metal, ep, { raise, bevel, smooth }, outerArea, dome, domeNormal) {
  const UP = new THREE.Vector3(0, 0, 1);
  const rings = [ep.outer, ...ep.holes].map(p => densifyLoop(fromPath(p), 0.005));
  rings.forEach((ring, k) => {
    // 外框外沿那一圈的倒角和侧壁在外框里做了
    if (k === 0 && Math.abs(signedArea(ring)) > outerArea * 0.9) return;
    // 有字形轮廓的组，倒角方向在前后各两个点上取平均，轮廓上的小起伏不会让倒角面忽明忽暗；
    // 金属丝不平均，拐角处的倒角要保持原样
    const raw = loopNormals(ring, (k === 0 ? 1 : -1) * Math.sign(signedArea(ring)));
    const nrm = !smooth ? raw : raw.map((_, i) => [0, 1, 2, 3, 4].reduce((acc, d) => {
      const q = raw[(i + d - 2 + raw.length) % raw.length];
      return [acc[0] + q[0] / 5, acc[1] + q[1] / 5];
    }, [0, 0]));
    const p = (i, d, h) => {
      const x = ring[i][0] + nrm[i][0] * d, y = ring[i][1] + nrm[i][1] * d;
      return new THREE.Vector3(x, y, dome(x, y) + h);
    };
    const o = i => new THREE.Vector3(nrm[i][0], nrm[i][1], 0);
    const top = ring.map((_, i) => p(i, 0, raise));
    const edge = ring.map((_, i) => p(i, bevel, raise - bevel));
    const foot = ring.map((_, i) => p(i, bevel, -0.015));
    strip(metal, top, edge, i => o(i).add(UP));
    strip(metal, edge, foot, o);
  });
  surface(metal, rings[0], rings.slice(1), (x, y) => [new THREE.Vector3(x, y, dome(x, y) + raise), domeNormal(x, y)], 0.02);
}
