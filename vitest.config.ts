import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// 单测配置（与构建配置分离）：
// 仅覆盖 src/lib 下的纯逻辑（编号、三态重绑、导入合并、注入物剥离、srcdoc 组装等），
// 环境用 happy-dom 提供 DOMParser / Document。viewer 与 React 组件不在此列（由构建 + 手动验收覆盖）。
export default defineConfig({
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