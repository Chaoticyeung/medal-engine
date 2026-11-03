// 几何：按图案和风格选一种形体。返回 { metal, face, back, reliefs, covered, ctx, uvScale, cord, lathe?, body? }：
// metal 外框和金属丝，face 正面（珐琅和缎面金属），back 背板，reliefs 每块浮雕，cord 锁边绳，lathe 旋转体，body 厚盒
import { buildShell } from './shell.js';
import { buildLathe } from './lathe.js';
import { buildBody } from './body.js';

export function buildGeometry(style, design) {
  if (design.lathe) return buildLathe(style, design);
  if (style.form.body) return buildBody(style, design);
  return buildShell(style, design);
}
