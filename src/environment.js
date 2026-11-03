// 环境：勋章反射的那一圈光。按方向算亮度的函数（fit）或一张立方体图（strip），可选的颜色和几级模糊
import { THREE } from './three.js';
import { newCanvas } from './paint.js';

const DIR_VERT = 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

// 在一个包住原点的大球里面画 fragmentShader（按方向 vDir 给颜色），用立方体相机拍成一张立方体图。拍完释放球和材质
function renderCube(renderer, { fragmentShader, uniforms, segments, size }) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, segments, segments / 2), new THREE.ShaderMaterial({ side: THREE.BackSide, ...(uniforms && { uniforms }), vertexShader: DIR_VERT, fragmentShader })));
  const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: false, minFilter: THREE.LinearFilter, type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 20, rt).update(renderer, scene);
  scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}

// 两种环境：
//   fit   按方向算亮度的函数（随仰角平滑变化的底色 + 椭圆光斑，可选再加长方形柔光箱 rects），两个通道各一套参数；
//   strip 6 个面竖排的一张图，flipFaces 时每个面上下翻转后再装（原点在左下角的图用）
export async function buildEnvironment(renderer, env) {
  if (env.kind === 'strip') {
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = env.url; });
    const s = img.width;
    const faces = Array.from({ length: 6 }, (_, k) => {
      const c = newCanvas(s), g = c.getContext('2d');
      if (env.flipFaces) { g.translate(0, s); g.scale(1, -1); }
      g.drawImage(img, 0, k * s, s, s, 0, 0, s, s);
      return c;
    });
    const t = new THREE.CubeTexture(faces);
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }
  const list = xs => xs.map(v => v.toFixed(4)).join(', ');
  const vec4s = xs => Array.from({ length: xs.length / 4 }, (_, i) => `vec4(${list(xs.slice(i * 4, i * 4 + 4))})`).join(', ');
  // 长方形柔光箱（可选，通道里的 rects）：每块 [方位, 仰角, 方位半宽, 仰角半宽, 羽化, 亮度]，里面是平的，
  // 边只在羽化的那几度里过渡。镜面金属和镜面漆靠反射里光源清楚的边才像，高斯光斑没有边
  const rectsCode = rects => `
      const vec4 rect[${rects.length}] = vec4[${rects.length}](${rects.map(r => `vec4(${list(r.slice(0, 4))})`).join(', ')});
      const vec2 rectEdge[${rects.length}] = vec2[${rects.length}](${rects.map(r => `vec2(${list([Math.max(r[4], 1e-3), r[5]])})`).join(', ')});
      for (int k = 0; k < ${rects.length}; k++) {
        float da = abs(mod(az - rect[k].x + 180.0, 360.0) - 180.0), de = abs(el - rect[k].y);
        vec2 e = rectEdge[k];
        v += e.y * (1.0 - smoothstep(rect[k].z - e.x, rect[k].z + e.x, da)) * (1.0 - smoothstep(rect[k].w - e.x, rect[k].w + e.x, de));
      }`;
  const channel = (name, c) => `
    float ${name}(float az, float el) {
      const float base[${c.base.length}] = float[${c.base.length}](${list(c.base)});
      const vec4 blob[${c.amp.length}] = vec4[${c.amp.length}](${vec4s(c.blobs)});
      const float amp[${c.amp.length}] = float[${c.amp.length}](${list(c.amp)});
      float t = (90.0 - el) / ${(180 / (c.base.length - 1)).toFixed(4)};
      int i = int(clamp(floor(t), 0.0, ${c.base.length - 2}.0));
      float f = t - float(i);
      float p0 = base[max(i - 1, 0)], p1 = base[i], p2 = base[i + 1], p3 = base[min(i + 2, ${c.base.length - 1})];
      float v = 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f * f * f);
      for (int k = 0; k < ${c.amp.length}; k++) {
        float da = mod(az - blob[k].x + 180.0, 360.0) - 180.0;
        float de = el - blob[k].y;
        v += amp[k] * exp(-0.5 * (da * da / (blob[k].z * blob[k].z) + de * de / (blob[k].w * blob[k].w)));
      }${c.rects ? rectsCode(c.rects) : ''}
      return clamp(v, 0.0, 1.0);
    }`;
  return renderCube(renderer, {
    segments: 256, size: env.size || 256,
    fragmentShader: `
      varying vec3 vDir;
      ${channel('channelR', env.r)}
      ${channel('channelG', env.g)}
      void main() {
        vec3 d = normalize(vDir);
        float az = degrees(atan(d.x, d.z));
        float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
        float r = channelR(az, el);
        gl_FragColor = vec4(r, channelG(az, el), r, 1.0);
      }`,
  });
}

// 环境的颜色（可选，env.tints）：默认处处白色；每个光斑 [方位, 仰角, 方位宽, 仰角宽, r, g, b, 强度] 把那一片染成这个颜色。
// 着色时最终颜色再乘反射方向上的这个颜色，洋红、青色灯带就会映在金属和漆面上
export async function buildEnvTint(renderer, tints) {
  const vec = tints.map(t => `vec4(${t.slice(0, 4).map(v => v.toFixed(3)).join(', ')})`).join(', ');
  const col = tints.map(t => `vec4(${t.slice(4, 8).map(v => v.toFixed(3)).join(', ')})`).join(', ');
  return renderCube(renderer, {
    segments: 128, size: 128,
    fragmentShader: `
      varying vec3 vDir;
      const vec4 blob[${tints.length}] = vec4[${tints.length}](${vec});
      const vec4 col[${tints.length}] = vec4[${tints.length}](${col});
      void main() {
        vec3 d = normalize(vDir);
        float az = degrees(atan(d.x, d.z)), el = degrees(asin(clamp(d.y, -1.0, 1.0)));
        vec3 c = vec3(1.0);
        for (int k = 0; k < ${tints.length}; k++) {
          float da = mod(az - blob[k].x + 180.0, 360.0) - 180.0, de = el - blob[k].y;
          float w = col[k].w * exp(-0.5 * (da * da / (blob[k].z * blob[k].z) + de * de / (blob[k].w * blob[k].w)));
          c = mix(c, col[k].rgb, clamp(w, 0.0, 1.0));
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// 模糊的环境（可选，style.env.blur = [角度, …]）：每个角度一张立方体图，把原环境在这么宽的高斯锥里平均。
// 瓷的胎和釉里散回来的光按法线取最模糊的一张（漫射），釉面光泽按反射方向取中间的（倒影看得出形状、边是软的）。
// 只给用到的材质（瓷和外壳），别的材质照旧取原环境。
// 一级级往上模糊（每级只补上和上一级差的那部分宽度），大角度时撒点也够密，不出斑
export async function buildEnvBlurs(renderer, src, angles, size = 64) {
  const N = 192, golden = Math.PI * (3 - Math.sqrt(5));
  let prev = src, prevDeg = 0;
  return angles.map(deg => {
    const sigma = Math.sqrt(Math.max(deg * deg - prevDeg * prevDeg, 1)) * Math.PI / 180, R = Math.min(3 * sigma, Math.PI * 0.95);
    const taps = [];
    for (let k = 0; k < N; k++) {
      const th = R * Math.sqrt((k + 0.5) / N), ph = k * golden;
      // 等面积撒点，每点代表的立体角正比于 sinθ/θ，再乘高斯权重
      const w = Math.exp(-0.5 * th * th / (sigma * sigma)) * (th > 1e-4 ? Math.sin(th) / th : 1);
      taps.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th), w]);
    }
    const sum = taps.reduce((a, t) => a + t[3], 0);
    prev = renderCube(renderer, {
      segments: 64, size, uniforms: { uSrc: { value: prev } },
      fragmentShader: `
        uniform samplerCube uSrc;
        varying vec3 vDir;
        const vec4 tap[${N}] = vec4[${N}](${taps.map(t => `vec4(${t.map(v => v.toFixed(5)).join(', ')})`).join(', ')});
        void main() {
          vec3 d = normalize(vDir);
          vec3 u = normalize(cross(abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), d)), v = cross(d, u);
          vec3 acc = vec3(0.0);
          for (int k = 0; k < ${N}; k++) acc += textureCube(uSrc, tap[k].x * u + tap[k].y * v + tap[k].z * d).rgb * tap[k].w;
          gl_FragColor = vec4(acc / ${sum.toFixed(5)}, 1.0);
        }`,
    });
    prevDeg = deg;
    return prev;
  });
}
