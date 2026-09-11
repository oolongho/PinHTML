/**
 * viewer/index.ts —— viewer 入口（spec R5「同一份代码，双上下文」）
 *
 * 职责：组装顶层 API 挂到 window.PinHTMLViewer，并在导入时触发生成导出自举检测。
 * - 工具内：main.tsx `import '@/viewer'` 副作用注册 window.PinHTMLViewer，供 React 侧 mount；
 *   导出自举检测因父文档无 #pinhtml-data 而直接 return。
 * - 导出产物：esbuild 将本入口 bundle 为单 IIFE 注入 #pinhtml-runtime，执行时检测到
 *   #pinhtml-data 即自举只读实例。
 *
 * 注意：本模块源码（含其依赖链）不得出现字面 `</script`。
 */
import { mount } from './mount';
import { bootstrap } from './bootstrap';
import type { PinHTMLViewerApi } from './types';

const api: PinHTMLViewerApi = { mount };

declare global {
  interface Window {
    /** 工具侧 mount 入口；导出产物 IIFE 执行后同样挂载（但只读路径由 bootstrap 自动接管） */
    PinHTMLViewer?: PinHTMLViewerApi;
  }
}

if (typeof window !== 'undefined') {
  window.PinHTMLViewer = api;
  // 导出产物自举触发（工具父文档无 #pinhtml-data，此处等价 no-op）
  bootstrap();
}