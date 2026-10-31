/**
 * quality.ts —— 草稿并入后的可机检质量信号（spec R5 / DC11）
 *
 * 职责：对「合并后的整个 project」做统计与告警——条数、分类分布、正文长度、
 * 同锚点重复、空标题、全部落 note。只判断、不修改任何东西（DC2：warning 不拦截、
 * 不改变退出码）；「该不该标」这类不可机检的判断由 Skill 承载，本文件不做（DC11）。
 *
 * 与 annotate 的分工：本文件不读草稿原文，只接收「草稿序号 → 标注 id」的映射，
 * 用于给 BODY_TOO_LONG / EMPTY_TITLE / DUPLICATE_ANCHOR 附上草稿 index；
 * 统计口径一律是合并后的项目（含本次新增与输入里既有的标注）。
 */
import type { Category, Project } from '@/lib/types';

/** 单条质量告警；index 为草稿项下标（仅当前标注来自本次草稿时可给出） */
export interface QualityWarning {
  /** 草稿 items 下标（0 起）；非本次草稿写入的标注不给出 */
  index?: number;
  /** 告警码：TOO_MANY_ITEMS / BODY_TOO_LONG / EMPTY_TITLE / DUPLICATE_ANCHOR / NO_CATEGORY */
  code: string;
  /** 人类可读说明（给人复核用，不参与逻辑） */
  message: string;
}

/** 质量报告：统计 + 告警 */
export interface QualityReport {
  /** 合并后项目的标注总数 */
  items: number;
  /** 合并后项目按分类的条数 */
  byColor: Record<Category, number>;
  /** 合并后项目正文字数均值（保留 1 位小数；无标注时为 0） */
  avgBodyLength: number;
  /** 合并后项目正文最大字数（无标注时为 0） */
  maxBodyLength: number;
  warnings: QualityWarning[];
}

/** 草稿序号与标注 id 的对应关系（applied 项的最小子集） */
export interface DraftEntryRef {
  /** 草稿 items 下标（0 起） */
  index: number;
  /** 该草稿项最终落到（或被更新为）的标注 id */
  annotationId: string;
}

/** 条数预算默认值（R5：`--max-items` 未给时） */
export const DEFAULT_MAX_ITEMS = 15;

/** 正文建议长度上限（超过只告警，不拒绝） */
const BODY_SUGGESTED_LIMIT = 200;

/** 四分类初始计数 */
function emptyByColor(): Record<Category, number> {
  return { interaction: 0, visual: 0, question: 0, note: 0 };
}

/** 保留 1 位小数（避免 stdout 里出现长浮点尾巴） */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 计算质量报告（纯函数）。
 *
 * @param project 合并后的项目（本次写入已并进去）
 * @param draftEntries 本次草稿的 `{ index, annotationId }` 列表，用于给告警附草稿下标
 * @param opts.maxItems 条数上限，缺省 15
 */
export function reviewDraft(
  project: Project,
  draftEntries: readonly DraftEntryRef[] = [],
  opts: { maxItems?: number } = {},
): QualityReport {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const annotations = project.annotations;
  const indexOf = new Map<string, number>();
  for (const entry of draftEntries) indexOf.set(entry.annotationId, entry.index);

  const byColor = emptyByColor();
  let totalBodyLength = 0;
  let maxBodyLength = 0;
  for (const annotation of annotations) {
    byColor[annotation.color] += 1;
    const length = annotation.body.length;
    totalBodyLength += length;
    if (length > maxBodyLength) maxBodyLength = length;
  }

  const warnings: QualityWarning[] = [];

  // ① 条数预算：超了建议合并同类或降级为 note（R10 写法规则），不拦截
  if (annotations.length > maxItems) {
    warnings.push({
      code: 'TOO_MANY_ITEMS',
      message: `标注 ${annotations.length} 条，超过上限 ${maxItems} 条：合并同类或降级为 note`,
    });
  }

  // ② 逐条：正文过长 / 空标题
  for (const annotation of annotations) {
    const index = indexOf.get(annotation.id);
    if (annotation.body.length > BODY_SUGGESTED_LIMIT) {
      warnings.push({
        ...(index !== undefined ? { index } : {}),
        code: 'BODY_TOO_LONG',
        message: `标注 ${annotation.id} 正文 ${annotation.body.length} 字，建议压到 ${BODY_SUGGESTED_LIMIT} 字内`,
      });
    }
    if (annotation.title.trim() === '') {
      warnings.push({
        ...(index !== undefined ? { index } : {}),
        code: 'EMPTY_TITLE',
        message: `标注 ${annotation.id} 标题为空`,
      });
    }
  }

  // ③ 同一锚点挂多条：第二条及以后各给一条（提示合并或确认是否各写一条）
  const seenAnchor = new Set<string>();
  for (const annotation of annotations) {
    if (!seenAnchor.has(annotation.anchorId)) {
      seenAnchor.add(annotation.anchorId);
      continue;
    }
    const index = indexOf.get(annotation.id);
    warnings.push({
      ...(index !== undefined ? { index } : {}),
      code: 'DUPLICATE_ANCHOR',
      message: `锚点 ${annotation.anchorId} 上有多条标注（含 ${annotation.id}）：合并或确认是否各写一条`,
    });
  }

  // ④ 全部落 note：说明没做分类判断（空项目不算）
  if (annotations.length > 0 && annotations.every((annotation) => annotation.color === 'note')) {
    warnings.push({
      code: 'NO_CATEGORY',
      message: '全部标注都是 note：确认是否漏了分类判断',
    });
  }

  return {
    items: annotations.length,
    byColor,
    avgBodyLength: annotations.length === 0 ? 0 : round1(totalBodyLength / annotations.length),
    maxBodyLength,
    warnings,
  };
}
