/**
 * project-ops.ts —— 标注 / 锚点的 CRUD 语义（spec DC4「唯一语义来源」）
 *
 * 职责：在 Project 数据快照上完成「新建 / 更新 / 删除标注、新建 / 复用锚点、
 * 序列号分配、时间戳刷新」，供 zustand store（GUI）与 CLI 共用。id 分配规则只有这一份，
 * 两侧不会各自演进成「CLI 分配 a-1、GUI 也分配 a-1」的撞号分叉。
 *
 * 边界：
 * - 纯函数：不碰 DOM、不 import store / draft / transport / viewer；不加锁、不落盘。
 *   入参 project 及其中的数组一律不被修改，返回新对象（zustand 依赖引用变化触发更新）。
 * - DOM 相关的事留给调用方：写 / 摘 data-anno-id、生成 selector / snippet（dom.ts）、
 *   页面归属（docPageKey）、三态判定（reanchor.ts 的 resolveAnchor）。
 * - 三态需要文档才能判定，本层没有 Document，`addAnnotation` 返回的 `state` 只是占位
 *   （恒为 'fresh'）；持有文档的调用方应以 `resolveAnchor(doc, anchor)` 的结果为准。
 *
 * 语义来源：逐条对齐 store.commitAnnotation / updateAnnotation / removeAnnotation 的
 * 既有文档注释与实现（anchorSeq + 1 → e-N、annoSeq + 1 → a-N、createdAt ISO 8601、
 * status 初始 open、同元素复用既有锚点），只把数据变更抽出来，行为不变。
 */
import type { AnnoStatus, Anchor, Annotation, Category, Project } from './types';
import type { ReanchorState } from './reanchor';

/** 新建标注的输入（CLI 可把草稿项字段原样传入） */
export interface AddAnnotationInput {
  /** 锚点定位证据之一：CSS 路径（dom.ts#buildSelector 生成） */
  selector: string;
  /** 锚点定位证据之二：元素文本前 40 字符（dom.ts#getSnippet 生成） */
  snippet: string;
  /** 标题 */
  title: string;
  /** 正文 */
  body: string;
  /** 分类 */
  color: Category;
  /** 创建时间（ISO 8601）；缺省取当前时间，锚点与标注共用同一个值 */
  createdAt?: string;
  /**
   * 草稿项的人工追溯标签（R9 的 `source`，形如 `PRD §3.2`）。
   * 传入即落进 Annotation（仅作人工追溯，不参与任何逻辑）；未传则新标注不带该字段、
   * 更新既有标注时保留原值。
   */
  source?: string;
  /** 状态：新建时缺省 `'open'`；更新既有标注时缺省保持原状态 */
  status?: AnnoStatus;
  /**
   * 调用方已从 DOM 解析出的既有锚点 id（元素带 data-anno-id，或编辑上下文持有 anchorId）。
   * 命中则复用该锚点，并以传入的 selector / snippet 覆盖其证据（改绑时即以此同步；
   * 传入同值则无实际变化）。未命中时按 selector + snippet 双证据兜底。
   */
  anchorId?: string | null;
  /** 页面归属（URL 模式多页原型，R13）；仅新建锚点时写入，缺省不记录 */
  docPath?: string | null;
  /**
   * 草稿项自带的标注 id（DC7 upsert）：该 id 已存在 → 更新该标注；
   * 不存在或未传 → 按 annoSeq + 1 新建。
   */
  id?: string;
}

/** 新建标注的结果 */
export interface AddAnnotationResult {
  /** 变更后的新 project（原对象未被修改） */
  project: Project;
  /** 标注最终挂载的锚点 id（复用或新建） */
  anchorId: string;
  /** 新建或更新后的标注 id */
  annotationId: string;
  /** 锚点三态占位：本层无文档，恒为 'fresh'（见文件头边界说明） */
  state: ReanchorState;
}

/** 更新标注允许的字段（updatedAt 由本层刷新） */
export type UpdateAnnotationPatch = Partial<Pick<Annotation, 'title' | 'body' | 'color' | 'status'>>;

/** 删除标注的选项 */
export interface RemoveAnnotationOptions {
  /**
   * 是否连带删除该标注的锚点（CLI `delete --anchor`）。
   * 锚点仍被其他标注引用时保留——否则其余标注的 anchorId 会悬空，违背「删一条不动其余」。
   */
  anchor?: boolean;
}

/** 删除标注的结果 */
export interface RemoveAnnotationResult {
  /** 变更后的 project；id 不存在时原样返回（引用相等） */
  project: Project;
  /** 被删除的标注快照；id 不存在时为 null */
  removed: Annotation | null;
}

/**
 * 新建或更新一条标注（对应 store.commitAnnotation 的数据部分）。
 *
 * 锚点解析顺序（与 store 既有实现一致）：
 * 1. `input.anchorId` 命中既有锚点 → 复用，并用传入证据覆盖（改绑即由此同步）；
 * 2. 未命中 → 按 `selector` + `snippet` 双证据匹配既有锚点（兜底 data-anno-id 丢失）；
 * 3. 仍未命中 → `anchorSeq + 1` 分配 `e-N` 新建锚点（写入 docPath，缺省不写）。
 *
 * 标注解析：`input.id` 命中既有标注 → 更新 title / body / color / status 与 anchorId，
 * 刷新 updatedAt；否则 `annoSeq + 1` 分配 `a-N` 新建，status 缺省 `'open'`，
 * createdAt / updatedAt 均取 `createdAt ?? 当前时间`。
 */
export function addAnnotation(project: Project, input: AddAnnotationInput): AddAnnotationResult {
  const now = input.createdAt ?? new Date().toISOString();
  let anchors = project.anchors;
  let anchorSeq = project.anchorSeq;
  let anchorId: string | null = null;

  // ① 调用方已解析出既有锚点：复用（同元素追加标注 / 编辑期改绑）
  if (input.anchorId) {
    const existing = anchors.find((a) => a.id === input.anchorId);
    if (existing) {
      anchorId = existing.id;
      anchors = anchors.map((a) =>
        a.id === existing.id ? { ...a, selector: input.selector, snippet: input.snippet } : a,
      );
    }
  }

  // ② selector + snippet 双证据兜底：避免同一元素被重复分配锚点（图钉计数不累加）
  if (!anchorId) {
    const byEvidence = anchors.find((a) => a.selector === input.selector && a.snippet === input.snippet);
    if (byEvidence) anchorId = byEvidence.id;
  }

  // ③ 新建锚点：anchorSeq + 1 → e-N
  if (!anchorId) {
    anchorSeq += 1;
    anchorId = `e-${anchorSeq}`;
    const anchor: Anchor = {
      id: anchorId,
      selector: input.selector,
      snippet: input.snippet,
      ...(input.docPath ? { docPath: input.docPath } : {}),
      createdAt: now,
    };
    anchors = [...anchors, anchor];
  }

  let annotations = project.annotations;
  let annoSeq = project.annoSeq;
  const target = input.id ? annotations.find((a) => a.id === input.id) : undefined;
  let annotation: Annotation;

  if (target) {
    // 更新既有标注（DC7 upsert）：status 缺省保持原值
    annotation = {
      ...target,
      anchorId,
      // 未传 source 时保留既有值；传了则覆盖（undefined 不产生该键）
      ...(input.source !== undefined ? { source: input.source } : {}),
      title: input.title,
      body: input.body,
      color: input.color,
      status: input.status ?? target.status,
      updatedAt: now,
    };
    annotations = annotations.map((a) => (a.id === annotation.id ? annotation : a));
  } else {
    // 新建标注：annoSeq + 1 → a-N，status 缺省 open
    annoSeq += 1;
    annotation = {
      id: `a-${annoSeq}`,
      anchorId,
      ...(input.source !== undefined ? { source: input.source } : {}),
      title: input.title,
      body: input.body,
      color: input.color,
      status: input.status ?? 'open',
      createdAt: now,
      updatedAt: now,
    };
    annotations = [...annotations, annotation];
  }

  return {
    project: { ...project, anchors, annotations, anchorSeq, annoSeq },
    anchorId,
    annotationId: annotation.id,
    state: 'fresh',
  };
}

/**
 * 更新标注的标题 / 正文 / 分类 / 状态（对应 store.updateAnnotation / CLI `update`）。
 * updatedAt 一律刷新；id 不存在时原样返回传入 project（引用相等），不抛错。
 */
export function updateAnnotation(project: Project, id: string, patch: UpdateAnnotationPatch): Project {
  if (!project.annotations.some((a) => a.id === id)) return project;
  const now = new Date().toISOString();
  return {
    ...project,
    annotations: project.annotations.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now } : a)),
  };
}

/**
 * 删除标注（对应 store.removeAnnotation / CLI `delete`）。
 *
 * 默认只删标注、**保留锚点**（无标注的锚点 pin 计数为 0，自然隐藏）；
 * `opts.anchor` 为 true 时连带删除该锚点，但仍有其他标注引用它时保留（见选项注释）。
 * id 不存在时返回原 project（引用相等）与 `removed: null`。
 */
export function removeAnnotation(
  project: Project,
  id: string,
  opts: RemoveAnnotationOptions = {},
): RemoveAnnotationResult {
  const removed = project.annotations.find((a) => a.id === id) ?? null;
  if (!removed) return { project, removed: null };

  const annotations = project.annotations.filter((a) => a.id !== id);
  const orphaned = opts.anchor === true && !annotations.some((a) => a.anchorId === removed.anchorId);
  const anchors = orphaned ? project.anchors.filter((a) => a.id !== removed.anchorId) : project.anchors;

  return { project: { ...project, anchors, annotations }, removed };
}
