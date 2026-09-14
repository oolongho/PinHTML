/**
 * naming.ts —— 原型名归一与下载文件命名
 *
 * 场景（缺陷修复）：导出产物名为「<原型名>-标注.html」，把它重新打开再导出时，
 * 若以当前文件名继续追加后缀，就会累积成「…-标注-标注-标注.html」。
 * 这里集中提供归一规则，供加载（保存原始原型名）与导出（生成文件名）共用。
 */

/** 工具在导出文件名后追加的后缀 */
const EXPORT_SUFFIX = '-标注';

/**
 * 归一原型名：保留扩展名，剥离尾部**累积**的一个或多个「-标注」后缀。
 * 例：`X-标注-标注.html` → `X.html`；`需求-标注.html` → `需求.html`
 */
export function normalizeProtoName(protoName: string): string {
  const matched = /^(.*?)(\.html?|\.anno\.json)$/i.exec(protoName.trim());
  const stem = matched ? matched[1] : protoName.trim();
  const ext = matched ? matched[2] : '';
  const cleaned = stem.replace(/(?:-标注)+$/g, '').trim();
  return (cleaned || '原型') + ext;
}

/** 取原型名主干（去扩展名 + 去累积的「-标注」后缀）；空则回落「原型」 */
export function protoStem(protoName: string): string {
  return normalizeProtoName(protoName).replace(/\.(html?|anno\.json)$/i, '') || '原型';
}

/** 导出 HTML 的下载文件名：`<原型名主干>-标注.html` */
export function exportHtmlName(protoName: string): string {
  return `${protoStem(protoName)}${EXPORT_SUFFIX}.html`;
}

/** 保存 JSON 的下载文件名：`<原型名主干>.anno.json` */
export function annoJsonName(protoName: string): string {
  return `${protoStem(protoName)}.anno.json`;
}