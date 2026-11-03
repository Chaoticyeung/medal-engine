// createBadge：把风格和图案组装成一枚能转的勋章。分四步，中间传一个上下文对象 b：
//   setupStage  渲染器、场景、相机、转动支点；
//   prepare     几何和与环境无关的贴图（正面、背面、亮片、釉面）；
//   light       环境图、金属色、各材质共用的 uniform 和着色器开头；
//   assemble    各部分的材质和网格（本体、浮雕、瓷、外壳、地面、锁边绳），以及换色、换金属；
// 最后接上转动手感和渲染循环。各步之间的先后不能随意调：图案的回调、Math.random 的调用顺序决定画面
import { THREE } from './three.js';
import { buildGeometry } from './geometry/index.js';
import { heightMips } from './relief.js';
import {
  paintFace, paintFaceParams, paintFaceMap, paintBack, paintBackColor, paintInlay, paintInlayParams, paintInlayGloss,
  paintInlayShell, paintPowder, paintMetalMap, paintEmissive, paintStitch, reliefCanvas, paintCeramicMap, paintCrackleMap, paintShellMap, paintSpill,
} from './paint.js';
import { fleckCanvas, surfaceCanvas, peelCanvas, scratchCanvas } from './procedural.js';
import { buildEnvironment, buildEnvTint, buildEnvBlurs } from './environment.js';
import { shaderHeader } from './shading/common.js';
import { faceMaterial, polishedMaterial, backMaterial } from './shading/medal.js';
import { reliefMaterial } from './shading/relief.js';
import { ceramicMaterial } from './shading/ceramic.js';
import { shellMaterial } from './shading/shell.js';
import { threadMaterial, cordMaterial, stitchPixel } from './embroidery.js';
import { makeBloom } from './effects/bloom.js';
import { makeGrain } from './effects/grain.js';
import { buildGround } from './effects/ground.js';
import { createMotion } from './motion.js';

// 几何和与颜色无关的贴图按（图案、风格的某一部分）缓存：页面里来回切换风格时不再重算。
// 几何对象可以跨渲染器复用，换渲染器时 three 会重新上传
const cache = new WeakMap();
export function cached(a, b, make) {
  if (!cache.has(a)) cache.set(a, new Map());
  const m = cache.get(a);
  if (!m.has(b)) m.set(b, make());
  return m.get(b);
}

// 每个容器只建一个渲染器，换风格时接着用：释放旧上下文（forceContextLoss）每次要占住主线程约 1 秒，
// 着色器程序也能留着给切回来的风格用
const renderers = new WeakMap();

// 画布贴图。贴图里存的都是数，不做颜色空间换算；aniso 开各向异性过滤，straight 不预乘 alpha，repeat 平铺
function texture(b, canvas, { aniso, straight, repeat } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  if (aniso) t.anisotropy = b.renderer.capabilities.getMaxAnisotropy();
  if (straight) t.premultiplyAlpha = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function setupStage(container, { style, design, canvas }) {
  // 停稳后不再重画，保留最后一帧的画面，截图（toDataURL）任何时候都能取到
  const renderer = renderers.get(container) || new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderers.set(container, renderer);
  renderer.setPixelRatio(Math.min(style.output.maxPixelRatio, devicePixelRatio * style.output.supersample));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // 着色器算出的数直接当显示值；画布标成 display-p3 时，同样的数在广色域屏幕上更饱和
  const gl = renderer.getContext();
  if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = style.output.colorSpace || 'srgb';
  if (!canvas) container.prepend(renderer.domElement);
  const size = () => [container.clientWidth || innerWidth, container.clientHeight || innerHeight];
  renderer.setSize(...size());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(...style.background);
  const camera = new THREE.PerspectiveCamera(style.camera.fov, size()[0] / size()[1], 0.1, 100);
  camera.position.set(0, 0, style.camera.distance);
  // 勋章挂在支点下面：支点在正面以下 pivotDepth 处，转动的是支点
  const pivot = new THREE.Group();
  pivot.position.z = -style.form.pivotDepth;
  scene.add(pivot);
  const medal = new THREE.Group();
  medal.position.z = style.form.pivotDepth;
  pivot.add(medal);
  return { style, design, renderer, size, scene, camera, pivot, medal, tex: {} };
}

// 几何、配色状态和正面一组贴图
function prepare(b, { enamel, metal }) {
  const { style, design, tex } = b;
  const geo = b.geo = cached(design, style.form, () => buildGeometry(style, design));
  const colors = { ...style.palette, ...(design.colors || {}) };
  // style.pairs（可选）= { 釉色名: 金属名 }：换到这个釉色时金属（青瓷是款的填色）跟着换成配好的那种
  const state = b.state = { enamel: enamel || design.defaultEnamel };
  state.metal = metal || style.pairs?.[state.enamel] || style.defaultMetal;
  b.regionColors = () => ({ ...colors, primary: colors[state.enamel], primaryName: state.enamel });

  const enamelMat = style.materials.enamel;
  tex.face = texture(b, paintFace(design, geo.ctx, geo.uvScale, b.regionColors()), { aniso: true, straight: true });
  tex.back = texture(b, cached(design, style.backText, () => paintBack(design, style, geo.uvScale)), { aniso: true });
  tex.fleck = texture(b, cached(enamelMat, 'fleck', () => fleckCanvas(enamelMat.fleck)), { aniso: true, repeat: true });
  tex.surface = texture(b, cached(enamelMat, 'surface', () => surfaceCanvas(enamelMat.surface)), { aniso: true, repeat: true });
  tex.peel = texture(b, cached(enamelMat, 'peel', () => peelCanvas(enamelMat.surface?.peel)), { aniso: true, repeat: true });
  // 可选的几张：正面光泽倍数、正面自发光、另一个空间的遮罩、背面彩色层
  b.hasGloss = design.paintGloss || design.regions(geo.ctx).some(r => r.gloss !== undefined);
  if (b.hasGloss) tex.faceParams = texture(b, cached(design, 'faceParams', () => paintFaceParams(design, geo.ctx, geo.uvScale)), { aniso: true });
  if (design.emissive) tex.emissive = texture(b, cached(design, 'emissive', () => paintFaceMap(design.emissive, geo.ctx, geo.uvScale)), { aniso: true });
  // 透视到另一个空间（可选，design.portal）：mask 画出的地方（R 通道）不画正面，改成看进勋章里面一片无限远的网格地面
  if (design.portal) tex.portal = texture(b, cached(design, 'portal', () => paintFaceMap(design.portal.mask, geo.ctx, geo.uvScale)), { aniso: true });
  if (design.back?.paint) tex.backColor = texture(b, paintBackColor(design, geo.uvScale, b.regionColors()), { aniso: true, straight: true });
}

// 环境、金属色、共用的 uniform 和着色器开头
async function light(b) {
  const { style, design, geo, tex, renderer, medal } = b;
  b.env = await buildEnvironment(renderer, style.env);
  b.metalColor = new THREE.Color();
  const er = style.reflection.envRotation || { x: 0, y: 0 };
  const envMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(er.x * Math.PI / 180)
    .multiply(new THREE.Matrix4().makeRotationY(er.y * Math.PI / 180)));
  b.envTint = style.env.tints ? await buildEnvTint(renderer, style.env.tints) : null;
  b.envBlur = style.env.blur ? await buildEnvBlurs(renderer, b.env, style.env.blur) : null;
  const scratches = style.materials.polished.scratches;
  if (scratches) tex.scratch = texture(b, cached(scratches, 'scratch', () => scratchCanvas(scratches)), { aniso: true, repeat: true });
  if (style.output.spill) {
    const sources = tex.emissive ? [{ canvas: tex.emissive.image }] : [];
    for (const rf of geo.reliefs) {
      if (rf.backSide || !rf.relief.emissive) continue;
      sources.push({ canvas: cached(rf.relief, 'emissive', () => paintEmissive(rf.relief.emissive, reliefCanvas(rf, 1024))), box: rf.box });
    }
    tex.spill = texture(b, cached(design, style.output.spill, () => paintSpill(style.output.spill, geo.uvScale, sources)), { aniso: true });
  }
  // form.rimMetal：外框、侧壁、背板用这个固定的金属色，setMetal 只换没有自己 metal 的浮雕（莳绘的金换、锡覆轮不换）
  const rimColor = style.form.rimMetal ? new THREE.Color(...style.form.rimMetal) : b.metalColor;
  b.common = { uEnv: { value: b.env }, uMetal: { value: rimColor }, uModel: { value: medal.matrixWorld }, uEnvMatrix: { value: envMatrix }, uEnvTint: { value: b.envTint },
    uScratch: { value: tex.scratch || null }, uSpill: { value: tex.spill || null } };
  b.header = shaderHeader(style);
}

// 每个部分的材质和网格
function assemble(b) {
  const { style, design, geo, medal } = b;
  for (const [g, m] of [[geo.face, faceMaterial(b)], [geo.metal, polishedMaterial(b)], [geo.back, backMaterial(b)]]) {
    m.side = THREE.DoubleSide;
    medal.add(new THREE.Mesh(g, m));
  }
  b.renderer.extensions.get('OES_texture_float_linear');
  b.inlays = geo.reliefs.map((rf, ri) => addRelief(b, rf, ri));
  b.ceramic = geo.lathe ? addCeramic(b) : null;
  b.shell = null; b.interior = null;
  if (geo.body) addShell(b);
  if (style.ground && design.groundMask) b.scene.add(buildGround(b));
  // 锁边绳的颜色：图案给 cordColor(colors) 就跟着珐琅色（配色）走，否则用金属色
  b.cordColor = new THREE.Color();
  if (geo.cord) {
    const cm = cordMaterial(style, style.form, b.header, { ...b.common, uCord: { value: b.cordColor } });
    cm.side = THREE.DoubleSide;
    medal.add(new THREE.Mesh(geo.cord.geometry, cm));
    if (design.cordColor) b.cordColor.setRGB(...design.cordColor(b.regionColors()));
  }
  applyMetal(b);
}

// 一块浮雕：高度图、嵌釉和各张可选的图，按刺绣或普通浮雕建材质。返回 [rf, 嵌釉贴图]，换色时重画
function addRelief(b, rf, ri) {
  const { style, tex, medal } = b;
  const r = rf.relief;
  const height = new THREE.DataTexture(rf.data, rf.nx, rf.ny, THREE.RGFormat, THREE.FloatType);
  height.minFilter = height.magFilter = THREE.LinearFilter;
  // prefilter：高度图带多级纹理，缩小到比屏幕像素还细的刻纹被平均掉，不出摩尔纹
  if (r.prefilter) {
    height.mipmaps = cached(rf, 'mips', () => heightMips(rf.data, rf.nx, rf.ny));
    height.minFilter = THREE.LinearMipmapLinearFilter; height.generateMipmaps = false;
  }
  height.needsUpdate = true;
  const maps = { height, inlay: texture(b, paintInlay(rf, b.regionColors()), { aniso: true, straight: true }) };
  if ((r.inlays || []).some(i => (i.translucent ?? r.translucent ?? 0) > 0)) maps.inlayParams = texture(b, cached(r, 'params', () => paintInlayParams(rf)));
  if (r.emissive) maps.emissive = texture(b, cached(r, 'emissive', () => paintEmissive(r.emissive, reliefCanvas(rf, 1024))));
  if (r.paintGloss || (r.inlays || []).some(i => i.gloss !== undefined)) maps.inlayGloss = texture(b, cached(r, 'gloss', () => paintInlayGloss(rf)));
  if (r.shell) maps.inlayShell = texture(b, cached(r, 'shell', () => paintInlayShell(rf)));
  if (r.powder?.paint) maps.powder = texture(b, cached(r, 'powder', () => paintPowder(rf)));
  if (r.paintMetal) maps.metalMap = texture(b, cached(r, 'metalMap', () => paintMetalMap(rf)), { straight: true });
  for (const [k, t] of Object.entries(maps)) tex[`${k}${ri}`] = t;
  // envScale：这块浮雕看到的环境亮度倍数；'back' 取背面材质的 envScale（背面浮雕和背板一样暗）
  const envScale = (r.envScale === 'back' ? style.materials.back.envScale ?? 1 : r.envScale ?? 1).toFixed(4);
  let mat;
  if (r.stitch) mat = stitchMaterial(b, rf, ri, maps, envScale);
  else {
    mat = reliefMaterial(b, rf, maps, envScale);
    mat.side = THREE.DoubleSide;
  }
  const mesh = new THREE.Mesh(rf.geometry, mat);
  // 壳里的浮雕（inside）只画进内部那一遍（图层 1），外壳再去取；oneSided 的只画朝前的一面（从背后看要能透过去）
  if (!r.stitch && r.inside !== undefined) { mesh.layers.set(1); if (r.oneSided) mat.side = THREE.FrontSide; }
  medal.add(mesh);
  return [rf, maps.inlay];
}

// 刺绣浮雕：针迹图（最近点取样，不插值）和可选的相位图
function stitchMaterial(b, rf, ri, maps, envScale) {
  const { style, tex } = b;
  const r = rf.relief;
  const sm = cached(r, 'stitch', () => paintStitch(rf, stitchPixel));
  const stitch = tex[`stitch${ri}`] = texture(b, sm.canvas, { straight: true });
  stitch.minFilter = stitch.magFilter = THREE.NearestFilter; stitch.generateMipmaps = false;
  // 相位图（可选）：图案逐点给出"横跨线的方向上走了多远"（RG = 坐标 × 权重、权重），弯的缎纹柱子靠它让线沿弧长均匀排开
  // 图案按画布的行序写（第 0 行在上），数据贴图第 0 行在下，这里翻过来
  let phase = null;
  if (sm.phase) {
    const W = sm.canvas.width, H = sm.canvas.height, flip = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) flip.set(sm.phase.subarray((H - 1 - j) * W * 2, (H - j) * W * 2), j * W * 2);
    phase = tex[`phase${ri}`] = new THREE.DataTexture(flip, W, H, THREE.RGFormat, THREE.FloatType);
    phase.minFilter = phase.magFilter = THREE.LinearFilter; phase.needsUpdate = true;
  }
  const tm = threadMaterial(style, rf, !!phase, b.header, { ...b.common, uHeight: { value: maps.height }, uInlay: { value: maps.inlay }, uStitch: { value: stitch }, uPhase: { value: phase },
    uBox: { value: new THREE.Vector4(...rf.box) }, uTexel: { value: new THREE.Vector2(1 / rf.nx, 1 / rf.ny) } }, envScale);
  tm.side = THREE.DoubleSide;
  return tm;
}

const blurUniforms = blurs => Object.fromEntries(blurs.map((t, k) => [`uEnvB${k}`, { value: t }]));

// 瓷器（可选，design.lathe）：整件一种材质，釉色是当前配色；页面上的金属只换刻痕里的填色
function addCeramic(b) {
  const { style, design, geo, tex } = b;
  for (const side of ['front', 'back']) tex[`ceramic_${side}`] = texture(b, cached(design, `ceramic-${side}`, () => paintCeramicMap(design, side, geo.uvScale)), { aniso: true, straight: true });
  if (design.crackle) for (const side of ['front', 'back']) {
    const t = tex[`crackle_${side}`] = texture(b, cached(design, `crackle-${side}`, () => paintCrackleMap(design, side, geo.uvScale)));
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  }
  const blurs = b.envBlur || [];
  const ceramic = ceramicMaterial(style, geo, b.header, {
    ...b.common, uMapF: { value: tex.ceramic_front }, uMapB: { value: tex.ceramic_back },
    uCrackF: { value: tex.crackle_front || null }, uCrackB: { value: tex.crackle_back || null },
    uGlaze: { value: new THREE.Color(...b.regionColors().primary) }, uFillMetal: { value: 0 },
    ...blurUniforms(blurs),
  }, blurs.length, !!design.crackle);
  ceramic.side = THREE.DoubleSide;
  b.medal.add(new THREE.Mesh(geo.lathe, ceramic));
  return ceramic;
}

// 透明塑料外壳（可选，form.body）：壳里的东西先画到 interior，外壳去取；塑料色是当前配色
function addShell(b) {
  const { style, design, geo, tex, camera } = b;
  for (const side of ['front', 'back']) tex[`shell_${side}`] = texture(b, cached(design, `shell-${side}`, () => paintShellMap(design, side, geo.uvScale)), { aniso: true });
  const interior = b.interior = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    depthTexture: style.materials.shell.depthBlur ? new THREE.DepthTexture(1, 1) : undefined });
  const blurs = b.envBlur || [];
  b.shell = shellMaterial(style, geo, b.header, {
    ...b.common, uInterior: { value: interior.texture }, uRes: { value: new THREE.Vector2(1, 1) },
    uTint: { value: new THREE.Color(...b.regionColors().primary) }, uMapF: { value: tex.shell_front }, uMapB: { value: tex.shell_back },
    uDepth: { value: interior.depthTexture || null }, uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    ...blurUniforms(blurs),
  }, blurs.length);
  b.medal.add(new THREE.Mesh(geo.body, b.shell));
}

// 换珐琅色时正面、浮雕嵌釉、背面彩色层都重画（嵌釉和背面也可能用 primary）；贴图都和金属色无关，换金属不重画
function applyColors(b) {
  const { design, geo, tex } = b;
  const colors = b.regionColors();
  tex.face.image = paintFace(design, geo.ctx, geo.uvScale, colors); tex.face.needsUpdate = true;
  for (const [rf, t] of b.inlays) { t.image = paintInlay(rf, colors); t.needsUpdate = true; }
  if (tex.backColor) { tex.backColor.image = paintBackColor(design, geo.uvScale, colors); tex.backColor.needsUpdate = true; }
  if (design.cordColor) b.cordColor.setRGB(...design.cordColor(colors));
  if (b.ceramic) b.ceramic.uniforms.uGlaze.value.setRGB(...colors.primary);
  if (b.shell) b.shell.uniforms.uTint.value.setRGB(...colors.primary);
}

function applyMetal(b) {
  const { style, design, state } = b;
  b.metalColor.setRGB(...style.metals[state.metal]);
  if (!design.cordColor) b.cordColor.copy(b.metalColor);
  if (b.ceramic) b.ceramic.uniforms.uFillMetal.value = (style.materials.ceramic.fill?.metal || []).includes?.(state.metal) ? 1 : 0;
}

// container：勋章画在这个元素里（取它的宽高）；canvas（可选）：画到给定的画布上，比如在后台线程里拿到的 OffscreenCanvas，
// 不给时自己建一块插进容器。enamel、metal 是开始时的配色和金属，默认 design.defaultEnamel 和 style.defaultMetal
export async function createBadge(container, { style, design, enamel, metal, canvas }) {
  const b = setupStage(container, { style, design, canvas });
  prepare(b, { enamel, metal });
  await light(b);
  assemble(b);
  const { renderer, scene, camera, pivot, tex, interior, shell } = b;

  const sizeInterior = () => {
    if (!interior) return;
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    interior.setSize(v.x, v.y); shell.uniforms.uRes.value.copy(v);
  };
  const drawInterior = () => {
    camera.layers.set(1);
    renderer.setRenderTarget(interior); renderer.render(scene, camera); renderer.setRenderTarget(null);
    camera.layers.set(0);
  };
  sizeInterior();

  const motion = createMotion(style.motion, renderer.domElement, () => Math.min(...b.size()));
  const bloom = style.output.bloom ? makeBloom(renderer, style.output.bloom) : null;
  bloom?.setSize();
  const grain = style.output.grain ? makeGrain(renderer, style.output.grain) : null;

  // 只在勋章还在动、或者有东西变了的时候才画；停稳以后不再每帧重画（高分辨率下很占显卡，页面上两枚会互相拖慢）
  let running = true, dirty = true, lastRot = NaN, lastFrame = performance.now();
  const redraw = () => { dirty = true; };
  function tick(now) {
    if (!running) return;
    const dt = Math.min(1 / 30, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    motion.advance(dt);
    const rotY = motion.rotation;
    if (dirty || motion.dragging || Math.abs(rotY - lastRot) > 1e-5) {
      pivot.rotation.set(0, rotY, 0);
      if (interior) drawInterior();
      if (bloom) bloom.render(scene, camera); else renderer.render(scene, camera);
      grain?.render();
      dirty = false; lastRot = rotY;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const onResize = () => {
    const [w, h] = b.size();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    bloom?.setSize();
    sizeInterior();
    redraw();
  };
  addEventListener('resize', onResize);

  return {
    renderer, flip: motion.flip,
    setRotation(y) { motion.set(y); redraw(); },
    setEnamel(name) {
      b.state.enamel = name;
      if (style.pairs?.[name]) { b.state.metal = style.pairs[name]; applyMetal(b); }
      applyColors(b); redraw();
    },
    setMetal(name) { b.state.metal = name; applyMetal(b); redraw(); },
    get state() { return { ...b.state }; },
    // 释放这枚勋章的几何、材质和贴图；渲染器和画布留给这个容器的下一枚勋章
    dispose() {
      running = false; removeEventListener('resize', onResize); motion.dispose();
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      for (const t of Object.values(tex)) t.dispose();
      b.env.dispose?.(); b.envTint?.dispose?.(); b.envBlur?.forEach(t => t.dispose()); bloom?.dispose(); interior?.dispose(); grain?.dispose();
      renderer.renderLists.dispose();
    },
  };
}
