// 贴图绘制：图案给的分区、回调画到画布上，着色器再按通道去取。
// 坐标换算交给图案：px、py 把图案坐标换成画布像素，unit 是一个长度单位多少像素
import { boxBlur } from './relief.js';

export function newCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// 正面坐标的画布：图案坐标 (x, y) 按 uvScale 放进 [0, 1] 的 UV，再乘边长
export function planar(size, uvScale) {
  const c = newCanvas(size);
  return { c, g: c.getContext('2d'), px: x => (x * uvScale + 0.5) * size, py: y => (0.5 - y * uvScale) * size, unit: uvScale * size };
}
// 背面的图是从背后看的：之后画的东西左右翻过来
const mirror = (g, size) => { g.translate(size, 0); g.scale(-1, 1); };
const rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
const grey = v => `rgb(${v},${v},${v})`;
const byte = (v, k = 255) => Math.round(Math.max(0, Math.min(255, v * k)));

export function trace(g, poly, px, py) {
  g.beginPath();
  poly.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
}
export const fillPoly = (g, poly, px, py) => { trace(g, poly, px, py); g.fill(); };

// ---------- 正面和背面 ----------

// 正面贴图：RGB 是珐琅色，A=1 是珐琅、A=0 是缎面金属。分区按图案给的多边形填，shade 把颜色整体调深调浅；
// 给了 stroke 就沿折线画一道这么宽的线（画在釉里的纹路，不是金属丝），opacity 是这道线的浓淡
// 贴图边长默认 2048；画心这类细的画面可以由图案用 textureSize 调大
export function paintFace(design, ctx, uvScale, colors, size = design.textureSize || 2048) {
  const { c, g, px, py, unit } = planar(size, uvScale);
  g.clearRect(0, 0, size, size);
  for (const r of design.regions(ctx)) {
    if (r.material === 'enamel') {
      g.fillStyle = rgb((Array.isArray(r.color) ? r.color : colors[r.color]).map(v => Math.min(1, v * (r.shade ?? 1))));
      g.globalCompositeOperation = 'source-over';
    } else {
      g.fillStyle = '#000';
      g.globalCompositeOperation = 'destination-out';
    }
    g.globalAlpha = r.opacity ?? 1;
    trace(g, r.polygon, px, py);
    if (r.stroke) { g.lineWidth = r.stroke * uvScale * size; g.lineCap = 'round'; g.strokeStyle = g.fillStyle; g.stroke(); }
    else g.fill();
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = 'source-over';
  // paint：图案自己在珐琅层上画（渐变、模糊过渡、细笔触），坐标换算交给它。只能画珐琅（不透明），
  // 要露出金属的地方仍然用 regions
  design.paint?.(g, { px, py, unit, colors, ctx });
  return c;
}

// 正面的光泽倍数图：R 通道 128 是 1 倍。分区给了 gloss 就按它填（丝印、阻焊、露出的基材各有各的光泽），
// 图案还可以用 paintGloss 自己画。只在用到时才建
export function paintFaceParams(design, ctx, uvScale, size = 1024) {
  const { c, g, px, py, unit } = planar(size, uvScale);
  g.fillStyle = grey(128); g.fillRect(0, 0, size, size);
  for (const r of design.regions(ctx)) {
    if (r.gloss === undefined) continue;
    g.fillStyle = grey(byte(r.gloss, 128));
    trace(g, r.polygon, px, py);
    if (r.stroke) { g.lineWidth = r.stroke * uvScale * size; g.lineCap = 'round'; g.strokeStyle = g.fillStyle; g.stroke(); } else g.fill();
  }
  design.paintGloss?.(g, { px, py, unit, ctx });
  return c;
}

// 正面坐标上的一张图，先涂黑再交给 draw(g, m)：自发光（design.emissive）、另一个空间的遮罩（design.portal.mask）
export function paintFaceMap(draw, ctx, uvScale, size = 1024) {
  const m = planar(size, uvScale);
  return paintEmissive(draw, { c: m.c, g: m.g, px: m.px, py: m.py, unit: m.unit, ctx });
}

// 背面的彩色层：back.paint 自由画（阻焊、丝印、焊盘这类多种颜色），A=0 处露出背面金属。坐标是从背后看的
export function paintBackColor(design, uvScale, colors, size = 2048) {
  const { c, g, px, py, unit } = planar(size, uvScale);
  mirror(g, size);
  design.back.paint(g, { px, py, unit, colors });
  return c;
}

// 背面文字遮罩。从背后看 x 是反的，所以水平镜像。风格给了 backText.ink 时文字是印上去的这种颜色（贴纸的背面），否则是更亮的反光面。
// lines 是一行行文字 { text, x, y, size, weight, font }，glyphs 是字形轮廓 { rings, x, y, size }，
// strokes 是折线 { pts, width }，boxes 是款识外面的方框 [中心 x, 中心 y, 宽, 高, 线宽]
export function paintBack(design, style, uvScale, size = 2048) {
  const { c, g, px, py, unit } = planar(size, uvScale);
  const back = design.back || {};
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  mirror(g, size);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const line of back.lines || []) {
    g.font = `${line.weight || 400} ${line.size * unit}px ${line.font || style.backText.font}`;
    g.fillText(line.text, px(line.x || 0), py(line.y));
  }
  for (const { rings, x, y, size: em } of back.glyphs || []) {
    g.beginPath();
    for (const ring of rings) ring.forEach(([u, v], i) => (i ? g.lineTo(px(x + u * em), py(y + v * em)) : g.moveTo(px(x + u * em), py(y + v * em))));
    g.fill('nonzero');
  }
  g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineCap = 'round';
  for (const { pts, width } of back.strokes || []) {
    g.lineWidth = width * unit;
    trace(g, pts, px, py);
    g.stroke();
  }
  for (const [x, y, w, h, lw] of back.boxes || []) {
    g.lineWidth = lw * unit;
    g.strokeRect(px(x - w / 2), py(y + h / 2), w * unit, h * unit);
  }
  return c;
}

// ---------- 浮雕 ----------

// 浮雕的贴图都按浮雕的外框取坐标（背面浮雕是从背后看的坐标）
export function reliefCanvas(rf, size = 2048) {
  const [x0, y0, w, h] = rf.box;
  const c = newCanvas(size, Math.round(size * h / w));
  const px = x => (x - x0) / w * c.width, py = y => (1 - (y - y0) / h) * c.height;
  return { c, g: c.getContext('2d'), px, py, unit: c.width / w };
}

// 嵌珐琅：RGB 是珐琅色，A=1 是珐琅、A=0 是金属。每块嵌釉 { polygon, color }，之后 relief.paint 自由画
export function paintInlay(rf, colors, size = 2048) {
  const { c, g, px, py } = reliefCanvas(rf, size);
  for (const inl of rf.relief.inlays || []) {
    g.fillStyle = rgb(Array.isArray(inl.color) ? inl.color : colors[inl.color]);
    fillPoly(g, inl.polygon, px, py);
  }
  rf.relief.paint?.(g, { px, py, unit: c.width / rf.box[2], colors });
  return c;
}

// 嵌釉的透明度：R 通道 0～255 对应 0～1。透明珐琅透出下面金属的反光（金属的起伏、刻纹都看得见），
// 颜色 = 珐琅色 × 下层金属的亮度；不透明珐琅只看珐琅自己。每块嵌釉可单独给 translucent，否则用浮雕的 translucent
export function paintInlayParams(rf) {
  const { c, g, px, py } = reliefCanvas(rf, 1024);
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  for (const inl of rf.relief.inlays || []) {
    g.fillStyle = grey(Math.round(255 * Math.max(0, Math.min(1, inl.translucent ?? rf.relief.translucent ?? 0))));
    fillPoly(g, inl.polygon, px, py);
  }
  return c;
}

// 嵌釉的光泽倍数：R 通道 128 是 1 倍。每块嵌釉可给 gloss，图案还可以用 paintGloss 逐点画（氧化膜全哑、漆半哑这类）
export function paintInlayGloss(rf) {
  const { c, g, px, py, unit } = reliefCanvas(rf, 1024);
  g.fillStyle = grey(128); g.fillRect(0, 0, c.width, c.height);
  for (const inl of rf.relief.inlays || []) {
    if (inl.gloss === undefined) continue;
    g.fillStyle = grey(byte(inl.gloss, 128));
    fillPoly(g, inl.polygon, px, py);
  }
  rf.relief.paintGloss?.(g, { px, py, unit });
  return c;
}

// 贝（螺钿）的贴图：R=1 是贝，G 是这一片贝的光程偏移（嵌釉的 shell 给 0～1），每片贝颜色各不相同
export function paintInlayShell(rf) {
  const { c, g, px, py } = reliefCanvas(rf, 1024);
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  for (const inl of rf.relief.inlays || []) {
    if (inl.shell === undefined) continue;
    g.fillStyle = `rgb(255,${Math.round(255 * Math.max(0, Math.min(1, inl.shell)))},0)`;
    fillPoly(g, inl.polygon, px, py);
  }
  return c;
}

// 金粉的强弱图：R 通道 0～255 对应 0～1，由图案的 powder.paint 画（平莳绘满、高莳绘的推光顶面弱、研出没有）
export function paintPowder(rf) {
  const { c, g, px, py, unit } = reliefCanvas(rf, 1024);
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  rf.relief.powder.paint(g, { px, py, unit });
  return c;
}

// 浮雕里分区的金属色（可选，relief.paintMetal）：图案在透明画布上画，A>0 的地方用画的颜色（线性值，和 metals 一样）代替浮雕的金属色，
// A=0 的地方仍是 relief.metal 或页面上选的金属。一块浮雕里就能有金、青金、银几种金属，磨损、凹处积灰、抛光照旧
export function paintMetalMap(rf) {
  const { c, g, px, py, unit } = reliefCanvas(rf, 2048);
  g.clearRect(0, 0, c.width, c.height);
  rf.relief.paintMetal(g, { px, py, unit });
  return c;
}

// 自发光贴图（正面或浮雕都可以有）：黑色是不发光，颜色是发出的光，着色时直接加上、不乘环境
export function paintEmissive(draw, m) {
  const { c, g } = m;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  draw(g, m);
  return c;
}

// 刺绣的针迹图：relief.stitch(g, m) 逐点写（见 shading/thread.js），可以返回 { phase }
export function paintStitch(rf, pixel) {
  const m = reliefCanvas(rf, rf.relief.stitchSize ?? 2048);
  const ret = rf.relief.stitch(m.g, { ...m, pixel });
  return { canvas: m.c, phase: ret?.phase };
}

// ---------- 瓷器和外壳 ----------

// 按物体坐标的 xy 平铺的一张图，背面从背后看（左右翻过来）。先涂 base，再交给 draw(g, { px, py, unit, size })
function bodyMap(draw, side, uvScale, size, base) {
  const { c, g, px, py, unit } = planar(size, uvScale);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  if (side === 'back') mirror(g, size);
  draw?.(g, { px, py, unit, size });
  return c;
}

// 瓷器的两张图（可选，design.ceramicMaps = { front(g, m), back(g, m) }）：
// R 是有没有釉（255 有釉，0 露胎：芝麻钉、磨薄的足端），G 是刻深（0 不刻，255 最深，烧成后镌刻，刀口穿透釉层），
// B 是压暗（棕眼、黑点），A 不用。底色是有釉、不刻、不压暗
export const paintCeramicMap = (design, side, uvScale, size = 2048) => bodyMap(design.ceramicMaps?.[side], side, uvScale, size, 'rgb(255,0,0)');

// 开片图（可选，design.crackle = { size, front(g, m), back(g, m) }）：
// R 是缝，G 是缝的走向（0～π 对应 0～255），B 是裂面倾斜（128 竖直，0 和 255 是 ±crackle.tilt 弧度）。底色全黑（没有缝）
export const paintCrackleMap = (design, side, uvScale) => bodyMap(design.crackle[side], side, uvScale, design.crackle.size || 2048, '#000');

// 外壳的磨砂图（form.body 时用，design.shellMaps = { front(g, m), back(g, m) }）：
// R 是磨砂（0 抛光透明，255 磨砂）。底色全是抛光；分模线以上取 front、以下取 back
export const paintShellMap = (design, side, uvScale, size = 2048) => bodyMap(design.shellMaps?.[side], side, uvScale, size, '#000');

// ---------- 特效用的图 ----------

// 自发光照到附近（output.spill）：正面和正面浮雕的自发光贴图拼到正面 UV 上、模糊 radius
export function paintSpill(spill, uvScale, sources, size = 256) {
  const { c, g, px, py } = planar(size, uvScale);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  for (const { canvas, box } of sources) {
    if (!box) { g.drawImage(canvas, 0, 0, size, size); continue; }
    const [x0, y0, w, h] = box;
    g.drawImage(canvas, px(x0), py(y0 + h), w * uvScale * size, h * uvScale * size);
  }
  const img = g.getImageData(0, 0, size, size), r = Math.max(1, Math.round(spill.radius * uvScale * size / 1.7));
  for (let ch = 0; ch < 3; ch++) {
    let v = new Float32Array(size * size);
    for (let k = 0; k < v.length; k++) v[k] = img.data[k * 4 + ch];
    for (let pass = 0; pass < 3; pass++) v = boxBlur(v, size, size, r);
    for (let k = 0; k < v.length; k++) img.data[k * 4 + ch] = Math.min(255, v[k]);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 地面投影的遮罩（design.groundMask(g, m)）：边长 M、覆盖 ±E 的方形，R 不透光的部分、G 外形、B 外形边上一圈
export function paintGroundMask(design, M, E) {
  const c = newCanvas(M), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, M, M);
  design.groundMask(g, { px: x => (x / E / 2 + 0.5) * M, py: y => (0.5 - y / E / 2) * M, unit: M / (2 * E) });
  return c;
}
