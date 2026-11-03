// 示例风格"工作室"：一枚小珐琅章，黄铜或银的外框和金属丝，正面微微拱起。
// 一个风格要给全下面这些项（引擎没有默认的风格），各项的意思见 docs/OPTIONS.md。长度单位：外形外接圆半径取 1
export default {
  name: '工作室',

  form: {
    sphere: 3.2, shell: 0.06, raise: 0.024, bevel: 0.005, backBevel: 0.01,
    rim: 0.06, fillet: 0.005, wires: { main: 0.045, thin: 0.03 },
    pivotDepth: 0.03,
  },

  // 金属色、珐琅色都是线性值（0～1），着色器直接拿去乘
  metals: { 黄铜: [0.8, 0.56, 0.26], 银: [0.82, 0.83, 0.85] },
  defaultMetal: '黄铜',
  palette: { 朱红: [0.62, 0.06, 0.04], 靛青: [0.04, 0.09, 0.3], 墨绿: [0.03, 0.18, 0.1], 象牙: [0.8, 0.74, 0.6] },
  swatches: ['朱红', '靛青', '墨绿'],

  // 颜色 = (环境亮度^k × diffuse + ambient) × 固有色，环境亮度取 channel 通道（r 柔、g 硬）
  materials: {
    polished: { channel: 'g', k: 2.4, diffuse: 1.7, ambient: 0.1 },
    satin: { channel: 'r', k: 1.3, diffuse: 0.95, ambient: 0.18 },
    enamel: {
      channel: 'r', k: 1.1, diffuse: 0.5, ambient: 0.5,
      gloss: { channel: 'g', k: 4, facing: 0.04, grazing: 0.6 },
      surface: { scale: 2, grain: { size: 3, strength: 0.06 } },
    },
    back: { channel: 'r', envScale: 0.8, k: 2, diffuse: 1.4, ambient: 0.12 },
    backText: { channel: 'g', k: 2, diffuse: 1.8, ambient: 0.15, multiply: true },
  },

  // 普通镜面反射；环境不转
  reflection: { model: 'mirror', envRotation: { x: 0, y: 0 } },
  camera: { fov: 24, distance: 5.4 },

  // 环境：仰角从 90° 到 −90° 等分的底色（这里 7 个点，每 30° 一个），加几个椭圆光斑 [方位, 仰角, 方位半宽, 仰角半宽] 和亮度。
  // 方位 0° 是镜头身后（正对时正面反射到这里），正值往右
  env: {
    kind: 'fit',
    r: {
      base: [0.75, 0.7, 0.6, 0.42, 0.26, 0.2, 0.22],
      blobs: [-35, 30, 30, 16, 60, 10, 35, 22, 180, 0, 50, 40],
      amp: [0.45, 0.25, -0.15],
    },
    g: {
      base: [0.7, 0.62, 0.45, 0.25, 0.12, 0.08, 0.1],
      blobs: [-35, 30, 18, 9, 55, 5, 12, 20, 0, -40, 60, 10],
      amp: [0.85, 0.55, 0.2],
      // 长方形柔光箱 [方位, 仰角, 方位半宽, 仰角半宽, 羽化, 亮度]：抛光金属里映出边缘清楚的一块
      rects: [[20, 45, 25, 8, 3, 0.5]],
    },
  },

  motion: {
    rate: 3, magnetic: 12, velocityForce: 0.6, velocityPower: 1, drag: 3.6, unsticking: 0.5,
    flipImpulse: 14, introSpin: 28,
  },

  backText: { font: '"Noto Sans SC", "Source Han Sans SC", sans-serif' },
  background: [0.06, 0.06, 0.07],
  output: { supersample: 1.5, maxPixelRatio: 3, colorSpace: 'srgb' },
};
