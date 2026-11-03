// 勋章本体的三种材质：正面（珐琅和缎面金属）、外框和金属丝（抛光金属）、背板
import { THREE } from '../three.js';
import { CHANNEL, VERT, tintLine, tintStart, polishedColor } from './common.js';
import { portalFn } from '../effects/portal.js';
import { spillLine } from '../effects/spill.js';

// 正面：face 贴图 A=1 处是珐琅（亮片、釉面瑕疵、橘皮纹、釉光），A=0 处是缎面金属；可叠自发光、自发光外溢、另一个空间
export function faceMaterial(b) {
  const { style, design, tex, common, header, hasGloss } = b;
  const gain = (style.output.emissiveGain ?? 1).toFixed(3);
  const enamel = style.materials.enamel, peel = enamel.surface?.peel;
  const fleckScale = (enamel.fleck?.scale ?? 1).toFixed(4), fleckStrength = (enamel.fleck?.strength ?? 0).toFixed(4);
  const surfaceScale = (enamel.surface?.scale ?? 1).toFixed(4);
  const peelScale = (peel?.scale ?? 1).toFixed(4), peelStrength = (peel?.strength ?? 0).toFixed(4);
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uFace: { value: tex.face }, uFleck: { value: tex.fleck }, uSurface: { value: tex.surface }, uPeel: { value: tex.peel },
      uFaceParams: { value: tex.faceParams || null }, uEmissive: { value: tex.emissive || null }, uPortal: { value: tex.portal || null } },
    vertexShader: VERT,
    fragmentShader: header + `
      uniform sampler2D uFace, uFleck, uSurface, uPeel, uFaceParams, uEmissive, uPortal;
      ${design.portal ? portalFn(design.portal) : ''}
      void main() {
        vec3 n = normalize(vObjNormal);
        ${tintStart(style, 'n')}
        vec4 face = texture2D(uFace, vUv);
        vec2 fleck = face.a > 0.5 ? (texture2D(uFleck, vUv * ${fleckScale}).xy - 0.5) * ${fleckStrength} : vec2(0.0);
        vec2 peel = face.a > 0.5 ? (texture2D(uPeel, vUv * ${peelScale}).xy - 0.5) * ${peelStrength} : vec2(0.0);
        vec3 env = envAt(n, fleck);
        vec3 nw = normalize(mat3(uModel) * n);
        float fres = pow(1.0 - clamp(dot(nw, normalize(cameraPosition - vWorldPos)), 0.0, 1.0), 5.0);
        vec2 surf = texture2D(uSurface, vUv * ${surfaceScale}).rg;
        float glossMul = ${hasGloss ? 'texture2D(uFaceParams, vUv).r * (255.0 / 128.0)' : '1.0'};
        vec3 enamel = enamelLight(env) * face.rgb * surf.r * (255.0 / 128.0) + enamelGloss(envAt(n, peel), fres) * surf.g * glossMul;
        gl_FragColor = vec4(mix(satinLight(env) * uMetal, enamel, face.a), 1.0);
        ${tintLine(style, 'n')}
        ${spillLine(style, 'metal', 'uMetal * (1.0 - face.a)')}
        ${spillLine(style, 'enamel', 'face.rgb * face.a')}
        ${tex.emissive ? `gl_FragColor.rgb += texture2D(uEmissive, vUv).rgb * ${gain};` : ''}
        ${design.portal ? `float portal = texture2D(uPortal, vUv).r;
        if (portal > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, portalColor(transpose(mat3(uModel)) * normalize(vWorldPos - cameraPosition)) * ${gain}, portal);` : ''}
      }`,
  });
}

// 外框、金属丝、孔壁：抛光金属，vTone 是金属色的倍数；负的 tone 是被珐琅盖住的金属丝（form 里 covered 的笔画）
export function polishedMaterial(b) {
  const { style, geo, tex, common, header } = b;
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uFace: { value: tex.face } }, vertexShader: VERT,
    fragmentShader: header + `
      uniform sampler2D uFace;
      varying float vTone;
      void main() {
        vec3 n = normalize(vObjNormal);
        ${tintStart(style, 'n')}
        ${polishedColor(style, 'n', 'env')}
        gl_FragColor = vec4(polishedCol * uMetal * vTone, 1.0);
        ${geo.covered ? `if (vTone < 0.0) {
          vec3 nw = normalize(mat3(uModel) * n);
          float fres = pow(1.0 - clamp(dot(nw, normalize(cameraPosition - vWorldPos)), 0.0, 1.0), 5.0);
          gl_FragColor = vec4(enamelLight(env) * texture2D(uFace, vUv).rgb * -vTone + enamelGloss(env, fres), 1.0);
        }` : ''}
        ${tintLine(style, 'n')}
        ${geo.covered ? 'if (vTone > 0.0) ' : ''}${spillLine(style, 'metal', 'uMetal * vTone')}
      }`,
  });
}

// 背板：背面金属加背面文字（paintBack 的遮罩），可选背面彩色层（design.back.paint）
export function backMaterial(b) {
  const { style, design, geo, tex, common, header } = b;
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uText: { value: tex.back }, uUvScale: { value: geo.uvScale }, uBackColor: { value: tex.backColor || null } },
    vertexShader: VERT,
    fragmentShader: header + `
      uniform sampler2D uText, uBackColor;
      uniform float uUvScale;
      void main() {
        ${tintStart(style, 'normalize(vObjNormal)')}
        float text = texture2D(uText, vObjPos.xy * uUvScale + 0.5).r;
        vec3 env = envAt(normalize(vObjNormal), vec2(0.0));
        float tint = mix(1.0, env.${CHANNEL[style.materials.backText.channel]}, text * ${style.materials.backText.multiply ? '1.0' : '0.0'});
        ${style.backText.ink ? `gl_FragColor = vec4(mix(backLight(env) * uMetal, backLight(env) * vec3(${style.backText.ink.map(v => v.toFixed(3)).join(', ')}), text), 1.0);`
          : 'gl_FragColor = vec4(mix(backLight(env), backTextLight(env), text) * tint * uMetal, 1.0);'}
        ${tex.backColor ? `vec4 bc = texture2D(uBackColor, vObjPos.xy * uUvScale + 0.5);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, enamelLight(env) * bc.rgb, bc.a);` : ''}
        ${tintLine(style, 'normalize(vObjNormal)')}
      }`,
  });
}
