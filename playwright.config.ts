/**
 * playwright.config.ts —— 最小端到端回归配置（Task 14）
 *
 * 只验证一条端到端证据：CLI 产出的 `<stem>-标注.html` 拖回工具后，
 * 侧栏能无失联地读回标注（stale = 0）。浏览器只跑 chromium；
 * 走 Vite dev server（不用 file://，避免 file 协议下 localStorage / fetch 行为差异）。
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
