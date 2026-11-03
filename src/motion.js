// 转动手感：拖动时转角 = rate × 横向位移 / 勋章显示宽度；松手后按
// "磁吸 + 速度阻力 + 脱粘力" 积分，再乘旋转阻尼。磁吸是 -sin(2θ)，只在正面和背面稳定。
// 按固定步长积分，停在哪一面不随帧率变。参数在 style.motion：
//   rate 拖动倍率，magnetic 磁吸，velocityForce、velocityPower 速度阻力，unsticking 脱粘力，drag 阻尼，
//   flipImpulse 双击翻面时加的转速，introSpin 开场的转速
const STEP = 1 / 240;

function stepper(P) {
  return (rot, w) => {
    const force = P.magnetic * Math.cos(2 * rot + Math.PI / 2)
      - P.velocityForce * Math.sign(w) * Math.pow(Math.abs(w), P.velocityPower)
      + Math.sin(rot) * P.unsticking / Math.pow(Math.abs(w) + 1, 3);
    w = (w + force * STEP) * (1 - P.drag * STEP);
    return [rot + w * STEP, w];
  };
}

// 开场转一圈要停在正面。停在哪一面取决于各风格的磁吸、阻尼和初速，所以先算一遍：
// 停在背面就把初速按 2% 一档往两边调，直到停在正面
function introSpin(P, step) {
  const restsOn = w => {
    let rot = 0;
    for (let i = 0; i < 240 * 20 && (Math.abs(w) > 1e-3 || Math.abs(Math.sin(2 * rot)) > 1e-3); i++) [rot, w] = step(rot, w);
    return Math.round(rot / Math.PI);
  };
  let spin = P.introSpin;
  for (let k = 0; k <= 15 && restsOn(spin) % 2; k++) {
    const s = P.introSpin * (1 + 0.02 * (k + 1));
    spin = restsOn(s) % 2 ? P.introSpin * (1 - 0.02 * (k + 1)) : s;
  }
  return spin;
}

// el 上监听指针（拖动、双击翻面）；width() 是勋章的显示宽度。advance(dt) 每帧调一次
export function createMotion(P, el, width) {
  const step = stepper(P);
  let rot = 0, spin = introSpin(P, step), dragging = false, lastX = 0, lastT = 0, pending = 0;
  const listening = new AbortController(), on = { signal: listening.signal };
  el.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastT = e.timeStamp; spin = 0; el.setPointerCapture(e.pointerId); }, on);
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const d = P.rate * (e.clientX - lastX) / width();
    const dt = Math.max(1e-3, (e.timeStamp - lastT) / 1000);
    rot += d;
    spin = spin * 0.5 + (d / dt) * 0.5;
    lastX = e.clientX; lastT = e.timeStamp;
  }, on);
  const release = e => {
    if (!dragging) return;
    dragging = false;
    if (e.timeStamp - lastT > 80) spin = 0;
  };
  el.addEventListener('pointerup', release, on);
  el.addEventListener('pointercancel', release, on);
  const flip = () => { spin += Math.sign(spin || 1) * P.flipImpulse; };
  el.addEventListener('dblclick', flip, on);
  return {
    get rotation() { return rot; },
    get dragging() { return dragging; },
    advance(dt) {
      if (!dragging && dt > 0) {
        for (pending += dt; pending >= STEP; pending -= STEP) [rot, spin] = step(rot, spin);
      } else pending = 0;
    },
    set(y) { rot = y; spin = 0; },
    flip,
    dispose() { listening.abort(); },
  };
}
