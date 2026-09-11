/**
 * viewer/geom.ts —— 纯几何函数（无 DOM 副作用，spec R5）
 *
 * 说明：连线/引脚位置的几何计算集中于此，全部每次取实时 getBoundingClientRect（不缓存）。
 * 可见性判定复用 lib/dom 的 isVisible（等价语义：getClientRects，不用 offsetParent）。
 */
import { isVisible } from '../lib/dom';

/** pin 徽标高（px）与元素外扩距离（px）。图钉为胶囊形：高度固定，宽度随位数自动增长 */
export const PIN_HEIGHT = 22;
export const PIN_OFFSET = 4;

/** 取元素实时 rect（含宽高为零的判定所需信息） */
export function getRect(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

/** 元素是否可见（委托 lib/dom.isVisible，单一事实来源） */
export function isElementVisible(el: Element): boolean {
  return isVisible(el);
}

/** 判断两个 rect 是否与给定视口（含外扩容差）有交集 */
export function inViewport(rect: DOMRect, viewW: number, viewH: number, tolerance = 40): boolean {
  return (
    rect.right > -tolerance &&
    rect.left < viewW + tolerance &&
    rect.bottom > -tolerance &&
    rect.top < viewH + tolerance
  );
}

/**
 * 计算 pin 的锚点（targetDoc 坐标系）——返回 pin **中心**坐标。
 *
 * 策略：中心贴合元素右上角并向外偏移 PIN_OFFSET，即「图钉压在元素角上」，
 * 视觉上紧贴、易分辨归属元素；且以中心定位后，图钉宽度随数字位数变化
 * （1 位圆形 → 2/3 位胶囊）也不会影响定位精度与连线起点。
 * 越界时依次回退：右缘翻到左上角 → 上缘落到元素内顶部 → 下缘上移。
 */
export function pinAnchorPoint(rect: DOMRect, viewW: number, viewH: number): { x: number; y: number } {
  const half = PIN_HEIGHT / 2;
  let x = rect.right + PIN_OFFSET;
  let y = rect.top - PIN_OFFSET;
  if (x + half > viewW) x = rect.left - PIN_OFFSET;
  if (y - half < 0) y = rect.top + PIN_OFFSET + half;
  if (y + half > viewH) y = viewH - half;
  return { x, y };
}

/**
 * 生成水平控制点贝塞尔路径的 d 属性（连线：pin 中心 → 卡片左缘垂直中点）。
 * 控制点取两端点水平距离的 45% 内缩，形成柔和 S 曲线。
 */
export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.45;
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  return `M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
}

/**
 * 把 targetDoc 坐标系下的点换算到 viewportDoc 视口坐标：
 * pin 在父页视口的位置 = iframe 的 rect 左上角 + 元素在 iframe 视口内的坐标（spec §5.3）。
 * 导出模式 frameRect 传 { left:0, top:0 }。
 */
export function toViewport(
  x: number,
  y: number,
  frameRect: { left: number; top: number },
): { x: number; y: number } {
  return { x: x + frameRect.left, y: y + frameRect.top };
}

/** 计算卡片元素左缘垂直中点（viewportDoc 坐标系，直接读实时 rect） */
export function cardEdgeMid(cardEl: HTMLElement): { x: number; y: number } {
  const r = cardEl.getBoundingClientRect();
  return { x: r.left, y: r.top + r.height / 2 };
}