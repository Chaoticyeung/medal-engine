// 厚盒（可选，form.body = { depth, top, bottom, steps, maxEdge }）：注塑件那样的一整块。正面是 form.sphere 的拱面（中心 z = 0），
// 背面平（z = −depth），侧面上下两道圆角，半径 top、bottom。整件用外壳材质（见 shading/shell.js），没有金属外框、金属丝和背板，
// 正面、金属、背面三份几何留空。浮雕给 inside: z 的放进壳里（平放在 z 处，不贴拱面），只画进内部那一遍
import { THREE } from '../three.js';
import { loopNormals } from '../geom2d.js';
import { MeshBuilder, surface, emptyGeometry } from '../mesh.js';
import { buildRelief } from '../relief.js';
import { domeOf, prepareOutline } from './outline.js';

export function buildBody(style, design) {
  const f = style.form, b = f.body, steps = b.steps ?? 10;
  const { dome, domeNormal } = domeOf(f.sphere);
  const { outline, uvScale, ctx } = prepareOutline(f, design);
  const out = loopNormals(outline, 1);
  const ring = d => outline.map((p, i) => [p[0] - out[i][0] * d, p[1] - out[i][1] * d]);
  const m = new MeshBuilder(uvScale);
  // 一排排截面上的点，每点带自己的法线，相邻两排连成带子
  const rows = [];
  const topIn = ring(b.top), botIn = ring(b.bottom), zb = -b.depth;
  for (let k = 0; k <= steps; k++) {
    const a = k / steps * Math.PI / 2, d = b.top * Math.sin(a);
    rows.push(topIn.map(([x, y], i) => [
      new THREE.Vector3(x + out[i][0] * d, y + out[i][1] * d, dome(x, y) - b.top * (1 - Math.cos(a))),
      domeNormal(x, y).multiplyScalar(Math.cos(a)).add(new THREE.Vector3(out[i][0], out[i][1], 0).multiplyScalar(Math.sin(a))).normalize(),
    ]));
  }
  for (let k = 0; k <= steps; k++) {
    const a = k / steps * Math.PI / 2, d = b.bottom * Math.cos(a);
    rows.push(botIn.map(([x, y], i) => [
      new THREE.Vector3(x + out[i][0] * d, y + out[i][1] * d, zb + b.bottom * (1 - Math.sin(a))),
      new THREE.Vector3(out[i][0] * Math.cos(a), out[i][1] * Math.cos(a), -Math.sin(a)).normalize(),
    ]));
  }
  for (let k = 0; k + 1 < rows.length; k++) {
    const base = m.count;
    for (const [p, q] of [...rows[k], ...rows[k + 1]]) m.vert(p, q);
    m.band(base, outline.length);
  }
  surface(m, topIn, [], (x, y) => [new THREE.Vector3(x, y, dome(x, y)), domeNormal(x, y)], b.maxEdge ?? 0.03);
  surface(m, botIn, [], (x, y) => [new THREE.Vector3(x, y, zb), new THREE.Vector3(0, 0, -1)], b.maxEdge ?? 0.03);
  const UP = new THREE.Vector3(0, 0, 1);
  const reliefs = (design.reliefs?.(ctx) || []).map(r => r.inside === undefined
    ? buildRelief(r, f, dome, domeNormal, uvScale) : buildRelief(r, f, () => 0, () => UP, uvScale));
  return { metal: emptyGeometry(), face: emptyGeometry(), back: emptyGeometry(), reliefs, covered: false, ctx, uvScale, cord: null, body: m.geometry() };
}
