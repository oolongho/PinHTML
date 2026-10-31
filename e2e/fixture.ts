/**
 * e2e/fixture.ts —— 用真实 CLI 生成回归夹具（Task 14）
 *
 * 流程与用户/agent 的实际用法完全一致：
 *   node bin/pinhtml.mjs annotate <真实原型> --draft <草稿> --out <临时目录>
 * 产出 `<stem>.anno.json` + `<stem>-标注.html`，再跑一次 `check --strict`。
 *
 * `check --strict` 必须在 UI 断言之前就 exit 0：
 * 这样一旦失败能立刻区分是「CLI 落的数据本身有 stale」还是「UI 读回有问题」。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** app/ 目录（本文件位于 app/e2e/） */
const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const CLI = path.join(APP_DIR, 'bin', 'pinhtml.mjs')
/** 真实夹具原型（app/ 的上一级 test/） */
const PROTOTYPE = path.resolve(APP_DIR, '..', 'test', 'OrbitBoard-压力测试原型.html')

/** 样例草稿：2 条均已实测 fresh（selector + text 双证据） */
const DRAFT = {
  items: [
    {
      clue: { selector: 'body > header.topbar > div.logo > span.badge', text: 'v0.9 原型' },
      title: '版本徽标标的是原型阶段',
      body: '正式版移除。',
      color: 'question',
    },
    {
      clue: { selector: 'body > header.topbar > button#btn-live', text: '实时更新' },
      title: '实时更新默认开启',
      body: '关闭后手动刷新，轮询 30s。',
      color: 'interaction',
    },
  ],
}

/** 夹具信息（供用例读取） */
export interface CliFixture {
  /** CLI 产出的 `<stem>-标注.html` 绝对路径 */
  artifactPath: string
  /** CLI `check --strict` 的 stale 计数（必须为 0） */
  stale: number
  /** CLI 侧锚点数（= 草稿条数） */
  anchorCount: number
}

/** check 命令的 JSON 输出（只取用例需要的字段） */
interface CheckOutput {
  counts: { fresh: number; moved: number; stale: number }
  anchors: unknown[]
}

/**
 * 生成夹具并做 CLI 侧前置校验。
 * annotate 的退出码非 0、或 check --strict 报 stale 时直接抛错（定位在 CLI 侧）。
 */
export function createCliFixture(): CliFixture {
  const outDir = mkdtempSync(path.join(tmpdir(), 'pinhtml-e2e-'))
  const draftPath = path.join(outDir, 'draft.json')
  writeFileSync(draftPath, JSON.stringify(DRAFT), 'utf8')

  execFileSync(
    process.execPath,
    [CLI, 'annotate', PROTOTYPE, '--draft', draftPath, '--out', outDir],
    { cwd: APP_DIR, encoding: 'utf8' },
  )

  const artifactPath = path.join(outDir, 'OrbitBoard-压力测试原型-标注.html')

  // 先证明 CLI 落的数据是 stale = 0：退出码 3 会抛异常，错误里带 stderr
  const checkJson = execFileSync(
    process.execPath,
    [CLI, 'check', artifactPath, '--strict'],
    { cwd: APP_DIR, encoding: 'utf8' },
  )
  const check = JSON.parse(checkJson) as CheckOutput
  if (check.counts.stale !== 0) {
    throw new Error(`CLI 前置校验失败：stale = ${check.counts.stale}，不是 0`)
  }

  return { artifactPath, stale: check.counts.stale, anchorCount: check.anchors.length }
}
