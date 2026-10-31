/**
 * annotate.ts —— `pinhtml annotate` 命令（spec R5 / DC2 / DC5 / DC6 / DC7 / DC10）
 *
 * 职责：读草稿 JSON → 逐条把 clue 解析成锚点证据（唯一命中写真实 selector/snippet，
 * 0/N 命中写哨兵证据）→ 经 project-ops 合入项目（带 id 且已存在则更新）→ 生成质量报告
 * → 落盘 `<stem>.anno.json` + `<stem>-标注.html`（`--clean` 追加 `<stem>.annotated.html`）。
 *
 * 边界：
 * - 每条草稿项独立处理，一条校验失败只进 skipped，不影响其余（DC2：不禁止写入）；
 * - 原型本体只读（DC10）：不改 `ctx.inputPath`，目标路径与它重合时跳过该文件并告警；
 * - `--dry-run` 走完同样的校验 / 解析 / 统计，但一个文件都不写；
 * - `--strict` 只在存在 stale 时 exit 3；质量 warning 不改变退出码。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSelector, getSnippet } from '@/lib/dom';
import { buildAnnotatedHtml, buildExportHtml } from '@/lib/exporter';
import { annoJsonName, cleanHtmlName, exportHtmlName } from '@/lib/naming';
import { addAnnotation, updateAnnotation } from '@/lib/project-ops';
import { resolveAnchor, type ReanchorState } from '@/lib/reanchor';
import type { Anchor, Category, Project } from '@/lib/types';
import type { Args } from '../args';
import { warn } from '../io';
import { DEFAULT_MAX_ITEMS, reviewDraft, type QualityReport } from '../quality';
import type { CliContext, CommandResult } from '../types';

/** 探针锚点 id：真实锚点为 e-N，此值不可能在原型中出现 */
const PROBE_ID = '__pinhtml_probe__';

/** 失联哨兵证据（R5）：两条证据都不可能等于任何真实元素，resolveAnchor 确定性返回 stale */
const SENTINEL_SELECTOR = '[data-anno-id="__unbound__"]';
const SENTINEL_SNIPPET = '\u0000pinhtml-unbound';

/** 草稿字段约束（R5 / R9） */
const MAX_TITLE_LENGTH = 60;
const MAX_BODY_LENGTH = 2000;

/** 四分类（顺序与 types 保持一致） */
const CATEGORIES: readonly Category[] = ['interaction', 'visual', 'question', 'note'];

/** 校验通过的草稿项（selector / snippet 即 clue 的两个字段） */
interface DraftItem {
  /** 可选：命中既有标注则走更新（DC7） */
  id?: string;
  /** 可选：人工追溯标签 */
  source?: string;
  /** clue.selector（缺省空串） */
  selector: string;
  /** clue.text（缺省空串） */
  snippet: string;
  title: string;
  body: string;
  color: Category;
}

/** 单项校验结果 */
type ItemCheck = { ok: true; value: DraftItem } | { ok: false; reason: string };

/** 逐条应用结果（stdout 的 applied） */
interface AppliedItem {
  /** 草稿 items 下标（0 起） */
  index: number;
  /** 落到（或更新为）的标注 id */
  annotationId: string;
  /** 标注当前挂载的锚点 id */
  anchorId: string;
  /** 锚点相对当前干净源的三态（唯一命中 = fresh，未命中 = stale） */
  state: ReanchorState;
}

/** 跳过项（stdout 的 skipped） */
interface SkippedItem {
  index: number;
  reason: string;
}

/** 命令 stdout 报告 */
export interface AnnotateReport {
  applied: AppliedItem[];
  skipped: SkippedItem[];
  counts: Record<ReanchorState, number>;
  quality: QualityReport;
  /** 实际写盘的文件绝对路径（--dry-run 时为空数组） */
  written: string[];
}

/** fs 错误的可读描述（不假设具体错误类型） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 分类合法性判定（顺带完成类型收窄） */
function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** 读取字符串型选项：未给 → 无；给了空值 / 非字符串 → 用法错误 */
function readStringOption(args: Args, key: string, label: string): { value?: string; error?: string } {
  const raw = args.options[key];
  if (raw === undefined) return {};
  if (typeof raw !== 'string' || raw.length === 0) return { error: `${label}需要一个值` };
  return { value: raw };
}

/** 解析 --max-items：缺省 15；非正整数 → 用法错误 */
function readMaxItems(args: Args): { value: number } | { error: string } {
  const raw = args.options['max-items'];
  if (raw === undefined) return { value: DEFAULT_MAX_ITEMS };
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
    return { error: '--max-items 需要一个正整数' };
  }
  return { value: Number(raw) };
}

/**
 * 单项校验（R5 / R9）：title 必填且 ≤60、body ≤2000、color 四类之一（缺省 interaction）、
 * clue 两字段均为字符串（缺省空串）、id / source 可选字符串。
 * 失败返回可读原因，由调用方记入 skipped（不影响其余项）。
 */
function checkItem(raw: unknown): ItemCheck {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '草稿项不是对象' };
  }
  const item = raw as Record<string, unknown>;

  if (typeof item.title !== 'string') return { ok: false, reason: 'title 缺失或不是字符串' };
  if (item.title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `title 超过 ${MAX_TITLE_LENGTH} 字` };
  }

  const body = item.body === undefined ? '' : item.body;
  if (typeof body !== 'string') return { ok: false, reason: 'body 不是字符串' };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, reason: `body 超过 ${MAX_BODY_LENGTH} 字` };
  }

  const color = item.color === undefined ? 'interaction' : item.color;
  if (typeof color !== 'string' || !isCategory(color)) {
    return { ok: false, reason: 'color 不是 interaction | visual | question | note' };
  }

  const clue = item.clue === undefined || item.clue === null ? {} : item.clue;
  if (typeof clue !== 'object' || Array.isArray(clue)) return { ok: false, reason: 'clue 不是对象' };
  const clueFields = clue as Record<string, unknown>;
  const selector = clueFields.selector === undefined ? '' : clueFields.selector;
  const snippet = clueFields.text === undefined ? '' : clueFields.text;
  if (typeof selector !== 'string') return { ok: false, reason: 'clue.selector 不是字符串' };
  if (typeof snippet !== 'string') return { ok: false, reason: 'clue.text 不是字符串' };

  if (item.id !== undefined && (typeof item.id !== 'string' || item.id.length === 0)) {
    return { ok: false, reason: 'id 不是非空字符串' };
  }
  if (item.source !== undefined && typeof item.source !== 'string') {
    return { ok: false, reason: 'source 不是字符串' };
  }

  const value: DraftItem = {
    selector,
    snippet,
    title: item.title,
    body,
    color,
    ...(typeof item.id === 'string' ? { id: item.id } : {}),
    ...(typeof item.source === 'string' ? { source: item.source } : {}),
  };
  return { ok: true, value };
}

/** 读取草稿文件：不可读 / 非法 JSON / 缺 items 数组一律失败（调用方 exit 2） */
async function readDraft(
  draftPath: string,
): Promise<{ ok: true; items: unknown[] } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(draftPath, 'utf8');
  } catch (error) {
    return { ok: false, message: `无法读取草稿文件 ${draftPath}：${errorMessage(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: `草稿文件不是合法 JSON：${draftPath}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: `草稿文件顶层不是对象：${draftPath}` };
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return { ok: false, message: `草稿文件缺少 items 数组：${draftPath}` };
  }
  return { ok: true, items };
}

/**
 * 线索 → 目标元素（只有唯一命中才返回元素）。
 *
 * - selector + text 都给出：沿用 resolveAnchor 的双证据链（与 reanchor 完全一致）；
 * - 只给 selector：只认 selector 唯一命中。空 snippet 若走 resolveAnchor 的全文档兜底，
 *   会与「所有无文本元素」相等，可能唯一而误绑到错元素；
 * - 只给 text：交给 resolveAnchor 的全文档 snippet 唯一兜底；
 * - 两者皆空：不猜，直接按失联处理。
 */
function resolveClue(doc: Document, selector: string, snippet: string, now: string): Element | null {
  if (selector === '' && snippet === '') return null;
  if (selector !== '' && snippet === '') {
    try {
      const hits = Array.from(doc.querySelectorAll(selector));
      return hits.length === 1 ? hits[0] : null;
    } catch {
      return null;
    }
  }
  const probe: Anchor = { id: PROBE_ID, selector, snippet, createdAt: now };
  return resolveAnchor(doc, probe).element;
}

/** 逐条合入：upsert 走 updateAnnotation（锚点不动），其余走 addAnnotation（新建或复用锚点） */
function applyItem(
  project: Project,
  item: DraftItem,
  doc: Document,
  now: string,
): { project: Project; annotationId: string; anchorId: string; state: ReanchorState } {
  // ① 草稿项带 id 且已存在 → 只更新 title / body / color，锚点与 source 保持原样（DC7 / R5）
  const existing = item.id !== undefined ? project.annotations.find((a) => a.id === item.id) : undefined;
  if (existing) {
    const next = updateAnnotation(project, existing.id, {
      title: item.title,
      body: item.body,
      color: item.color,
    });
    const anchor = next.anchors.find((a) => a.id === existing.anchorId);
    const state: ReanchorState = anchor ? resolveAnchor(doc, anchor).state : 'stale';
    return {
      project: next,
      annotationId: existing.id,
      anchorId: existing.anchorId,
      state,
    };
  }

  // ② 新建：唯一命中写真实证据；0/N 命中写哨兵证据（DC5，仍然写入）
  const hit = resolveClue(doc, item.selector, item.snippet, now);
  const evidence = hit
    ? { selector: buildSelector(hit), snippet: getSnippet(hit) }
    : { selector: SENTINEL_SELECTOR, snippet: SENTINEL_SNIPPET };

  const result = addAnnotation(project, {
    ...evidence,
    title: item.title,
    body: item.body,
    color: item.color,
    createdAt: now,
    ...(item.source !== undefined ? { source: item.source } : {}),
    ...(project.protoDocPath ? { docPath: project.protoDocPath } : {}),
  });

  return {
    project: result.project,
    annotationId: result.annotationId,
    anchorId: result.anchorId,
    state: hit ? 'fresh' : 'stale',
  };
}

/** 写一个文件（父目录不存在则递归创建） */
async function writeOutput(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const draftOption = readStringOption(args, 'draft', '--draft ');
  if (draftOption.error) {
    warn(draftOption.error);
    return { exitCode: 1 };
  }
  if (draftOption.value === undefined) {
    warn('annotate 需要 --draft <file.json>');
    return { exitCode: 1 };
  }
  const outOption = readStringOption(args, 'out', '--out ');
  if (outOption.error) {
    warn(outOption.error);
    return { exitCode: 1 };
  }
  const maxItems = readMaxItems(args);
  if ('error' in maxItems) {
    warn(maxItems.error);
    return { exitCode: 1 };
  }

  const draftPath = path.resolve(draftOption.value);
  const draft = await readDraft(draftPath);
  if (!draft.ok) {
    warn(draft.message);
    return { exitCode: 2 };
  }

  const doc = new DOMParser().parseFromString(ctx.cleanSource, 'text/html');
  const now = new Date().toISOString();

  let project = ctx.project;
  const applied: AppliedItem[] = [];
  const skipped: SkippedItem[] = [];

  for (let index = 0; index < draft.items.length; index += 1) {
    const checked = checkItem(draft.items[index]);
    if (!checked.ok) {
      skipped.push({ index, reason: checked.reason });
      continue;
    }
    const result = applyItem(project, checked.value, doc, now);
    project = result.project;
    applied.push({
      index,
      annotationId: result.annotationId,
      anchorId: result.anchorId,
      state: result.state,
    });
  }

  const counts: Record<ReanchorState, number> = { fresh: 0, moved: 0, stale: 0 };
  for (const item of applied) counts[item.state] += 1;

  const quality = reviewDraft(
    project,
    applied.map((item) => ({ index: item.index, annotationId: item.annotationId })),
    { maxItems: maxItems.value },
  );

  // 写盘：--dry-run 只算不写；原型本体只读，目标与 input 重合时跳过（DC10）
  const written: string[] = [];
  if (args.options['dry-run'] !== true) {
    const outDir =
      outOption.value !== undefined ? path.resolve(outOption.value) : path.dirname(ctx.inputPath);
    const hasAnno = typeof args.options.anno === 'string' && args.options.anno.length > 0;
    const targets: Array<{ path: string; content: string }> = [
      {
        path: hasAnno ? ctx.writebackPath : path.join(outDir, annoJsonName(project.protoName)),
        content: JSON.stringify(project, null, 2) + '\n',
      },
      {
        path: path.join(outDir, exportHtmlName(project.protoName)),
        content: buildExportHtml(ctx.cleanSource, project),
      },
    ];
    if (args.options.clean === true) {
      targets.push({
        path: path.join(outDir, cleanHtmlName(project.protoName)),
        content: buildAnnotatedHtml(ctx.cleanSource, project),
      });
    }

    for (const target of targets) {
      if (path.resolve(target.path) === ctx.inputPath) {
        warn(`跳过写入（与输入文件同名，原型只读）：${target.path}`);
        continue;
      }
      try {
        await writeOutput(target.path, target.content);
      } catch (error) {
        warn(`写入失败 ${target.path}：${errorMessage(error)}`);
        return { exitCode: 2 };
      }
      written.push(target.path);
    }
  }

  const report: AnnotateReport = { applied, skipped, counts, quality, written };
  const strictFailed = args.options.strict === true && counts.stale > 0;
  return { exitCode: strictFailed ? 3 : 0, json: report };
}
