/**
 * resolve.ts —— `pinhtml resolve` 命令（spec R3：agent 的放大镜）。
 *
 * 职责：把调用方给出的线索（--text 文字 / --selector CSS 路径）解析成原型中的候选元素，
 * 并给出与「重锚定」一致的三态判定（fresh / moved / stale），供 agent 决定下一步
 * （直接锚定 / 收窄线索 / 放弃）。只读：不写回任何文件，歧义（多候选 / stale）不算错误。
 *
 * 判定口径（与 lib/reanchor.resolveAnchor 的证据链对齐）：
 * - 只给 --selector：selector 即唯一线索，唯一命中 → fresh，否则 stale（不走 snippet 过滤）；
 * - selector + text：候选来自 selector 命中 → fresh（selector 直接命中）；
 * - 候选只来自全文档 snippet 兜底（只给 --text）→ moved；
 * - 候选 0 / 多个，或 resolveAnchor 指向的元素与唯一候选不一致 → stale。
 */
import { buildSelector, getSnippet } from '@/lib/dom';
import { resolveAnchor, type ReanchorState } from '@/lib/reanchor';
import type { Anchor } from '@/lib/types';
import type { Args } from '../args';
import { warn } from '../io';
import type { CliContext, CommandResult } from '../types';

/** 探针锚点 id：真实锚点为 e-N，此值不可能在原型中出现 */
const PROBE_ID = '__pinhtml_probe__';

/** 默认候选截断条数（count 不受影响） */
const DEFAULT_LIMIT = 10;

/** 全文档文字扫描时跳过的容器标签 */
const CONTAINER_TAGS = new Set(['html', 'head', 'body', 'script', 'style']);

/** 单个候选元素的输出形状 */
interface ResolveCandidate {
  /** 供下一次 --selector 复用的 CSS 路径 */
  selector: string;
  /** 小写标签名 */
  tag: string;
  /** 元素 snippet（textContent 规范化空白后前 40 字符） */
  text: string;
  /** 从 body 到该元素的标签链，如 body>div>main>button */
  path: string;
}

/** 选择器在文档中安全查询（非法选择器返回空数组，与 reanchor 同口径） */
function safeQueryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** 元素路径链：body 起（含）到该元素的标签名，以 '>' 连接 */
function buildPath(el: Element): string {
  const root = el.ownerDocument?.body ?? null;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node) {
    parts.unshift(node.tagName.toLowerCase());
    if (node === root) break;
    node = node.parentElement;
  }
  return parts.join('>');
}

/** 全文档元素 → 文档顺序序号（用于稳定排序，同时避免依赖 Node 全局常量） */
function documentOrder(doc: Document): Map<Element, number> {
  const order = new Map<Element, number>();
  Array.from(doc.querySelectorAll('*')).forEach((el, i) => order.set(el, i));
  return order;
}

/** 把元素收敛为候选输出 */
function toCandidate(el: Element): ResolveCandidate {
  return {
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    text: getSnippet(el),
    path: buildPath(el),
  };
}

/** 读取字符串型线索：未给 → 无；给了却缺值 → 用法错误 */
function readClue(
  args: Args,
  key: 'text' | 'selector',
): { value?: string; error?: string } {
  const raw = args.options[key];
  if (raw === undefined) return {};
  if (typeof raw !== 'string') return { error: `--${key} 需要一个字符串值` };
  return raw.length > 0 ? { value: raw } : {};
}

/** 读取 --limit：默认 10；非法（非非负整数）→ 用法错误 */
function readLimit(args: Args): { limit: number; error?: string } {
  const raw = args.options.limit;
  if (raw === undefined) return { limit: DEFAULT_LIMIT };
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return { limit: DEFAULT_LIMIT, error: '--limit 需要一个非负整数' };
  }
  return { limit: Number(raw) };
}

/** 三态判定：唯一候选且与 resolveAnchor 指向同一元素时，按证据来源区分 fresh / moved */
function judgeState(
  candidates: Element[],
  resolvedElement: Element | null,
  viaSelector: boolean,
): ReanchorState {
  if (candidates.length !== 1) return 'stale';
  const single = candidates[0];
  if (resolvedElement !== single) return 'stale';
  return viaSelector ? 'fresh' : 'moved';
}

/** 命令入口：构造探针锚点 → 计算候选 → 输出线索 / 完整计数 / 三态 / 截断后的候选 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const text = readClue(args, 'text');
  if (text.error) {
    warn(text.error);
    return { exitCode: 1 };
  }
  const selector = readClue(args, 'selector');
  if (selector.error) {
    warn(selector.error);
    return { exitCode: 1 };
  }
  const limit = readLimit(args);
  if (limit.error) {
    warn(limit.error);
    return { exitCode: 1 };
  }

  const textValue = text.value;
  const selectorValue = selector.value;
  if (textValue === undefined && selectorValue === undefined) {
    warn('resolve 需要至少一个线索：--text <string> 或 --selector <string>');
    return { exitCode: 1 };
  }

  const doc = new DOMParser().parseFromString(ctx.cleanSource, 'text/html');

  let elements: Element[];
  let state: ReanchorState;
  if (selectorValue !== undefined && textValue === undefined) {
    // 只给 selector：selector 就是唯一线索，不做 snippet 过滤，
    // 也不借 resolveAnchor 改判（探针 snippet 为空会被误判为 stale）
    elements = safeQueryAll(doc, selectorValue);
    state = elements.length === 1 ? 'fresh' : 'stale';
  } else {
    // 探针锚点：id 不可能真实存在，因此 resolveAnchor 只能走 selector / snippet 证据链
    const probe: Anchor = {
      id: PROBE_ID,
      selector: selectorValue ?? '',
      snippet: textValue ?? '',
      createdAt: new Date().toISOString(),
    };
    const resolved = resolveAnchor(doc, probe);

    if (selectorValue !== undefined) {
      // 有 selector：先按 selector 命中，再用 text 收窄
      elements = safeQueryAll(doc, selectorValue).filter(
        (el) => getSnippet(el) === textValue,
      );
    } else {
      // 只有 text：全文档扫描，跳过容器元素（其文本与后代相同，会干扰计数）
      elements = Array.from(doc.querySelectorAll('*')).filter(
        (el) =>
          !CONTAINER_TAGS.has(el.tagName.toLowerCase()) &&
          textValue !== undefined &&
          getSnippet(el) === textValue,
      );
    }
    const order = documentOrder(doc);
    elements.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
    state = judgeState(elements, resolved.element, selectorValue !== undefined);
  }
  const clue: { selector?: string; text?: string } = {};
  if (selectorValue !== undefined) clue.selector = selectorValue;
  if (textValue !== undefined) clue.text = textValue;

  return {
    exitCode: 0,
    json: {
      clue,
      count: elements.length,
      state,
      candidates: elements.slice(0, limit.limit).map(toCandidate),
    },
  };
}
