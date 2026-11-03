// 勋章渲染引擎的入口。分三层：
//   引擎（src/）：球面薄壳、金属丝并集几何、"环境亮度^k" 着色、环境图、反射方向、转动物理，和风格无关；
//   风格：比例、材质系数、金属色、色板、环境布光、反射模型、相机、手感；
//   图案：外形轮廓、金属丝笔画、珐琅分区、浮雕、背面文字。
// 依赖：three（import 'three'，由 importmap 或打包工具解析）和全局的 ClipperLib（clipper-lib 6.4.2）
import * as THREE from 'three';
import { setThree } from './three.js';

setThree(THREE);
export * from './core.js';
