/**
 * draft.ts —— localStorage 草稿自动保存与恢复（spec R9 / D2）
 *
 * 职责：键 pinhtml:draft:<protoName>:<protoHash>，保存项目 + 干净源文本；
 * 保存 / 导出成功后清除；localStorage 不可用（如 Safari file://）时 try/catch 静默降级。
 * 300ms 防抖由调用方（App 订阅 store 变更）实现，本文件提供同步读写原语。
 */
import type { Project } from './types';

const PREFIX = 'pinhtml:draft:';

/** 草稿内容：项目 + 干净源（恢复时重建 iframe srcdoc） */
export interface DraftContent {
  project: Project;
  protoCleanSource: string;
}

/** 生成草稿键 */
export function draftKey(protoName: string, protoHash: string): string {
  return `${PREFIX}${protoName}:${protoHash}`;
}

/** 写入草稿（localStorage 不可用静默降级） */
export function saveDraft(key: string, content: DraftContent): void {
  try {
    localStorage.setItem(key, JSON.stringify(content));
  } catch {
    // 静默降级（file:// 下 Safari 可能禁用 localStorage）
  }
}

/** 读取草稿；无 / 损坏返回 null */
export function loadDraft(key: string): DraftContent | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).project &&
      typeof (parsed as Record<string, unknown>).protoCleanSource === 'string'
    ) {
      return parsed as DraftContent;
    }
    return null;
  } catch {
    return null;
  }
}

/** 删除草稿（localStorage 不可用静默降级） */
export function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 静默降级
  }
}