/**
 * exporter.ts —— 导出单文件 HTML（spec R8）
 *
 * 职责：以内存干净源为基准（DOMParser 静态解析 + 锚点选择器定位静态副本元素写入
 * data-anno-id，回放不到的锚点保留在 JSON 由产物打开时走三态），末个 </body> 前依序注入
 * #pinhtml-style / #pinhtml-data / #pinhtml-runtime 三件，下载「<原型名>-标注.html」
 * （零外链零 CDN，双击即用）。
 */
import { STYLE_TEXT } from '@/viewer/style';
import viewerSource from 'virtual:viewer-src';
import { annoJsonName, exportHtmlName } from './naming';
import type { Project } from './types';

/** 序列化项目为 JSON 并转义 `</` → `<\/`（避免闭合 script 标签，R8） */
function serializeProject(project: Project): string {
  return JSON.stringify(project).replace(/<\//g, '<\\/');
}

/** 把锚点 data-anno-id 回写到干净源的静态副本（依 selector 定位，避免序列化运行中污染 DOM） */
function injectAnchorIds(cleanSource: string, project: Project): string {
  const doc = new DOMParser().parseFromString(cleanSource, 'text/html');
  for (const anchor of project.anchors) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(anchor.selector);
    } catch {
      el = null;
    }
    // 回放不到 → 不写属性，锚点保留在 JSON，产物打开时走三态判定（R8）
    if (el) el.setAttribute('data-anno-id', anchor.id);
  }
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

/** 组装导出产物 HTML（不涉及下载，便于单测与复用） */
export function buildExportHtml(cleanSource: string, project: Project): string {
  const source = injectAnchorIds(cleanSource, project);
  // 三件注入物（script 闭合标签拆开书写，防止本文件被内联时截断，见 R11）
  const style = `<style id="pinhtml-style">${STYLE_TEXT}</style>`;
  const data = `<script id="pinhtml-data" type="application/json">${serializeProject(project)}</` + 'script>';
  const runtime = `<script id="pinhtml-runtime">${viewerSource}</` + 'script>';
  const injection = style + data + runtime;

  const bodyRe = /<\/body\s*>/gi;
  let lastBodyIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(source)) !== null) lastBodyIndex = m.index;
  if (lastBodyIndex >= 0) {
    return source.slice(0, lastBodyIndex) + injection + source.slice(lastBodyIndex);
  }
  // 无 </body>：在 </html> 前注入（无则末尾追加）
  return source + injection;
}

/** 触发浏览器下载（file:// 下 Blob + a[download] 通用，spec 方案 §2） */
function triggerDownload(content: BlobPart, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 下载导出产物：文件名由 naming.ts 归一，重复导出不会累积「-标注」后缀 */
export function downloadHtml(cleanSource: string, project: Project): void {
  triggerDownload(buildExportHtml(cleanSource, project), 'text/html', exportHtmlName(project.protoName));
}

/** 下载项目 JSON（保存标注数据，spec R8「保存 JSON」） */
export function downloadJson(project: Project): void {
  triggerDownload(JSON.stringify(project, null, 2), 'application/json', annoJsonName(project.protoName));
}