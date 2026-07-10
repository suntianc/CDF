// window.electronAPI 类型直接来自 preload 实际暴露对象（type-only import，编译后擦除）。
// 单独成文件：带顶层 import 的 d.ts 是模块，混入 ambient 声明会使 shorthand declare module 失效。
import type { PreloadApi } from '../../preload';

declare global {
  interface Window {
    electronAPI: PreloadApi;
  }
}

export {};
