// 在后台线程里跑整个引擎：three.js 渲染和图案的计算都在这里，页面主线程不会被几秒的计算卡住。
// 页面那边用 offscreen.js 的 createWorkerBadge：它把 <canvas> 转成 OffscreenCanvas 交过来，指针事件、尺寸变化、换风格都用消息传。
//
// 后台线程的脚本（type: 'module'）里写：
//   import { runBadgeWorker } from '<引擎>/src/worker.js';
//   runBadgeWorker({ three: '<three.module.js 的地址>' });
// 选项：
//   three    three.module.js 的地址（后台线程里没有 importmap，不能 import 'three'），也可以在页面的 init 消息里给；
//   clipper  clipper.js 的地址，同上；
//   load(msg)       按 show 消息取 [风格, 图案]，默认把 msg.style、msg.design 当模块地址 import 进来取 default；
//   prepare(style, msg)  建勋章前改一下风格（比如按页面换背景色），默认原样；
//   describe(style, badge, msg)  ready 消息里额外带回去的字段，默认带配色 swatches、金属 metals、当前 state。
//
// 引擎和图案原本写给页面主线程用，这里补上它们要的几样东西：document.createElement('canvas')、
// 容器的宽高、window、innerWidth、devicePixelRatio、全局的 ClipperLib、requestAnimationFrame
import { setThree } from './three.js';
import { createBadge } from './badge.js';

let size = [800, 800];
function installShims() {
  self.window = self;
  self.devicePixelRatio = 1;
  Object.defineProperty(self, 'innerWidth', { get: () => size[0], configurable: true });
  Object.defineProperty(self, 'innerHeight', { get: () => size[1], configurable: true });
  self.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`后台线程里只能建 canvas，不能建 ${tag}`);
      const c = new OffscreenCanvas(300, 150);
      c.style = {};
      return c;
    },
  };
  self.requestAnimationFrame ||= cb => setTimeout(() => cb(performance.now()), 16);
}

const frames = n => new Promise(ok => { const f = () => (--n ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f); });
const loadModules = msg => Promise.all([msg.style, msg.design].map(u => import(u).then(m => m.default)));
const describeBadge = (style, badge) => ({
  swatches: (style.swatches || []).map(n => [n, style.palette[n]]),
  metals: Object.keys(style.metals || {}),
  state: badge.state,
});

export function runBadgeWorker({ three, clipper, load = loadModules, prepare = s => s, describe = () => ({}) } = {}) {
  installShims();
  const container = { get clientWidth() { return size[0]; }, get clientHeight() { return size[1]; } };
  let canvas, badge, wanted = null, busy = false;

  async function init(data) {
    canvas = data.canvas;
    canvas.style = {};
    canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
    size = [data.width, data.height];
    self.devicePixelRatio = data.dpr;
    setThree(await import(data.three || three));
    if (!globalThis.ClipperLib) (0, eval)(await (await fetch(data.clipper || clipper)).text());
  }

  // 换风格按最后一次要的那个来：连点几下时中间的直接跳过
  async function show() {
    if (busy) return;
    busy = true;
    while (wanted) {
      const msg = wanted;
      wanted = null;
      try {
        const [st, design] = await load(msg);
        if (wanted) continue;
        const style = prepare(st, msg);
        badge?.dispose();
        badge = await createBadge(container, { style, design, canvas, enamel: msg.enamel, metal: msg.metal });
        // 画布上还留着上一枚的最后一帧，等新的一枚真正画出第一帧、交到页面上以后再说好了，页面淡入时才不会闪回上一枚
        await frames(2);
        if (wanted) continue;
        postMessage({ type: 'ready', id: msg.id, ...describeBadge(style, badge), ...describe(style, badge, msg) });
      } catch (e) {
        postMessage({ type: 'error', id: msg.id, message: String(e.stack || e) });
      }
    }
    busy = false;
  }

  // 指针事件原样转给画布：引擎按 clientX 和 timeStamp 算转角和速度，两个时间都取页面上的，差值不受传递延迟影响
  function pointer({ kind, clientX, pointerId, timeStamp }) {
    const e = new Event(kind);
    Object.defineProperties(e, { clientX: { value: clientX }, pointerId: { value: pointerId }, timeStamp: { value: timeStamp } });
    canvas.dispatchEvent(e);
  }

  let started;
  const ready = new Promise(ok => { started = ok; });
  self.onmessage = async ({ data }) => {
    if (data.type === 'init') {
      try { await init(data); started(); } catch (e) { postMessage({ type: 'error', id: null, message: String(e.stack || e) }); }
      return;
    }
    await ready;
    const state = () => postMessage({ type: 'state', state: badge?.state });
    switch (data.type) {
      case 'show': wanted = data; show(); break;
      case 'enamel': badge?.setEnamel(data.name); state(); break;
      case 'metal': badge?.setMetal(data.name); state(); break;
      case 'flip': badge?.flip(); break;
      case 'rotate': badge?.setRotation(data.y); break;
      case 'pointer': pointer(data); break;
      case 'resize':
        size = [data.width, data.height];
        self.devicePixelRatio = data.dpr;
        self.dispatchEvent(new Event('resize'));
        break;
      case 'shot': postMessage({ type: 'shot', blob: await canvas.convertToBlob({ type: data.format || 'image/png' }) }); break;
    }
  };
}
