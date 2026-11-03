// 示例风格"铜币"：一枚浮雕币，正反两面都是高度场浮雕，没有珐琅。凹处积暗、发哑，凸处磨亮
import studio from './studio.js';

export default {
  ...studio,
  name: '铜币',
  form: { ...studio.form, sphere: 8, shell: 0.08, raise: 0.03, rim: 0.075, backBevel: 0.015, pivotDepth: 0.04 },
  metals: { 青铜: [0.6, 0.4, 0.22], 白铜: [0.74, 0.72, 0.66] },
  defaultMetal: '青铜',
  palette: {}, swatches: [],
  materials: {
    ...studio.materials,
    polished: { channel: 'g', k: 2, diffuse: 1.5, ambient: 0.12 },
    satin: { channel: 'r', k: 1.5, diffuse: 0.8, ambient: 0.14 },
    back: { channel: 'r', envScale: 1, k: 2, diffuse: 1.5, ambient: 0.12 },
  },
};
