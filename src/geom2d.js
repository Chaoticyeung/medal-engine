// 二维工具：折线、多边形的生成和加密、法线、最近点。图案文件也用（unit、arcPts、quadPts、regularPolygon、roundCorners）

export function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

export function arcPts(cx, cy, rx, ry, a0, a1, n = 64) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return p;
}

export function quadPts(p0, c, p1, n = 32) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    p.push([s * s * p0[0] + 2 * s * t * c[0] + t * t * p1[0], s * s * p0[1] + 2 * s * t * c[1] + t * t * p1[1]]);
  }
  return p;
}

// 正多边形顶点，从 rotation 角开始逆时针
export function regularPolygon(n, R, rotation = Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => {
    const a = rotation + i * 2 * Math.PI / n;
    return [R * Math.cos(a), R * Math.sin(a)];
  });
}

// 多边形倒圆角：每个角用二次曲线连起来，corner 是圆角在两条边上各占的长度
export function roundCorners(vertices, corner, seg = 10) {
  const n = vertices.length, pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = vertices[(i + n - 1) % n], p1 = vertices[i], p2 = vertices[(i + 1) % n];
    const d1 = unit(p0[0] - p1[0], p0[1] - p1[1]), d2 = unit(p2[0] - p1[0], p2[1] - p1[1]);
    const a = [p1[0] + d1[0] * corner, p1[1] + d1[1] * corner], b = [p1[0] + d2[0] * corner, p1[1] + d2[1] * corner];
    pts.push(...quadPts(a, p1, b, seg));
  }
  return pts;
}

export function densifyOpen(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}

export function densifyLoop(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return out;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// 闭合轮廓每个点朝外的方向（带斜接补偿，拐角处偏移距离不缩水）。sign 为 1 时轮廓逆时针朝外
export function loopNormals(ring, sign) {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
    const e1 = unit(p[0] - a[0], p[1] - a[1]), e2 = unit(b[0] - p[0], b[1] - p[1]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const v = unit(n1[0] + n2[0], n1[1] + n2[1]);
    const miter = 1 / Math.max(0.5, v[0] * n1[0] + v[1] * n1[1]);
    return [v[0] * sign * miter, v[1] * sign * miter];
  });
}

// 闭合折线上离 p 最近的点
export function closestOnRing(ring, [x, y]) {
  let best = Infinity, bx = 0, by = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [cx, cy] = ring[(i + 1) % ring.length];
    const dx = cx - ax, dy = cy - ay, L2 = dx * dx + dy * dy || 1e-12;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const px = ax + u * dx, py = ay + u * dy, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) { best = d; bx = px; by = py; }
  }
  return [bx, by];
}

// 按 keep 把一段折线拆成若干段；闭合的先转到一个被删的点再拆
export function splitRun(pts, closed, keep) {
  const flags = pts.map(keep);
  if (flags.every(Boolean)) return [{ pts, closed }];
  let order = pts.map((_, i) => i);
  if (closed) {
    const s = flags.indexOf(false);
    order = [...order.slice(s), ...order.slice(0, s)];
  }
  const out = [];
  let cur = [];
  for (const i of order) {
    if (flags[i]) cur.push(pts[i]);
    else { if (cur.length > 2) out.push({ pts: cur, closed: false }); cur = []; }
  }
  if (cur.length > 2) out.push({ pts: cur, closed: false });
  return out;
}
