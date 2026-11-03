// 页面这边：把勋章交给后台线程去算和画（后台线程的脚本见 worker.js）。
//   const badge = createWorkerBadge(container, { worker: new Worker('my-worker.js', { type: 'module' }), clipper, three });
//   const info = await badge.show({ id: 'a', style: '风格模块的地址', design: '图案模块的地址' });  // { swatches, metals, state, … }
//   await badge.setEnamel(名字); await badge.setMetal(名字); badge.flip(); badge.setRotation(弧度); await badge.shot();
// container 里会插进一块 <canvas>，铺满容器；容器变大小时自动跟着变。three、clipper 是后台线程加载 three.js、clipper-lib 用的地址。
// 连着 show 几次时后台线程只算最后一次，前面几次的 Promise 一直不会有结果

// 浏览器支不支持把画布交给后台线程画 WebGL
export function canRunInWorker() {
  try { return 'transferControlToOffscreen' in HTMLCanvasElement.prototype && !!new OffscreenCanvas(1, 1).getContext('webgl2'); } catch { return false; }
}

export function createWorkerBadge(container, { worker, three, clipper }) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display: block; width: 100%; height: 100%; touch-action: none;';
  container.append(canvas);
  const off = canvas.transferControlToOffscreen();
  const waiters = new Map();
  let stateWaiting = null, shotWaiting = null;
  const failAll = err => { for (const w of waiters.values()) w.reject(err); waiters.clear(); };
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') { waiters.get(data.id)?.resolve(data); waiters.delete(data.id); }
    else if (data.type === 'error') {
      const err = new Error(data.message);
      if (waiters.has(data.id)) { waiters.get(data.id).reject(err); waiters.delete(data.id); } else failAll(err);
    } else if (data.type === 'state') stateWaiting?.(data.state);
    else if (data.type === 'shot') shotWaiting?.(data.blob);
  };
  worker.onerror = e => failAll(new Error(e.message || '后台线程出错'));
  const dims = () => ({ width: container.clientWidth, height: container.clientHeight, dpr: devicePixelRatio });
  const abs = u => (u ? new URL(u, location.href).href : undefined);
  worker.postMessage({ type: 'init', canvas: off, three: abs(three), clipper: abs(clipper), ...dims() }, [off]);
  const resize = new ResizeObserver(() => worker.postMessage({ type: 'resize', ...dims() }));
  resize.observe(container);
  const send = (kind, e) => worker.postMessage({ type: 'pointer', kind, clientX: e.clientX, pointerId: e.pointerId, timeStamp: e.timeStamp });
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); send('pointerdown', e); });
  for (const k of ['pointermove', 'pointerup', 'pointercancel', 'dblclick']) canvas.addEventListener(k, e => send(k, e));
  const ask = (msg, set) => new Promise(ok => { set(ok); worker.postMessage(msg); });
  return {
    canvas,
    // style、design 是模块地址（相对页面），会换成绝对地址交给后台线程；其余字段原样带过去（enamel、metal，或者 load 钩子要的东西）
    show(msg) {
      const full = { ...msg, type: 'show', style: abs(msg.style), design: abs(msg.design) };
      return new Promise((resolve, reject) => { waiters.set(msg.id, { resolve, reject }); worker.postMessage(full); });
    },
    setEnamel(name) { return ask({ type: 'enamel', name }, ok => { stateWaiting = ok; }); },
    setMetal(name) { return ask({ type: 'metal', name }, ok => { stateWaiting = ok; }); },
    flip() { worker.postMessage({ type: 'flip' }); },
    setRotation(y) { worker.postMessage({ type: 'rotate', y }); },
    shot(format) { return ask({ type: 'shot', format }, ok => { shotWaiting = ok; }); },
    dispose() { resize.disconnect(); worker.terminate(); canvas.remove(); },
  };
}
