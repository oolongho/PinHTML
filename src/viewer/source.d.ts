/**
 * 虚拟模块类型声明：`virtual:viewer-src` 由 vite.config.ts 的 viewerSourcePlugin 提供，
 * 内容为 src/viewer/index.ts 经 esbuild bundle 后的单个 IIFE 源码字符串（供 exporter 注入）。
 */
declare module 'virtual:viewer-src' {
  const src: string;
  export default src;
}