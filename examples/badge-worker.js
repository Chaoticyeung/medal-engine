// 后台线程的脚本：页面那边是 worker.html。three.js 和 clipper-lib 的地址由页面在 init 消息里给
import { runBadgeWorker } from '../src/worker.js';

runBadgeWorker();
