// 外形轮廓和正面曲面，薄壳和厚盒共用
import { THREE } from '../three.js';
import { densifyLoop, signedArea } from '../geom2d.js';

// 正面是半径 R 的球面 z = dome(x, y)，中心 z = 0；R 为 Infinity 时是平面
export function domeOf(R) {
  const dome = R === Infinity ? () => 0 : (x, y) => Math.sqrt(R * R - x * x - y * y) - R;
  const domeNormal = R === Infinity ? () => new THREE.Vector3(0, 0, 1)
    : (x, y) => new THREE.Vector3(x, y, dome(x, y) + R).normalize();
  return { dome, domeNormal };
}

// 图案的外形加密成逆时针的一圈。ctx 交给图案的 holes、strokes、reliefs、regions 等回调：{ form, outline, extent }
export function prepareOutline(form, design) {
  const outline = densifyLoop(design.outline(form), 0.005);
  if (signedArea(outline) < 0) outline.reverse();
  const extent = Math.max(...outline.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) * 1.05;
  return { outline, extent, uvScale: 0.5 / extent, ctx: { form, outline, extent } };
}
