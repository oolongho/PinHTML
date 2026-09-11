/**
 * viewer/sidebar.ts —— 导出自举只读侧栏（spec R5 导出自举 / R6 筛选统计）
 *
 * 说明：导出产物不带 React，侧栏由 viewer 原生构建。提供标注栏（可收起/唤出）、
 * 栏头统计、状态与分类筛选、卡片列表容器。不具备创建/编辑/删除/重新锚定能力。
 */
import { CATEGORY_META, getCategoryLabel } from '../lib/types';
import type { Category, Filters, Project } from '../lib/types';

/** 侧栏筛选操作回调（由 bootstrap 注入） */
export interface SidebarActions {
  onStatus(status: Filters['status']): void;
  onCategory(category: Category): void;
}

/** buildSidebar 返回的句柄 */
export interface SidebarResult {
  /** 侧栏根元素（已挂载到 doc.body） */
  root: HTMLElement;
  /** 卡片列表容器（mount 将其作为 cardsContainer 使用） */
  listEl: HTMLElement;
  /** 展开/收起侧栏（同步 body margin 让位） */
  setOpen(open: boolean): void;
  /** 依据最新 filters 刷新筛选 pill 的选中态 */
  refreshFilters(filters: Filters): void;
}

const STATUS_OPTIONS: Array<{ value: Filters['status']; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '待确认' },
  { value: 'resolved', label: '已确认' },
];

/** 生成筛选 pill 按钮，点击触发 onTap；tag 用 data-key 便于 refreshFilters 定位 */
function createPill(doc: Document, label: string, key: string, onTap: () => void): HTMLButtonElement {
  const pill = doc.createElement('button');
  pill.type = 'button';
  pill.className = 'pinhtml-filter-pill';
  pill.textContent = label;
  pill.setAttribute('data-key', key);
  pill.addEventListener('click', onTap);
  return pill;
}

/** 构建只读侧栏并挂载到 doc.body */
export function buildSidebar(
  doc: Document,
  project: Project,
  filters: Filters,
  actions: SidebarActions,
): SidebarResult {
  const openCount = project.annotations.filter((a) => a.status === 'open').length;

  const root = doc.createElement('aside');
  root.className = 'pinhtml-sidebar';

  // 头部：标题 + 统计 + 收起按钮
  const head = doc.createElement('div');
  head.className = 'pinhtml-sidebar-head';
  const titleWrap = doc.createElement('div');
  const title = doc.createElement('div');
  title.className = 'pinhtml-sidebar-title';
  title.textContent = 'PinHTML';
  const stats = doc.createElement('div');
  stats.className = 'pinhtml-sidebar-stats';
  stats.textContent = `标注 ${project.annotations.length} 条 · 待确认 ${openCount}`;
  titleWrap.appendChild(title);
  titleWrap.appendChild(stats);
  const collapse = doc.createElement('button');
  collapse.type = 'button';
  collapse.className = 'pinhtml-sidebar-collapse';
  collapse.textContent = '×';
  head.appendChild(titleWrap);
  head.appendChild(collapse);
  root.appendChild(head);

  // 筛选区：状态（单选）+ 分类（开关）
  const filtersEl = doc.createElement('div');
  filtersEl.className = 'pinhtml-sidebar-filters';
  for (const opt of STATUS_OPTIONS) {
    filtersEl.appendChild(
      createPill(doc, opt.label, `status:${opt.value}`, () => actions.onStatus(opt.value)),
    );
  }
  for (const cat of Object.keys(CATEGORY_META) as Category[]) {
    filtersEl.appendChild(
      createPill(doc, getCategoryLabel(project, cat), `cat:${cat}`, () => actions.onCategory(cat)),
    );
  }
  root.appendChild(filtersEl);

  // 卡片列表容器
  const listEl = doc.createElement('div');
  listEl.className = 'pinhtml-sidebar-list';
  root.appendChild(listEl);

  doc.body.appendChild(root);

  // 唤出浮层按钮（收起时显示）
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pinhtml-sidebar-toggle';
  toggle.textContent = '注';
  doc.body.appendChild(toggle);

  // 展开/收起：open 状态 + body margin 让位 + toggle 显隐
  const setOpen = (open: boolean): void => {
    root.classList.toggle('is-open', open);
    doc.documentElement.classList.toggle('pinhtml-doc-with-sidebar', open);
    toggle.style.display = open ? 'none' : 'block';
  };
  collapse.addEventListener('click', () => {
    setOpen(false);
    toggle.style.display = 'block';
  });
  toggle.addEventListener('click', () => setOpen(true));

  // 刷新筛选 pill 选中态
  const refreshFilters = (current: Filters): void => {
    for (const pill of filtersEl.querySelectorAll<HTMLButtonElement>('.pinhtml-filter-pill')) {
      const key = pill.getAttribute('data-key') ?? '';
      if (key.startsWith('status:')) {
        pill.classList.toggle('is-on', current.status === key.slice('status:'.length));
      } else if (key.startsWith('cat:')) {
        const cat = key.slice('cat:'.length) as Category;
        pill.classList.toggle('is-on', current.categories[cat]);
      }
    }
  };

  // 初始：默认展开，并按初始 filters 上色
  setOpen(true);
  refreshFilters(filters);

  return { root, listEl, setOpen, refreshFilters };
}