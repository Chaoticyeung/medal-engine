// 后期辉光
import { THREE } from '../three.js';

// 后期辉光（可选，style.output.bloom = { threshold, strength, knee }）：先画到半精度浮点目标，
// 取超过 threshold 的部分，在 1/2、1/4、1/8 分辨率上各做一次高斯模糊，叠回画面。自发光的颜色超过 1 才会溢出发光
export function makeBloom(renderer, opt) {
  const ht = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const levels = [2, 4, 8].map(div => ({ div, a: new THREE.WebGLRenderTarget(1, 1, ht), b: new THREE.WebGLRenderTarget(1, 1, ht) }));
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const bright = new THREE.ShaderMaterial({
    uniforms: { uSrc: { value: null } }, vertexShader: vs, depthTest: false,
    fragmentShader: `uniform sampler2D uSrc; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uSrc, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = smoothstep(${(opt.threshold ?? 1).toFixed(3)}, ${((opt.threshold ?? 1) + (opt.knee ?? 0.3)).toFixed(3)}, l);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
  });
  const blur = new THREE.ShaderMaterial({
    uniforms: { uSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false,
    fragmentShader: `uniform sampler2D uSrc; uniform vec2 uDir; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uSrc, vUv).rgb * 0.227;
        c += (texture2D(uSrc, vUv + uDir * 1.385).rgb + texture2D(uSrc, vUv - uDir * 1.385).rgb) * 0.316;
        c += (texture2D(uSrc, vUv + uDir * 3.231).rgb + texture2D(uSrc, vUv - uDir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const comp = new THREE.ShaderMaterial({
    uniforms: { uScene: { value: sceneRT.texture }, uB0: { value: levels[0].a.texture }, uB1: { value: levels[1].a.texture }, uB2: { value: levels[2].a.texture } },
    vertexShader: vs, depthTest: false,
    fragmentShader: `uniform sampler2D uScene, uB0, uB1, uB2; varying vec2 vUv;
      void main() {
        vec3 b = texture2D(uB0, vUv).rgb * 0.5 + texture2D(uB1, vUv).rgb * 0.8 + texture2D(uB2, vUv).rgb;
        gl_FragColor = vec4(texture2D(uScene, vUv).rgb + b * ${(opt.strength ?? 0.8).toFixed(3)}, 1.0);
      }`,
  });
  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, cam); };
  const v = new THREE.Vector2();
  return {
    setSize() {
      renderer.getDrawingBufferSize(v);
      sceneRT.setSize(v.x, v.y);
      for (const L of levels) { L.a.setSize(Math.max(1, v.x / L.div | 0), Math.max(1, v.y / L.div | 0)); L.b.setSize(L.a.width, L.a.height); }
    },
    render(scene, camera) {
      renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
      // 第一级从画面取亮部；之后每级从上一级缩小一半（方向为零的模糊就是直接拷贝），再横竖各模糊一次
      let src = sceneRT.texture;
      levels.forEach((L, i) => {
        if (i === 0) { bright.uniforms.uSrc.value = src; pass(bright, L.a); }
        else { blur.uniforms.uSrc.value = src; blur.uniforms.uDir.value.set(0, 0); pass(blur, L.a); }
        blur.uniforms.uSrc.value = L.a.texture; blur.uniforms.uDir.value.set(1 / L.a.width, 0); pass(blur, L.b);
        blur.uniforms.uSrc.value = L.b.texture; blur.uniforms.uDir.value.set(0, 1 / L.a.height); pass(blur, L.a);
        src = L.a.texture;
      });
      pass(comp, null);
    },
    dispose() { sceneRT.dispose(); for (const L of levels) { L.a.dispose(); L.b.dispose(); } quad.geometry.dispose(); bright.dispose(); blur.dispose(); comp.dispose(); },
  };
}
