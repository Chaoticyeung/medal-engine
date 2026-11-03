// 着色的公共部分：各材质的光照函数、反射方向、环境染色，拼在每个片元着色器前面
// 每种材质：颜色 = (环境亮度^k × diffuse + ambient) × 固有色，环境亮度取 channel 通道再乘 envScale。
// 反射方向两种模型：
//   soft    用假相机（在勋章背后）算指向相机的方向，对物体空间法线反射，绕支点按模型旋转，再乘环境矩阵；
//   mirror  普通镜面反射：世界空间视线对世界空间法线反射
export const CHANNEL = { r: 'x', g: 'y', b: 'z' };
// env.tintMode 为 'reflection' 时染色只乘随环境变的那一项（和釉光），底亮不染：印上去的颜色在彩色灯下不变色。
// 这时光照函数返回颜色，片元开头先取好反射方向上的颜色 gTint
export const tintReflection = style => style.env.tints && style.env.tintMode === 'reflection';
function lightFn(name, m, refl) {
  const scale = (m.envScale ?? 1).toFixed(4);
  const reflected = `pow(env.${CHANNEL[m.channel]} * ${scale}, ${m.k.toFixed(4)}) * ${m.diffuse.toFixed(4)}`;
  return refl ? `vec3 ${name}(vec3 env) { return ${reflected} * gTint + ${m.ambient.toFixed(4)}; }`
    : `float ${name}(vec3 env) { return ${reflected} + ${m.ambient.toFixed(4)}; }`;
}

export function shaderHeader(style) {
  const r = style.reflection, M = style.materials, refl = tintReflection(style);
  const dirCode = r.model === 'soft' ? `
    mat3 rot = mat3(uModel);
    vec3 r = reflect(normalize(vec3(0.0, 0.0, -${style.camera.distance.toFixed(4)}) - vWorldPos), n);
    vec3 dir = uEnvMatrix * (rot * (r + PIVOT) - PIVOT);
    return dir + (fleck.x * rot * cross(n, vec3(0.0, 1.0, 0.0)) + fleck.y * rot * cross(n, vec3(1.0, 0.0, 0.0)));` : `
    vec3 nw = normalize(mat3(uModel) * (n + vec3(fleck, 0.0)));
    return uEnvMatrix * reflect(normalize(vWorldPos - cameraPosition), nw);`;
  return `
uniform samplerCube uEnv;
uniform vec3 uMetal;
uniform mat4 uModel;
uniform mat3 uEnvMatrix;
varying vec3 vWorldPos;
varying vec3 vObjNormal;
varying vec3 vObjPos;
varying vec2 vUv;
const vec3 PIVOT = vec3(0.0, 0.0, ${(r.pivot ?? 0).toFixed(4)});
vec3 envDir(vec3 n, vec2 fleck) {${dirCode}
}
vec3 envAt(vec3 n, vec2 fleck) { return textureCube(uEnv, envDir(n, fleck)).rgb; }
${style.env.tints ? 'uniform samplerCube uEnvTint;\nvec3 tintAt(vec3 n) { return textureCube(uEnvTint, envDir(n, vec2(0.0))).rgb; }' : ''}
${refl ? 'vec3 gTint = vec3(1.0);' : ''}
${lightFn('polishedLight', M.polished, refl)}
${lightFn('satinLight', M.satin, refl)}
${lightFn('enamelLight', M.enamel, refl)}
${lightFn('backLight', M.back, refl)}
${lightFn('backTextLight', M.backText, refl)}
${glossFn(M.enamel.gloss, refl)}
${M.polished.scratches ? `uniform sampler2D uScratch;
vec4 scratchAt(vec3 p) { return texture2D(uScratch, p.xy * ${(M.polished.scratches.scale ?? 1).toFixed(4)}); }
vec3 scratched(vec3 n, vec4 s) { return normalize(n + vec3((s.xy - 0.5) * ${(M.polished.scratches.strength ?? 0.3).toFixed(4)}, 0.0)); }` : ''}
${style.output.spill ? 'uniform sampler2D uSpill;' : ''}`;
}

// 釉面光泽：珐琅磨平后像一层玻璃，镜面反射不受亮片扰动，不染珐琅色。
// 强度 = (正对时 + 掠射加成 × 菲涅尔) × 环境亮度^k
function glossFn(g, refl) {
  const type = refl ? 'vec3' : 'float';
  if (!g) return `${type} enamelGloss(vec3 env, float fres) { return ${type}(0.0); }`;
  return `${type} enamelGloss(vec3 env, float fres) {
    return (${g.facing.toFixed(4)} + ${g.grazing.toFixed(4)} * fres) * pow(env.${CHANNEL[g.channel]}, ${g.k.toFixed(4)})${refl ? ' * gTint' : ''};
  }`;
}

// 环境有颜色时，每个片元最后乘反射方向上的颜色；没有就什么都不加。只染反射时改成片元开头取颜色
export const tintLine = (style, n) => (style.env.tints && !tintReflection(style) ? `gl_FragColor.rgb *= tintAt(${n});` : '');
export const tintStart = (style, n) => (tintReflection(style) ? `gTint = tintAt(${n});` : '');

// 抛光金属的颜色：有划痕时法线按划痕偏一点，发乌的地方往缎面混
export const polishedColor = (style, n, envVar) => {
  const s = style.materials.polished.scratches;
  if (!s) return `vec3 ${envVar} = envAt(${n}, vec2(0.0));\n vec3 polishedCol = vec3(polishedLight(${envVar}));`;
  return `vec4 sc = scratchAt(vObjPos);
        vec3 ${envVar} = envAt(scratched(${n}, sc), vec2(0.0));
        vec3 polishedCol = mix(vec3(polishedLight(${envVar})), vec3(satinLight(${envVar})), sc.b * ${(s.dull ?? 0.6).toFixed(4)});`;
};

export const VERT = `
attribute float tone;
varying vec3 vWorldPos;
varying vec3 vObjNormal;
varying vec3 vObjPos;
varying vec2 vUv;
varying float vTone;
void main() {
  vTone = tone;
  vObjNormal = normal;
  vObjPos = position;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// 环境按模糊级取：0 是原环境，k 是 env.blur 的第 k 个角度，小数在相邻两级之间插值
export function envLevelExpr(d, lv, count) {
  const name = k => (k === 0 ? 'uEnv' : `uEnvB${k - 1}`);
  const l = Math.max(0, Math.min(lv, count)), i = Math.min(Math.floor(l), count - 1), f = l - i;
  if (count === 0 || f === 0) return `textureCube(${name(Math.min(Math.round(l), count))}, ${d}).rgb`;
  return `mix(textureCube(${name(i)}, ${d}).rgb, textureCube(${name(i + 1)}, ${d}).rgb, ${f.toFixed(4)})`;
}

// 值噪声，几种材质的细颗粒、起伏都用它
export const VNOISE = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), q = fract(p), u = q * q * (3.0 - 2.0 * q);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }`;

