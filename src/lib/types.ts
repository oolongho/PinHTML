/**
 * types.ts —— schema v1 数据模型（spec R3）
 *
 * 职责：Project / Anchor / Annotation / Category（interaction | visual | question | note）/
 * AnnoStatus（open | resolved）/ Filters / Mode 的 TypeScript 定义与分类常量。
 * viewer.js 内以 JSDoc 镜像同形状（spec 分层图「共享契约」）。
 */

/** 标注分类（四类，兼作颜色键） */
export type Category = 'interaction' | 'visual' | 'question' | 'note';

/** 标注状态 */
export type AnnoStatus = 'open' | 'resolved';

/** 工具模式：浏览（零拦截）/ 标注（拾取） */
export type Mode = 'browse' | 'annotate';

/** 锚点：挂在原型元素上的定位记录（一个锚点可挂多条标注） */
export interface Anchor {
  /** 锚点 id，形如 e-N（N 为 anchorSeq 自增序列） */
  id: string;
  /** 生成锚点时的 CSS 路径（nth-of-type 链），仅用于原型改版后的自动重绑（R7 moved 态）；运行时定位一律以 data-anno-id 为准 */
  selector: string;
  /** 锚定元素 textContent 规范化空白后前 40 字符，重绑时的第二证据 */
  snippet: string;
  /**
   * 页面归属（URL 模式多页原型，R13）：创建时的文档路径（pathname + search）。
   * 缺省 = 未记录（srcdoc 文件模式 / 老项目），按「当前页」处理。
   */
  docPath?: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/** 标注：挂在锚点上的 PRD 简注 */
export interface Annotation {
  /** 标注 id，形如 a-N（N 为 annoSeq 自增序列） */
  id: string;
  /** 所属锚点 id */
  anchorId: string;
  /** 标题（必填 ≤60 字） */
  title: string;
  /** 正文（≤2000 字，支持换行） */
  body: string;
  /** 分类（四选一，默认 interaction） */
  color: Category;
  /** 状态：open 待确认 / resolved 已确认 */
  status: AnnoStatus;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后更新时间（ISO 8601） */
  updatedAt: string;
}

/** 项目（schema v1），保存为 <原型名>.anno.json */
export interface Project {
  /** 数据模型版本 */
  schema: 1;
  /** 原型文件名 */
  protoName: string;
  /** 原型干净源文本的哈希（SHA-256 前 16 位，降级时 FNV-1a），用于变更检测 */
  protoHash: string;
  /** 锚点 id 自增序列（已分配的最大值） */
  anchorSeq: number;
  /** 标注 id 自增序列（已分配的最大值） */
  annoSeq: number;
  anchors: Anchor[];
  annotations: Annotation[];
  /**
   * 干净源对应的页面键（URL 模式加载时记录；文件模式缺省）。
   * 导出注入时据此跳过「属于其他页」的锚点（那些元素不在本份干净源里）。
   */
  protoDocPath?: string;
  /** 分类显示名覆盖（用户自定义；未覆盖的分类用 CATEGORY_META 默认中文名） */
  categoryLabels?: Partial<Record<Category, string>>;
}

/** 分类元信息（中文名 + 色值） */
export interface CategoryMeta {
  /** 中文标签 */
  label: string;
  /** 色值（连线 / 色条 / 标签统一取色处） */
  color: string;
}

/** 四分类的中文名与色值 */
export const CATEGORY_META: Record<Category, CategoryMeta> = {
  interaction: { label: '交互说明', color: '#2563EB' },
  visual: { label: '视觉规范', color: '#7C3AED' },
  question: { label: '待定问题', color: '#D97706' },
  note: { label: '一般备注', color: '#85857F' },
};

/** 取分类显示名：用户自定义优先，否则回退默认中文名 */
export function getCategoryLabel(
  project: { categoryLabels?: Partial<Record<Category, string>> } | null | undefined,
  cat: Category,
): string {
  return project?.categoryLabels?.[cat] ?? CATEGORY_META[cat].label;
}

/** 侧栏筛选器 */
export interface Filters {
  /** 状态筛选：全部 / 待确认 / 已确认 */
  status: 'all' | AnnoStatus;
  /** 分类筛选开关（默认全开） */
  categories: Record<Category, boolean>;
}

/** 筛选器默认值：状态「全部」、四分类全开 */
export const DEFAULT_FILTERS: Filters = {
  status: 'all',
  categories: { interaction: true, visual: true, question: true, note: true },
};
