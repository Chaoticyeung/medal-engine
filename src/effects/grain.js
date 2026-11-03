// 画面颗粒
import { THREE } from '../three.js';
import { VNOISE } from '../shading/common.js';

// 画面颗粒（可选，style.output.grain = { strength, size }）：照片的颗粒。画完以后在整个画面上再盖一层，
// 按 2 × 颗粒 × 画面 混合（颗粒 0.5 不变），亮暗处都按比例起伏。颗粒按屏幕像素生成、每帧一样，size 是一颗多少个像素
export function makeGrain(renderer, opt) {
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${VNOISE}
      void main() {
        vec2 p = gl_FragCoord.xy / ${(opt.size ?? 1.5).toFixed(3)};
        float g = (vnoise(p) + vnoise(p * 2.03 + 7.1)) * 0.5 - 0.5;
        gl_FragColor = vec4(vec3(0.5 + g * ${(opt.strength ?? 0.04).toFixed(4)}), 1.0);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return {
    render() {
      const auto = renderer.autoClear;
      renderer.autoClear = false; renderer.setRenderTarget(null); renderer.render(scene, cam); renderer.autoClear = auto;
    },
    dispose() { scene.children[0].geometry.dispose(); mat.dispose(); },
  };
}
