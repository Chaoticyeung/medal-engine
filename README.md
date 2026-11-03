# 勋章引擎 medal-engine

A WebGL renderer for medals, badges and small craft objects: cloisonné wire and enamel, cast and chased relief, translucent enamel over engraved metal, mother-of-pearl, gold powder, glazed ceramic with crackle, clear injection-molded plastic, and embroidered patches with merrowed edges. A *style* module sets materials, lighting, camera and the feel of the spin; a *design* module draws the outline, wires, enamel regions, reliefs and the back. Both are plain JavaScript objects, so a new look is a new pair of files rather than new engine code. Built on three.js; licensed under AGPL-3.0. Documentation below is in Chinese; option names and code are in English.

---

勋章引擎把"一枚勋章长什么样"拆成两个普通的 JS 模块：**风格**定材料、布光、相机和转动手感，**图案**定外形、金属丝、珐琅分区、浮雕和背面。引擎负责几何、贴图、着色和转动，和具体风格无关。换一种工艺，多半是写一个新风格；换一个题材，是写一个新图案。

能做的东西：

- 掐丝珐琅：球面薄壳上金属丝和外框求并集成一整块金属，丝之间填珐琅（亮片、釉面瑕疵、橘皮纹、釉光）；
- 浮雕：图案在高度场上叠形状、刻槽、起线，凹处积暗、发哑，凸处磨亮；可以嵌珐琅、透明珐琅、螺钿、金粉、分区换金属；
- 瓷器：截面绕轴转成器物，有厚度的半透明釉、刻痕填色、釉里的开片；
- 透明塑料外壳：壳里的东西先画一遍，外壳折射、吸收、磨砂；
- 刺绣章：一根根线、针脚、锁边绳都在着色器里按位置现算；
- 特效：辉光、画面颗粒、自发光外溢、地面投影、透进勋章里的另一个空间。

## 跑起来

```bash
npm install
```

```bash
python3 tools/serve.py 8000
```

然后打开 http://127.0.0.1:8000/examples/ 。拖动转，双击翻面，下面的按钮换示例、配色和金属。`examples/worker.html` 是同样的勋章放在后台线程里算和画。

`tools/serve.py` 和 `python3 -m http.server` 一样，只是每个响应都不让浏览器缓存（改了 `src/` 以后浏览器拿到新旧混杂的模块会加载失败）。任何静态服务器都可以。

## 目录

```
src/            引擎
  index.js        页面里用的入口：import 'three'，再转出 core.js 的全部接口
  core.js         全部接口，不含 three.js 的加载
  three.js        各模块从这里取 three.js（setThree）
  badge.js        createBadge：分几步把风格和图案组装成一枚能转的勋章
  geom2d.js       二维工具：折线、多边形、法线（图案文件也用）
  clipper.js      Clipper 包装：并集、内缩外扩、分组
  mesh.js         网格拼装：带子、贴着曲面的面
  geometry/       几何：薄壳和外框、金属丝、旋转体、厚盒、锁边绳
  relief.js       高度场浮雕
  paint.js        图案画的贴图（正面、背面、嵌釉、瓷、外壳……）
  procedural.js   程序生成的贴图（亮片、釉面瑕疵、橘皮纹、划痕）
  environment.js  环境图
  shading/        着色器：公共部分、本体、浮雕、瓷、外壳
  embroidery.js   刺绣和锁边绳
  effects/        辉光、颗粒、自发光外溢、地面投影、另一个空间
  motion.js       转动手感
  worker.js       后台线程里跑引擎
  offscreen.js    页面这边：把勋章交给后台线程
examples/       两个示例风格和图案、示例页面
regress/        回归测试页
docs/OPTIONS.md 每个可选项在哪设、做什么
```

## 在自己的页面里用

引擎依赖 three.js（0.170.0）和 clipper-lib（6.4.2）。three 走 `import 'three'`，用 importmap 或打包工具解析；clipper-lib 是全局脚本（`ClipperLib`）。

```html
<script src="node_modules/clipper-lib/clipper.js"></script>
<script type="importmap">{"imports":{"three":"./node_modules/three/build/three.module.js"}}</script>
<div id="stage" style="width: 600px; height: 600px"></div>
<script type="module">
import { createBadge } from './src/index.js';
import style from './examples/styles/studio.js';
import design from './examples/designs/sun-mountain.js';

const badge = await createBadge(document.getElementById('stage'), { style, design });
badge.setEnamel('朱红');
badge.setMetal('银');
</script>
```

`createBadge` 在容器里插一块画布，铺满容器、跟着窗口变大小。返回的对象有 `flip()`、`setRotation(弧度)`、`setEnamel(名字)`、`setMetal(名字)`、`state` 和 `dispose()`。同一个容器里换风格时先 `dispose()` 旧的再建新的，渲染器会接着用，不必重建 WebGL 上下文。

### 后台线程

复杂的图案（大块浮雕、刺绣）要算几秒，放在页面主线程里会卡住页面。浏览器支持把画布交给后台线程时（`canRunInWorker()`），可以这样用：

```js
// 页面
import { canRunInWorker, createWorkerBadge } from './src/offscreen.js';
const badge = createWorkerBadge(document.getElementById('stage'), {
  worker: new Worker('./my-worker.js', { type: 'module' }),
  three: './node_modules/three/build/three.module.js',
  clipper: './node_modules/clipper-lib/clipper.js',
});
const info = await badge.show({ id: 'a', style: './styles/studio.js', design: './designs/sun-mountain.js' });
```

```js
// my-worker.js
import { runBadgeWorker } from './src/worker.js';
runBadgeWorker();
```

后台线程里没有 importmap，所以 three.js 按地址加载，引擎模块除了 `index.js` 都不直接 `import 'three'`。图案文件要在后台线程里用，二维工具就从 `src/geom2d.js` 取，不要经 `index.js`。`runBadgeWorker` 可以给 `load`、`prepare`、`describe` 三个钩子，自己决定怎么按消息加载风格、建勋章前怎么改风格、`ready` 消息里带回什么，见 `src/worker.js` 开头的说明。

## 怎么写一个风格

先看两个示例，各几十行：

- `examples/styles/studio.js` + `examples/designs/sun-mountain.js`：一枚珐琅章。外形是圆，两条金属丝勾出山和日，天空是当前配色的珐琅，山是象牙色珐琅，日露出缎面金属，背面刻字。
- `examples/styles/coin.js` + `examples/designs/tree-coin.js`：一枚浮雕币，正反两面都是高度场浮雕。风格是在 studio 上改的：`{ ...studio, form: { ...studio.form, … } }`。

### 风格

风格要给全这些项（引擎没有内置的默认风格）：

- `form`：形体的尺寸。正面球面半径 `sphere`、壳厚 `shell`、外框宽 `rim`、金属丝高出多少 `raise`、倒角 `bevel` 等。长度单位是外形外接圆半径。
- `metals`、`defaultMetal`、`palette`、`swatches`：可选的金属和珐琅色，都是线性 RGB。
- `materials`：抛光金属、缎面金属、珐琅、背板、背面文字各一组 `{ channel, k, diffuse, ambient }`。颜色 = (环境亮度^k × diffuse + ambient) × 固有色。
- `env`：环境光。最常用 `kind: 'fit'`：按仰角平滑变化的底色加几个椭圆光斑，两个通道 `r`（柔，珐琅和缎面用）、`g`（硬，抛光金属用）各一套。抛光金属的质感几乎全靠它：亮的光斑在金属里映出来，暗的地方衬出轮廓。
- `reflection`、`camera`、`motion`、`backText`、`background`、`output`。

调风格的顺序一般是：先定 `env`（看抛光金属转起来时光斑扫过的样子），再定 `materials` 的系数（暗部别死黑、亮部别糊成一片），最后调 `motion` 的手感。

### 图案

- `outline(form)`：外形，一圈点。
- `strokes(ctx)`：金属丝，每笔一条中心线和线宽；或者直接给字形轮廓 `shape`。
- `regions(ctx)`：正面分区，按顺序填，`material: 'enamel'` 是珐琅，别的值露出金属。`color: 'primary'` 是页面上选的配色。
- 可选：`reliefs(ctx)` 浮雕、`back` 背面、`holes` 镂空、`paint` 自由画、`emissive` 自发光等。

`ctx` 是 `{ form, outline, extent }`。回调里画东西用 `m.px(x)`、`m.py(y)` 把图案坐标换成画布像素。

每个可选项一行的说明在 [docs/OPTIONS.md](docs/OPTIONS.md)。

## 回归测试

改引擎时用来确认画面没变：钉死动画时间（每帧时间戳相同，勋章不会自己转）、`Math.random` 每个风格开始前重设同一个种子，每个风格截正面、0.436、π 三个转角，再换成最后一个配色和最后一种金属截一张，逐像素比。

1. 改之前打开 http://127.0.0.1:8000/regress/?mode=save ，截图存进这个浏览器（IndexedDB）。
2. 改完打开 http://127.0.0.1:8000/regress/?mode=compare ，页面列出每张图的最大差和差超过 0、20 的像素数，最后一行比对整个过程中编译过的着色器源码（空白不算）。

参数：`set=名字` 存成多份；`cases=地址` 换成自己的风格清单（格式见 `regress/cases.js`）；`engine=地址` 指向另一份引擎（比对改前改后的两份副本）；`only=名字,名字` 只截其中几个；`three=`、`clipper=` 换依赖的地址。结果也放在 `window.__result`，自动化脚本可以等 `window.__done` 再取。

回归页所在的标签页要一直在前台：标签页切到后台时浏览器会暂停动画帧，回来以后截到的图可能和前台截的有几个像素不同。同一台机器、同一个浏览器上，同样的代码两次截图逐像素相同。不同显卡、不同浏览器之间不一定相同，所以基准要在同一个浏览器里存、在同一个浏览器里比。

## 许可证

AGPL-3.0，全文见 [LICENSE](LICENSE)。用这个引擎做的网站或服务对外提供时，要按 AGPL 的要求向用户提供对应的源码（包括你改过的引擎）。three.js 和 clipper-lib 是依赖，不在本仓库里，各自的许可证分别是 MIT 和 Boost。
