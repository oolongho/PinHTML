/**
 * bridge.js —— 注入 iframe srcdoc 的原型侧脚本（spec R2 / R11 / D1）
 *
 * 职责：
 * - 挂载 window.PinHTMLBridge（version / init / setMode / setPickOnce / locate / destroy），
 *   供父页经 contentDocument 直连握手（契约见 src/lib/transport.ts）
 * - 模式切换：浏览零拦截（原型交互照常）/ 标注模式 capture 阶段拦截 click
 *   （preventDefault + stopImmediatePropagation），随后按当前层级选中元素回调 onPick
 * - hover 拾取高亮：mouseover（capture）追踪最内层元素，class 注入 + !important
 *   （2px 抹茶绿描边 + 10% 抹茶绿底，D4）；`[` 放宽一层 / `]` 收窄一层（沿原 hover 路径）
 * - MutationObserver（childList + subtree + attributes）→ rAF 合并转发 onStructureChange，
 *   过滤自源变化（pin 层内突变 / 高亮 class 切换），避免自触发循环
 *
 * 硬性约束：纯 JS、零导入、IIFE；源码不得含字面 script 结束标签（注入 srcdoc 的安全前提）。
 */
(function () {
  'use strict';

  const w = window;
  const doc = w.document;

  /* ---------- 常量 ---------- */

  const VERSION = '1';
  // 拾取高亮 class 与注入样式（幂等，按 id 定位）：2px 抹茶绿描边 + 10% 抹茶绿底（D4）
  const HL_CLASS = 'pinhtml-pick-highlight';
  const STYLE_ID = 'pinhtml-bridge-style';
  const STYLE_TEXT =
    '.pinhtml-pick-highlight{outline:2px solid #7A9B54 !important;background-color:rgba(122,155,84,.10) !important;}';
  // viewer 渲染的 pin 层元素 id：跳过其内部元素的拾取，并用于突变自源过滤
  const PINLAYER_ID = 'pinhtml-pinlayer';

  /* ---------- 运行状态 ---------- */

  let config = null; // 最近一次 init 的回调集合（可重复 init，以最后一次为准）
  let mode = 'browse'; // 'browse' | 'annotate'，安全默认为浏览
  let pickOnce = false; // 一次性拾取开关（stale 重锚定的临时拾取态）
  let hoverPath = []; // 原 hover 路径：[最内层元素, ...祖先]，最外层到 body 直接子级（跳过 html/body）
  let hoverIndex = 0; // 当前层级索引（0 = 最内层；增大 = 向父元素放宽）
  let currentHL = null; // 当前带高亮 class 的元素
  let observer = null; // MutationObserver 实例（init 后启动）
  let rafId = 0; // structureChange 的 rAF 合并句柄
  let ready = false; // DOM 是否就绪（DOMContentLoaded）
  let bound = false; // 事件监听是否已绑定
  let destroyed = false; // destroy 置位；再次 init 可重启

  /* ---------- 可拾取性判定 ---------- */

  // 是否可拾取：跳过 html/body、pin 层内部元素，以及已脱离文档的元素（hover 期间 DOM 可能已变化）
  function isPickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === doc.documentElement || el === doc.body) return false;
    if (!el.isConnected) return false;
    const layer = doc.getElementById(PINLAYER_ID);
    if (layer && (layer === el || layer.contains(el))) return false;
    return true;
  }

  // 事件目标是否位于 pin 层内（pin 徽标自身 pointer-events:auto，点击需放行给 viewer 委托联动）
  function inPinLayer(el) {
    const layer = doc.getElementById(PINLAYER_ID);
    return !!(layer && el && (layer === el || layer.contains(el)));
  }

  /* ---------- 拾取高亮（class 切换，不用内联 style） ---------- */

  // 幂等注入拾取高亮样式
  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // 移除注入的样式元素
  function removeStyle() {
    const style = doc.getElementById(STYLE_ID);
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  // 将高亮 class 移到 el（传 null 表示仅清除）
  function setHighlight(el) {
    if (currentHL === el) return;
    if (currentHL) currentHL.classList.remove(HL_CLASS);
    currentHL = el;
    if (el) {
      ensureStyle();
      el.classList.add(HL_CLASS);
    }
  }

  // 鼠标离开文档：仅移除高亮视觉，保留 hover 路径供 `[` `]` 键继续调整
  function clearHighlightOnly() {
    setHighlight(null);
  }

  // 清除高亮并重置拾取上下文
  function resetHover() {
    setHighlight(null);
    hoverPath = [];
    hoverIndex = 0;
  }

  // 高亮当前层级索引指向的元素
  function applyHighlight() {
    setHighlight(hoverPath.length > 0 ? hoverPath[hoverIndex] : null);
  }

  /* ---------- hover 路径（原 hover 路径栈 + 当前层级索引） ---------- */

  // 构建原 hover 路径：从 target 向上收集祖先链，到 body 之前停止（html/body 不可拾取）
  function buildHoverPath(el) {
    const path = [];
    let node = el;
    while (node && node !== doc.body && node !== doc.documentElement) {
      path.push(node);
      node = node.parentElement;
    }
    return path;
  }

  // 标注模式下追踪最内层元素，重建路径并把层级索引归零
  function onMouseOver(e) {
    if (!config || mode !== 'annotate') return;
    const el = e.target;
    if (!isPickable(el)) {
      // 跳过 html/body 与 pin 层内元素的拾取：当前拾取上下文失效
      resetHover();
      return;
    }
    hoverPath = buildHoverPath(el);
    hoverIndex = 0;
    applyHighlight();
  }

  // 鼠标离开文档（mouseleave 不冒泡，直接绑在 document 上）
  function onMouseLeave() {
    clearHighlightOnly();
  }

  /* ---------- 键盘层级（`[` 放宽 / `]` 收窄） ---------- */

  function onKeyDown(e) {
    if (!config) return;
    // 快捷键转发到父页（保存/导出/取消编辑由父页承担）——放在输入焦点判断之前，
    // 保证在原型输入框内按 ⌘S 也能保存当前标注 JSON
    if (config.onShortcut) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        config.onShortcut('save');
        return;
      }
      if (mod && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        config.onShortcut('export');
        return;
      }
      if (e.key === 'Escape') {
        config.onShortcut('escape');
        return;
      }
    }
    // 焦点在输入元素内不触发（原型自身表单输入不受干扰）
    const active = doc.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    let dir = null;
    if (e.key === '[') dir = 'up'; // 放宽一层：沿原 hover 路径向父元素
    else if (e.key === ']') dir = 'down'; // 收窄一层：沿原 hover 路径回到子元素
    if (!dir) return;
    // bridge 自身的 hover 路径调整照常（路径为空时为 no-op，如浏览模式下的临时拾取态）
    if (hoverPath.length > 0) {
      const idx = hoverIndex + (dir === 'up' ? 1 : -1);
      if (idx >= 0 && idx < hoverPath.length) {
        hoverIndex = idx;
        applyHighlight();
      }
    }
    // 通知父页（编辑器打开时据此改绑锚点父元素 / 撤回上次上移），与 bridge 自身调整互不冲突
    if (config.onLayerKey) config.onLayerKey(dir);
  }

  /* ---------- 拖入文件转发（仅 Files 类型，避免干扰原型自身拖拽交互） ---------- */

  // 拖拽负载是否包含文件（内部元素拖拽不含 'Files'，据此放行原型自身 DnD）
  function hasFiles(dt) {
    if (!dt || !dt.types) return false;
    for (let i = 0; i < dt.types.length; i += 1) {
      if (dt.types[i] === 'Files') return true;
    }
    return false;
  }

  function onDragOver(e) {
    if (!config || !hasFiles(e.dataTransfer)) return;
    e.preventDefault(); // 允许 drop，否则浏览器会直接把文件当页面打开
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (config.onFileDragState) config.onFileDragState(true);
  }

  function onDragLeave(e) {
    if (!config) return;
    // relatedTarget 为 null 表示指针已离开整个文档
    if (!e.relatedTarget && config.onFileDragState) config.onFileDragState(false);
  }

  function onDrop(e) {
    if (!config || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (config.onFileDragState) config.onFileDragState(false);
    if (files && files.length > 0 && config.onFileDrop) config.onFileDrop(files);
  }

  /* ---------- click 拦截与拾取 ---------- */

  function onClick(e) {
    if (!config) return;
    // 浏览模式且未开启一次性拾取：完全零拦截，原型交互照常
    if (mode !== 'annotate' && !pickOnce) return;
    const target = e.target;
    // pin 层内元素放行：viewer 的事件委托照常处理 pin 点击联动
    if (inPinLayer(target)) return;
    // 拦截（html/body 也拦截以防原型全局 click 副作用，但不作为拾取目标回调）
    e.preventDefault();
    e.stopImmediatePropagation();
    // 先复位一次性拾取开关再回调：回调异常也不会导致开关残留；模式保持不变
    pickOnce = false;
    // 选中元素：标注模式取当前层级元素；一次性拾取（浏览模式临时拾取态）取最内层目标兜底
    let el = null;
    if (mode === 'annotate' && hoverPath.length > 0) el = hoverPath[hoverIndex];
    else if (isPickable(target)) el = target;
    if (el && isPickable(el) && config.onPick) config.onPick(el);
  }

  /* ---------- MutationObserver 转发（rAF 合并） ---------- */

  // 判断突变是否为自源变化（不转发，避免自触发循环）：
  // 1) 突变目标位于 pin 层（viewer 的渲染域）内；
  // 2) bridge 自身切换拾取高亮 class 引起的 attribute 变化
  function isSelfMutation(m) {
    const layer = doc.getElementById(PINLAYER_ID);
    const t = m.target;
    if (layer && t && (t === layer || layer.contains(t))) return true;
    if (m.type === 'attributes' && m.attributeName === 'class') {
      const oldHad = typeof m.oldValue === 'string' && m.oldValue.indexOf(HL_CLASS) !== -1;
      const newHas = !!(t.classList && t.classList.contains(HL_CLASS));
      if (oldHad || newHas) return true;
    }
    return false;
  }

  // 一帧内多次突变只转发一次
  function scheduleFlush() {
    if (rafId) return;
    rafId = w.requestAnimationFrame(function () {
      rafId = 0;
      if (config && config.onStructureChange) config.onStructureChange();
    });
  }

  function handleMutations(muts) {
    if (!config || !config.onStructureChange) return;
    for (let i = 0; i < muts.length; i++) {
      if (!isSelfMutation(muts[i])) {
        scheduleFlush();
        return;
      }
    }
  }

  // 启动结构观察（幂等）：observe 整个 document（childList + subtree + attributes）
  function startObserver() {
    if (observer || destroyed) return;
    observer = new w.MutationObserver(handleMutations);
    observer.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
    });
  }

  /* ---------- 事件绑定与生命周期 ---------- */

  function bind() {
    if (bound || destroyed) return;
    bound = true;
    doc.addEventListener('click', onClick, true); // capture 拦截
    doc.addEventListener('mouseover', onMouseOver, true); // capture 追踪
    doc.addEventListener('mouseleave', onMouseLeave, false);
    doc.addEventListener('keydown', onKeyDown, true); // capture 层级键 + 快捷键转发
    doc.addEventListener('dragover', onDragOver, true); // 拖入文件：允许 drop
    doc.addEventListener('dragleave', onDragLeave, true);
    doc.addEventListener('drop', onDrop, true);
    w.addEventListener('dragover', onDragOver, true);
    w.addEventListener('drop', onDrop, true);
  }

  function unbind() {
    if (!bound) return;
    bound = false;
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('mouseover', onMouseOver, true);
    doc.removeEventListener('mouseleave', onMouseLeave, false);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('dragover', onDragOver, true);
    doc.removeEventListener('dragleave', onDragLeave, true);
    doc.removeEventListener('drop', onDrop, true);
    w.removeEventListener('dragover', onDragOver, true);
    w.removeEventListener('drop', onDrop, true);
  }

  // DOM 就绪后绑定事件；若脚本求值时已就绪则立即执行
  function onReady() {
    doc.removeEventListener('DOMContentLoaded', onReady);
    if (destroyed) return;
    ready = true;
    bind();
    if (config) startObserver();
  }

  /* ---------- PinHTMLBridge 公开 API（契约见 transport.ts） ---------- */

  // 初始化：注册回调；可重复调用，以最后一次为准
  function init(cfg) {
    if (!cfg) return;
    config = cfg;
    destroyed = false;
    if (ready) {
      bind();
      startObserver();
    }
  }

  // 切换模式：browse 零拦截 / annotate 拾取
  function setMode(m) {
    if (!config) return; // 未 init 前为安全 no-op
    mode = m === 'annotate' ? 'annotate' : 'browse';
    if (mode === 'browse') {
      resetHover(); // 移除高亮 class
      removeStyle(); // 移除注入样式
    }
  }

  // 一次性拾取开关：下一次点击无论当前模式都按标注模式拦截并回调一次
  function setPickOnce(flag) {
    if (!config) return;
    pickOnce = !!flag;
  }

  // 滚动 data-anno-id 等于 anchorId 的元素到视口中央（运行时定位以 data-anno-id 为准，R3）
  function locate(anchorId) {
    if (!config || typeof anchorId !== 'string') return;
    const el = doc.querySelector('[data-anno-id="' + anchorId + '"]');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // 销毁：移除全部事件监听、断开 Observer、移除高亮 class 与注入样式
  function destroy() {
    destroyed = true;
    unbind();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (rafId) {
      w.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    setHighlight(null);
    removeStyle();
    hoverPath = [];
    hoverIndex = 0;
    pickOnce = false;
    mode = 'browse';
    const cb = config && config.onDestroyed;
    config = null;
    if (cb) cb();
  }

  /* ---------- 挂载 ---------- */

  // 脚本求值即在所在 window 挂载 PinHTMLBridge（DOM 未就绪也允许，内部待就绪后再绑定事件）
  w.PinHTMLBridge = {
    version: VERSION,
    init: init,
    setMode: setMode,
    setPickOnce: setPickOnce,
    locate: locate,
    destroy: destroy,
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
