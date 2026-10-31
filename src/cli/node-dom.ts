/**
 * node-dom.ts —— 在 Node 环境为 CLI 安装最小 DOM 全局（happy-dom）。
 *
 * 职责：lib 的锚定 / 排序逻辑依赖全局 DOMParser 与 Node.DOCUMENT_POSITION_*
 * 常量，而 CLI 不经过浏览器，故在入口处一次性注入。对 happy-dom 的类型对齐
 * 集中在本文件，其余 CLI 代码只消费标准 DOM 类型。
 *
 * 注意：happy-dom 导出的 DOMParser 是未绑定 Window 的裸类，其 parseFromString
 * 依赖实例上的内部 window 符号（直接 new 会在解析时抛错）；因此这里创建
 * 一个 Window 实例，取它绑定的 DOMParser / Node 再挂到全局。
 */
import { Window } from 'happy-dom';

let installed = false;

/** 幂等安装全局 DOMParser / Node（Node 提供 compareDocumentPosition 所需常量） */
export function installNodeDom(): void {
  if (installed) return;
  installed = true;
  const happyWindow = new Window();
  const globals = globalThis as { DOMParser?: unknown; Node?: unknown };
  globals.DOMParser = happyWindow.DOMParser;
  globals.Node = happyWindow.Node;
}
