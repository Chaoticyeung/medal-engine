import { THREE } from '../three.js';
import { paintGroundMask } from '../paint.js';

// 地面（可选，style.ground，图案给 groundMask(g, m)：R 不透光的部分、G 外形、B 外形边上一圈）：
// 勋章背后 z = ground.z 处一块不跟着转的平面，颜色是页面背景色 × 光，网页上舞台和页面同色时也成立。
// 主光（方向 light）穿过勋章落到平面上：外形里透出染了两遍色的光（trans，中间亮 core、边上暗 rim），
// 不透光的部分（zmid ± zhalf 那一段）挡掉。从平面上每一点朝主光在世界坐标里走 steps 步，经过勋章外接球（半径 radius）那一段，
// 逐点看在不在勋章里（外形里、正面和背面之间），和勋章转到什么角度无关；每一点按离开平面的距离变软（pen0 + pen1 × 距离）。
// 接触阴影沿平面法线往前走一小段（aoDist），离勋章越近越暗（ao、aoR、aoFall）。amb 是影子里还剩的环境光。
// 平面也画进内部那一遍（透过外壳边缘看得到它）；先画、不参与深度测试，勋章转到平面后面也不会被切掉
// 返回画好的平面（要加进场景），遮罩贴图放进 b.tex.ground
export function buildGround(b) {
  const { style, design, geo, tex, shell, medal } = b;
  const G = style.ground, M = 1536, E = G.extent ?? geo.ctx.extent * 2.2;
  const mt = new THREE.CanvasTexture(paintGroundMask(design, M, E)); mt.colorSpace = THREE.NoColorSpace; mt.minFilter = THREE.LinearMipmapLinearFilter;
  tex.ground = mt;
  const v3 = a => `vec3(${a.map(v => v.toFixed(4)).join(', ')})`;
  const gm = new THREE.ShaderMaterial({
    uniforms: { uMask: { value: mt }, uInv: { value: new THREE.Matrix4() }, uCenter: { value: new THREE.Vector3() }, uTint: shell ? shell.uniforms.uTint : { value: new THREE.Color(1, 1, 1) }, uBg: { value: new THREE.Color(...style.background) } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform sampler2D uMask; uniform mat4 uInv; uniform vec3 uTint, uBg, uCenter; varying vec3 vW;
      // 按软化半径 r 取多级纹理（低一级上围一圈取 4 点，免得出方块）
      vec3 maskAt(vec2 q, float r) {
        float lod = max(log2(r * ${(M / (2 * E)).toFixed(1)}) - 1.0, 0.0);
        vec3 acc = vec3(0.0);
        for (int k = 0; k < 4; k++) {
          float a = float(k) * 1.5708 + 0.4;
          acc += textureLod(uMask, (q + vec2(cos(a), sin(a)) * r * 0.5) / ${(2 * E).toFixed(3)} + 0.5, lod).rgb;
        }
        // 遮罩范围以外一律没有勋章（粗的那几级多级纹理会把边上的值拖出去）。范围要比外形加上最大的软化半径还大，
        // 不然转到侧面、影子软得宽时，会在勋章坐标的固定 x 处被切出一道竖直的硬边
        vec2 u = abs(q / ${(2 * E).toFixed(3)});
        return acc / 4.0 * (1.0 - smoothstep(0.42, 0.48, max(u.x, u.y)));
      }
      // 这一点（勋章坐标）在不在勋章里：外形里、并且在正面和背面之间；钢板只在 zmid 那一层。r 是软化半径，e 是前后方向的软化
      vec3 inBody(vec3 X, float r, float e) {
        vec3 m = maskAt(X.xy, r);
        float zin = smoothstep(-${G.depth.toFixed(4)} - e, -${G.depth.toFixed(4)} + e, X.z) * (1.0 - smoothstep(-e, e, X.z));
        float plate = 1.0 - smoothstep(0.0, e, abs(X.z - ${G.zmid.toFixed(4)}) - ${(G.zhalf ?? 0.01).toFixed(4)});
        return vec3(m.r * plate, m.g * zin, m.b * zin);
      }
      void main() {
        // 主光的影子：从平面上这一点朝主光（世界坐标）一步步往回走，经过勋章所在的那一段，逐点看是不是在勋章里，取最大。
        // 只按世界坐标走，和勋章转到什么角度无关；每一点按离开平面的距离变软
        vec3 L = normalize(${v3(G.light)});
        float sc = dot(uCenter - vW, L), R = ${(G.radius ?? 1.25).toFixed(4)};
        float s0 = max(sc - R, 0.0), s1 = max(sc + R, 0.0), ds = (s1 - s0) / ${G.steps}.0;
        float cover = 0.0, rim = 0.0, opaque = 0.0, core = 0.0;
        if (s1 > 0.0) for (int k = 0; k < ${G.steps}; k++) {
          float sk = s0 + ds * (float(k) + 0.5);
          vec3 X = (uInv * vec4(vW + L * sk, 1.0)).xyz;
          // 正面、背面投下来的边和外形的边一样按距离变软（只软外形的话，勋章转到侧面时正面背面在影子里是两条竖直的硬线）
          float pen = ${G.pen0.toFixed(4)} + ${G.pen1.toFixed(4)} * sk;
          vec3 m = inBody(X, pen, 0.6 * ds + pen);
          cover = max(cover, m.g); rim = max(rim, m.b); opaque = max(opaque, m.r); core = max(core, m.g - m.b);
        }
        vec3 T2 = uTint * uTint;
        vec3 through = mix(vec3(1.0), T2 * ${G.trans.toFixed(4)} * (1.0 + ${G.core.toFixed(4)} * core), cover);
        through *= (1.0 - opaque) * (1.0 - rim * ${G.rim.toFixed(4)});
        // 接触阴影：沿平面法线往前走一小段，离勋章越近越暗
        float ao = 0.0;
        for (int k = 0; k < 8; k++) {
          float sk = ${(G.aoDist ?? 0.35).toFixed(4)} * (float(k) + 0.5) / 8.0;
          vec3 X = (uInv * vec4(vW + vec3(0.0, 0.0, sk), 1.0)).xyz;
          ao = max(ao, inBody(X, ${G.aoR.toFixed(4)} + 0.15 * sk, 0.05).g * exp(-sk * ${G.aoFall.toFixed(4)}));
        }
        vec3 light = vec3(${G.amb.toFixed(4)}) + ${(1 - G.amb).toFixed(4)} * through;
        gl_FragColor = vec4(uBg * light * (1.0 - ao * ${G.ao.toFixed(4)}), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), gm);
  // 先画、不参与深度测试：勋章转动时一侧会转到平面后面，不能被它切掉
  plane.position.z = G.z; plane.layers.enable(1); plane.renderOrder = -1;
  // 平面跟着让：勋章转起来时一侧会往后摆，平面始终退到勋章最靠后的那一点后面 gap 处，不让勋章穿进去
  // （穿进去的那一截不投影，交界是一条竖直的硬线）。正面放着时勋章贴着平面，转起来像被拿起来离开了页面
  const corner = new THREE.Vector3(), ext = geo.ctx.extent / 1.05;
  plane.onBeforeRender = () => {
    gm.uniforms.uInv.value.copy(medal.matrixWorld).invert();
    gm.uniforms.uCenter.value.set(0, 0, -G.depth / 2).applyMatrix4(medal.matrixWorld);
    let back = Infinity;
    for (const x of [-ext, ext]) for (const z of [0.05, -G.depth]) back = Math.min(back, corner.set(x, 0, z).applyMatrix4(medal.matrixWorld).z);
    plane.position.z = Math.min(G.z, back - (G.gap ?? 0.06));
    plane.updateMatrix(); plane.matrixWorld.copy(plane.matrix);
  };
  return plane;
}
