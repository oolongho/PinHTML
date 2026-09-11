/**
 * importer.ts —— JSON 导入与合并（spec R8 / D3）
 *
 * 职责：解析 <原型名>.anno.json；按 id 合并（并集、冲突以导入文件优先，D3）。
 * protoHash 一致 → 直接合并；不一致 → 调用方先做全量三态判定（reanchor）再合并。
 */
import type { Project } from './types';

/** 解析并校验项目 JSON 文本；非法返回 null */
export function parseProjectJson(text: string): Project | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).schema === 1 &&
      Array.isArray((parsed as Record<string, unknown>).anchors) &&
      Array.isArray((parsed as Record<string, unknown>).annotations)
    ) {
      return parsed as Project;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 按 id 合并（D3）：两侧独有标注都保留；id 冲突以导入文件覆盖当前。
 * 序列号取两侧较大值，避免后续编号重复。
 */
export function mergeProjects(current: Project, imported: Project): Project {
  const anchors = new Map(current.anchors.map((a) => [a.id, a]));
  for (const a of imported.anchors) anchors.set(a.id, a);

  const annotations = new Map(current.annotations.map((a) => [a.id, a]));
  for (const a of imported.annotations) annotations.set(a.id, a);

  return {
    ...current,
    anchors: [...anchors.values()],
    annotations: [...annotations.values()],
    anchorSeq: Math.max(current.anchorSeq, imported.anchorSeq),
    annoSeq: Math.max(current.annoSeq, imported.annoSeq),
    categoryLabels: { ...current.categoryLabels, ...imported.categoryLabels },
  };
}