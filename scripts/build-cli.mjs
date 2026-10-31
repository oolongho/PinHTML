/**
 * build-cli.mjs —— 把 headless CLI 打成单文件可执行。
 *
 * 两个产物：
 * - 默认 → `bin/pinhtml.mjs`：开发用，`happy-dom` 保持为运行时外部依赖（产物小、构建快，需 npm install）。
 * - `--standalone` → `skills/pinhtml/bin/pinhtml.mjs`：分发用，把 happy-dom 内联进产物，
 *   整个 skills/pinhtml 目录自包含（只要求目标机器有 Node ≥ 20，无需 npm install）。
 *   内联后 happy-dom 的依赖 `ws` 里有 CJS 动态 require，ESM 下需要注入 createRequire 兜底。
 * viewer 运行时经 `virtual:viewer-src` 在构建期现场 bundle 后内联。
 */
import { chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import { bundleViewerSource } from '../build/viewer-source.mjs'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ENTRY = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url))
const VIRTUAL = 'virtual:viewer-src'

/** 分发版：走 --standalone（由 `npm run build:skill` 调用） */
const standalone = process.argv.includes('--standalone')
const OUT = fileURLToPath(
  new URL(standalone ? '../skills/pinhtml/bin/pinhtml.mjs' : '../bin/pinhtml.mjs', import.meta.url),
)

/** 虚拟模块 `virtual:viewer-src`：内容与 vite.config.ts 插件保持一致 */
const viewerSourcePlugin = {
  name: 'pinhtml:viewer-source',
  setup(build) {
    build.onResolve({ filter: /^virtual:viewer-src$/ }, () => ({ path: VIRTUAL, namespace: 'pinhtml-virtual' }))
    build.onLoad({ filter: /.*/, namespace: 'pinhtml-virtual' }, async () => ({
      contents: `export default ${JSON.stringify(await bundleViewerSource())};`,
      loader: 'js',
    }))
  },
}

await esbuild({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: standalone
      ? [
          '#!/usr/bin/env node',
          "import { createRequire as __pinhtmlCreateRequire } from 'node:module';",
          'const require = __pinhtmlCreateRequire(import.meta.url);',
        ].join('\n')
      : '#!/usr/bin/env node',
  },
  external: standalone ? [] : ['happy-dom'],
  alias: { '@': SRC },
  logLevel: 'warning',
  plugins: [viewerSourcePlugin],
})

await chmod(OUT, 0o755)
