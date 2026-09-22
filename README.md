# PinHTML App

把标注钉在 HTML 原型上，再连标注带原型打包成**一个 HTML 文件**发出去。纯本地、无服务器、双击即用。

```
打开原型 → 切「标注」模式 → 点元素 → 右侧写标注 → 导出 HTML
```

导出的文件里自带只读标注栏、图钉与虚线连线，收件人不需要装任何东西；再把它拖回工具还能继续改。

---

## 它能做什么

- **元素级锚定**：点原型上的任意元素创建锚点，写标题 / 正文 / 四类分类（交互说明、视觉规范、待定问题、一般备注）/ 待确认与已确认状态。
- **跟随动态 DOM**：切分页、展开折叠、滚动时图钉与连线实时重算；元素被隐藏时图钉淡出，标注数据不丢。
- **改版自动重绑**：锚点带 `selector + snippet` 双证据，原型改版后自动找回元素；实在找不到才提示「锚点失联」并让你重新选。
- **导出单文件**：`<原型名>-标注.html`，零外链零 CDN；文件名做了归一，反复「打开导出产物 → 再导出」不会堆成 `…-标注-标注-标注.html`。
- **JSON 收口**：保存 / 导入 `.anno.json`，按 id 合并（冲突以导入文件为准），适合收集多人意见。
- **顺手的部分**：删除可撤销、`⌘S` 保存 / `⌘E` 导出 / `Esc` 取消 / `⌘↵` 提交、侧栏搜索与筛选、分类显示名可自定义、文件拖到窗口任意位置都能打开。
- **两种打开方式**：默认的**文件模式**（拖入 / 选择本地 HTML），以及**URL 模式**（见下）。

## 两种打开方式

| | 文件模式（默认） | URL 模式 |
| --- | --- | --- |
| 怎么用 | 拖入或选择 `.html` / `.htm` | 空状态输入同源服务 URL，如 `http://localhost:8000/proto.html` |
| 原型怎么加载 | 读成文本写入 iframe `srcdoc` | iframe 直接加载真实 URL |
| 相对链接 / 多页跳转 | 会被拦下并提示（srcdoc 没有真实 URL 基准） | 正常跟随；跳页后自动重新注入、重新挂载、按新 DOM 重跑重锚定 |
| 同目录图片 / CSS / JS | 不加载 | 正常加载 |
| 前提 | 无 | **必须与工具同源**：把 `PinHTML.html` 放进原型目录，用同一个服务打开工具 |

URL 模式的一行命令示例：

```bash
cd 你的原型目录          # 目录里同时放 PinHTML.html 与原型
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/PinHTML.html，再在空状态里填 http://localhost:8000/你的原型.html
```

多页原型下，其他页的锚点会显示「属于其他页」而不是「锚点失联」——跳回该页会自动恢复。

## 快速开始（开发）

```bash
npm install
npm run dev        # 本地开发（HMR）
npm run check      # 质量门：typecheck → lint → 单测 → 构建
npm run build      # 产出单文件 dist/PinHTML.html
```

其它命令：`npm run typecheck`（仅类型检查）、`npm run lint`（oxlint）、`npm run test`（vitest）、`npm run preview`（预览产物）。

技术栈：Vite 7 + React 19 + TypeScript（strict）+ Tailwind 4 + shadcn/ui + zustand；渲染核心（`src/viewer/`）是零 React 依赖的原生 TS，工具内与导出产物共用同一份代码，构建期由 esbuild 打成 IIFE 内联进产物。

---

## 已知限制

### 能力边界

| 限制 | 说明 |
| --- | --- |
| **一次只能打开一个原型** | viewer 是模块级单实例，同时只支持一份原型 + 一个渲染实例 |
| **不能原地保存原型文件** | 浏览器写不了磁盘：改动的是标注数据，产物靠下载 JSON / HTML 获得 |
| **URL 模式下导出仍是单页** | 产物只含「首次打开那一页」的干净源；其他页的标注保留在 JSON 里但不进产物；同目录资源也不会内联，发给别人要连资源一起给 |
| **未提交的编辑不进导出** | 编辑器还开着时直接导出，只包含已提交的标注，且不会二次提醒 |
| **只做元素锚点** | 没有截图、画笔、框选区域标注，也没有评论回复串 |

### 形态取舍（有意为之）

| 取舍 | 代价 |
| --- | --- |
| **同源直连，无 postMessage 通道** | 原型页面理论上能访问父页 DOM——**只打开你信任的原型文件**。换 postMessage 可解，但需要重写跨文档通道 |
| **文件模式会拦下原型内的跳转** | srcdoc 文档没有真实 URL 基准，相对链接 / 绝对外链 / 表单提交会被 `preventDefault` 并提示（否则 iframe 会加载工具自身或变空白页）。需要这些行为请用 URL 模式 |
| **注入物统一 `pinhtml-` 前缀** | 原型自身的 `id` / `class` 不能以 `pinhtml-` 开头，否则会被当成注入物剥离 |
| **可访问性未打磨** | 卡片是 `div + onClick`（不是按钮），键盘无法遍历卡片，也没有成体系的 `aria-*` |

### 运行环境

| 限制 | 说明 |
| --- | --- |
| **URL 模式必须同源** | 跨源地址会被直接拒绝；用 `file://` 双击打开工具时无法使用 URL 模式（内容直连拿不到跨源文档） |
| **草稿存 localStorage** | 键为 `pinhtml:draft:<原型名>:<protoHash>`，300ms 防抖写入；容量约 5MB，写失败静默吞掉；Safari 在 `file://` 下可能禁用 localStorage，此时草稿静默降级（不报错） |
| **浏览器目标** | Chrome / Edge 最近两版为主，Firefox / Safari 兼容但未系统测试 |
| **`npm run build` 用了 `mv`** | Windows 原生命令行跑不通，需 Git Bash / WSL |
| **无 CI** | 没有 `.github/workflows`，`npm run check` 靠手动执行 |

---

## 目录速览

```
src/
├── App.tsx          工具壳编排：两种加载模式 / 拖放 / 快捷键 / 草稿 / 关闭保护
├── components/      React UI：顶栏、标注栏、卡片、编辑器、空状态
├── hooks/           useViewer（渲染实例生命周期）/ useAnnotationActions / useProjectActions
├── lib/             框架无关核心：types / store / loading / transport / reanchor / exporter / importer / draft / naming / dom
├── viewer/          零 React 依赖的渲染核心：pin / svg / cards / sidebar / mount / bootstrap / geom / style
└── bridge.js        注入 iframe 的原型侧脚本：事件拦截、拾取高亮、层级键、结构观察、导航守卫
```

更细的设计与验收口径见仓库根目录的 `原型标注工具-开发方案.md` 与 `.trae/specs/build-pinhtml-tool/`（spec / tasks / checklist）。
