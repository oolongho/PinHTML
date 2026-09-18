import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// 单测配置（与构建配置分离）：
// 覆盖 src/lib 下的状态与纯逻辑（编号、三态重绑、导入合并、注入物剥离、srcdoc 组装、store 状态机）
// 与 src/viewer 下的纯几何函数（geom）；React 组件与 DOM 渲染路径不在此列（由构建 + 手动验收覆盖）。
// 环境用 happy-dom 提供 DOMParser / Document。
export default defineConfig({
  // virtual:viewer-src 由构建配置的 esbuild bundle 插件提供；单测中以空模块替身接管，
  // 使 exporter 的组装逻辑（注入顺序 / 转义 / 锚点回放）可被直接断言，无需跨模块补桩。
  plugins: [
    {
      name: 'viewer-src-stub',
      resolveId: (id) => (id === 'virtual:viewer-src' ? '\0viewer-src' : null),
      load: (id) => (id === '\0viewer-src' ? 'export default "";' : null),
    },
  ],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})