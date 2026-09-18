/**
 * viewer/bootstrap.ts —— 导出自举（spec R5 导出自举 / R6）
 *
 * 说明：导出产物的 #pinhtml-runtime 执行时检测页面内 #pinhtml-data，解析项目后自建
 * 只读侧栏（可收起）、渲染卡片、挂载只读 viewer 实例。**不具备**创建/编辑/删除/重新锚定。
 * 工具模式（父文档无 #pinhtml-data）此处直接 return。
 */
import { mount } from './mount';
import { buildSidebar } from './sidebar';
import { buildCardDom } from './cards';
import { filterAnnotations } from './types';
import { orderAnnotations, numberAnnotations } from '../lib/dom';
import { DEFAULT_FILTERS } from '../lib/types';
import type { Filters, Project } from '../lib/types';
import type { ViewerInstance } from './types';

const DATA_ID = 'pinhtml-data';

export function bootstrap(): void {
  const doc = document;
  const dataEl = doc.getElementById(DATA_ID);
  if (!dataEl) return; // 工具模式 / 非导出产物

  let project: Project;
  try {
    project = JSON.parse(dataEl.textContent ?? '{}') as Project;
  } catch {
    return; // 数据损坏则不做自举
  }

  // 筛选状态（导出只读模式自管理；内容为深拷贝，避免共享 DEFAULT_FILTERS 引用）
  let filters: Filters = {
    status: DEFAULT_FILTERS.status,
    categories: { ...DEFAULT_FILTERS.categories },
  };
  let viewer: ViewerInstance | null = null;
  /** annoId → anchorId，供可见性事件快速反查 */
  const anchorByAnno = new Map(project.annotations.map((a) => [a.id, a.anchorId]));

  const sidebar = buildSidebar(doc, project, filters, {
    onStatus: (status) => {
      filters = { ...filters, status };
      applyFilters();
    },
    onCategory: (cat) => {
      filters = { ...filters, categories: { ...filters.categories, [cat]: !filters.categories[cat] } };
      applyFilters();
    },
  });

  // 移动/移除不可见角标（单一事实来源：mount 每次重算派发 visibility-change）
  function syncBadges(detail: Record<string, boolean>): void {
    for (const card of sidebar.listEl.querySelectorAll<HTMLElement>('.pinhtml-card')) {
      const anchorId = anchorByAnno.get(card.getAttribute('data-anno') ?? '');
      if (anchorId === undefined) continue;
      setHiddenBadge(card, detail[anchorId] === false);
    }
  }

  doc.addEventListener('pinhtml-visibility-change', (e) => {
    syncBadges((e as CustomEvent<Record<string, boolean>>).detail ?? {});
  });

  // 渲染卡片列表：固定编号（与图钉序号同源）→ 排序 → 过滤后渲染
  function renderCards(): void {
    const listEl = sidebar.listEl;
    listEl.textContent = '';
    const numbers = numberAnnotations(project.annotations, doc);
    const ordered = orderAnnotations(project.annotations, doc);
    const visibleIds = new Set(filterAnnotations(project, filters).map((a) => a.id));
    for (const anno of ordered) {
      if (!visibleIds.has(anno.id)) continue;
      listEl.appendChild(
        buildCardDom(doc, anno, { index: numbers.get(anno.id) ?? 0, hidden: false }, project.categoryLabels),
      );
    }
  }

  function applyFilters(): void {
    sidebar.refreshFilters(filters);
    renderCards();
    viewer?.setFilters(filters);
  }

  // 挂载只读实例（getProject/getFilters 实时读取本闭包变量）
  viewer = mount({
    targetDoc: doc,
    viewportDoc: doc,
    frameEl: null,
    cardsContainer: sidebar.listEl,
    getProject: () => project,
    getFilters: () => filters,
    interactive: true,
    onPinClick: (anchorId) => viewer?.scrollToAnchor(anchorId),
    onCardClick: (annoId) => {
      const anno = project.annotations.find((a) => a.id === annoId);
      if (anno) viewer?.scrollAnchorIntoView(anno);
    },
  });

  renderCards();
  viewer.refresh(); // 首次重算，触发可见性角标同步与连线绘制
}

function setHiddenBadge(card: HTMLElement, hidden: boolean): void {
  let badge = card.querySelector<HTMLElement>('.pinhtml-card-badge');
  if (hidden) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'pinhtml-card-badge';
      badge.textContent = '不可见（当前视图）';
      card.querySelector('.pinhtml-card-foot')?.appendChild(badge);
    }
  } else {
    badge?.remove();
  }
}