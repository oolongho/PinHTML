/**
 * viewer/cards.ts —— 卡片 DOM 结构契约 + 导出模式卡片渲染（spec R4 / R5）
 *
 * 说明：这里定义了标注卡片的标准 DOM 结构契约（.pinhtml-card[data-anno] 及其子元素），
 * 导出产物（viewer 自举只读侧栏）据此渲染；Task 6 的 React 卡片（AnnoCard）必须复用
 * **同一套类名与结构**，以保证连线端点（`.pinhtml-card[data-anno]`）与 hover 联动在两种
 * 上下文统一成立。
 */
import { CATEGORY_META } from '../lib/types';
import type { Annotation, AnnoStatus, Category } from '../lib/types';

/** 卡片根类名（连线终点与 hover 联动查找依据） */
export const CARD_CLASS = 'pinhtml-card';

/** 状态 pill 文案 */
const STATUS_LABEL: Record<AnnoStatus, string> = {
  open: '待确认',
  resolved: '已确认',
};

/** 卡片渲染参数 */
export interface CardRenderOptions {
  /** 全局排序序号（1-based） */
  index: number;
  /** 是否可见（false 时追加「不可见（当前视图）」角标） */
  hidden: boolean;
}

/** 创建子元素（一次性完成 tagName / class / textContent 赋值，减少重复） */
function createEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * 构建一张标注卡片（导出只读模式）。返回 .pinhtml-card[data-anno] 根元素。
 * 分类色经 CSS 变量 --pinhtml-cat 注入（bar 色条与 cat 标签取同一变量）；
 * categoryLabels 提供用户自定义分类显示名（未覆盖用默认）。
 */
export function buildCardDom(
  doc: Document,
  annotation: Annotation,
  opts: CardRenderOptions,
  categoryLabels?: Partial<Record<Category, string>>,
): HTMLElement {
  const meta = CATEGORY_META[annotation.color];
  const catLabel = categoryLabels?.[annotation.color] ?? meta.label;
  const card = doc.createElement('div');
  card.className = CARD_CLASS;
  card.setAttribute('data-anno', annotation.id);
  card.style.setProperty('--pinhtml-cat', meta.color);

  // 左侧 3px 分类色条
  card.appendChild(createEl(doc, 'div', 'pinhtml-card-bar'));

  // 头：序号 + 分类标签
  const head = createEl(doc, 'div', 'pinhtml-card-head');
  head.appendChild(createEl(doc, 'span', 'pinhtml-card-index', `#${opts.index}`));
  head.appendChild(createEl(doc, 'span', 'pinhtml-card-cat', catLabel));
  card.appendChild(head);

  // 标题 / 正文（空正文不生成节点，避免卡片多出一段空行）
  card.appendChild(createEl(doc, 'div', 'pinhtml-card-title', annotation.title));
  if (annotation.body) card.appendChild(createEl(doc, 'div', 'pinhtml-card-body', annotation.body));

  // 标题后再拼「不可见」角标（有则不占卡片头部主要视觉）
  card.appendChild(createEl(doc, 'div', 'pinhtml-card-foot'));

  const foot = card.querySelector('.pinhtml-card-foot') as HTMLElement;
  const statusPill = createEl(doc, 'span', 'pinhtml-card-status', STATUS_LABEL[annotation.status]);
  if (annotation.status === 'resolved') statusPill.classList.add('is-resolved');
  foot.appendChild(statusPill);

  if (opts.hidden) {
    foot.appendChild(createEl(doc, 'span', 'pinhtml-card-badge', '不可见（当前视图）'));
  }

  return card;
}