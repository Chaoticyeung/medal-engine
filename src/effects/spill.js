// 自发光照到附近（output.spill = { radius, metal, enamel }）：正面和正面浮雕的自发光贴图拼到正面 UV 上、模糊 radius，
// 着色时金属加 模糊后的光 × 金属色 × metal，珐琅加 × enamel（珐琅本身反光弱，多半已在图案里画过）。贴图在 paint.js 的 paintSpill
export const spillLine = (style, what, color) => {
  const k = style.output.spill?.[what];
  return k ? `gl_FragColor.rgb += texture2D(uSpill, vUv).rgb * ${color} * ${(k * (style.output.emissiveGain ?? 1)).toFixed(4)};` : '';
};
