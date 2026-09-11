/**
 * viewer/style.ts —— STYLE_TEXT 样式常量（spec R10 / D4 / 侧栏双渲染共享契约）
 *
 * 说明：这是 pin / 连线 / 卡片的全部样式，`pinhtml-` 前缀。导出自举时由导出器静态
 * 注入为 <style id="pinhtml-style">（此常量即内容）；工具内挂实例时也注入同 id 同内容，
 * 幂等。React 卡片组件（Task 6）复用其中的 .pinhtml-card* 类名，保证连线端点与 hover
 * 联动在两种上下文统一成立。
 *
 * 分类色条经 CSS 变量 --pinhtml-cat 注入（渲染卡片时 setProperty 设定）。
 * 注意：本字符串不得出现字面 "</style" 或 "</script"。
 */
export const STYLE_TEXT = `
/* ===== PinHTML viewer 样式（pinhtml- 前缀，抹茶绿 #7A9B54）===== */

/* --- pin 覆盖层：锚点文档内 fixed，不参与原型布局 --- */
#pinhtml-pinlayer{
  position:fixed;inset:0;pointer-events:none;z-index:2147483000;
}
#pinhtml-pinlayer.pinhtml-pinlayer-static{pointer-events:none;}
#pinhtml-pinlayer.pinhtml-pinlayer-static .pinhtml-pin{pointer-events:none;}

/* --- pin 徽标：胶囊形，底色跟随分类色；1 位为圆形，2/3 位自动加宽（定位以中心点为准） --- */
.pinhtml-pin{
  position:absolute;height:22px;min-width:22px;padding:0 5px;box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  border-radius:999px;background:var(--pinhtml-pin-color,#7A9B54);color:#fff;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-weight:600;line-height:1;letter-spacing:.2px;
  cursor:pointer;pointer-events:auto;user-select:none;
  transform:translate(-50%,-50%);
  box-shadow:0 1px 3px rgba(20,20,19,.28);
  transition:filter .12s ease;
}
.pinhtml-pin:hover{filter:brightness(.88);}
.pinhtml-pin-active{outline:2px solid rgba(122,155,84,.9);outline-offset:2px;}

@keyframes pinhtml-pulse{
  0%{box-shadow:0 0 0 0 var(--pinhtml-pin-ring,rgba(122,155,84,.55));transform:translate(-50%,-50%) scale(1);}
  50%{box-shadow:0 0 0 8px rgba(0,0,0,0);transform:translate(-50%,-50%) scale(1.15);}
  100%{box-shadow:0 0 0 0 rgba(0,0,0,0);transform:translate(-50%,-50%) scale(1);}
}
.pinhtml-pin-pulse{animation:pinhtml-pulse .5s ease;}

/* --- 连线 SVG 层：viewport 文档内 fullscreen，pointer-events:none；
       z-index 取与 pin 层同级的极大值，避免被原型自身 fixed 元素（顶栏等）压住 --- */
#pinhtml-svg-layer{
  position:fixed;inset:0;pointer-events:none;z-index:2147483000;width:100vw;height:100vh;
}
#pinhtml-svg-layer path{fill:none;stroke-linecap:round;}

/* --- 标注卡片（React 卡片与 viewer 导出卡片复用同套类名）--- */
.pinhtml-card{
  position:relative;background:#fff;border:1px solid #E8E8E4;border-radius:12px;
  padding:10px 12px 10px 16px;margin:0 0 10px;box-sizing:border-box;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#141413;
  transition:box-shadow .15s ease,opacity .15s ease;
}
.pinhtml-card:hover{box-shadow:0 1px 4px rgba(20,20,19,.08);}
.pinhtml-card-active{outline:2px solid rgba(122,155,84,.65);outline-offset:-1px;}

/* 左侧 3px 分类色条 */
.pinhtml-card-bar{position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:12px 0 0 12px;background:var(--pinhtml-cat,#85857F);}

/* 头：序号 + 分类标签 */
.pinhtml-card-head{display:flex;align-items:center;gap:6px;margin-bottom:4px;}
.pinhtml-card-index{font-size:11px;color:#85857F;font-weight:600;}
.pinhtml-card-cat{font-size:11px;color:var(--pinhtml-cat,#85857F);}

/* 标题 / 正文 */
.pinhtml-card-title{font-weight:600;font-size:13px;margin:0 0 4px;line-height:1.35;}
.pinhtml-card-body{font-size:12px;line-height:1.55;white-space:pre-wrap;color:#333;margin:0 0 6px;}

/* 脚：状态 pill（工具模式 React 另加编辑/删除按钮） */
.pinhtml-card-foot{display:flex;align-items:center;gap:6px;}
.pinhtml-card-status{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid #E8E8E4;color:#5E7A42;background:rgba(122,155,84,.08);}
.pinhtml-card-status.is-resolved{color:#85857F;background:#F1F0EC;}

/* 不可见角标 */
.pinhtml-card-badge{display:inline-block;font-size:11px;color:#999;background:#F1F0EC;border-radius:4px;padding:1px 6px;}

/* flash 高亮（点击 pin 定位卡片时播放一次） */
@keyframes pinhtml-flash{0%{background:#F2F6EA;}100%{background:#fff;}}
.pinhtml-card-flash{animation:pinhtml-flash .8s ease;}

/* --- 导出自举只读侧栏 --- */
.pinhtml-sidebar{
  position:fixed;top:0;right:0;bottom:0;width:340px;background:#FAFAF8;
  border-left:1px solid #E8E8E4;z-index:2147483100;overflow-y:auto;display:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#141413;
}
.pinhtml-sidebar.is-open{display:block;}
.pinhtml-sidebar-head{padding:14px 16px;border-bottom:1px solid #E8E8E4;position:sticky;top:0;background:#FAFAF8;z-index:1;display:flex;align-items:center;justify-content:space-between;}
.pinhtml-sidebar-title{font-weight:700;font-size:14px;margin:0;}
.pinhtml-sidebar-stats{font-size:12px;color:#666;margin-top:6px;}
.pinhtml-sidebar-collapse{border:none;background:none;cursor:pointer;color:#666;font-size:18px;line-height:1;padding:4px;}
.pinhtml-sidebar-filters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 16px 4px;}
.pinhtml-sidebar-list{padding:12px 16px 24px;}
.pinhtml-filter-pill{
  font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid #E8E8E4;
  background:#fff;cursor:pointer;color:#333;user-select:none;
}
.pinhtml-filter-pill.is-on{border-color:#7A9B54;background:rgba(122,155,84,.10);color:#5E7A42;}
.pinhtml-sidebar-toggle{
  position:fixed;top:12px;right:12px;z-index:2147483200;width:36px;height:36px;border-radius:8px;
  background:#141413;color:#fff;border:none;cursor:pointer;display:none;font-size:16px;font-weight:700;
}
/* 侧栏展开时给原型让位 */
.pinhtml-doc-with-sidebar{margin-right:360px !important;}

@media (max-width:900px){
  .pinhtml-doc-with-sidebar{margin-right:0 !important;}
}

@media (prefers-reduced-motion: reduce){
  .pinhtml-pin-pulse,.pinhtml-card-flash{animation:none;}
  .pinhtml-card{transition:none;}
}
`;