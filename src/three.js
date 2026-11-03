// three.js 由使用方提供，引擎各模块都从这里取。页面里用 index.js，它 import 'three'（靠 importmap 或打包工具解析）；
// 后台线程里没有 importmap，worker.js 按给定的地址加载以后交给 setThree
export let THREE = null;
export function setThree(ns) { THREE = ns; }
