/**
 * viewer/pin.ts —— pin 覆盖层与 pin 徽标渲染（spec R5）
 *
 * 说明：pin 由 viewer 渲染在锚点文档（targetDoc）内一个 fixed 覆盖层里，不参与原型布局。
 * 覆盖层 pointer-events:none，pin 自身 pointer-events:auto（点击联动）；标注拾取模式下经
 * setPinInteractive(false) 切为整体不可点，避免拾取到 pin 自身。
 */
import type { PinItem } from './types';

const PINLAYER_ID = 'pinhtml-pinlayer';
const PIN_CLASS = 'pinhtml-pin';

/** 依序号位数取字号（1 位 12px / 2 位 11px / 3 位及以上 10px），保证数字不撑破胶囊 */
function fontSizeFor(label: string): number {
  if (label.length <= 1) return 12;
  if (label.length === 2) return 11;
  return 10;
}

/** hex 色转 rgba（用于脉冲光环，跟随图钉自身的分类色） */
function toRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(122,155,84,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 幂等取得 pin 覆盖层（不存在则创建） */
export function ensurePinLayer(targetDoc: Document): HTMLElement {
  let layer = targetDoc.getElementById(PINLAYER_ID);
  if (!layer) {
    layer = targetDoc.createElement('div');
    layer.id = PINLAYER_ID;
    targetDoc.body?.appendChild(layer);
  }
  return layer;
}

/**
 * 全量重建 pin 徽标：清空覆盖层后按 PinItem 列表渲染。
 * 图钉为胶囊形（高度固定 22px、宽度随位数增长），显示内容序号、底色跟随分类色；
 * 定位以「中心点」为准（CSS translate(-50%,-50%)），故宽度变化不影响定位与连线端点。
 */
export function renderPins(targetDoc: Document, items: PinItem[]): void {
  const layer = ensurePinLayer(targetDoc);
  layer.textContent = '';
  for (const item of items) {
    const pin = targetDoc.createElement('div');
    pin.className = PIN_CLASS;
    pin.setAttribute('data-anchor-id', item.anchorId);
    pin.textContent = item.label;
    if (item.title) pin.title = item.title;
    pin.style.left = `${item.x}px`;
    pin.style.top = `${item.y}px`;
    pin.style.background = item.color;
    pin.style.setProperty('--pinhtml-pin-color', item.color);
    pin.style.setProperty('--pinhtml-pin-ring', toRgba(item.color, 0.55));
    pin.style.fontSize = `${fontSizeFor(item.label)}px`;
    layer.appendChild(pin);
  }
}

/** 切换 pin 是否可交互（标注拾取模式：false 整体不可点） */
export function setPinInteractive(targetDoc: Document, interactive: boolean): void {
  const layer = targetDoc.getElementById(PINLAYER_ID);
  if (!layer) return;
  layer.classList.toggle('pinhtml-pinlayer-static', !interactive);
}

/** 在 pin 覆盖层内查找某锚点 pin 元素 */
export function findPin(targetDoc: Document, anchorId: string): HTMLElement | null {
  const layer = targetDoc.getElementById(PINLAYER_ID);
  return layer?.querySelector(`.${PIN_CLASS}[data-anchor-id="${anchorId}"]`) ?? null;
}

/** 移除 pin 覆盖层（destroy 时） */
export function removePinLayer(targetDoc: Document): void {
  targetDoc.getElementById(PINLAYER_ID)?.remove();
}