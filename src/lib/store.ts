/**
 * store.ts —— zustand 全局状态（spec 分层图「React 层」）
 *
 * 状态：project / protoCleanSource / protoHash / mode / filters / editing / dirty。
 *
 * dirty 语义（R9）：
 * - 标注数据变更（commitAnnotation / updateAnnotation / removeAnnotation /
 *   toggleStatus / rebindAnchor）必须置 dirty = true；
 * - 模式切换 / 筛选 / 编辑上下文（editing 持有 DOM Element 引用，transient）为 UI 态，不置 dirty；
 * - loadProject / markSaved / resetProject 将 dirty 归 false。
 */
import { create } from 'zustand';
import { buildSelector, docPageKey, getSnippet } from './dom';
import { DEFAULT_FILTERS } from './types';
import type { Anchor, Annotation, Category, Filters, Mode, Project } from './types';

/** 编辑上下文：编辑器打开期间的状态（可持有 iframe 内 DOM Element 引用，不参与持久化） */
export interface EditingState {
  /** 正在编辑的标注 id；null = 新建标注 */
  annotationId: string | null;
  /** 关联的既有锚点 id；null = 待分配新锚点（依赖 element） */
  anchorId: string | null;
  /** 当前拾取的元素（「上移一层」会替换为其父级） */
  element: Element | null;
  /** 「上移一层」历史栈（栈底为最初拾取的元素），供 ] 撤回 */
  pickHistory: Element[];
}

/** commitAnnotation 的表单输入 */
export interface CommitAnnotationInput {
  title: string;
  body: string;
  color: Category;
}

/** commitAnnotation 的提交结果 */
export interface CommitResult {
  /** 提交后关联的锚点 id */
  anchorId: string;
  /** 新建或更新后的标注 */
  annotation: Annotation;
}

/** updateAnnotation 允许更新的字段 */
export type AnnotationPatch = Partial<Pick<Annotation, 'title' | 'body' | 'color'>>;

export interface PinHTMLState {
  /** 当前项目（未加载原型时为 null） */
  project: Project | null;
  /** 原型干净源文本（导出 HTML 的基准，R8） */
  protoCleanSource: string | null;
  /** 原型干净源的哈希 */
  protoHash: string | null;
  /** 当前模式 */
  mode: Mode;
  /** 侧栏筛选器 */
  filters: Filters;
  /** 侧栏关键词搜索（匹配标题 / 正文；空串为不搜索；UI 态，不置 dirty） */
  query: string;
  /** 编辑上下文（编辑器打开期间非 null） */
  editing: EditingState | null;
  /** 自上次保存/导出后是否有变更（beforeunload 提示依据，R9） */
  dirty: boolean;
  /** 失联锚点 id 集合（stale 态，卡片置灰 + 提供「重新选择锚点」，R7） */
  staleAnchorIds: string[];
  /** 属于其他页的锚点 id 集合（URL 模式多页原型，R13；卡片显示「属于其他页」而非失联） */
  otherPageAnchorIds: string[];
  /** 待重新选择的 stale 锚点 id（一次性拾取意图；下一次拾取用于改绑；载入原型时清空） */
  pendingRebindAnchorId: string | null;
  /** 原型 DOM 结构版本（结构变化时自增，驱动依赖文档顺序的编号/排序重算；不置 dirty） */
  structureVersion: number;

  /** 载入项目：整体重置（回浏览模式、默认筛选、清编辑上下文）并清 dirty */
  loadProject: (project: Project, protoCleanSource: string, protoHash: string) => void;
  /** 清空回空状态（关闭原型） */
  resetProject: () => void;
  setMode: (mode: Mode) => void;
  setFilters: (patch: Partial<Filters>) => void;
  /** 设置侧栏搜索关键词（UI 态，不置 dirty） */
  setQuery: (query: string) => void;
  /** 重新插入一条被删除的标注（删除撤销；锚点本就保留，故只需回插标注；置 dirty） */
  restoreAnnotation: (annotation: Annotation) => void;
  /** 打开编辑器（进入编辑上下文） */
  beginEdit: (state: EditingState) => void;
  /** 「上移一层」：改绑到新元素，原元素压入 pickHistory */
  updateEditElement: (element: Element) => void;
  /** 「]」撤回：弹出 pickHistory 栈顶恢复为当前元素；无可撤回时返回 null（状态不变） */
  undoEditElement: () => Element | null;
  /** 取消编辑（不产生数据变更） */
  cancelEdit: () => void;
  /**
   * 提交标注（新建/复用锚点 + 新建/更新标注），完成后清空 editing 并置 dirty。
   * - editing.anchorId 为空：用 anchorSeq+1 分配 e-N，给 element 写 data-anno-id，
   *   anchors 追加（selector/snippet 由 dom.ts 生成，createdAt ISO 8601）；
   *   元素已有 data-anno-id 时复用该锚点（同一元素追加标注）。
   * - editing.annotationId 为空：annoSeq+1 分配 a-N 新建标注（status 初始 open）；
   *   否则更新既有标注（updatedAt 刷新）。
   * - 编辑期间「上移一层」过（element 的 data-anno-id 与 anchorId 不一致）：
   *   同步更新锚点 selector/snippet 并把属性写到新元素、从旧元素移除。
   * @returns 提交结果；无项目 / 无编辑上下文 / 数据不一致时返回 null（不产生任何变更）
   */
  commitAnnotation: (input: CommitAnnotationInput) => CommitResult | null;
  /** 更新标注的标题/正文/分类（updatedAt 刷新，置 dirty） */
  updateAnnotation: (id: string, patch: AnnotationPatch) => void;
  /** 删除标注；anchors 保留不动（锚点无标注时 pin 计数为 0 自然隐藏） */
  removeAnnotation: (id: string) => void;
  /** open ↔ resolved 状态切换（updatedAt 刷新，置 dirty） */
  toggleStatus: (id: string) => void;
  /** 三态重锚定（R7）：锚点改绑到新元素并更新 selector/snippet，写 data-anno-id */
  rebindAnchor: (anchorId: string, element: Element, selector: string, snippet: string) => void;
  /** 设置失联锚点集合（stale 态，R7） */
  setStaleAnchorIds: (ids: string[]) => void;
  /** 设置「属于其他页」锚点集合（URL 模式多页原型，R13） */
  setOtherPageAnchorIds: (ids: string[]) => void;
  /** 设置待重新选择的锚点 id（null = 退出一次性拾取态；不置 dirty） */
  setPendingRebind: (anchorId: string | null) => void;
  /** 原型 DOM 结构变化时递增版本号（驱动编号/排序重算） */
  bumpStructure: () => void;
  /** 更新分类显示名（用户自定义标签，置 dirty） */
  setCategoryLabels: (labels: Partial<Record<Category, string>>) => void;
  /** 保存 / 导出成功后清除 dirty */
  markSaved: () => void;
}

export const usePinHTMLStore = create<PinHTMLState>((set, get) => ({
  project: null,
  protoCleanSource: null,
  protoHash: null,
  mode: 'browse',
  filters: DEFAULT_FILTERS,
  query: '',
  editing: null,
  dirty: false,
  staleAnchorIds: [],
  otherPageAnchorIds: [],
  structureVersion: 0,
  pendingRebindAnchorId: null,

  loadProject: (project, protoCleanSource, protoHash) =>
    set({
      project,
      protoCleanSource,
      protoHash,
      mode: 'browse',
      filters: DEFAULT_FILTERS,
      query: '',
      editing: null,
      dirty: false,
      staleAnchorIds: [],
      otherPageAnchorIds: [],
      structureVersion: 0,
      pendingRebindAnchorId: null,
    }),

  resetProject: () =>
    set({
      project: null,
      protoCleanSource: null,
      protoHash: null,
      mode: 'browse',
      filters: DEFAULT_FILTERS,
      query: '',
      editing: null,
      dirty: false,
      staleAnchorIds: [],
      otherPageAnchorIds: [],
      structureVersion: 0,
      pendingRebindAnchorId: null,
    }),

  setMode: (mode) => set({ mode }),

  setFilters: (patch) =>
    set((s) => ({
      filters: {
        ...s.filters,
        ...patch,
        // categories 为嵌套记录，需深合并一层
        categories: { ...s.filters.categories, ...(patch.categories ?? {}) },
      },
    })),

  setQuery: (query) => set({ query }),

  restoreAnnotation: (annotation) => {
    const { project } = get();
    if (!project) return;
    if (project.annotations.some((a) => a.id === annotation.id)) return;
    set({ project: { ...project, annotations: [...project.annotations, annotation] }, dirty: true });
  },

  beginEdit: (state) => set({ editing: state }),

  updateEditElement: (element) =>
    set((s) => {
      if (!s.editing) return {};
      const prev = s.editing.element;
      return {
        editing: {
          ...s.editing,
          element,
          pickHistory: prev ? [...s.editing.pickHistory, prev] : [...s.editing.pickHistory],
        },
      };
    }),

  undoEditElement: () => {
    const editing = get().editing;
    if (!editing || editing.pickHistory.length === 0) return null;
    const restored = editing.pickHistory[editing.pickHistory.length - 1];
    const history = editing.pickHistory.slice(0, -1);
    set({ editing: { ...editing, element: restored, pickHistory: history } });
    return restored;
  },

  cancelEdit: () => set({ editing: null }),

  commitAnnotation: (input) => {
    const { project, editing } = get();
    if (!project || !editing) return null;
    const now = new Date().toISOString();
    let anchorId = editing.anchorId;
    let { anchors, annotations, anchorSeq, annoSeq } = project;

    if (anchorId) {
      // 已有锚点：若编辑期间「上移一层」改绑了元素（data-anno-id 不一致），同步锚点证据与 DOM 属性
      const el = editing.element;
      if (el && el.getAttribute('data-anno-id') !== anchorId) {
        if (!anchors.some((a) => a.id === anchorId)) return null;
        // 从历史栈定位原锚点元素并移除属性
        for (const prev of editing.pickHistory) {
          if (prev.getAttribute('data-anno-id') === anchorId) prev.removeAttribute('data-anno-id');
        }
        el.setAttribute('data-anno-id', anchorId);
        anchors = anchors.map((a) =>
          a.id === anchorId ? { ...a, selector: buildSelector(el), snippet: getSnippet(el) } : a,
        );
      }
    } else {
      // 新建锚点：依赖当前拾取的元素
      const el = editing.element;
      if (!el) return null;
      const existingId = el.getAttribute('data-anno-id');
      const existing = existingId ? anchors.find((a) => a.id === existingId) : undefined;
      if (existingId && existing) {
        // 元素已有锚点：复用（同一元素追加标注，R2 Scenario）
        anchorId = existingId;
      } else {
        // 兜底：data-anno-id 缺失（原型 DOM 重渲染导致属性丢失等）时，按 selector + snippet
        // 双证据匹配既有锚点，避免同一元素被重复分配锚点、导致图钉计数不累加
        const selector = buildSelector(el);
        const snippet = getSnippet(el);
        const byEvidence = anchors.find((a) => a.selector === selector && a.snippet === snippet);
        if (byEvidence) {
          anchorId = byEvidence.id;
        } else {
          anchorSeq += 1;
          anchorId = `e-${anchorSeq}`;
          // 页面归属：URL 模式（真实文档 URL）下记录当前页路径；srcdoc 单文档不记录（R13）
          const pageKey = docPageKey(el.ownerDocument);
          const anchor: Anchor = {
            id: anchorId,
            selector,
            snippet,
            ...(pageKey ? { docPath: pageKey } : {}),
            createdAt: now,
          };
          anchors = [...anchors, anchor];
        }
        el.setAttribute('data-anno-id', anchorId);
      }
    }

    // 标注：annotationId 为空 → 新建；否则更新
    let annotation: Annotation;
    if (!editing.annotationId) {
      annoSeq += 1;
      annotation = {
        id: `a-${annoSeq}`,
        anchorId,
        title: input.title,
        body: input.body,
        color: input.color,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      annotations = [...annotations, annotation];
    } else {
      const target = annotations.find((a) => a.id === editing.annotationId);
      if (!target) return null;
      annotation = {
        ...target,
        anchorId,
        title: input.title,
        body: input.body,
        color: input.color,
        updatedAt: now,
      };
      annotations = annotations.map((a) => (a.id === annotation.id ? annotation : a));
    }

    set({ project: { ...project, anchors, annotations, anchorSeq, annoSeq }, editing: null, dirty: true });
    return { anchorId, annotation };
  },

  updateAnnotation: (id, patch) => {
    const { project } = get();
    if (!project) return;
    const now = new Date().toISOString();
    let found = false;
    const annotations = project.annotations.map((a) => {
      if (a.id !== id) return a;
      found = true;
      return { ...a, ...patch, updatedAt: now };
    });
    if (!found) return;
    set({ project: { ...project, annotations }, dirty: true });
  },

  removeAnnotation: (id) => {
    const { project } = get();
    if (!project) return;
    const annotations = project.annotations.filter((a) => a.id !== id);
    // anchors 保留不动：无标注的锚点 pin 计数为 0 自然隐藏
    set({ project: { ...project, annotations }, dirty: true });
  },

  toggleStatus: (id) => {
    const { project } = get();
    if (!project) return;
    const now = new Date().toISOString();
    let found = false;
    const annotations = project.annotations.map((a) => {
      if (a.id !== id) return a;
      found = true;
      const status: Annotation['status'] = a.status === 'open' ? 'resolved' : 'open';
      return { ...a, status, updatedAt: now };
    });
    if (!found) return;
    set({ project: { ...project, annotations }, dirty: true });
  },

  rebindAnchor: (anchorId, element, selector, snippet) => {
    const { project } = get();
    if (!project) return;
    // 改绑即认定「这条锚点归属当前页」：更新页面归属（srcdoc 单文档则清空）
    const pageKey = docPageKey(element.ownerDocument);
    let found = false;
    const anchors = project.anchors.map((a) => {
      if (a.id !== anchorId) return a;
      found = true;
      return { ...a, selector, snippet, docPath: pageKey ?? undefined };
    });
    if (!found) return;
    element.setAttribute('data-anno-id', anchorId);
    // 重绑成功后从失联 / 其他页集合移除
    set({
      project: { ...project, anchors },
      staleAnchorIds: get().staleAnchorIds.filter((id) => id !== anchorId),
      otherPageAnchorIds: get().otherPageAnchorIds.filter((id) => id !== anchorId),
      dirty: true,
    });
  },

  setStaleAnchorIds: (ids) => set({ staleAnchorIds: ids }),

  setOtherPageAnchorIds: (ids) => set({ otherPageAnchorIds: ids }),

  setPendingRebind: (anchorId) => set({ pendingRebindAnchorId: anchorId }),

  bumpStructure: () => set((s) => ({ structureVersion: s.structureVersion + 1 })),

  setCategoryLabels: (labels) => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, categoryLabels: { ...project.categoryLabels, ...labels } },
      dirty: true,
    });
  },

  markSaved: () => set({ dirty: false }),
}));

/**
 * 选择器（非 hook 纯函数）：按状态（all/open/resolved）+ 分类开关过滤标注列表。
 * project 为 null 时返回空数组。
 */
export function filterAnnotations(project: Project | null, filters: Filters): Annotation[] {
  if (!project) return [];
  return project.annotations.filter(
    (a) => (filters.status === 'all' || a.status === filters.status) && filters.categories[a.color],
  );
}
