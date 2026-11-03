# 参数说明

一枚勋章由两个模块决定：**风格**（style，材料、布光、相机、手感）和**图案**（design，外形、笔画、分区、浮雕、背面）。两者都是普通的 JS 对象，`createBadge(container, { style, design })` 读它们。

- 长度单位：外形外接圆半径取 1。图案坐标 x 向右、y 向上，原点在中心。
- 颜色：金属色、珐琅色都是线性值 `[r, g, b]`（0～1），着色器直接拿去乘，不做伽马换算。
- 着色公式：大部分材质的颜色 = (环境亮度^k × diffuse + ambient) × 固有色。环境亮度取环境图的一个通道：`r`（柔，给珐琅、缎面金属）、`g`（硬，给抛光金属）、`b`（和 r 相同，可以另配）。
- 带"回调"的项是函数，引擎调用时传 `(g, m)`：`g` 是 2D 画布上下文，`m` 里有坐标换算 `px(x)`、`py(y)`（图案坐标换成画布像素）和 `unit`（一个长度单位多少像素），有的还带 `colors`（当前配色，其中 `primary` 是选中的那种珐琅色）、`ctx`、`size`。
- 回调拿到的 `ctx` 是 `{ form, outline, extent }`：风格的 form、加密后的外形、外形的半宽（略放大）。
- "缓存"：几何和与颜色无关的贴图按图案对象、风格的某一部分缓存，页面里来回换风格不会重算。所以回调要是确定的（同样的输入画同样的图）。

表里"默认"一栏空着的是必填项。

## 风格（style）

### 顶层

| 项 | 默认 | 做什么 |
|---|---|---|
| `name` | | 名字，引擎不用 |
| `form` | | 形体，见下 |
| `metals` | | `{ 名字: [r, g, b] }`，页面上可选的金属 |
| `defaultMetal` | | 开始时的金属名 |
| `palette` | | `{ 名字: [r, g, b] }`，图案用到的珐琅色 |
| `swatches` | | 页面上可选的配色名（palette 里的名字），引擎本身不读，回归脚本和示例页用 |
| `pairs` | 无 | `{ 配色名: 金属名 }`，换到这个配色时金属跟着换 |
| `materials` | | 各材质的系数，见下 |
| `reflection` | | 反射方向，见下 |
| `camera` | | `{ fov, distance }`：竖直视角（度）、镜头到原点的距离 |
| `env` | | 环境，见下 |
| `motion` | | 转动手感，见下 |
| `backText` | | `{ font, ink }`：背面文字的默认字体（CSS 写法）；给 `ink: [r, g, b]` 时字是印上去的这种颜色，否则是比背面更亮的反光面 |
| `background` | | 画面背景色 |
| `output` | | 输出，见下 |
| `ground` | 无 | 勋章背后的地面和投影，见"特效" |

### form：形体

| 项 | 默认 | 做什么 |
|---|---|---|
| `sphere` | | 正面球面半径；`Infinity` 是平面 |
| `shell` | | 壳厚（正面到背面） |
| `raise` | | 外框、金属丝高出正面多少 |
| `bevel` | | 外框和金属丝顶边的倒角 |
| `backBevel` | | 背面边缘的倒角 |
| `rim` | | 外框宽 |
| `fillet` | | 金属丝交界处凹角的圆角半径 |
| `wires` | | `{ 名字: 线宽 }`，笔画用名字取线宽 |
| `pivotDepth` | | 转动支点在正面以下多深 |
| `sharp` | `false` | 外形有小于约 90° 的尖角时打开：外框侧壁改用真正的内缩轮廓，不自交 |
| `rimMetal` | 无 | 外框、侧壁、背板用这个固定的金属色；页面上换金属只换浮雕 |
| `cord` | 无 | 锁边绳，代替金属外框，见"刺绣" |
| `body` | 无 | 厚盒（注塑件），见"透明外壳" |
| 其他数字项 | | 笔画的 `raise`、`bevel` 可以写成 form 里的项名，比如 `raise: 'textRaise'` |

### materials：材质

`polished`（抛光金属：外框、金属丝、浮雕凸处）、`satin`（缎面金属：正面露金属处、浮雕凹处）、`enamel`（珐琅）、`back`（背板）、`backText`（背面文字）各有一组：

| 项 | 默认 | 做什么 |
|---|---|---|
| `channel` | | 取环境的哪个通道：`'r'`、`'g'`、`'b'` |
| `k` | | 环境亮度的次方，越大反差越大 |
| `diffuse` | | 环境项的倍数 |
| `ambient` | | 底亮 |
| `envScale` | 1 | 环境亮度先乘这个数 |
| `backText.multiply` | | `true` 时背面文字再乘一次环境亮度 |

珐琅另有：

| 项 | 默认 | 做什么 |
|---|---|---|
| `enamel.gloss` | 无 | 釉光：`{ channel, k, facing, grazing }`，强度 = (facing + grazing × 菲涅尔) × 环境亮度^k，不染珐琅色 |
| `enamel.fleck` | 无 | 亮片：`{ count, radius: [小, 大], spread, scale, strength }`，随机小圆点各偏一个法线方向（贴图边长 512 像素，radius 按像素） |
| `enamel.surface` | 无 | 釉面瑕疵，平铺：`scale` 平铺密度；`mottle { count, radius, strength }` 大片深浅；`grain { size, strength }` 砂糖样颗粒；`pits { count, radius, depth }` 砂眼；`bubbles { count, radius, strength }` 釉下气泡 |
| `enamel.surface.peel` | 无 | 橘皮纹，只扰动釉光：`{ count, radius, seed, scale, strength }` |

抛光金属可以有划痕：

| 项 | 默认 | 做什么 |
|---|---|---|
| `polished.scratches` | 无 | 打开划痕，平铺在外框、金属丝和浮雕上 |
| `.count` `.length` `.width` | 600、[10, 60]、1.5 | 细划痕的条数、长短和宽（像素，图边长 1024） |
| `.long` | 0 | 几条长划痕 |
| `.haze` | 无 | 大片发乌：`{ count, radius, strength }` |
| `.strength` `.scale` | 0.3、1 | 法线偏转的强度、平铺密度 |
| `.dull` | 0.6 | 发乌处往缎面混的比例 |

刺绣、瓷、外壳的材质（`materials.thread`、`materials.ceramic`、`materials.shell`）见后面各节。

### reflection：反射方向

| 项 | 默认 | 做什么 |
|---|---|---|
| `model` | | `'mirror'` 普通镜面反射；`'soft'` 用勋章背后的一台假相机算反射，绕支点按勋章转动，转动时倒影变化更慢更柔 |
| `pivot` | 0 | `soft` 模型的支点深度 |
| `envRotation` | `{ x: 0, y: 0 }` | 环境图绕 x、y 轴转多少度 |

### env：环境

| 项 | 默认 | 做什么 |
|---|---|---|
| `kind` | | `'fit'` 按方向算亮度的函数；`'strip'` 一张 6 个面竖排的立方体图 |
| `r`、`g` | | `fit` 的两个通道，各一组：`base` 从仰角 90° 到 −90° 等分的底色（Catmull-Rom 插值）；`blobs` 每 4 个数一个椭圆光斑 `[方位, 仰角, 方位半宽, 仰角半宽]`（度），`amp` 每个光斑的亮度（可为负）；`rects` 长方形柔光箱 `[方位, 仰角, 方位半宽, 仰角半宽, 羽化, 亮度]` |
| `size` | 256 | `fit` 渲染成立方体图的边长 |
| `url`、`flipFaces` | | `strip` 的图片地址；每个面上下翻转（原点在左下角的图用） |
| `tints` | 无 | 环境的颜色：每个光斑 `[方位, 仰角, 方位宽, 仰角宽, r, g, b, 强度]` 把那一片染色，反射里映出彩色灯带 |
| `tintMode` | 无 | `'reflection'` 时染色只乘随环境变的那一项，底亮不染 |
| `blur` | 无 | `[角度, …]`：几级模糊的环境，瓷和外壳的漫射、釉光用 |

方位 0° 在 +z 方向（`mirror` 模型下正对时正面反射到这里），正值往 +x。

### motion：转动手感

| 项 | 做什么 |
|---|---|
| `rate` | 拖动倍率：转角 = rate × 横向位移 / 勋章显示宽度 |
| `magnetic` | 磁吸，−sin(2θ)，只在正面和背面稳定 |
| `velocityForce`、`velocityPower` | 速度阻力 = velocityForce × \|ω\|^velocityPower |
| `unsticking` | 脱粘力，转得慢时把勋章推离侧面 |
| `drag` | 阻尼 |
| `flipImpulse` | 双击翻面时加的转速 |
| `introSpin` | 开场的转速；引擎会微调它，保证开场转完停在正面 |

### output：输出

| 项 | 默认 | 做什么 |
|---|---|---|
| `supersample` | | 按设备像素比再乘这个倍数 |
| `maxPixelRatio` | | 像素比的上限 |
| `colorSpace` | `'srgb'` | 画布的颜色空间，`'display-p3'` 时同样的数在广色域屏上更饱和 |
| `emissiveGain` | 1 | 自发光的倍数（正面、浮雕、另一个空间、外溢都乘） |
| `bloom` | 无 | 后期辉光：`{ threshold, knee, strength }`，默认 1、0.3、0.8 |
| `grain` | 无 | 画面颗粒：`{ strength, size }`，默认 0.04、1.5（像素） |
| `spill` | 无 | 自发光照到附近：`{ radius, metal, enamel }` |

## 图案（design）

### 顶层

| 项 | 默认 | 做什么 |
|---|---|---|
| `name` | | 名字，引擎不用 |
| `outline(form)` | | 外形：一圈点 `[[x, y], …]` |
| `strokes(ctx)` | | 金属丝笔画，见下；没有就返回 `[]` |
| `regions(ctx)` | | 正面分区，见下；没有就返回 `[]` |
| `defaultEnamel` | 无 | 开始时的配色名 |
| `colors` | 无 | 图案自己的颜色，覆盖风格的 palette |
| `holes(ctx)` | 无 | 镂空：若干闭合轮廓，正面背面开孔，孔壁直通 |
| `paint(g, m)` | 无 | 在正面珐琅层上自由画（渐变、细笔触），m 带 colors、ctx |
| `paintGloss(g, m)` | 无 | 正面光泽倍数图，R 通道 128 是 1 倍 |
| `textureSize` | 2048 | 正面贴图边长 |
| `emissive(g, m)` | 无 | 正面自发光图，黑色不发光 |
| `portal` | 无 | 另一个空间，见"特效" |
| `reliefs(ctx)` | 无 | 浮雕，见下 |
| `back` | 无 | 背面，见下 |
| `lathe(form)` | 无 | 旋转体（瓷器），见"瓷" |
| `ceramicMaps`、`crackle` | 无 | 瓷的刻痕、开片图，见"瓷" |
| `shellMaps` | 无 | 外壳的磨砂图，见"透明外壳" |
| `groundMask(g, m)` | 无 | 地面投影的遮罩，见"特效" |
| `cordColor(colors)` | 无 | 锁边绳的颜色跟着配色走；不给时用金属色 |

### strokes：金属丝

| 项 | 默认 | 做什么 |
|---|---|---|
| `pts` | | 中心线 `[[x, y], …]`；首尾重合就是闭合的 |
| `width` | | 线宽，数字或 `form.wires` 里的名字 |
| `cap` | 半圆头 | `'butt'` 两头平切 |
| `shape` | 无 | 直接给金属顶面的轮廓（字形），代替 pts；多个轮廓按非零规则合并 |
| `embolden` | 无 | shape 整体加粗 |
| `raise`、`bevel` | form 里的 | 这一笔的凸起和倒角，数字或 form 里的项名 |
| `tone` | 1 | 金属色的倍数 |
| `covered` | `false` | 被珐琅盖住：几何照常凸起，颜色取下面珐琅层的；`lift` 提亮倍数（默认 1.06） |

伸进外框的部分被外框盖住；同样 raise、bevel、tone 的笔画一起求并集。

### regions：正面分区

按顺序填，后填的盖住先填的。

| 项 | 默认 | 做什么 |
|---|---|---|
| `polygon` | | 轮廓，或给 stroke 时是折线 |
| `material` | | `'enamel'` 珐琅；其他值露出缎面金属（把这里挖掉） |
| `color` | | 配色名（含 `'primary'`）或 `[r, g, b]` |
| `shade` | 1 | 颜色整体乘这个数 |
| `opacity` | 1 | 浓淡 |
| `stroke` | 无 | 不填满，沿折线画一道这么宽的线 |
| `gloss` | 无 | 这一块釉光的倍数 |

### back：背面

坐标是从背后看的（左右和正面相反）。

| 项 | 做什么 |
|---|---|
| `lines` | 文字：`{ text, x, y, size, weight, font }`，size 是字高 |
| `glyphs` | 字形轮廓：`{ rings, x, y, size }`，按非零规则填 |
| `strokes` | 折线：`{ pts, width }` |
| `boxes` | 方框：`[中心 x, 中心 y, 宽, 高, 线宽]` |
| `paint(g, m)` | 背面彩色层，A=0 处露出背面金属，m 带 colors |

### reliefs：高度场浮雕

每块浮雕一个对象。高度在 `build(field)` 里堆出来，细的刻线和凹凸在着色器里按高度图逐像素算法线，网格只管大形。

| 项 | 默认 | 做什么 |
|---|---|---|
| `outline` | | 外轮廓 |
| `holes` | 无 | 内孔（做环形的框） |
| `build(field)` | | 堆高度场，见下面的 HeightField |
| `side` | 正面 | `'back'` 放在背面，坐标从背后看 |
| `raise` | `form.raise` | 浮雕底面高出正面多少 |
| `inside` | 无 | 放进厚盒里，平放在 z = inside 处（见"透明外壳"）；`oneSided` 只画朝前的一面 |
| `step` | 0.0012 | 高度场的格距 |
| `maxEdge` | 0.006 | 网格最长的边 |
| `wall`、`wallDepth` | `true`、0.012 | 侧壁和它往下伸多深 |
| `cavityRadius` | 0.01 | 算"凹度"时的模糊半径：本点比周围低多少 |
| `cavityDark` | 0.55 | 凹处压暗到多少 |
| `satinBelow` | 0.003 | 凹度低于这个数时从抛光转成缎面 |
| `patina` | `[1, 1, 1]` | 凹处颜色的倍数（积灰、旧鎏金的褐色） |
| `grain`、`grainScale` | 0、600 | 凹处细麻面的强弱和密度 |
| `wear` | 无 | 凸处磨损：`{ color, from, to }`，凸度从 from 到 to 渐变成 color |
| `metal` | 页面上选的金属 | 这块浮雕固定的金属色 |
| `paintMetal(g, m)` | 无 | 分区的金属色：透明画布上画，A>0 处用画的颜色 |
| `envScale` | 1 | 这块浮雕看到的环境亮度倍数；`'back'` 取背面材质的 |
| `scratches` | 开 | `false` 时不叠抛光划痕 |
| `prefilter` | `false` | 高度图带多级纹理，比像素还细的刻纹不出摩尔纹 |
| `inlays` | 无 | 嵌珐琅：`{ polygon, color, translucent, gloss, shell }` |
| `paint(g, m)` | 无 | 在嵌釉图上自由画，m 带 colors |
| `translucent` | 0 | 嵌釉默认的透明度：透出下面金属的反光 |
| `paintGloss(g, m)` | 无 | 嵌釉的光泽倍数图 |
| `glassTop` | `false` | 釉光用不带刻纹扰动的法线（面釉磨平） |
| `shell` | 无 | 螺钿：`{ base, strength, film: [lo, hi], bands: { scale, warp, angle }, k, diffuse, ambient }`，嵌釉给 `shell: 0～1` 的片才是贝 |
| `powder` | 无 | 金粉：`{ scale, tilt, paint(g, m) }`，一粒粒法线各偏一点 |
| `emissive(g, m)` | 无 | 浮雕的自发光图 |
| `stitch` | 无 | 这块是刺绣，见"刺绣" |

HeightField（`build` 收到的 `field`）：

| 方法 | 做什么 |
|---|---|
| `add(fn)` | 每个格点加 `fn(x, y)` |
| `max(fn)` | 每个格点取和 `fn(x, y)` 的较大值 |
| `map(fn)` | 每个格点改成 `fn(x, y, 当前高度, 下标)` |
| `mask(poly, radius)` | 返回一张遮罩（和格点一样排的数组）：多边形边上 0.5、往里平滑升到 1 |
| `groove(pts, width, depth)` | 沿折线刻槽，截面是半圆；几道槽重叠处取最深 |
| `ridge(pts, width, height)` | 沿折线起线；重叠处取最高 |
| `sample(x, y)` | 读某一点的高度 |

## 刺绣

刺绣浮雕在普通浮雕的项上再加：

| 项 | 默认 | 做什么 |
|---|---|---|
| `stitch(g, m)` | | 逐点写针迹图：`m.pixel(针法, 针向角, 针长倍数)` 给出该写的 RGBA，用 putImageData 写；可以返回 `{ phase }` 相位图让弯的缎纹沿弧长排线 |
| `stitchSize` | 2048 | 针迹图边长 |
| `threads` | 无 | 改某种针法的参数：`{ 针法: { pitch, len, shift, phi, sheen, jitter, gap } }` |
| `bump` | 1 | 高度图对法线的影响 |
| `cavityDepth` | 0.008 | 凹处压暗的深度范围 |

针法：`twill` 斜纹（底布）、`fill` 填充、`satin` 缎纹、`run` 平针、`plain` 平纹、`none` 不画线。线色画在嵌釉图里（inlays、paint）。

`materials.thread`（风格里）：`{ channel, k, diffuse, ambient, sheen: { channel, k, strength, tint } }`，默认 r、1.4、0.55、0.36，丝光 g、4、0.5、0.35。

锁边绳 `form.cord`：

| 项 | 默认 | 做什么 |
|---|---|---|
| `width` | | 绳宽 |
| `top`、`under` | 、0.004 | 顶在正面以上多少、底在背面以下多少 |
| `segments` | 28 | 截面分几段 |
| `pitch`、`slant` | 0.009、0.35 | 线距、斜绕的角度（弧度） |
| `phi`、`sheen` | 1.2、1 | 线截面法线的最大偏角、丝光倍数 |
| `gap`、`jitter`、`spacing` | 0.55、0、0 | 线缝的暗、每圈的出入、线距的起伏 |
| `fuzz`、`fuzzRim` | 0、0 | 细毛：一小段一小段的亮暗、掠射处的一圈柔光 |
| `bead`、`beadAt` | 0、0.45 | 外上侧 V 形线圈带的强弱、位置（截面角） |
| `needleAt`、`needleDark` | 2.75、0 | 内侧针眼的位置、暗度 |
| `innerDark` | 0.5 | 绳和章面相接的内侧压暗 |
| `loop` | 无 | 线圈沿绕的方向一段段的段长 |

## 瓷

图案给 `lathe(form) = { profile, segments }`：`profile` 是 `[r, z, 釉厚]` 的折线，绕 z 轴转一圈成器物，`segments` 默认 256。整件用 `materials.ceramic`：

| 项 | 默认 | 做什么 |
|---|---|---|
| `body` | | 胎色 |
| `cut` | 胎色 | 刻痕露出的颜色 |
| `ref` | | 釉色是"ref 厚、正对时"的颜色；釉色本身取当前配色 |
| `ior` | 1.5 | 釉的折射率 |
| `scatter`、`scatterPath` | 1、0.6 | 釉里散回来的光的多少和路长 |
| `channel`、`diffuse`、`ambient` | r、1、0 | 胎和釉的漫射 |
| `diffuseLevel` | 最模糊一级 | 漫射取第几级模糊的环境（见 env.blur） |
| `f0`、`gloss`、`glossLevel`、`glossK` | 0.04、1、1、1 | 釉面反射：菲涅尔、强度、取哪一级环境、次方 |
| `grain` | 0 | 胎的细颗粒 |
| `carveDepth` | 0.002 | 刻痕对法线的影响 |
| `peel` | 无 | 橘皮纹 `{ scale, strength }` |
| `crackle` | 无 | 开片：`{ samples, tilt, level, k, line, lineColor, glint }`，默认 4、0.6、0.5、2、0.2、白、1 |
| `fill` | 无 | 刻痕填色：`{ color, metal, from, level, k, diffuse, ambient, paintDiffuse, paintAmbient }`；不给 color 时填页面上选的金属，metal 是按金属算的金属名数组 |

图案的 `ceramicMaps = { front(g, m), back(g, m) }`：R 有没有釉、G 刻深、B 压暗。`crackle = { size, front(g, m), back(g, m) }`：R 缝、G 缝的走向、B 裂面倾斜。

## 透明外壳

风格给 `form.body = { depth, top, bottom, steps, maxEdge }`：正面拱面、背面平、侧面上下两道圆角的一整块，默认 steps 10、maxEdge 0.03。壳里的东西用浮雕的 `inside` 放进去。`materials.shell`：

| 项 | 默认 | 做什么 |
|---|---|---|
| `ior` | 1.585 | 折射率 |
| `refract` | 0.1 | 折射在屏幕上偏多少 |
| `slant`、`inner` | 0.2、0.5 | 斜看时路长的上限；照进壳里的光已经穿过一次前壳的程度 |
| `front`、`back` | | `{ lod, milk }`：磨砂处模糊几级、往乳白混多少；back 另有 `tint` 后壳的颜色（前壳是当前配色） |
| `milkColor`、`channel`、`diffuse`、`ambient`、`diffuseLevel` | | 乳白散射光 |
| `gloss` | | 表面反射 `{ channel, f0, strength, k, frostLevel, frostDim }` |
| `part` | | 前后壳在 z = part 处相接 |
| `groove` | `{ width: 0.004, dark: 0.5 }` | 分模线 |
| `wave` | 无 | 表面起伏 `[[scale, strength], …]` |
| `wall` | 无 | 内面的第二道反射 `{ offset, strength }` |
| `depthBlur` | 无 | 壳里的东西离外壳越远越糊 `{ lod, range }` |

图案的 `shellMaps = { front(g, m), back(g, m) }`：R 是磨砂。

## 特效

| 项 | 在哪 | 做什么 |
|---|---|---|
| `portal` | 图案 | 另一个空间：`mask(g, m)` 画出的地方（R）改成看进勋章里一片无限远的网格地面；`color` 网格颜色，`base` 底色，`scale` 网格间距，`fog` 远处变暗，`glow` 地平线光，`width` 线宽（像素），`pitch` 视线下压的角度 |
| `ground` | 风格 | 勋章背后一块不跟着转的地面，颜色是背景色 × 光：`z` 位置，`depth` 勋章厚度，`zmid`、`zhalf` 不透光的那一层，`light` 主光方向，`steps` 步数，`radius` 外接球半径，`pen0`、`pen1` 影子随距离变软，`trans`、`core`、`rim` 透光，`amb` 影子里的环境光，`ao`、`aoR`、`aoFall`、`aoDist` 接触阴影，`gap` 地面离勋章最后面的距离，`extent` 遮罩范围 |
| `groundMask(g, m)` | 图案 | 地面投影的遮罩：R 不透光、G 外形、B 外形边上一圈 |
| `output.bloom`、`output.grain`、`output.spill` | 风格 | 见 output |

## createBadge 返回什么

| 成员 | 做什么 |
|---|---|
| `renderer` | three.js 的渲染器（截图用 `renderer.domElement.toDataURL()`，停稳后也能取） |
| `flip()` | 翻面 |
| `setRotation(弧度)` | 直接转到这个角度并停住 |
| `setEnamel(名字)`、`setMetal(名字)` | 换配色、换金属 |
| `state` | `{ enamel, metal }` |
| `dispose()` | 释放这枚勋章；渲染器和画布留给同一个容器的下一枚 |

`createBadge(container, { style, design, enamel, metal, canvas })`：`enamel`、`metal` 是开始时的配色和金属；`canvas` 给了就画到这块画布上（后台线程里的 OffscreenCanvas），不给就自己建一块插进 container。
