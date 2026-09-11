/**
 * loading.ts —— 原型加载、注入物剥离与哈希（spec R1「加载原型」/ R8 幂等）
 *
 * 职责：
 * - 读原型文件文本并完成加载流水线（剥离注入物 → 计算 protoHash → 恢复项目 / 建空项目）；
 * - protoHash：SHA-256 前 16 位 hex；crypto.subtle 不可用时 FNV-1a 32 位两轮（不同偏移种子）降级；
 * - 导出产物识别：存在 script#pinhtml-data → 提取 Project、剥离全部 pinhtml- 注入物
 *   （保留 data-anno-id）得干净源，进入续编；
 * - buildSrcdoc：干净源 + bridge 脚本组装 iframe srcdoc。
 */
import type { Project } from './types';

/** loadPrototypeFile 的返回 */
export interface LoadPrototypeResult {
  /** 剥离注入物后的干净源文本（后续导出 HTML 的基准） */
  cleanSource: string;
  /** 恢复或新建的项目 */
  project: Project;
  /** 干净源的哈希 */
  protoHash: string;
  /** true = 本工具导出产物且含标注，进入续编 */
  restored: boolean;
}

/** FNV-1a 32 位单轮：以 seed 为初始值，返回 8 位 hex */
function fnv1a32(data: Uint8Array, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 计算原型干净源文本的哈希（R8）：
 * 优先 SHA-256 取前 16 位 hex；crypto.subtle 不可用（如非安全上下文）时，
 * 以 FNV-1a 32 位两轮（不同偏移种子）各取 8 位 hex 拼接成 16 位降级。
 */
export async function computeProtoHash(cleanSource: string): Promise<string> {
  const data = new TextEncoder().encode(cleanSource);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 16);
  }
  return fnv1a32(data, 0x811c9dc5) + fnv1a32(data, 0x9dc5811c);
}

/** Project 顶层形状校验（浅校验，防 JSON.parse 得到非项目结构） */
function isValidProject(value: unknown): value is Project {
  if (value === null || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.schema === 1 &&
    typeof p.protoName === 'string' &&
    typeof p.protoHash === 'string' &&
    typeof p.anchorSeq === 'number' &&
    typeof p.annoSeq === 'number' &&
    Array.isArray(p.anchors) &&
    Array.isArray(p.annotations)
  );
}

/**
 * 剥离本工具全部注入物（R8 幂等）：
 * - 提取 script#pinhtml-data（type="application/json"）中的 Project（解析失败 / 形状不对 → null）；
 * - 移除全部 id 为 pinhtml- 前缀的注入元素（#pinhtml-style / #pinhtml-data /
 *   #pinhtml-runtime / #pinhtml-pinlayer 及未来新增的注入层，方案 §9 统一前缀约定）；
 * - 移除元素上 pinhtml- 前缀的注入 class（如拾取高亮）；
 * - 保留所有 data-anno-id 属性（续编锚点运行时定位依据）；
 * - 序列化回 '<!DOCTYPE html>' + documentElement.outerHTML。
 */
export function stripInjections(html: string): { cleanSource: string; project: Project | null } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let project: Project | null = null;
  // 先提取后移除：#pinhtml-data 本身也属 pinhtml- 前缀注入物
  const dataEl = doc.getElementById('pinhtml-data');
  if (dataEl) {
    try {
      const parsed: unknown = JSON.parse(dataEl.textContent ?? '');
      project = isValidProject(parsed) ? parsed : null;
    } catch {
      project = null;
    }
  }
  // 统一移除 id 以 pinhtml- 开头的注入元素
  for (const el of doc.querySelectorAll('[id^="pinhtml-"]')) el.remove();
  // 移除 pinhtml- 前缀注入 class：粗筛含 pinhtml- 字样，再按完整词精确过滤，避免误伤如 my-pinhtml-x
  for (const el of doc.querySelectorAll('[class*="pinhtml-"]')) {
    const raw = el.getAttribute('class');
    if (!raw) continue;
    const parts = raw.split(/\s+/).filter(Boolean);
    const kept = parts.filter((c) => !c.startsWith('pinhtml-'));
    if (kept.length === parts.length) continue;
    if (kept.length > 0) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }
  return { cleanSource: '<!DOCTYPE html>' + doc.documentElement.outerHTML, project };
}

/** 创建空项目（schema v1、序列号 0、无锚点与标注） */
export function createEmptyProject(protoName: string, protoHash: string): Project {
  return { schema: 1, protoName, protoHash, anchorSeq: 0, annoSeq: 0, anchors: [], annotations: [] };
}

/**
 * 读取原型文件并完成加载流水线（R1「加载原型」）：
 * 读文本 → stripInjections → 对干净源计算 protoHash；
 * 若为本工具导出产物且含标注（anchors / annotations 非空）→ 恢复项目进入续编
 * （protoName / protoHash 同步为当前文件与当前干净源），否则建空项目（protoName = 文件名）。
 */
export async function loadPrototypeFile(file: File): Promise<LoadPrototypeResult> {
  const text = await file.text();
  const { cleanSource, project: savedProject } = stripInjections(text);
  const protoHash = await computeProtoHash(cleanSource);
  const restored =
    savedProject !== null && (savedProject.anchors.length > 0 || savedProject.annotations.length > 0);
  const project: Project = restored && savedProject !== null
    ? { ...savedProject, protoName: file.name, protoHash }
    : createEmptyProject(file.name, protoHash);
  return { cleanSource, project, protoHash, restored };
}

/**
 * 组装 iframe srcdoc：把 bridge 源码包成 <script> 注入到末个 </body> 前；
 * 容错：无 </body> 时，若有 </html> 则在其前补 <body>…</body> 再注入，否则在末尾追加。
 *
 * 注意：bridgeSource 直接内插、不做任何转义；因此 bridge 源码自身不得包含字面
 * script 结束标签（R11 约束，由 Task 3 的 bridge.js 源码保证），否则会提前闭合注入脚本。
 * （本文件源码中的闭合标签同样拆开书写，避免被 vite-plugin-singlefile 内联进产物时截断。）
 */
export function buildSrcdoc(cleanSource: string, bridgeSource: string): string {
  const injection = '<script>' + bridgeSource + '</' + 'script>';
  // 末个 </body>（大小写不敏感）前注入
  const bodyRe = /<\/body\s*>/gi;
  let lastBodyIndex = -1;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(cleanSource)) !== null) lastBodyIndex = m.index;
  if (lastBodyIndex >= 0) {
    return cleanSource.slice(0, lastBodyIndex) + injection + cleanSource.slice(lastBodyIndex);
  }
  const htmlMatch = /<\/html\s*>/i.exec(cleanSource);
  if (htmlMatch) {
    return (
      cleanSource.slice(0, htmlMatch.index) +
      '<body>' +
      injection +
      '</body>' +
      cleanSource.slice(htmlMatch.index)
    );
  }
  return cleanSource + '<body>' + injection + '</body>';
}
