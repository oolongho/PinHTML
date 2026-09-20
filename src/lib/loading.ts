/**
 * loading.ts —— 原型加载、注入物剥离与哈希（spec R1「加载原型」/ R8 幂等）
 *
 * 职责：
 * - 读原型文件文本并完成加载流水线（剥离注入物 → 计算 protoHash → 恢复项目 / 建空项目）；
 * - protoHash：SHA-256 前 16 位 hex；crypto.subtle 不可用时 FNV-1a 32 位两轮（不同偏移种子）降级；
 * - 导出产物识别：存在 script#pinhtml-data → 提取 Project、剥离全部 pinhtml- 注入物
 *   （保留 data-anno-id）得干净源，进入续编；
 * - buildSrcdoc：干净源 + 中性 base + bridge 脚本组装 iframe srcdoc（文件模式）；
 * - URL 模式（多页原型 / 需读同目录资源）：iframe 直接 src=URL 加载原型原文件，
 *   bridge 由父页在 load 后注入其文档（injectBridgeIntoDoc），见 spec R13。
 */
import { normalizeProtoName } from './naming';
import type { Project } from './types';

/** loadPrototypeFile / loadPrototypeText 的返回 */
export interface LoadPrototypeResult {
  /** 剥离注入物后的干净源文本（后续导出 HTML 的基准） */
  cleanSource: string;
  /** 恢复或新建的项目 */
  project: Project;
  /** 干净源的哈希 */
  protoHash: string;
  /** true = 本工具导出产物且含标注，进入续编 */
  restored: boolean;
  /** true = 文本是本工具导出产物（含 #pinhtml-data）：URL 模式下其内嵌运行时会自举，应改用文件模式 */
  isExportArtifact: boolean;
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
 * 若为本工具导出产物 → 恢复其项目、并**沿用文件内记录的原始原型名**（归一化后），
 * 使重复「打开导出产物 → 再导出」时文件名不再累积「-标注」后缀；
 * 标注非空进入续编，否则建空项目。
 */
export async function loadPrototypeFile(file: File): Promise<LoadPrototypeResult> {
  return loadPrototypeText(file.name, await file.text());
}

/**
 * 从文本完成加载流水线（文件模式与 URL 模式共用）。
 * name 为原型名来源：文件模式用 File.name，URL 模式用 URL 末段文件名；
 * docPath 为 URL 模式的页面键（R13，记录进 project.protoDocPath 供导出注入过滤）。
 */
export async function loadPrototypeText(
  name: string,
  text: string,
  docPath?: string | null,
): Promise<LoadPrototypeResult> {
  const { cleanSource, project: savedProject } = stripInjections(text);
  const protoHash = await computeProtoHash(cleanSource);
  const changed = (p: Project): boolean => p.anchors.length > 0 || p.annotations.length > 0;
  // 本工具导出产物：沿用其内部记录的原始原型名（而非当前文件名）；否则用所打开的当前文件名
  const sourceName = savedProject?.protoName ? savedProject.protoName : name;
  const protoName = normalizeProtoName(sourceName);
  const withPage = (p: Project): Project => (docPath ? { ...p, protoDocPath: docPath } : p);
  const project: Project =
    savedProject !== null && changed(savedProject)
      ? withPage({ ...savedProject, protoName, protoHash })
      : withPage(createEmptyProject(protoName, protoHash));
  return {
    cleanSource,
    project,
    protoHash,
    restored: savedProject !== null && changed(savedProject),
    isExportArtifact: /id=["']pinhtml-data["']/.test(text),
  };
}

/** URL 模式的原型名：取路径末段文件名（解码百分号编码），无 .html/.htm 末段则回落 'prototype.html' */
export function prototypeNameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // 非法百分号编码：保留原样
  }
  return /\.html?$/i.test(name) ? name : 'prototype.html';
}

/** URL 模式下注入 bridge 脚本的元素 id（srcdoc 模式不需要，bridge 已随 srcdoc 文本注入） */
const BRIDGE_SCRIPT_ID = 'pinhtml-bridge-script';

/**
 * URL 模式：原型文件原样加载（没有 srcdoc 注入环节），由父页在 iframe load 后把 bridge
 * 脚本插入其文档（同源直连前提）。幂等；脚本经 textContent 注入，不参与 HTML 解析。
 */
export function injectBridgeIntoDoc(doc: Document | null, bridgeSource: string): void {
  if (!doc || doc.getElementById(BRIDGE_SCRIPT_ID)) return;
  const script = doc.createElement('script');
  script.id = BRIDGE_SCRIPT_ID;
  script.textContent = bridgeSource;
  (doc.head ?? doc.documentElement).appendChild(script);
}

/**
 * srcdoc 文档的中性 base：srcdoc 文档自身的 URL 是 about:srcdoc，其 base 会回落到
 * 父页 URL，于是原型里的 #片段链接被解析成「父页 URL + 片段」——本该是同文档片段导航，
 * 却变成跨文档导航，iframe 会直接加载工具自身（工具套工具）。
 * 注入 about:srcdoc 作为 base 后，片段解析结果与文档 URL 同源同路径，恢复同文档导航，
 * 原型自己的 hashchange 路由照常工作。已有 base 的原型不注入，避免覆盖其资源解析基准。
 */
const BASE_TAG = '<base id="pinhtml-base" href="about:srcdoc">';

/** 在 head 起始处（无 head 则 html 起始处，再无则文首）注入中性 base；已有 base 则原样返回 */
function injectBase(source: string): string {
  if (/<base[\s>/]/i.test(source)) return source;
  const anchor = /<head[^>]*>/i.exec(source) ?? /<html[^>]*>/i.exec(source);
  if (!anchor) return BASE_TAG + source;
  const at = anchor.index + anchor[0].length;
  return source.slice(0, at) + BASE_TAG + source.slice(at);
}

/**
 * 组装 iframe srcdoc：在 head 注入中性 base，并把 bridge 源码包成 <script> 注入到末个 </body> 前；
 * 容错：无 </body> 时，若有 </html> 则在其前补 <body>…</body> 再注入，否则在末尾追加。
 *
 * 注意：bridgeSource 直接内插、不做任何转义；因此 bridge 源码自身不得包含字面
 * script 结束标签（R11 约束，由 Task 3 的 bridge.js 源码保证），否则会提前闭合注入脚本。
 * （本文件源码中的闭合标签同样拆开书写，避免被 vite-plugin-singlefile 内联进产物时截断。）
 */
export function buildSrcdoc(cleanSource: string, bridgeSource: string): string {
  const source = injectBase(cleanSource);
  return injectBridge(source, '<script>' + bridgeSource + '</' + 'script>');
}

/** 把注入片段插到末个 </body> 前（spec R11 注入位置约定） */
function injectBridge(cleanSource: string, injection: string): string {
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
