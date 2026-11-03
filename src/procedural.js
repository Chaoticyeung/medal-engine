// 程序生成的贴图：珐琅亮片、釉面瑕疵、橘皮纹、抛光金属的划痕。都是平铺的，和图案无关，按风格的参数缓存
import { newCanvas } from './paint.js';

// 固定种子的随机数，同样的参数每次生成同一张图
const lcg = seed => { let t = seed; return () => { t = (t * 16807) % 2147483647; return t / 2147483647; }; };

// 珐琅亮片法线图：随机小圆点，每个点一个随机朝向。不给 enamel.fleck 时是一张不偏的图
export function fleckCanvas({ count = 0, radius = [1, 1], spread = 0 } = {}) {
  const c = newCanvas(512);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < count; i++) {
    const v = () => 128 - spread / 2 + Math.random() * spread | 0;
    g.fillStyle = `rgb(${v()},${v()},255)`;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, radius[0] + Math.random() * (radius[1] - radius[0]), 0, Math.PI * 2); g.fill();
  }
  return c;
}

// 釉面瑕疵图，平铺在珐琅上：R 是固有色的倍数（128 为 1），G 是釉光的倍数（255 为 1）。
//   mottle   大片的深浅不匀（一次次填烧、磨平留下的）；
//   pits     砂眼：小黑点，釉面破了，没有反光；
//   grain    颗粒：成团的细小明暗点，像砂糖（珐琅料是磨碎的玻璃粉，烧成后不完全均匀）；
//   bubbles  釉下气泡：小亮圈，釉面完好
export function surfaceCanvas({ mottle, grain, pits, bubbles } = {}, seed = 3) {
  const N = 1024;
  const c = newCanvas(N);
  const g = c.getContext('2d');
  const rand = lcg(seed);
  g.fillStyle = 'rgb(128,255,0)'; g.fillRect(0, 0, N, N);
  // 跨边的图形在对边再画一次，平铺时没有接缝
  const wrapped = (x, y, r, draw) => {
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      if (x + dx + r < 0 || x + dx - r > N || y + dy + r < 0 || y + dy - r > N) continue;
      draw(x + dx, y + dy);
    }
  };
  if (mottle) {
    for (let i = 0; i < mottle.count; i++) {
      const x = rand() * N, y = rand() * N, r = mottle.radius[0] + rand() * (mottle.radius[1] - mottle.radius[0]);
      const v = (rand() * 2 - 1) * mottle.strength * 128;
      wrapped(x, y, r, (X, Y) => {
        const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
        const col = v > 0 ? '255,255,255' : '0,0,0';
        grad.addColorStop(0, `rgba(${col},${Math.abs(v) / 128})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = grad;
        g.fillRect(X - r, Y - r, 2 * r, 2 * r);
      });
    }
    // 只保留 R 的变化：把 G 拉回 255、B 拉回 0
    const img = g.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i + 1] = 255; img.data[i + 2] = 0; }
    g.putImageData(img, 0, 0);
  }
  if (grain) {
    // 先在小图上撒随机值，再放大（带平滑），颗粒约 grain.size 像素一团
    const n = Math.round(N / grain.size);
    const small = newCanvas(n);
    const sg = small.getContext('2d'), noise = sg.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = Math.round(128 + (rand() * 2 - 1) * 127);
      noise.data[i * 4] = noise.data[i * 4 + 1] = noise.data[i * 4 + 2] = v; noise.data[i * 4 + 3] = 255;
    }
    sg.putImageData(noise, 0, 0);
    const big = newCanvas(N);
    const bg = big.getContext('2d');
    bg.imageSmoothingEnabled = true;
    bg.drawImage(small, 0, 0, N, N);
    const gv = bg.getImageData(0, 0, N, N).data, img = g.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) img.data[i] = Math.max(0, Math.min(255, img.data[i] * (1 + (gv[i] - 128) / 128 * grain.strength)));
    g.putImageData(img, 0, 0);
  }
  if (bubbles) {
    for (let i = 0; i < bubbles.count; i++) {
      const x = rand() * N, y = rand() * N, r = bubbles.radius[0] + rand() * (bubbles.radius[1] - bubbles.radius[0]);
      wrapped(x, y, r, (X, Y) => {
        g.strokeStyle = `rgb(${Math.round(128 * (1 + bubbles.strength))},255,0)`;
        g.lineWidth = Math.max(0.8, r * 0.35);
        g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.stroke();
      });
    }
  }
  if (pits) {
    for (let i = 0; i < pits.count; i++) {
      const x = rand() * N, y = rand() * N, r = pits.radius[0] + rand() * (pits.radius[1] - pits.radius[0]);
      wrapped(x, y, r, (X, Y) => {
        g.fillStyle = `rgb(${Math.round(128 * (1 - pits.depth))},0,0)`;
        g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.fill();
      });
    }
  }
  return c;
}

// 橘皮纹：釉面微微起伏，只扰动釉光的反射方向（珐琅本色不动）。
// 先叠一张平铺的随机高度场（一堆高斯小丘，正负都有），再取坡度存进 RG，128 为不偏
export function peelCanvas({ count = 0, radius = [8, 24], seed = 5 } = {}) {
  const N = 256, h = new Float32Array(N * N);
  const rand = lcg(seed);
  for (let i = 0; i < count; i++) {
    const cx = rand() * N, cy = rand() * N, r = radius[0] + rand() * (radius[1] - radius[0]), a = rand() * 2 - 1;
    const R = Math.ceil(r * 2.5);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = ((Math.floor(cx) + dx) % N + N) % N, y = ((Math.floor(cy) + dy) % N + N) % N;
      h[y * N + x] += a * Math.exp(-(dx * dx + dy * dy) / (2 * r * r));
    }
  }
  let max = 1e-6;
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    gx[i] = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N];
    gy[i] = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    max = Math.max(max, Math.abs(gx[i]), Math.abs(gy[i]));
  }
  const c = newCanvas(N);
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = 128 + 127 * gx[i] / max;
    img.data[i * 4 + 1] = 128 + 127 * gy[i] / max;
    img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 抛光金属的划痕（materials.polished.scratches）：平铺的一张图，RG 是法线偏转（128 不偏），B 是发乌的程度。
//   count/length/width：细划痕的条数、长短（像素，图边长 1024）、宽；long 是几条长的；
//   haze：大片发乌（手摸过、氧化），{ count, radius, strength }；strength 是偏转的强度，scale 是平铺密度，
//   dull 是发乌处往缎面混的比例
export function scratchCanvas(s, seed = 11) {
  const N = 1024;
  const c = newCanvas(N);
  const g = c.getContext('2d');
  const rand = lcg(seed);
  g.fillStyle = 'rgb(128,128,0)'; g.fillRect(0, 0, N, N);
  const line = (x, y, a, len, w, depth) => {
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2, nx = -Math.sin(a), ny = Math.cos(a);
    // 划痕是一道细槽：两侧的坡朝相反方向。画布 y 朝下，物体 y 朝上
    for (const side of [1, -1]) {
      const R = Math.round(128 + side * nx * 127 * depth), G = Math.round(128 - side * ny * 127 * depth);
      g.strokeStyle = `rgb(${R},${G},${Math.round(90 * depth)})`;
      g.lineWidth = w / 2;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const cx = x + ox + side * nx * w / 4, cy = y + oy + side * ny * w / 4;
        if (cx + len < 0 || cx - len > N || cy + len < 0 || cy - len > N) continue;
        g.beginPath(); g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy); g.stroke();
      }
    }
  };
  const [l0, l1] = s.length ?? [10, 60];
  for (let i = 0; i < (s.count ?? 600); i++) line(rand() * N, rand() * N, rand() * Math.PI, l0 + rand() * (l1 - l0), s.width ?? 1.5, 0.3 + rand() * 0.7);
  for (let i = 0; i < (s.long ?? 0); i++) line(rand() * N, rand() * N, rand() * Math.PI, N * (0.3 + rand() * 0.5), (s.width ?? 1.5) * 1.5, 1);
  if (s.haze) {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < s.haze.count; i++) {
      const x = rand() * N, y = rand() * N, r = s.haze.radius[0] + rand() * (s.haze.radius[1] - s.haze.radius[0]);
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const X = x + ox, Y = y + oy;
        if (X + r < 0 || X - r > N || Y + r < 0 || Y - r > N) continue;
        const grad = g.createRadialGradient(X, Y, 0, X, Y, r);
        grad.addColorStop(0, `rgba(0,0,255,${s.haze.strength * rand()})`); grad.addColorStop(1, 'rgba(0,0,255,0)');
        g.fillStyle = grad; g.fillRect(X - r, Y - r, 2 * r, 2 * r);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}
