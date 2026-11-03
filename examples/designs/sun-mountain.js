// 示例图案"山与日"：圆形外框里一座山、一轮日，金属丝勾边，天空是当前配色的珐琅，山是象牙色珐琅，日露出缎面金属。
// 图案只从 geom2d.js 取二维工具，不引 three.js，这样在后台线程里也能加载
import { arcPts } from '../../src/geom2d.js';

const R = 1;
const ridge = [[-0.95, -0.3], [-0.55, 0.05], [-0.32, -0.12], [0.05, 0.38], [0.42, -0.02], [0.6, 0.12], [0.95, -0.25]];
const sun = arcPts(0.42, 0.5, 0.17, 0.17, 0, 2 * Math.PI, 72);
// 山下面的轮廓顺着外圆走，和外框内沿相接
const mountain = [...ridge, ...arcPts(0, 0, R, R, -0.255, -Math.PI + 0.307, 48)];

export default {
  name: '山与日',
  defaultEnamel: '靛青',
  // 外形：逆时针的一圈点
  outline: () => arcPts(0, 0, R, R, 0, 2 * Math.PI, 256),
  // 金属丝：中心线和线宽（form.wires 里的名字或数字）；伸进外框的部分被外框盖住
  strokes: () => [
    { pts: ridge, width: 'main' },
    { pts: sun, width: 'main' },
    { pts: [[-0.55, 0.05], [-0.5, -0.35]], width: 'thin' },
    { pts: [[0.05, 0.38], [0.12, -0.1], [0.05, -0.5]], width: 'thin' },
  ],
  // 珐琅分区，按顺序填：先铺满天空，再盖上山，日的位置挖掉露出金属
  regions: () => [
    { polygon: arcPts(0, 0, R, R, 0, 2 * Math.PI, 256), material: 'enamel', color: 'primary' },
    { polygon: mountain, material: 'enamel', color: '象牙' },
    { polygon: sun, material: 'metal' },
  ],
  // 背面刻的字：坐标从背后看，size 是字高
  back: {
    lines: [
      { text: '山与日', y: 0.12, size: 0.2, weight: 600 },
      { text: 'MEDAL ENGINE', y: -0.14, size: 0.075, weight: 500 },
    ],
  },
};
