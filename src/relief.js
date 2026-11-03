// 高度场浮雕：图案在网格上叠形状、刻槽、起线，引擎按它生成浮雕曲面和着色用的高度图
import { THREE } from './three.js';
import { densifyLoop, signedArea, loopNormals } from './geom2d.js';
import { MeshBuilder, strip, surface } from './mesh.js';

// 高度场：图案在网格上叠形状、刻槽、起线，引擎按它生成浮雕曲面。
// 槽和起线各存一层，重叠时取最深、最高，不累加（两道刻线交叉处不会刻穿）
export class HeightField {
  constructor(x0, y0, x1, y1, step) {
    Object.assign(this, { x0, y0, step, nx: Math.ceil((x1 - x0) / step) + 1, ny: Math.ceil((y1 - y0) / step) + 1 });
    const n = this.nx * this.ny;
    this.h = new Float32Array(n); this.cut = new Float32Array(n); this.bump = new Float32Array(n);
    this.dirty = true;
  }
  each(fn) {
    for (let j = 0, k = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++, k++) fn(this.x0 + i * this.step, this.y0 + j * this.step, k);
  }
  add(fn) { this.dirty = true; this.each((x, y, k) => { this.h[k] += fn(x, y); }); return this; }
  max(fn) { this.dirty = true; this.each((x, y, k) => { this.h[k] = Math.max(this.h[k], fn(x, y)); }); return this; }
  map(fn) { this.dirty = true; this.each((x, y, k) => { this.h[k] = fn(x, y, this.h[k], k); }); return this; }
  // 多边形内为 1、外为 0，再模糊 radius：边上是 0.5，往里平滑地升到 1。做平滑的碗、平滑的收边用
  mask(poly, radius) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const m = new Float32Array(this.nx * this.ny);
    // 逐行扫描：求这一行和各条边的交点，排序后两两之间填满（奇偶规则，和逐点判断结果一样）
    for (let j = 0; j < this.ny; j++) {
      const y = this.y0 + j * this.step;
      if (y < y0 || y > y1) continue;
      const xs = [];
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const [xi, yi] = poly[i], [xk, yk] = poly[k];
        if ((yi > y) !== (yk > y)) xs.push((xk - xi) * (y - yi) / (yk - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.floor((xs[q] - this.x0) / this.step) + 1), i1 = Math.min(this.nx - 1, Math.ceil((xs[q + 1] - this.x0) / this.step) - 1);
        m.fill(1, j * this.nx + i0, j * this.nx + i1 + 1);
      }
    }
    const r = Math.max(1, Math.round(radius / this.step / 1.7));
    return boxBlur(boxBlur(boxBlur(m, this.nx, this.ny, r), this.nx, this.ny, r), this.nx, this.ny, r);
  }
  // 沿折线：t 是到中心线的距离占半宽的比例，profile 给出这一点的量
  line(pts, width, layer, amount) {
    this.dirty = true;
    const r = width / 2, s = this.step;
    for (let q = 1; q < pts.length; q++) {
      const [ax, ay] = pts[q - 1], [bx, by] = pts[q];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - this.x0) / s)), i1 = Math.min(this.nx - 1, Math.ceil((Math.max(ax, bx) + r - this.x0) / s));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - this.y0) / s)), j1 = Math.min(this.ny - 1, Math.ceil((Math.max(ay, by) + r - this.y0) / s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * s, y = this.y0 + j * s;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        const d = Math.hypot(x - ax - u * dx, y - ay - u * dy);
        if (d >= r) continue;
        const v = amount * Math.sqrt(1 - (d / r) ** 2), k = j * this.nx + i;
        if (v > layer[k]) layer[k] = v;
      }
    }
    return this;
  }
  groove(pts, width, depth) { return this.line(pts, width, this.cut, depth); }
  ridge(pts, width, height) { return this.line(pts, width, this.bump, height); }
  result() {
    if (this.dirty) {
      this.out = this.h.map((v, k) => v - this.cut[k] + this.bump[k]);
      this.dirty = false;
    }
    return this.out;
  }
  sample(x, y) {
    const H = this.result();
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / this.step)), fy = Math.max(0, Math.min(this.ny - 1.001, (y - this.y0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * this.nx + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + this.nx] * (1 - u) + H[k + this.nx + 1] * u) * v;
  }
}

// 高度图的多级纹理：每级长宽减半（向下取整，和 WebGL 的要求一致），2×2 平均。
// 法线仍按第 0 级的格距求差分，在模糊过的级上就是模糊后高度的坡度
export function heightMips(data, nx, ny) {
  const out = [{ data, width: nx, height: ny }];
  let src = data, w = nx, h = ny;
  while (w > 1 || h > 1) {
    const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), d = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) {
      const j0 = Math.min(2 * j, h - 1) * w, j1 = Math.min(2 * j + 1, h - 1) * w;
      for (let i = 0; i < W; i++) {
        const i0 = Math.min(2 * i, w - 1), i1 = Math.min(2 * i + 1, w - 1);
        for (let c = 0; c < 2; c++) d[(j * W + i) * 2 + c] = (src[(j0 + i0) * 2 + c] + src[(j0 + i1) * 2 + c] + src[(j1 + i0) * 2 + c] + src[(j1 + i1) * 2 + c]) / 4;
      }
    }
    out.push({ data: d, width: W, height: H });
    src = d; w = W; h = H;
  }
  return out;
}

export function boxBlur(src, nx, ny, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < ny; j++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[j * nx + Math.min(nx - 1, Math.max(0, i))];
    for (let i = 0; i < nx; i++) {
      tmp[j * nx + i] = acc / (2 * r + 1);
      acc += src[j * nx + Math.min(nx - 1, i + r + 1)] - src[j * nx + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(ny - 1, Math.max(0, j)) * nx + i];
    for (let j = 0; j < ny; j++) {
      out[j * nx + i] = acc / (2 * r + 1);
      acc += tmp[Math.min(ny - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
    }
  }
  return out;
}

// 一块浮雕：图案给外轮廓 outline（可带内孔 holes，做环形的框）、在 build(field) 里堆出高度场，可带嵌珐琅 inlays（多边形填色）和 paint（自由画）。
// side: 'back' 放在背面：坐标照背面文字的习惯，是从背后看的（左右和正面相反），往 −z 长、法线朝后。
// 侧壁往下伸 wallDepth（默认 0.012）；wall: false 不做侧壁（和别的浮雕边挨边、靠高度差遮住时用）。
// 曲面网格只管大形；细的刻线、凹凸在着色器里按高度图逐像素算法线，所以网格不用很密。
// 高度图第二个通道是"凹度"（本点比周围低多少），着色时凹处压暗、转缎面，像铸件打磨后高处亮、低处留暗。
// 可选：patina 是凹处颜色的倍数（旧鎏金凹处积的褐色），grain/grainScale 是凹处细麻面的强弱和密度；
// envScale 是这块浮雕看到的环境亮度倍数（'back' 取背面材质的）；嵌釉的光泽倍数见 paintInlayGloss。
// glassTop: true 时嵌釉的釉光用不带高度图扰动的曲面法线（面釉磨平，倒影完整），下面金属和透明珐琅透出的反光仍跟着刻纹；
// prefilter: true 时高度图带多级纹理，缩小到比屏幕像素还细的刻纹被平均掉，不出摩尔纹（见 heightMips）
export function buildRelief(r, f, dome, domeNormal, uvScale) {
  const backSide = r.side === 'back';
  const flip = backSide ? ([x, y]) => [-x, y] : p => p;
  const xs = r.outline.map(p => p[0]), ys = r.outline.map(p => p[1]), pad = 0.02;
  const [x0, y0, x1, y1] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const field = new HeightField(x0, y0, x1, y1, r.step ?? 0.0012);
  r.build(field);
  const H = field.result(), { nx, ny } = field;
  const blur = boxBlur(H, nx, ny, Math.max(1, Math.round((r.cavityRadius ?? 0.01) / field.step)));
  const data = new Float32Array(nx * ny * 2);
  for (let k = 0; k < nx * ny; k++) { data[2 * k] = H[k]; data[2 * k + 1] = H[k] - blur[k]; }

  // inside：放进厚盒里的浮雕（form.body），平放在 z = inside 处，侧壁从顶面往下伸 wallDepth
  const base = r.inside ?? r.raise ?? f.raise;
  const m = new MeshBuilder(uvScale);
  // 网格在物体坐标里建，高度按图案坐标（背面要左右翻回去）取
  const top = backSide
    ? (x, y) => new THREE.Vector3(x, y, dome(x, y) - f.shell - base - field.sample(-x, y))
    : (x, y) => new THREE.Vector3(x, y, dome(x, y) + base + field.sample(x, y));
  const normal = backSide ? (x, y) => domeNormal(x, y).negate() : domeNormal;
  let outline = densifyLoop(r.outline.map(flip), 0.004);
  if (signedArea(outline) < 0) outline.reverse();
  const holes = (r.holes || []).map(h => {
    const ring = densifyLoop(h.map(flip), 0.004);
    return signedArea(ring) > 0 ? ring.reverse() : ring;
  });
  // 浮雕的顶点高度只按网格插值，转动时细纹会跟着插值误差错位；方格按 maxEdge / √2 铺，比旧的整块切分更贴近曲面
  surface(m, outline, holes, (x, y) => [top(x, y), normal(x, y)], (r.maxEdge ?? 0.006) / Math.SQRT2);
  if (r.wall !== false) {
    const depth = r.wallDepth ?? 0.012;
    const foot = (x, y) => new THREE.Vector3(x, y, backSide ? dome(x, y) - f.shell + depth : r.inside === undefined ? dome(x, y) - depth : base - depth);
    const out = loopNormals(outline, 1);
    const wall = (ring, hint) => strip(m, ring.map(([x, y]) => top(x, y)), ring.map(([x, y]) => foot(x, y)), hint);
    wall(outline, i => new THREE.Vector3(out[i][0], out[i][1], 0));
    // 内孔的侧壁朝孔里
    for (const ring of holes) {
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      wall(ring, i => new THREE.Vector3(cx - ring[i][0], cy - ring[i][1], 0));
    }
  }
  return { geometry: m.geometry(), box: [x0, y0, x1 - x0, y1 - y0], nx, ny, data, relief: r, backSide };
}
