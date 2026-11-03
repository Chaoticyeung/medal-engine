// 薄壳：正面是一张曲面 z = dome(x, y)，背面平移一个壳厚；外框和金属丝高出 raise。
// 金属丝和外框平顶一起求并集，交界处是一整块金属；外框外侧另做倒角、侧壁、底边，接到背面
import { THREE } from '../three.js';
import { densifyLoop, signedArea, loopNormals, closestOnRing } from '../geom2d.js';
import { toPath, offsetPolygon, insetRing } from '../clipper.js';
import { MeshBuilder, strip, surface } from '../mesh.js';
import { domeOf, prepareOutline } from './outline.js';
import { buildWires } from './wires.js';
import { buildCord } from './cord.js';
import { buildRelief } from '../relief.js';

const UP = () => new THREE.Vector3(0, 0, 1);

export function buildShell(style, design) {
  const f = style.form;
  const { dome, domeNormal } = domeOf(f.sphere);
  const { outline, extent, uvScale, ctx } = prepareOutline(f, design);
  // 镂空（可选）：design.holes(ctx) 给若干闭合轮廓，正面、背面在这里开孔，孔壁从正面直通背面。
  // 盖在上面的浮雕要在自己的 holes 里挖同样的孔
  const holes = (design.holes?.(ctx) || []).map(h => {
    const ring = densifyLoop(h, 0.005);
    return signedArea(ring) < 0 ? ring.reverse() : ring;
  });
  const holesCW = holes.map(h => [...h].reverse());
  const rowAt = (pts, h) => pts.map(([x, y]) => new THREE.Vector3(x, y, dome(x, y) + h));

  // 外框外侧：顶边往里收一个倒角，再往下到背面，底边再收一个底倒角。
  // 默认逐点沿法线往里收；外形有小于约 90° 的尖角时这样收会自交，form.sharp 打开后改用 Clipper 真正内缩，
  // 侧壁的每个点取内缩轮廓上最近的点（尖角处几个点会落到同一个角上，不自交）
  const out = loopNormals(outline, 1);
  const outward = i => new THREE.Vector3(out[i][0], out[i][1], 0);
  const sharpRing = d => densifyLoop(insetRing(outline, d), 0.002);
  const inset = d => {
    if (d === 0) return outline;
    if (!f.sharp) return outline.map((p, i) => [p[0] - out[i][0] * d, p[1] - out[i][1] * d]);
    const ring = sharpRing(d);
    return outline.map(p => closestOnRing(ring, p));
  };
  const rimTopOuter = f.sharp ? sharpRing(f.bevel) : inset(f.bevel);
  const backLoop = f.sharp ? sharpRing(f.backBevel) : inset(f.backBevel);

  const metal = new MeshBuilder(uvScale);
  const rows = [
    [rowAt(inset(f.bevel), f.raise), i => outward(i).add(UP())],
    [rowAt(outline, f.raise - f.bevel), outward],
    [rowAt(outline, -f.shell + f.backBevel), i => outward(i).sub(UP())],
    [rowAt(inset(f.backBevel), -f.shell), null],
  ];
  // 有锁边绳（form.cord）时，外沿由绳子包住，不建金属外框的侧壁和顶面
  if (!f.cord) for (let k = 0; k < rows.length - 1; k++) strip(metal, rows[k][0], rows[k + 1][0], rows[k][1]);
  // 孔壁是冲出来的断面，不抛光、也照不到多少环境光，按金属色的一半画
  metal.tone = 0.5;
  for (const ring of holes) {
    const into = loopNormals(ring, -1);
    strip(metal, rowAt(ring, 0), rowAt(ring, -f.shell), i => new THREE.Vector3(into[i][0], into[i][1], 0));
  }
  metal.tone = 1;

  // 外框顶面是"外圈 + 反向的内圈"，要和挨着外框的金属丝在同一次求并里
  const rimPieces = f.cord ? [] : [toPath(rimTopOuter), ...offsetPolygon(outline, -(f.rim - f.bevel)).map(h => toPath(h.reverse()))];
  const covered = buildWires(metal, { f, outline, ctx, strokes: design.strokes(ctx), rimPieces, outerArea: Math.abs(signedArea(rimTopOuter)), dome, domeNormal });

  // 正面：比外框内沿多铺一点，接缝藏在外框侧壁下面
  const face = new MeshBuilder(uvScale);
  for (const poly of offsetPolygon(outline, -(f.rim - 0.012))) {
    surface(face, densifyLoop(poly, 0.02), holesCW, (x, y) => [new THREE.Vector3(x, y, dome(x, y)), domeNormal(x, y)], 0.04);
  }
  const back = new MeshBuilder(uvScale);
  surface(back, backLoop, holesCW, (x, y) => [new THREE.Vector3(x, y, dome(x, y) - f.shell), domeNormal(x, y).negate()], 0.04);

  const reliefs = (design.reliefs?.(ctx) || []).map(r => buildRelief(r, f, dome, domeNormal, uvScale));
  const cord = f.cord ? buildCord(outline, f, dome) : null;
  return { metal: metal.geometry(), face: face.geometry(), back: back.geometry(), reliefs, covered, ctx, uvScale, cord, extent };
}
