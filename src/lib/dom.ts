/**
 * dom.ts —— DOM 锚定小工具（spec lib 清单的补充文件）
 *
 * 说明：spec「技术栈与职责分层」中 lib 清单为 types / store / transport / loading /
 * reanchor / exporter / importer / draft；本文件为实施期新增的补充，集中提供锚点
 * 证据字段（selector / snippet）生成与可见性判定的基础工具，供 store（提交锚点）与
 * reanchor（三态重绑，Task 8）共用，保证两处生成的证据字段一致。
 *
 * 所有函数均以 el.ownerDocument 为根工作，兼容 iframe 内元素（不用全局 document）。
 */
import type { Annotation } from './types';

/** 判断字符串是否为无需转义的合法 CSS 标识符（近似规则，覆盖常见命名） */
function isValidCssIdent(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) || /^-[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

/** 计算元素是父元素下第几个同标签兄弟（1-based，供 :nth-of-type 使用） */
function typeIndex(el: Element): number {
  let index = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) index += 1;
    sib = sib.previousElementSibling;
  }
  return index;
}

/**
 * 生成单层路径段：tag / tag#id / tag.class；
 * 该段在父元素直下不唯一（或无父元素）时追加 :nth-of-type(k)。
 */
function buildSegment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id && isValidCssIdent(id)) return `${tag}#${id}`;
  const cls = Array.from(el.classList).find((c) => isValidCssIdent(c));
  const base = cls ? `${tag}.${cls}` : tag;
  const parent = el.parentElement;
  if (parent) {
    try {
      const matches = parent.querySelectorAll(':scope > ' + base);
      if (matches.length === 1 && matches[0] === el) return base;
    } catch {
      // 理论不可达（tag/id/class 均已验证合法），兜底走 nth-of-type
    }
  }
  return `${base}:nth-of-type(${typeIndex(el)})`;
}

/**
 * 生成元素的 CSS 路径（nth-of-type 链），从 body 直下到该元素，形如：
 * "body > div.app > main > div.card:nth-of-type(1) > div.card-head"
 *
 * 规则：优先 id，其次首个合法 class；该段在父元素直下不唯一时追加 :nth-of-type(k)。
 * selector 仅用于原型改版后的重绑候选（R7），不保证全文档唯一。
 */
export function buildSelector(el: Element): string {
  // 以元素所属文档的 body 为根（兼容 iframe 内元素），游离元素返回其相对路径
  const root = el.ownerDocument?.body ?? null;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== root) {
    parts.unshift(buildSegment(node));
    node = node.parentElement;
  }
  if (node === root) parts.unshift('body');
  return parts.join(' > ');
}

/**
 * 取元素 textContent 规范化空白（连续空白折叠为单空格并去首尾）后的前 40 字符，
 * 作为重绑的第二证据（R7）。
 */
export function getSnippet(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 40);
}

/**
 * 元素可见性判定（spec R5 勘误：不用 offsetParent——会误伤 fixed 元素）：
 * getClientRects().length === 0（如 display:none 祖先、未激活分页）
 * 或 getBoundingClientRect() 宽高均为 0 → 不可见；其余可见。
 */
export function isVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  return !(rect.width === 0 && rect.height === 0);
}

/** 比较两元素在文档中的顺序（-1 / 0 / 1）；任一方为 null（失联）时排到末尾 */
function compareDocOrder(a: Element | null, b: Element | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

/**
 * 标注排序（spec R4）：按锚点在原型 DOM 中的文档顺序（compareDocumentPosition），
 * 同锚点多条按 createdAt 升序；失联（找不到锚点元素）的排到最后。
 * React 侧栏与导出 viewer（bootstrap）共用此实现，保证序号一致。
 * 元素解析结果一次性预计算，避免排序比较中重复查询 DOM。
 */
export function orderAnnotations(annotations: Annotation[], doc: Document): Annotation[] {
  const elementOf = new Map<string, Element | null>();
  const elementFor = (anchorId: string): Element | null => {
    let el = elementOf.get(anchorId);
    if (el === undefined) {
      el = doc.querySelector(`[data-anno-id="${anchorId}"]`);
      elementOf.set(anchorId, el);
    }
    return el;
  };
  return [...annotations].sort((a, b) => {
    const cmp = compareDocOrder(elementFor(a.anchorId), elementFor(b.anchorId));
    if (cmp !== 0) return cmp;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * 计算标注的展示序号（卡片刻号与图钉序号共用，保证两者永远一致）。
 *
 * 规则（用户决策）：**固定编号、允许跳号** —— 序号基于「全部标注」按文档顺序一次性分配，
 * 与侧栏筛选无关；筛掉部分卡片后剩余卡片保留原序号（出现跳号），图钉序号同理。
 * 返回 Map<annotationId, number>（number 从 1 开始）。
 */
export function numberAnnotations(annotations: Annotation[], doc: Document): Map<string, number> {
  const ordered = orderAnnotations(annotations, doc);
  const numbers = new Map<string, number>();
  ordered.forEach((anno, i) => numbers.set(anno.id, i + 1));
  return numbers;
}
