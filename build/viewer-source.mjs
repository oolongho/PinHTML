/**
 * viewer-source.mjs —— 把 src/viewer/index.ts 经 esbuild 打成自我包含的 IIFE 源码。
 *
 * 职责：供 vite 插件（virtual:viewer-src）与 CLI 构建脚本共用同一份打包逻辑，
 * 保证「工具内导出的 viewer 运行时」与「CLI 内置的 viewer 运行时」完全一致，
 * 避免两处 esbuild 选项漂移。entry 基于本文件位置解析，不依赖进程 cwd。
 */
import { build as esbuild } from 'esbuild'
import { fileURLToPath } from 'node:url'

const ENTRY = fileURLToPath(new URL('../src/viewer/index.ts', import.meta.url))

/** 返回 src/viewer/index.ts 的 IIFE 源码字符串（未压缩，供导出时注入 <script>） */
export async function bundleViewerSource() {
  const result = await esbuild({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    minify: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}
