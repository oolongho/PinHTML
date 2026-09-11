import { build as esbuild } from 'esbuild'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// PinHTML 构建配置（spec R12 / D5）：
// - dev：常规 Vite 开发服务器（HMR）
// - build：vite-plugin-singlefile 将全部资源内联为单文件 dist/index.html，
//   再由 package.json 的 build 脚本重命名为 dist/PinHTML.html（零外链零 CDN，双击即用）

/**
 * 虚拟模块 `virtual:viewer-src`：把 src/viewer/index.ts 经 esbuild bundle 为单个
 * IIFE 字符串。spec「viewer 纯 JS、零导入」约束只针对**运行时产物**——导出时注入
 * 的 #pinhtml-runtime 必须是自我包含的 IIFE；源码层则用 ES import 拆成多模块。
 * 工具侧照常 `import '@/viewer'` 走 Vite 的正常依赖图。
 */
function viewerSourcePlugin(): Plugin {
  const entry = fileURLToPath(new URL('./src/viewer/index.ts', import.meta.url))
  return {
    name: 'pinhtml:viewer-source',
    resolveId(id) {
      if (id === 'virtual:viewer-src') return '\0virtual:viewer-src'
      return null
    },
    async load(id) {
      if (id !== '\0virtual:viewer-src') return null
      const result = await esbuild({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2019',
        minify: false,
        logLevel: 'silent',
      })
      const code = result.outputFiles[0].text
      // 产物文本作为字符串默认导出，供 exporter.ts 读取注入导出 HTML
      return `export default ${JSON.stringify(code)};`
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viewerSourcePlugin(), viteSingleFile()],
  build: {
    // 单文件分发（D5）：把图片等静态资源一律内联为 base64 data URI，
    // 避免生成 dist/assets/*.png 之类的独立文件破坏「零外链、双击即用」
    assetsInlineLimit: 1024 * 1024,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})