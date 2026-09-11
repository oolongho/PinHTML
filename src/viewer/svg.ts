/**
 * viewer/svg.ts —— 连线 SVG 层与全量重绘（spec R5 / R6）
 *
 * 说明：连线绘制在 viewport 文档的全屏 SVG 层内，pointer-events:none。每帧全量重绘
 * （元素量级 <100，性能足够，不做脏检查，spec 方案 §9）。
 */
import { bezierPath } from './geom';
import type { LineItem } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_LAYER_ID = 'pinhtml-svg-layer';

/** 连线默认 / 高亮线宽与高亮色（spec R5/R6 + D4） */
const STROKE_WIDTH = 1.5;
const STROKE_WIDTH_HIGHLIGHT = 2.5;
const HIGHLIGHT_COLOR = '#7A9B54';

/** 幂等取得连线 SVG 层（viewport 文档） */
export function ensureSvgLayer(viewportDoc: Document): SVGSVGElement {
  let svg = viewportDoc.getElementById(SVG_LAYER_ID) as SVGSVGElement | null;
  if (!svg) {
    svg = viewportDoc.createElementNS(SVG_NS, 'svg');
    svg.id = SVG_LAYER_ID;
    viewportDoc.body?.appendChild(svg);
  }
  return svg;
}

/** 创建 SVG path 元素（设置 id 供 hover 联动命中） */
function createPath(doc: Document, item: LineItem, highlighted: boolean): SVGPathElement {
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', bezierPath(item.px, item.py, item.cx, item.cy));
  path.setAttribute('data-anno', item.annoId);
  path.setAttribute('stroke', highlighted ? HIGHLIGHT_COLOR : item.color);
  path.setAttribute('stroke-width', String(highlighted ? STROKE_WIDTH_HIGHLIGHT : STROKE_WIDTH));
  path.setAttribute('stroke-dasharray', '5,4');
  return path;
}

/**
 * 全量重绘连线：清空 SVG 层后按 LineItem 列表绘制。
 * highlightAnnos = 当前 hover 的标注 id 集合（对应连线加粗并高亮为抹茶绿）。
 */
export function drawLines(viewportDoc: Document, items: LineItem[], highlightAnnos: Set<string>): void {
  const svg = ensureSvgLayer(viewportDoc);
  svg.textContent = '';
  for (const item of items) {
    svg.appendChild(createPath(viewportDoc, item, highlightAnnos.has(item.annoId)));
  }
}

/** 移除连线 SVG 层（destroy 时） */
export function removeSvgLayer(viewportDoc: Document): void {
  viewportDoc.getElementById(SVG_LAYER_ID)?.remove();
}