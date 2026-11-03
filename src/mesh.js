// 网格拼装：顶点表、两排点之间的带子、贴着曲面的面
import { THREE } from './three.js';
import { signedArea } from './geom2d.js';
import { CS, C, toPath, fromPath, paths, boolean, offsetPolygon } from './clipper.js';

// 按 { 名字: [数组, 分量数] } 建 BufferGeometry
export function bufferGeometry(attributes, index) {
  const g = new THREE.BufferGeometry();
  for (const [name, [array, size]] of Object.entries(attributes)) g.setAttribute(name, new THREE.Float32BufferAttribute(array, size));
  if (index) g.setIndex(index);
  return g;
}

export const emptyGeometry = () => new THREE.BufferGeometry();

// tone 是金属色的倍数，同一组笔画一个值（比如地子上的细丝比纹样的丝暗一些）
export class MeshBuilder {
  constructor(uvScale) { this.pos = []; this.nrm = []; this.uv = []; this.tones = []; this.idx = []; this.uvScale = uvScale; this.tone = 1; }
  get count() { return this.pos.length / 3; }
  vert(p, n) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.tones.push(this.tone);
    this.uv.push(p.x * this.uvScale + 0.5, p.y * this.uvScale + 0.5);
    return this.count - 1;
  }
  // 两排点对应连成四边形：每排 n 个点，首尾相接
  band(base, n) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.idx.push(base + i, base + n + i, base + n + j, base + i, base + n + j, base + j);
    }
  }
  geometry() {
    return bufferGeometry({ position: [this.pos, 3], normal: [this.nrm, 3], uv: [this.uv, 2], tone: [this.tones, 1] }, this.idx);
  }
}

// 两排对应点之间连一条带子。法线沿带子方向平滑、横向不平滑，倒角和侧壁之间是硬边；
// hint 给出大致朝外的方向，用来把法线翻到正确一侧
export function strip(m, rowA, rowB, hint) {
  const n = rowA.length, base = m.count;
  const nrm = rowA.map((_, i) => {
    const ip = (i + n - 1) % n, iq = (i + 1) % n;
    const along = rowA[iq].clone().sub(rowA[ip]).add(rowB[iq].clone().sub(rowB[ip]));
    const v = along.cross(rowB[i].clone().sub(rowA[i])).normalize();
    if (v.dot(hint(i)) < 0) v.negate();
    return v;
  });
  rowA.forEach((p, i) => m.vert(p, nrm[i]));
  rowB.forEach((p, i) => m.vert(p, nrm[i]));
  m.band(base, n);
}

// 一块贴着曲面的面，新点都按 place 放回曲面。平的长三角形会沉到曲面以下，让下面一层透上来，所以边都要短于 maxEdge。
// 内部铺规则方格（每格两个三角形，斜边正好是 maxEdge）；方格离轮廓至少 1.5 格，轮廓和方格之间的一圈
// 才三角化，再把长边一路对半切到 maxEdge 以下。整块直接三角化再切会切出成片的细长三角形，数量多出十几倍。
// 相邻三角形共用顶点（位置相同、法线也相同），方格边界上的点按格距排好，和那一圈的三角形对得上
export function surface(m, contour, holes, place, maxEdge) {
  const seen = new Map();
  const keyOf = (x, y) => Math.round(x * 1e7) * 4e7 + Math.round(y * 1e7);
  const put = (x, y) => {
    const key = keyOf(x, y);
    let i = seen.get(key);
    if (i === undefined) { const [p, n] = place(x, y); i = m.vert(p, n); seen.set(key, i); }
    return i;
  };
  const split = (a, b, c) => {
    const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const longest = Math.max(ab, bc, ca);
    if (longest <= maxEdge) { m.idx.push(put(...a), put(...b), put(...c)); return; }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (longest === ab) { const d = mid(a, b); split(a, d, c); split(d, b, c); }
    else if (longest === bc) { const d = mid(b, c); split(a, b, d); split(a, d, c); }
    else { const d = mid(c, a); split(a, b, d); split(d, b, c); }
  };
  const fill = (outer, inner) => {
    const pts = [outer, ...inner].flat();
    const faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), inner.map(h => h.map(([x, y]) => new THREE.Vector2(x, y))));
    for (const f of faces) split(pts[f[0]], pts[f[1]], pts[f[2]]);
  };

  // 方格：坐标取 Clipper 整数单位的整倍数，Clipper 求出的边界点和方格点完全相同
  const hI = Math.floor(maxEdge / Math.SQRT2 * 0.999 * CS), h = hI / CS;
  const ccw = r => (signedArea(r) < 0 ? [...r].reverse() : r);
  const inner = boolean('difference',
    offsetPolygon(ccw(contour), -1.5 * h).map(toPath),
    holes.flatMap(hole => offsetPolygon(ccw(hole), 1.5 * h)).map(toPath)).map(fromPath);
  const xs = contour.map(p => p[0]), ys = contour.map(p => p[1]);
  const x0I = Math.floor(Math.min(...xs) * CS / hI) * hI, y0I = Math.floor(Math.min(...ys) * CS / hI) * hI;
  const nx = Math.ceil((Math.max(...xs) * CS - x0I) / hI) + 1, ny = Math.ceil((Math.max(...ys) * CS - y0I) / hI) + 1;
  if (!inner.length || nx < 4 || ny < 4) { fill(contour, holes); return; }
  // 格点在不在内缩轮廓里：逐行求和各条边的交点，奇偶规则（内缩后的孔也在里面，正好挖掉）
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = (y0I + j * hI) / CS, cross = [];
    for (const r of inner) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [xi, yi] = r[i], [xk, yk] = r[k];
      if ((yi > y) !== (yk > y)) cross.push((xk - xi) * (y - yi) / (yk - yi) + xi);
    }
    cross.sort((a, b) => a - b);
    for (let q = 0; q + 1 < cross.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((cross[q] * CS - x0I) / hI)), i1 = Math.min(nx - 1, Math.floor((cross[q + 1] * CS - x0I) / hI));
      if (i1 >= i0) inside.fill(1, j * nx + i0, j * nx + i1 + 1);
    }
  }
  const at = (i, j) => [(x0I + i * hI) / CS, (y0I + j * hI) / CS];
  const cell = (i, j) => inside[j * nx + i] && inside[j * nx + i + 1] && inside[(j + 1) * nx + i] && inside[(j + 1) * nx + i + 1];
  const rect = (X0, Y0, X1, Y1) => [{ X: X0, Y: Y0 }, { X: X1, Y: Y0 }, { X: X1, Y: Y1 }, { X: X0, Y: Y1 }];
  // 每行连续的格子并成一个长方形，再求并，得到方格区的边界
  const rects = paths();
  let cells = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1;) {
      if (!cell(i, j)) { i++; continue; }
      const s = i;
      while (i < nx - 1 && cell(i, j)) {
        const [a, b] = [at(i, j), at(i + 1, j + 1)];
        m.idx.push(put(a[0], a[1]), put(b[0], a[1]), put(b[0], b[1]), put(a[0], a[1]), put(b[0], b[1]), put(a[0], b[1]));
        i++; cells++;
      }
      const Y0 = y0I + j * hI;
      rects.push(rect(x0I + s * hI, Y0, x0I + i * hI, Y0 + hI));
    }
  }
  if (!cells) { fill(contour, holes); return; }
  // 轮廓和方格区之间的一圈：按 6 格见方的块切开，各块分别三角化（整圈一起三角化会拉出横跨整边的细长三角形）。
  // 块的边、方格区的边都在格线上，上面每个格点都放一个点，相邻两块、块和方格对得上
  const band = [toPath(ccw(contour)), ...holes.map(hole => toPath(ccw(hole).reverse()))];
  const B = 6 * hI, blocks = new Set();
  for (const ring of [contour, ...holes]) for (const [x, y] of ring) {
    const bi = Math.floor((x * CS - x0I) / B), bj = Math.floor((y * CS - y0I) / B);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) blocks.add((bi + di + 2) * 1e5 + (bj + dj + 2));
  }
  const onGrid = (v, v0) => ((v - v0) % hI + hI) % hI === 0;
  const dense = path => path.flatMap((q, k) => {
    const r = path[(k + 1) % path.length], out = [[q.X / CS, q.Y / CS]];
    const vertical = q.X === r.X && onGrid(q.X, x0I), horizontal = q.Y === r.Y && onGrid(q.Y, y0I);
    if (!vertical && !horizontal) return out;
    const [a, b, v0] = vertical ? [q.Y, r.Y, y0I] : [q.X, r.X, x0I], dir = Math.sign(b - a);
    for (let v = v0 + (Math.floor((a - v0) / hI) + (dir > 0 ? 1 : 0)) * hI; dir > 0 ? v < b : v > b; v += dir * hI) {
      if (v === a) continue;
      out.push(vertical ? [q.X / CS, v / CS] : [v / CS, q.Y / CS]);
    }
    return out;
  });
  const rest = boolean('difference', band, rects);
  // 先按块的行切成横条，再在横条里切块，每次求交只碰到附近的轮廓
  const rows = new Map();
  for (const key of blocks) {
    const bi = Math.floor(key / 1e5) - 2, bj = key % 1e5 - 2;
    if (!rows.has(bj)) rows.set(bj, []);
    rows.get(bj).push(bi);
  }
  for (const [bj, bis] of rows) {
    const Y0 = y0I + bj * B, row = boolean('intersection', rest, [rect(x0I - 2 * B, Y0, x0I + nx * hI + 2 * B, Y0 + B)]);
    if (!row.length) continue;
    for (const bi of bis) {
      const X0 = x0I + bi * B, tree = boolean('intersection', row, [rect(X0, Y0, X0 + B, Y0 + B)], new (C().PolyTree)());
      for (const ep of C().JS.PolyTreeToExPolygons(tree)) fill(dense(ep.outer), ep.holes.map(dense));
    }
  }
}
