/**
 * reanchor.ts —— 三态重锚定（spec R7）
 *
 * 职责：锚点相对当前 DOM 的三态判定（fresh / moved / stale）：
 * - fresh：data-anno-id 命中 DOM（正常路径）；
 * - moved（自动重绑）：元素消失但 selector 候选 + snippet（textContent 前 40 字符）唯一匹配；
 * - stale（失联）：0 或 >1 匹配，等待人工「重新选择锚点」。
 *
 * 本文件只做判定（纯函数、无副作用）；写回 data-anno-id / selector / snippet 由调用方
 * （store.rebindAnchor）执行，stale 集合由调用方维护。
 */
import { getSnippet } from './dom';
import type { Anchor } from './types';

/** 三态 */
export type ReanchorState = 'fresh' | 'moved' | 'stale';

/** 单锚点判定结果 */
export interface ResolvedAnchor {
  state: ReanchorState;
  /** fresh：命中的元素；moved：新目标元素；stale：null */
  element: Element | null;
}

/** 批量判定结果 */
export interface ReanchorOutcome {
  /** fresh 锚点（无需处理） */
  fresh: Anchor[];
  /** moved 锚点与目标元素（需静默重绑） */
  moved: Array<{ anchor: Anchor; element: Element }>;
  /** stale 锚点（需人工重选） */
  stale: Anchor[];
}

/** 用选择器在文档中安全查询（选择器非法返回空数组） */
function safeQueryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** 依据 selector + snippet 双证据解析单个锚点（spec R7） */
export function resolveAnchor(doc: Document, anchor: Anchor): ResolvedAnchor {
  const current = doc.querySelector(`[data-anno-id="${anchor.id}"]`);
  if (current) return { state: 'fresh', element: current };

  // selector 候选 + snippet 唯一匹配
  const bySelector = safeQueryAll(doc, anchor.selector).filter((el) => getSnippet(el) === anchor.snippet);
  if (bySelector.length === 1) return { state: 'moved', element: bySelector[0] };

  // selector 无果 → 全文档 snippet 匹配，取「最内层」唯一者
  // （必须排除 body / html 这类祖先：其 textContent 与后代相同，否则永远 >1 匹配而误判失联）
  const bySnippet = Array.from(doc.querySelectorAll('*')).filter(
    (el) => getSnippet(el) === anchor.snippet,
  );
  const innermost = bySnippet.filter(
    (el) => !bySnippet.some((other) => other !== el && el.contains(other)),
  );
  if (innermost.length === 1) return { state: 'moved', element: innermost[0] };

  return { state: 'stale', element: null };
}

/** 对全部锚点批量三态判定（导入 protoHash 不一致 / MutationObserver 元素消失时调用） */
export function reanchorAll(doc: Document, anchors: Anchor[]): ReanchorOutcome {
  const fresh: Anchor[] = [];
  const moved: Array<{ anchor: Anchor; element: Element }> = [];
  const stale: Anchor[] = [];
  for (const anchor of anchors) {
    const r = resolveAnchor(doc, anchor);
    if (r.state === 'fresh') fresh.push(anchor);
    else if (r.state === 'moved' && r.element) moved.push({ anchor, element: r.element });
    else stale.push(anchor);
  }
  return { fresh, moved, stale };
}

/**
 * 按页面归属切分锚点（URL 模式多页原型，R13）：只有「当前页的锚点」才参与三态判定。
 * - docKey 为 null（srcdoc 文件模式，单文档）→ 全部视为当前页；
 * - 锚点未记录 docPath（老项目 / 文件模式创建）→ 视为当前页，避免切换模式时集体误判失联；
 * - 其余按 docPath 是否等于当前页键分流，其他页的锚点保持原状态（不判定、不置失联）。
 */
export function partitionByPage(
  anchors: Anchor[],
  docKey: string | null,
): { onPage: Anchor[]; offPage: Anchor[] } {
  if (docKey === null) return { onPage: anchors, offPage: [] };
  const onPage: Anchor[] = [];
  const offPage: Anchor[] = [];
  for (const anchor of anchors) {
    if (anchor.docPath && anchor.docPath !== docKey) offPage.push(anchor);
    else onPage.push(anchor);
  }
  return { onPage, offPage };
}