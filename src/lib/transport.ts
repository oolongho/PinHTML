/**
 * transport.ts —— 父页 ↔ 原型 iframe 通信封装（spec R11 / D1）
 *
 * 本文件定义两侧契约，供 Task 3 实现 src/bridge.js 时严格遵循：
 * - iframe 内：bridge 脚本求值时即在 contentWindow 挂载 window.PinHTMLBridge（见接口）；
 * - 父页侧：Transport 接口收敛全部跨文档操作（pick / locate / structureChange），
 *   可整体替换为 postMessage 实现（D1：本期只做 contentDocument 直连，不做降级通道）。
 *
 * 直连原理：srcdoc iframe 与父页同源，父页可经 iframe.contentWindow.PinHTMLBridge 直接调用。
 */
import type { Mode } from './types';

/** 通信契约版本（bridge.version 应与之相等，供握手校验 / 调试） */
export const TRANSPORT_VERSION = '1';

/** bridge.init(config) 的配置：父页注册到 iframe 内的回调 */
export interface BridgeConfig {
  /**
   * 拾取回调：标注模式下点击元素时回传目标元素（bridge 完成 [ ] 层级解析后的最终元素）；
   * pickOnce 生效期间（stale 重锚定 / 续绑的临时拾取态），任意模式下点击都回调一次。
   */
  onPick: (element: Element) => void;
  /** 结构变化回调：bridge 的 MutationObserver（childList + subtree + attributes）合并转发，父页据此触发 rAF 重算 */
  onStructureChange: () => void;
  /** bridge.destroy() 执行后的通知（可选，预留） */
  onDestroyed?: () => void;
  /**
   * 层级键回调（可选）：按 `[`（放宽一层，向父元素，'up'）或 `]`（收窄一层，回到子元素，'down'）时通知父页。
   * 父页编辑器打开时据此改绑锚点父元素 / 撤回上次上移；bridge 自身的 hover 路径调整照常进行，两者互不冲突。
   */
  onLayerKey?: (dir: 'up' | 'down') => void;
}

/**
 * iframe 内 bridge 的全局契约（Task 3 在 src/bridge.js 中实现并挂载）：
 *
 *   window.PinHTMLBridge = { version, init(config), setMode(mode),
 *                            setPickOnce(flag), locate(anchorId), destroy() }
 *
 * 生命周期：bridge 脚本求值即挂载 PinHTMLBridge（DOM 未就绪也允许，内部待
 * DOMContentLoaded 后再绑定事件）；父页在 iframe load 后调 init 建立连接。
 */
export interface PinHTMLBridge {
  /** 通信契约版本，等于 TRANSPORT_VERSION */
  version: string;
  /**
   * 初始化：父页建立连接时调用，注册回调；可重复调用，以最后一次为准。
   */
  init(config: BridgeConfig): void;
  /**
   * 切换模式：
   * - 'browse'：不拦截任何事件，原型自身交互照常；
   * - 'annotate'：capture 阶段拦截 click（preventDefault + stopImmediatePropagation）、
   *   hover 最内层元素显示拾取高亮（pinhtml- 前缀 class + !important）、支持 [ ] 键层级，
   *   input / textarea / contenteditable 聚焦时不触发层级键。
   */
  setMode(mode: Mode): void;
  /**
   * 一次性拾取开关（供 stale 重锚定 / 续绑的临时拾取态）：
   * true = 下一次点击无论当前处于何种模式，都回调 onPick 一次，
   * 随后自动回到原模式并把开关复位为 false。
   */
  setPickOnce(flag: boolean): void;
  /** 在 iframe 内滚动 data-anno-id 等于 anchorId 的元素到视口中央（scrollIntoView block:'center'） */
  locate(anchorId: string): void;
  /** 销毁：移除全部事件监听、MutationObserver 与注入高亮，供原型切换 / 工具卸载时调用 */
  destroy(): void;
}

declare global {
  interface Window {
    /** 仅原型 iframe 内由 bridge.js 挂载；工具父窗口不挂载 */
    PinHTMLBridge?: PinHTMLBridge;
  }
}

/**
 * 跨文档操作接口（父页侧）。D1：可整体替换为 postMessage 实现的收敛点。
 *
 * pinEvent 预留位说明：pin 点击联动由 viewer.mount({ onPinClick }) 回调承担
 * （viewer 直接在 pin 层做事件委托），不经 transport；若未来 transport 替换为
 * postMessage 实现，需在此接口增加 onPinEvent(cb: (anchorId: string) => void) 预留位。
 */
export interface Transport {
  /** 切换 iframe 内模式（browse 零拦截 / annotate 拾取） */
  setMode(mode: Mode): void;
  /** 开关一次性拾取（语义见 PinHTMLBridge.setPickOnce） */
  pickOnce(enabled: boolean): void;
  /** 注册拾取回调（重复调用以最后一次注册为准） */
  onPick(cb: (el: Element) => void): void;
  /** 注册结构变化回调（重复调用以最后一次注册为准） */
  onStructureChange(cb: () => void): void;
  /** 注册层级键回调（可选；重复调用以最后一次注册为准；不注册则 bridge 侧按键仅调整自身 hover 路径） */
  onLayerKey?(cb: (dir: 'up' | 'down') => void): void;
  /** 滚动 data-anno-id = anchorId 的元素到 iframe 视口中央 */
  locate(anchorId: string): void;
}

/**
 * 直连 transport（D1）：经 iframe.contentWindow.PinHTMLBridge 调用，不做 postMessage。
 * bridge 未就绪（脚本未执行 / 挂载失败）返回 null，调用方可在 iframe load 后重试。
 * init 只在创建时调用一次；onPick / onStructureChange / onLayerKey 仅更新闭包中的回调引用。
 */
export function createDirectTransport(iframe: HTMLIFrameElement): Transport | null {
  const bridge = iframe.contentWindow?.PinHTMLBridge;
  if (!bridge) return null;
  let pickCb: ((el: Element) => void) | null = null;
  let structureCb: (() => void) | null = null;
  let layerKeyCb: ((dir: 'up' | 'down') => void) | null = null;
  bridge.init({
    onPick: (el) => {
      if (pickCb) pickCb(el);
    },
    onStructureChange: () => {
      if (structureCb) structureCb();
    },
    onLayerKey: (dir) => {
      if (layerKeyCb) layerKeyCb(dir);
    },
  });
  return {
    setMode: (mode) => bridge.setMode(mode),
    pickOnce: (enabled) => bridge.setPickOnce(enabled),
    onPick: (cb) => {
      pickCb = cb;
    },
    onStructureChange: (cb) => {
      structureCb = cb;
    },
    onLayerKey: (cb) => {
      layerKeyCb = cb;
    },
    locate: (anchorId) => bridge.locate(anchorId),
  };
}
