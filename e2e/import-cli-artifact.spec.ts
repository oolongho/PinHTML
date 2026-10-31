/**
 * import-cli-artifact.spec.ts —— CLI 产物读回的最小端到端回归（Task 14）
 *
 * 目标断言：把 CLI 产出的 `<stem>-标注.html` 导入工具后，**stale 计数为 0**。
 *
 * UI 入口定位（读 src/App.tsx 得到）：
 * - 顶栏「打开原型」按钮 → App 顶层隐藏 `<input type="file" accept=".html,.htm">`；
 *   空状态里也有一个同 accept 的 input（两者最终都走 handleFile，等价）。
 *   这里用 `last()` 取 App 那个，最贴近顶栏入口，且无需先点击按钮。
 * - 产物是导出格式（内嵌 #pinhtml-data），打开即「续编」恢复项目，不需要走「导入JSON」。
 *
 * stale 的可见状态定位（读 src/components/AnnoPanel.tsx / AnnoCard.tsx 得到）：
 * - 界面上**没有**直接的 stale 计数。侧栏头只有「标注 N · 待确认 M」。
 * - stale 只在卡片上以文本「锚点失联」+「重新选择锚点」按钮呈现。
 * 因此这里的等价断言是：
 *   ① CLI 侧 `check --strict` 的 stale 已为 0（夹具前置）；
 *   ② 侧栏显示「标注 2 · 待确认 2」，且 2 张卡片都不含「锚点失联」；
 *   ③ iframe 内 2 个锚点元素带 data-anno-id，且 viewer 渲染出 2 个图钉
 *      —— 证明锚点确实被解析到，而不是靠「初始 stale 集合为空」蒙混过关。
 * 注：UI 目前没有 data-testid 锚点，后续建议给侧栏统计与卡片补 data-testid。
 */
import { expect, test } from '@playwright/test'
import { createCliFixture, type CliFixture } from './fixture'

let fixture: CliFixture

test.beforeAll(() => {
  // CLI 生成产物，并已跑过 check --strict（有 stale 会在这里直接失败）
  fixture = createCliFixture()
})

test('CLI 产出的 -标注.html 导入后锚点全部命中（stale = 0）且标注 2 条', async ({ page }) => {
  // 0) 前置：CLI 侧数据无失联
  expect(fixture.stale).toBe(0)
  expect(fixture.anchorCount).toBe(2)

  await page.goto('/')

  // 1) 通过「打开原型」对应的文件输入导入 CLI 产物（App 顶层 input 在 DOM 中最后）
  await page
    .locator('input[type="file"][accept=".html,.htm"]')
    .last()
    .setInputFiles(fixture.artifactPath)

  // 2) 侧栏统计：两条标注、都处于待确认（CLI 新建标注默认 open）
  const sidebar = page.locator('aside')
  await expect(sidebar.getByText(/标注 2 · 待确认 2/)).toBeVisible()

  // 3) 标注卡片 2 条，且没有「锚点失联」/「重新选择锚点」
  await expect(page.locator('#annoList .pinhtml-card')).toHaveCount(2)
  await expect(page.locator('body')).not.toContainText('锚点失联')
  await expect(page.locator('body')).not.toContainText('重新选择锚点')

  // 4) 原型侧证据：CLI 回写的 data-anno-id 被读到，viewer 为两条锚点各渲染一个图钉
  const prototype = page.frameLocator('iframe[title="原型"]')
  await expect(prototype.locator('[data-anno-id]')).toHaveCount(2)
  await expect(prototype.locator('#pinhtml-pinlayer .pinhtml-pin')).toHaveCount(2)
})
