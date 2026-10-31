# PinHTML

> 把 PRD 和原型丢给 AI，拿回一份**钉得住、只讲重点**的标注原型。

原型改了 N 版，发出去没人看得懂改了啥；要改的内容散落在截图、PRD、聊天记录里，对不上号。
PinHTML 把标注**直接钉在 HTML 元素上**，产出两份文件：

| 文件 | 用途 |
| --- | --- |
| `<原型名>.anno.json` | 标注数据，当前真相 |
| `<原型名>-标注.html` | 交付物，双击即见图钉、连线与右侧标注栏；拖回工具还能继续改 |

**它不内置大模型。** 判断交给 agent（Skill），定位与落盘交给 headless CLI——这样 agent 只负责「标什么、怎么写」，工具的每一处落点都确定可复现。

---

## 谁在用

| 谁 | 输入 | 入口 |
| --- | --- | --- |
| **AI agent** | 原型 +（可选）PRD | `pinhtml` CLI + `skills/pinhtml` |
| **人** | 原型 HTML | 浏览器工具 `PinHTML.html`（文件模式 / URL 模式） |

两条路读写同一份数据：AI 落下的标注，人打开 HTML 就能看、能改；人改完的 JSON，AI 下一轮接着用。

---

## AI 用法

### 装 skill（一次）

```bash
# Node ≥ 20 即可，不需要 npm install
cp -R skills/pinhtml ~/.trae-cn/skills/
```

`skills/pinhtml/` 是自包含的：`SKILL.md` + `bin/pinhtml.mjs`（2.1 MB，DOM 解析依赖已内联）。整个目录可直接拷给别人。

### 然后说人话

> 「用 pinhtml 帮我标注这个原型，重点是空态和实时更新那块，别铺太开」

agent 自己跑完这四步，你只看结果：

```bash
pinhtml outline 原型.html                              # 元素清单，selector 可直接复用
pinhtml annotate 原型.html --draft draft.json --dry-run # 试算：stale / skipped / quality
pinhtml annotate 原型.html --draft draft.json          # 落盘，产 .anno.json + -标注.html
pinhtml check 原型-标注.html --strict                   # 自检，0 stale 才 exit 0
```

不满意就继续说：「第 7 条太啰嗦」「空态漏了」，agent 走 `update` / `delete` / 补标再生成一遍。

### 分工

| 谁 | 负责 | 不负责 |
| --- | --- | --- |
| **CLI** | 定位（双证据锚定）、落盘、产出、可机检的质量信号 | 判断哪条该标 |
| **Skill** | 标什么、怎么写、归哪一类、写多少条 | 定位、写文件 |
| **你** | 一句重点方向 + 复核结果 | 记命令、写 JSON |

### 命令面

| 命令 | 用途 |
| --- | --- |
| `outline` | 原型结构树 + 现有标注摘要（agent 的眼睛） |
| `resolve` | 把线索解析成候选元素（线索可疑时先探一步） |
| `list` | 列出现有标注及三态（取 id 的入口） |
| `annotate` | 并入草稿，产交付物；`--dry-run` / `--clean` / `--max-items` / `--strict` |
| `export` | 从已有标注重出交付物，只读输入；`--kind share\|clean` |
| `update` | 改一条标注，回写 `.anno.json` |
| `delete` | 删标注（默认保留锚点），`--ids` 批量 |
| `check` | 逐锚点三态报告，只报不回写 |

输入自动识别：原始原型 / 已标注产物 / `--anno` 指定的 JSON / 同目录旁挂的 `.anno.json`。
退出码：`0` 成功 · `1` 用法错误 · `2` 输入或数据问题 · `3` 仅 `--strict` 下存在 stale。

### 四条硬保证

1. **钉得住才算标注**：`data-anno-id` + selector + snippet 三态证据；0/N 命中也**确定性**标成 stale（哨兵证据），不允许「以为成功了其实没成功」。
2. **精简有约束**：默认 15 条上限；正文超 200 字、空标题、同锚点同标题重复、单一分类、**引用了原型里的 px 数值**、待定问题过多，都会进 `quality.warnings`——只报告，不拦截。
3. **不碰你的原型**：原型本体只读，只新增文件。
4. **多轮不丢数据**：同目录 `.anno.json` 自动作为基线，重跑 `annotate` 是**合并**而不是覆盖；`.anno.json` 损坏直接 exit 2，不静默忽略。

### 质量边界（先说清）

`quality` 只是**代理指标**——它抓条数、字数、分类分布、重复锚点，抓不到「这条到底该不该标」。
「重点」只能由 agent 判断 + 你复核。把它当自动化质量保证会失望；把它当「体检报告」才对。

---

## 人的用法

导入原型 → 切「标注」模式 → 点元素 → 右侧写标注 → 导出 `<原型名>-标注.html`。

- **元素级锚定**：任意元素建锚点，写标题 / 正文 / 四类分类（交互说明、视觉规范、待定问题、一般备注）/ 待确认与已确认。
- **跟随动态 DOM**：切分页、展开折叠、滚动时图钉与连线实时重算；元素被隐藏时图钉淡出，数据不丢。
- **改版自动重绑**：锚点带 `selector + snippet` 双证据，原型改版后自动找回元素；找不到才提示「锚点失联」让你重选。
- **导出单文件**：零外链零 CDN；文件名做了归一，反复「打开产物 → 再导出」不会堆成 `…-标注-标注-标注.html`。
- **JSON 收口**：保存 / 导入 `.anno.json`，按 id 合并（冲突以导入文件为准）。
- **顺手的部分**：删除可撤销、`⌘S` 保存 / `⌘E` 导出 / `Esc` 取消 / `⌘↵` 提交、侧栏搜索与筛选、分类显示名可自定义、文件拖到窗口任意位置都能打开。

### 两种打开方式

| | 文件模式（默认） | URL 模式 |
| --- | --- | --- |
| 怎么用 | 拖入或选择 `.html` / `.htm` | 空状态输入同源服务 URL，如 `http://localhost:8000/proto.html` |
| 原型怎么加载 | 读成文本写入 iframe `srcdoc` | iframe 直接加载真实 URL |
| 相对链接 / 多页跳转 | 会被拦下并提示（srcdoc 没有真实 URL 基准） | 正常跟随；跳页后自动重新注入、重新挂载、按新 DOM 重跑重锚定 |
| 同目录图片 / CSS / JS | 不加载 | 正常加载 |
| 前提 | 无 | **必须与工具同源**：把 `PinHTML.html` 放进原型目录，用同一个服务打开工具 |

```bash
cd 你的原型目录          # 目录里同时放 PinHTML.html 与原型
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/PinHTML.html，再在空状态里填 http://localhost:8000/你的原型.html
```

多页原型下，其他页的锚点显示「属于其他页」而不是「锚点失联」——跳回该页会自动恢复。

---

## 开发

```bash
npm install
npm run dev         # 本地开发
npm run check       # 质量门：typecheck → lint → 单测 → 构建 → build:cli → build:skill
npm run build       # 产出单文件 dist/PinHTML.html（约 477 kB）
npm run test:e2e    # Playwright：CLI 产物导入工具后断言 0 stale
```

产物：

| 命令 | 产物 | 说明 |
| --- | --- | --- |
| `npm run build` | `dist/PinHTML.html` | 浏览器工具，单文件 |
| `npm run build:cli` | `bin/pinhtml.mjs` | 开发用 CLI，`happy-dom` 走外部依赖 |
| `npm run build:skill` | `skills/pinhtml/bin/pinhtml.mjs` | 分发用，依赖已内联，可独立拷走 |

技术栈：Vite 7 + React 19 + TypeScript（strict）+ Tailwind 4 + shadcn/ui + zustand；渲染核心（`src/viewer/`）零 React 依赖，工具内与导出产物共用同一份代码，构建期由 esbuild 打成 IIFE 内联进产物。CLI 侧复用 `src/lib/*`，用 happy-dom 在 Node 里跑同一套锚定逻辑——一份定位实现，三处生效。

测试：187 条单测 + 1 条 Playwright 端到端；GitHub Actions 跑 `npm run check` 与 e2e。

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
| **CLI 不做隐式去重** | 同一份草稿重跑会插入重复条目（`DUPLICATE_ANCHOR` 会告警）；改已有条目用 `update` 或草稿带 `id` |
| **「重点」不可机检** | `quality` 抓不到「该不该标」，靠 agent 判断与人工复核抽样 |

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
| **CLI 需 Node ≥ 20** | 分发版 skill 已内联依赖，无需 `npm install`；开发版 `bin/pinhtml.mjs` 需装 `happy-dom` |
| **URL 模式必须同源** | 跨源地址会被直接拒绝；用 `file://` 双击打开工具时无法使用 URL 模式 |
| **草稿存 localStorage** | 键为 `pinhtml:draft:<原型名>:<protoHash>`，300ms 防抖写入；容量约 5MB，写失败静默吞掉；Safari 在 `file://` 下可能禁用 localStorage，此时草稿静默降级 |
| **浏览器目标** | Chrome / Edge 最近两版为主，Firefox / Safari 兼容但未系统测试 |
| **`npm run build` 用了 `mv`** | Windows 原生命令行跑不通，需 Git Bash / WSL |

---

## 目录速览

```
src/
├── App.tsx          工具壳编排：两种加载模式 / 拖放 / 快捷键 / 草稿 / 关闭保护
├── components/      React UI：顶栏、标注栏、卡片、编辑器、空状态
├── hooks/           useViewer / useAnnotationActions / useProjectActions
├── lib/             框架无关核心：types / store / loading / transport / reanchor / exporter / importer / draft / naming / dom / project-ops
├── cli/             headless CLI：输入识别、八条命令、质量报告
└── viewer/          零 React 依赖的渲染核心：pin / svg / cards / sidebar / mount / bootstrap / geom / style
    └── bridge.js    注入 iframe 的原型侧脚本：事件拦截、拾取高亮、层级键、结构观察、导航守卫

skills/pinhtml/      agent 说明书 SKILL.md + 自包含命令 bin/pinhtml.mjs
scripts/             build-cli.mjs（--standalone 出分发版）
build/               viewer-source.mjs（工具与 CLI 共用同一份渲染核心打包逻辑）
e2e/                 Playwright 回归
```
