---
name: pinhtml
description: 把 PRD 与 HTML 原型转成「标注好的原型」：用 pinhtml CLI 落标注，要求每条都钉得住（0 stale）且只讲关键。当用户给出 HTML 原型、要求评审 / 找问题 / 补标注 / 把 PRD 落到元素上时使用。
---

# PinHTML 标注

## 这个 skill 做什么

输入原型 HTML（可选加 PRD）。输出两份：

- `<stem>.anno.json` — 标注数据（当前真相，覆盖写）
- `<stem>-标注.html` — 完整交付物，双击即见针脚、连线与右侧标注栏；拖回 PinHTML 工具同样 0 stale

你负责**判断**：标什么、写什么、归哪类。CLI 只负责**定位与落盘**。
默认策略：**重点驱动，少而准**——8-15 条钉在关键处，胜过 40 条均匀铺开。

## 前置

按顺序找可用的 CLI，找到就停：

1. **本 skill 目录下的 `bin/pinhtml.mjs`** — 随 skill 一起分发，依赖已内联（约 2 MB），只要目标机器有 Node ≥ 20 就能直接跑，不需要 `npm install`
2. PATH 里的 `pinhtml`
3. `<PinHTML 仓库>/app/bin/pinhtml.mjs` — 开发环境用，需先在仓库的 `app/` 下跑一次 `npm run build:cli`

下面的命令统一写成 `pinhtml`，按上面选中的形态替换即可。退出码：`0` 成功 / `1` 用法错误 / `2` 输入或数据问题 / `3` 仅 `--strict` 下存在 stale。

## 输入档位

| 档位 | 判断依据 |
| --- | --- |
| ① 只有原型 | 标「看得懂，但照着做会做错」的地方 |
| ② 原型 + PRD | PRD **只用来判断哪些是重点**，不做逐条覆盖；落到的地方把 `source` 记成 `PRD §x.y` |

## 五步工作流

1. **看** — `pinhtml outline 原型.html`
   拿元素清单与现有标注摘要。每个节点的 `selector` 与 `text` 可以直接原样复用。
2. **选** — 按「重点判定」筛，按「写法」写，按「四分类」归类。
3. **落草稿** — 写成草稿 JSON（格式见下）。
4. **收敛** — `pinhtml annotate 原型.html --draft draft.json --dry-run`
   看 `counts.stale`；有 stale 就回 `outline` 改线索，重复到 `stale: 0`。`skipped` 里的项要修，不能放过。
5. **落盘** — 去掉 `--dry-run` 正式执行，然后读 stdout 的 `quality` 块自评；必要时补标或精简后再跑一次。

交付前可选自检：`pinhtml check 原型-标注.html --strict`（0 stale 才 exit 0）。

## 重点判定

**该标**（不加就会做错的）：

- 状态与交互后果：点了会怎样、为什么禁用、撤销怎么走
- 隐藏规则与默认值：默认开/关、默认选中、默认排序
- 边界与空态：没有数据时显示什么、超限怎么提示
- **唯一**的视觉数值来源：间距 / 字号 / 色值的定义处（其它地方重复的不标）
- 跨组件一致性约束：A 变了 B 必须跟着变
- 待定决策：设计没定、需要人拍板的地方

**不该标**（删掉不影响任何人）：

- 可见即所得的（「这是保存按钮」）
- 复述 PRD 原文、没有新增信息的
- 同一个事实已经标在别处的

**判据一句话**：**不加这条，开发/设计会做错；加了这条，读者不用问第二遍。**

## 写法

- `title` 写**一句断言**：「生成中两个按钮都禁用」；不写名词短语「按钮状态」。
- `body` = 结论 + 依据或例外。能删的字就删，建议 ≤ 200 字（超过 200 只报警告，不拦截）。
- 条数预算默认 **8-15**（`--max-items N` 可调）。超了就**合并同类**或降级为 `note`，不要靠删标凑数。

## 四分类

| color | 语义 | 典型内容 |
| --- | --- | --- |
| `interaction` | 交互与状态 | 点击后果、禁用条件、状态机 |
| `visual` | 视觉规范 | 间距、字号、色值的唯一定义处 |
| `question` | 待定问题 | 设计未定、需要拍板 |
| `note` | 一般备注 | 不属于以上三类，但仍然必要 |

## 四条硬规则

1. **线索原样复制**：`clue.selector` / `clue.text` 优先照抄 `outline` 输出。`text` 是**精确相等**比对（40 字截断），改写即断掉第二证据。
2. **一条标注 = 一个元素**：同一元素有多个问题就写多条（会共用锚点），不要糅成一段。
3. **拿不准怎么办**：拿不准**语义**（这个交互该怎么设计）→ 用 `question`；拿不准**位置** → 回 `outline` 重取线索，不要猜 selector。
4. **交付前 0 stale**：`--dry-run` 里出现 stale 就回去改线索。带着 stale 交付等于把问题推给读者。

## 草稿格式

```json
{
  "proto": "原型.html",
  "items": [
    {
      "source": "PRD §3.2",
      "clue": { "selector": "body > div.app > main > div.card:nth-of-type(1) > div.card-head", "text": "图片生成" },
      "title": "卡头只显示任务类型",
      "body": "左侧图片/视频，右侧 undo/redo。生成中两者禁用。",
      "color": "interaction"
    }
  ]
}
```

- `proto` 可选，仅作人工核对。
- `clue` 两字段缺省为空串：只给 `selector` 就只按 selector 唯一命中；只给 `text` 走全文档文本唯一兜底；两者都给才走双证据链。
- `id` 可选：给了且已存在 → **更新**该标注（改已有标注用这个）；不给 → 新建。
- `source` 可选，仅作人工追溯。

## 命令速查

| 命令 | 用途 | 关键选项 |
| --- | --- | --- |
| `outline <input>` | 元素清单 + 现有标注摘要 | `--all` `--depth N` `--text` |
| `resolve <input>` | 线索 → 候选元素（线索可疑时先探一步） | `--text S` / `--selector S` `--limit N` |
| `list <input>` | 列出现有标注及三态（取 id 的入口） | `--state fresh\|moved\|stale` |
| `annotate <input>` | 并入草稿并产交付物 | `--draft F` `--dry-run` `--clean` `--out DIR` `--max-items N` `--strict` |
| `export <input>` | 从已有标注重出交付物（只读输入） | `--kind share\|clean`（默认 share）`--out DIR` |
| `update <input>` | 改一条标注 | `--id a-N` `--title` `--body` `--color` `--status` |
| `delete <input>` | 删标注（默认保留锚点） | `--id a-N` 或 `--ids a-1,a-2` `--anchor` |
| `check <input>` | 逐锚点三态报告，只报不回写 | `--text` `--strict` |

## 读回已有标注

`annotate 原型.html` 会写 `<stem>.anno.json`。只要它和原型在同一目录，后续命令会**自动**把它当基线（stderr 会打一行「使用同目录标注数据」）：

- `pinhtml list 原型.html` 直接读到已有标注，不用每次指路
- 想换一份数据：`--anno 其它.json`

例外：原型挪了位置或改了名，旁挂 json 就对不上；这时显式 `--anno`，或直接读产物 `pinhtml list 原型-标注.html`。

## 重跑不会清空，但也不会去重

`annotate` 是**合并**，不是覆盖：重跑不会删掉已有标注。但它**不做隐式去重**——同一份草稿再跑一次，已存在的条目会被当成新条目再插一遍（`quality.warnings` 的 `DUPLICATE_ANCHOR` 会提示）。

改已有条目的两条路：草稿里带上 `id`（走更新），或直接 `pinhtml update ... --id a-3`。补标时草稿只放**新增**条目。

## 交付物怎么给用户

- 给人看：`<stem>-标注.html`（双击即见标注）
- 给下游 agent 改原型：加 `--clean` 同时出 `<stem>.annotated.html`（无运行时噪音，只带回写锚点）

## 不做什么

- 不修改原型本体（工具只写新文件）。
- 不改用户已有标注的措辞去「凑齐」条数。
- 不逐条翻译 PRD。PRD 是判断重点的依据，不是待办清单。
