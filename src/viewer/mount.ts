/**
 * viewer/mount.ts —— mount 核心聚合（spec R5 / R6）
 *
 * 职责：绑定渲染所需 DOM（样式 / pin 层 / 连线层）、注册重算触发源（resize / scroll /
 * MutationObserver / hover 委托 / 点击联动）、rAF 合帧全量重算，并暴露实例 API。
 * 这是 viewer 中体型最大的模块；数据读取一律经 getProject()/getFilters() 实时取值，不做缓存。
 */
import { STYLE_TEXT } from './style';
import { getRect, isElementVisible, inViewport, pinAnchorPoint, toViewport, cardEdgeMid } from './geom';
import { ensurePinLayer, renderPins, setPinInteractive, findPin, removePinLayer } from './pin';
import { ensureSvgLayer, drawLines, removeSvgLayer } from './svg';
import { CARD_CLASS } from './cards';
import { CATEGORY_META } from '../lib/types';
import { numberAnnotations } from '../lib/dom';
import type { Annotation, Project } from '../lib/types';
import { filterAnnotations, findAnchorElement } from './types';
import type { LineItem, MountOptions, PinItem, ViewerInstance } from './types';

const STYLE_ID = 'pinhtml-style';

/** 注入 viewer 样式（幂等：同 id 已存在则跳过；导出器会静态注入同 id 同内容） */
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  (doc.head || doc.documentElement).appendChild(style);
}

/** 尊重 prefers-reduced-motion 的平滑滚动行为 */
function smoothBehavior(doc: Document): ScrollBehavior {
  const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 'auto' : 'smooth';
}

export function mount(opts: MountOptions): ViewerInstance {
  const {
    targetDoc,
    viewportDoc,
    frameEl,
    cardsContainer,
    getProject,
    getFilters,
    interactive,
    onCardClick,
    onPinClick,
  } = opts;

  let destroyed = false;
  let rafId = 0;
  let observer: MutationObserver | null = null;
  let lastVisibility: Record<string, boolean> = {};
  /** 上一帧计算出的连线端点（hover 变化时仅重绘连线，不重算几何） */
  let lineItemsCache: LineItem[] = [];
  /** 当前 hover 需要高亮的标注 id 集合 */
  let highlightAnnos = new Set<string>();
  /** 锚点分组：primary anchorId → 同组（同一 DOM 元素）全部 anchorId；合并为一个图钉、计数累加 */
  let groupMap = new Map<string, string[]>();
  /** 任意 anchorId → 所属分组的 primary anchorId */
  let primaryMap = new Map<string, string>();

  // 注入样式与 DOM 层（幂等）
  ensureStyle(targetDoc);
  if (viewportDoc !== targetDoc) ensureStyle(viewportDoc);
  ensurePinLayer(targetDoc);
  ensureSvgLayer(viewportDoc);

  /* ---------- 全量重算 ---------- */

  function recompute(): void {
    if (destroyed) return;
    const project = getProject();
    const filters = getFilters();
    const annos = filterAnnotations(project, filters);

    // targetDoc 视口尺寸（pin 边缘钳制 / 视口交集判定）
    const tw = targetDoc.documentElement.clientWidth || targetDoc.defaultView?.innerWidth || 0;
    const th = targetDoc.documentElement.clientHeight || targetDoc.defaultView?.innerHeight || 0;
    const frameRect = frameEl
      ? frameEl.getBoundingClientRect()
      : { left: 0, top: 0, right: 0, bottom: 0 };

    // 0) 编号：基于全部标注（固定编号、允许跳号）。卡片刻号与图钉序号共用同一份结果，
    //    保证「图钉显示的数字 = 对应卡片的序号」
    const numbers = numberAnnotations(project?.annotations ?? [], targetDoc);

    // 1) 锚点 → 按元素分组（同一元素上的多个锚点合并为一个图钉）→ pin item + 可见性
    const anchors = project?.anchors ?? [];
    const visibility: Record<string, boolean> = {};
    const pinItems: PinItem[] = [];
    /** primary anchorId → 图钉中心（targetDoc 坐标），供连线起点换算 */
    const pinCenterByAnchor = new Map<string, { x: number; y: number }>();

    // 分组：同一 DOM 元素上的多个锚点（历史重复锚点 / DOM 重渲染残留）合并展示
    const groups: Array<{ element: Element; anchorIds: string[] }> = [];
    const groupByElement = new Map<Element, { element: Element; anchorIds: string[] }>();
    for (const anchor of anchors) {
      const el = findAnchorElement(targetDoc, anchor.id);
      // 元素不存在：不写 visibility（「失联」由 staleAnchorIds 表达，避免误标「不可见」）
      if (!el) continue;
      let group = groupByElement.get(el);
      if (!group) {
        group = { element: el, anchorIds: [] };
        groupByElement.set(el, group);
        groups.push(group);
      }
      group.anchorIds.push(anchor.id);
    }

    groupMap = new Map();
    primaryMap = new Map();
    for (const group of groups) {
      const primaryId = group.anchorIds[0];
      groupMap.set(primaryId, group.anchorIds);
      for (const id of group.anchorIds) primaryMap.set(id, primaryId);

      // 元素不可见 / 不在视口：整组标记为不可见（卡片显示「不可见（当前视图）」角标）
      if (!isElementVisible(group.element) || !inViewport(getRect(group.element), tw, th)) {
        for (const id of group.anchorIds) visibility[id] = false;
        continue;
      }
      for (const id of group.anchorIds) visibility[id] = true;

      // 图钉显示该元素上「序号最小的可见标注」的序号与分类色（用户决策）；
      // 该元素没有任何可见标注时不显示图钉
      const groupAnnoIds = new Set(group.anchorIds);
      const visibleAnnos = annos.filter((a) => groupAnnoIds.has(a.anchorId));
      if (visibleAnnos.length === 0) continue;
      const first = visibleAnnos.reduce((min, a) =>
        (numbers.get(a.id) ?? Number.MAX_SAFE_INTEGER) <
        (numbers.get(min.id) ?? Number.MAX_SAFE_INTEGER)
          ? a
          : min,
      );

      const point = pinAnchorPoint(getRect(group.element), tw, th);
      pinItems.push({
        anchorId: primaryId,
        x: point.x,
        y: point.y,
        label: String(numbers.get(first.id) ?? ''),
        color: CATEGORY_META[first.color].color,
        title: `#${numbers.get(first.id) ?? ''} ${first.title}`,
      });
      pinCenterByAnchor.set(primaryId, point);
    }

    // 2) 标注 → 连线端点（锚点可见且卡片存在才画）
    const lineItems: LineItem[] = [];
    if (project) {
      const frameLeft = frameRect.left;
      const frameTop = frameRect.top;
      for (const anno of annos) {
        if (!visibility[anno.anchorId]) continue;
        const cardEl = findCardEl(anno.id);
        if (!cardEl) continue;
        const primary = primaryMap.get(anno.anchorId);
        const pinCenter = primary ? pinCenterByAnchor.get(primary) : undefined;
        if (!pinCenter) continue;
        const pv = toViewport(pinCenter.x, pinCenter.y, { left: frameLeft, top: frameTop });
        const cv = cardEdgeMid(cardEl);
        lineItems.push({
          annoId: anno.id,
          color: CATEGORY_META[anno.color].color,
          px: pv.x,
          py: pv.y,
          cx: cv.x,
          cy: cv.y,
        });
      }
    }

    // 3) 渲染 + 缓存
    renderPins(targetDoc, pinItems);
    drawLines(viewportDoc, lineItems, highlightAnnos);
    lineItemsCache = lineItems;

    // 4) 可见性变化事件（单一事实来源，卡片据此显示「不可见」角标）
    if (JSON.stringify(visibility) !== JSON.stringify(lastVisibility)) {
      lastVisibility = visibility;
      viewportDoc.dispatchEvent(
        new viewportDoc.defaultView!.CustomEvent('pinhtml-visibility-change', { detail: visibility }),
      );
    }
  }

  /* ---------- rAF 合帧调度 ---------- */

  function schedule(): void {
    if (destroyed || rafId) return;
    rafId = viewportDoc.defaultView!.requestAnimationFrame(() => {
      rafId = 0;
      if (!destroyed) recompute();
    });
  }

  /* ---------- hover 联动（事件委托，两上下文统一） ---------- */

  function clearHighlight(): void {
    // 清除两端 active class
    viewportDoc.querySelectorAll('.pinhtml-card-active').forEach((el) => el.classList.remove('pinhtml-card-active'));
    targetDoc.querySelectorAll('.pinhtml-pin-active').forEach((el) => el.classList.remove('pinhtml-pin-active'));
    highlightAnnos = new Set();
    drawLines(viewportDoc, lineItemsCache, highlightAnnos);
  }

  function highlightByAnno(annoIds: string[]): void {
    clearHighlight();
    highlightAnnos = new Set(annoIds);
    for (const id of annoIds) {
      findCardEl(id)?.classList.add('pinhtml-card-active');
    }
    drawLines(viewportDoc, lineItemsCache, highlightAnnos);
  }

  function highlightByAnchor(anchorId: string, project: Project | null): void {
    // 同元素上的多个锚点合并为一个图钉：hover 时高亮该组全部标注
    const primary = primaryMap.get(anchorId) ?? anchorId;
    const groupIds = groupMap.get(primary) ?? [primary];
    const ids = (project?.annotations ?? [])
      .filter((a) => groupIds.includes(a.anchorId))
      .map((a) => a.id);
    clearHighlight();
    highlightAnnos = new Set(ids);
    for (const id of ids) findCardEl(id)?.classList.add('pinhtml-card-active');
    const pin = findPin(targetDoc, primary);
    pin?.classList.add('pinhtml-pin-active');
    drawLines(viewportDoc, lineItemsCache, highlightAnnos);
  }

  function onViewportMouseOver(e: MouseEvent): void {
    if (!interactive) return;
    const t = e.target as HTMLElement | null;
    const card = t?.closest?.('[data-anno]') as HTMLElement | null;
    if (card && card.classList.contains(CARD_CLASS)) {
      highlightByAnno([card.getAttribute('data-anno')!]);
    } else {
      clearHighlight();
    }
  }

  function onTargetMouseOver(e: MouseEvent): void {
    if (!interactive) return;
    const t = e.target as HTMLElement | null;
    const pin = t?.closest?.('.pinhtml-pin') as HTMLElement | null;
    if (pin) {
      highlightByAnchor(pin.getAttribute('data-anchor-id')!, getProject());
    } else {
      clearHighlight();
    }
  }

  function onViewportClick(e: MouseEvent): void {
    if (!interactive || !onCardClick) return;
    const t = e.target as HTMLElement | null;
    const card = t?.closest?.(`[data-anno].${CARD_CLASS}`) as HTMLElement | null;
    if (card) onCardClick(card.getAttribute('data-anno')!);
  }

  function onTargetClick(e: MouseEvent): void {
    if (!interactive || !onPinClick) return;
    const t = e.target as HTMLElement | null;
    const pin = t?.closest?.('.pinhtml-pin') as HTMLElement | null;
    if (pin) onPinClick(pin.getAttribute('data-anchor-id')!);
  }

  /* ---------- 触发源注册 ---------- */

  /** 注入 class 是否出现在 class 属性值中（注入 class 统一 pinhtml- 前缀，方案 §9 约定） */
  function hasInjectedClass(raw: string | null): boolean {
    return !!raw && raw.split(/\s+/).some((c) => c.startsWith('pinhtml-'));
  }

  function isSelfMutation(m: MutationRecord): boolean {
    const t = m.target as HTMLElement | null;
    if (!t) return false;
    if (t.id === 'pinhtml-pinlayer' || t.id === 'pinhtml-svg-layer') return true;
    const layer = targetDoc.getElementById('pinhtml-pinlayer');
    if (layer && layer.contains(t)) return true;
    const svg = viewportDoc.getElementById('pinhtml-svg-layer');
    if (svg && svg.contains(t)) return true;
    // 注入 class 的切换（bridge 拾取高亮 / 卡片 active / 图钉 active）不是原型结构变化：
    // 不过滤的话，标注模式下每次悬停都会触发一次全量几何重算
    if (m.type === 'attributes' && m.attributeName === 'class') {
      if (hasInjectedClass(m.oldValue) || hasInjectedClass(t.getAttribute('class'))) return true;
    }
    return false;
  }

  const onTargetScroll = () => schedule();
  const onViewportScroll = () => schedule();
  const onResize = () => schedule();

  targetDoc.addEventListener('scroll', onTargetScroll, true);
  targetDoc.defaultView?.addEventListener('scroll', onTargetScroll, true);
  viewportDoc.addEventListener('scroll', onViewportScroll, true);
  viewportDoc.defaultView?.addEventListener('resize', onResize);
  targetDoc.defaultView?.addEventListener('resize', onResize);

  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (!isSelfMutation(m)) {
        schedule();
        break;
      }
    }
  });
  observer.observe(targetDoc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true, // 供 isSelfMutation 识别注入 class 的切换
  });

  viewportDoc.addEventListener('mouseover', onViewportMouseOver, true);
  viewportDoc.addEventListener('click', onViewportClick, true);
  targetDoc.addEventListener('mouseover', onTargetMouseOver, true);
  targetDoc.addEventListener('click', onTargetClick, true);

  /* ---------- 实例 API ---------- */

  function findCardEl(annoId: string): HTMLElement | null {
    const container = cardsContainer ?? (viewportDoc === targetDoc ? targetDoc : viewportDoc);
    if (!container) return null;
    return container.querySelector(`.${CARD_CLASS}[data-anno="${annoId}"]`);
  }

  function scrollToAnchor(anchorId: string): void {
    const project = getProject();
    const primary = primaryMap.get(anchorId) ?? anchorId;
    const groupIds = groupMap.get(primary) ?? [primary];
    const first = project?.annotations.find((a) => groupIds.includes(a.anchorId));
    if (!first) return;
    const el = findCardEl(first.id);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: smoothBehavior(viewportDoc) });
    el.classList.remove('pinhtml-card-flash');
    void el.offsetWidth; // 强制回流以重放动画
    el.classList.add('pinhtml-card-flash');
  }

  function pulse(anchorId: string): void {
    const primary = primaryMap.get(anchorId) ?? anchorId;
    const pin = findPin(targetDoc, primary);
    if (!pin) return;
    pin.classList.remove('pinhtml-pin-pulse');
    void (pin as HTMLElement).offsetWidth;
    pin.classList.add('pinhtml-pin-pulse');
  }

  function scrollAnchorIntoView(annotation: Annotation): void {
    const el = findAnchorElement(targetDoc, annotation.anchorId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: smoothBehavior(targetDoc) });
    pulse(annotation.anchorId);
  }

  return {
    refresh: schedule,
    setFilters: () => schedule(),
    scrollToAnchor,
    pulse,
    scrollAnchorIntoView,
    findCardEl,
    setPinInteractive: (bool) => setPinInteractive(targetDoc, bool),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (rafId) {
        viewportDoc.defaultView!.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      targetDoc.removeEventListener('scroll', onTargetScroll, true);
      targetDoc.defaultView?.removeEventListener('scroll', onTargetScroll, true);
      viewportDoc.removeEventListener('scroll', onViewportScroll, true);
      viewportDoc.defaultView?.removeEventListener('resize', onResize);
      targetDoc.defaultView?.removeEventListener('resize', onResize);
      observer?.disconnect();
      observer = null;
      viewportDoc.removeEventListener('mouseover', onViewportMouseOver, true);
      viewportDoc.removeEventListener('click', onViewportClick, true);
      targetDoc.removeEventListener('mouseover', onTargetMouseOver, true);
      targetDoc.removeEventListener('click', onTargetClick, true);
      removePinLayer(targetDoc);
      removeSvgLayer(viewportDoc);
    },
  };
}