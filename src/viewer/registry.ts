/**
 * viewer/registry.ts —— viewer 运行时实例的进程内注册表
 *
 * 说明：viewer 是命令式渲染对象（非 React 状态），工具内由 useViewer 挂载后注册于此。
 * React 组件（AnnoCard / AnnoList）经此获取实例 API（滚动定位 / 脉冲）与目标文档（排序用），
 * 避免多层 prop drilling。导出产物不使用本模块（自举在 viewer 内部完成）。
 */
import type { ViewerInstance } from './types';
import type { Transport } from '@/lib/transport';

let instance: ViewerInstance | null = null;
let targetDoc: Document | null = null;
let transport: Transport | null = null;

/** 注册当前 viewer 实例（useViewer 挂载/销毁时维护） */
export function setViewerInstance(v: ViewerInstance | null): void {
  instance = v;
}

/** 取当前 viewer 实例（未挂载时为 null） */
export function getViewerInstance(): ViewerInstance | null {
  return instance;
}

/** 记录原型目标文档（iframe.contentDocument，供卡片排序 compareDocumentPosition 使用） */
export function setTargetDoc(doc: Document | null): void {
  targetDoc = doc;
}

/** 取原型目标文档 */
export function getTargetDoc(): Document | null {
  return targetDoc;
}

/** 注册 iframe transport（useViewer 建立/销毁时维护） */
export function setTransport(t: Transport | null): void {
  transport = t;
}

/** 取 iframe transport（供 stale 重选「重新选择锚点」触发一次性拾取） */
export function getTransport(): Transport | null {
  return transport;
}