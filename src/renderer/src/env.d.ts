/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// window.electronAPI 类型直接来自 preload 实际暴露对象（type-only import，编译后擦除）。
import type { PreloadApi } from '../../preload';

declare global {
  interface Window {
    electronAPI: PreloadApi;
  }
}
