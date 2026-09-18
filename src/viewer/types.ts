/**
 * viewer/types.ts —— viewer 的契约类型与过滤纯函数（spec R5 / R6）
 *
 * 说明：viewer 的运行时产物须「零 React 负担」，因此**不** import zustand store。
 * 数据类型与常量复用 lib/types（type import 被 esbuild 移除，值 import 打进 bundle 属必需）；
 * filterAnnotations 是 viewer 内部独立的过滤纯函数，与 React 侧 store 的过滤逻辑同构但互不依赖。
 */
import type { Annotation, Filters, Project } from '../lib/types';

/** 连线端点数据（重算时由 mount 计算后交给 svg 绘制） */
export interface LineItem {
  /** 标注 id */
  annoId: string;
  /** 分类色 */
  color: string;
  /** pin 中心（viewportDoc 视口坐标） */
  px: number;
  py: number;
  /** 卡片左缘垂直中点（viewportDoc 视口坐标） */
  cx: number;
  cy: number;
}

/** 锚点渲染数据（重算时由 mount 计算后交给 pin 渲染；仅包含需要显示图钉的锚点） */
export interface PinItem {
  /** 分组主锚点 id（同元素多锚点合并为一个图钉，取其首个锚点） */
  anchorId: string;
  /** 图钉中心（targetDoc 视口坐标） */
  x: number;
  y: number;
  /** 图钉显示的序号文本（= 内容序号，取该元素上序号最小的可见标注） */
  label: string;
  /** 图钉底色（跟随 label 对应标注的分类色） */
  color: string;
  /** 悬浮提示：该序号对应标注的标题（便于快速辨认） */
  title: string;
}

/** mount 入参契约（spec R5） */
export interface MountOptions {
  /** 锚点所在文档（工具内 = iframe.contentDocument；导出 = document） */
  targetDoc: Document;
  /** 连线 SVG 所在文档（工具内 = 顶层 document；导出 = document） */
  viewportDoc: Document;
  /** iframe 元素（pin 坐标换算用；导出模式为 null） */
  frameEl?: HTMLIFrameElement | null;
  /** 工具模式 = React 渲染的 #annoList 容器（仅查询卡片元素，不渲染）；导出模式 = 侧栏列表容器 */
  cardsContainer?: HTMLElement | null;
  /** () => Project，每次重算实时读取 */
  getProject: () => Project | null;
  /** () => Filters，每次重算实时读取 */
  getFilters: () => Filters;
  /** 是否绑定点击/hover 联动（导出只读模式为 true） */
  interactive: boolean;
  /** 点击卡片（非编辑态）回调 */
  onCardClick?: (annoId: string) => void;
  /** 点击 pin 回调 */
  onPinClick?: (anchorId: string) => void;
}

/** 实例 API（spec R5 / R6） */
export interface ViewerInstance {
  /** 手动触发一次全量重算（React store 变化后调用） */
  refresh(): void;
  /** 更新内部筛选（导出模式驱动侧栏筛选 UI 联动；工具模式通常读 store 无需调用） */
  setFilters(f: Filters): void;
  /** 卡片列表滚动到该锚点第一条标注并 flash 高亮 */
  scrollToAnchor(anchorId: string): void;
  /** 对应 pin 播放脉冲动画一次 */
  pulse(anchorId: string): void;
  /** targetDoc 内滚动到该标注锚点元素（视口中央）+ pin 脉冲 */
  scrollAnchorIntoView(annotation: Annotation): void;
  /** 在 cardsContainer/侧栏内查找某标注卡片元素 */
  findCardEl(annoId: string): HTMLElement | null;
  /** true 恢复 pin 可交互；false 时 pin 层整体 pointer-events:none（标注拾取模式避免拾取到 pin） */
  setPinInteractive(bool: boolean): void;
  /** 销毁：移除全部 DOM 注入与事件监听 */
  destroy(): void;
}

/** viewer 顶层 API（window.PinHTMLViewer 形态） */
export interface PinHTMLViewerApi {
  mount(opts: MountOptions): ViewerInstance;
}

/**
 * 过滤标注（viewer 内部实现，与 React 侧 store 逻辑同构）：
 * 状态筛选（all/open/resolved）+ 分类开关。
 */
export function filterAnnotations(project: Project | null, filters: Filters): Annotation[] {
  if (!project) return [];
  return project.annotations.filter((a) => {
    if (filters.status !== 'all' && a.status !== filters.status) return false;
    return filters.categories[a.color];
  });
}

/** 对锚点 source 做 `data-anno-id` 查找（工具与导出两上下文统一的运行时定位依据，spec R3） */
export function findAnchorElement(targetDoc: Document, anchorId: string): Element | null {
  return targetDoc.querySelector(`[data-anno-id="${anchorId}"]`);
}