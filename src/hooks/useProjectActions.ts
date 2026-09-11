/**
 * hooks/useProjectActions.ts —— 保存 / 导出 / 导入 / 重锚定动作（spec R7 / R8）
 *
 * 职责：下载 JSON/HTML、导入 JSON（D3 合并 + 三态判定）、结构变化驱动的锚点失联检查。
 * 草稿清除钩子随保存/导出成功触发；localStorage 键见 lib/draft。
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { usePinHTMLStore } from '@/lib/store';
import { downloadHtml, downloadJson } from '@/lib/exporter';
import { parseProjectJson, mergeProjects } from '@/lib/importer';
import { reanchorAll } from '@/lib/reanchor';
import { buildSelector, getSnippet } from '@/lib/dom';
import { draftKey, removeDraft } from '@/lib/draft';
import { getTargetDoc } from '@/viewer/registry';

export interface ProjectActions {
  saveJson: () => void;
  exportHtml: () => void;
  importJson: (file: File) => Promise<void>;
  /** 结构变化后检查锚点是否失联（moved 自动重绑 / stale 标记） */
  recheckAnchors: () => void;
}

export function useProjectActions(): ProjectActions {
  const saveJson = useCallback(() => {
    const s = usePinHTMLStore.getState();
    if (!s.project) return;
    downloadJson(s.project);
    s.markSaved();
    removeDraft(draftKey(s.project.protoName, s.project.protoHash));
    toast.success('已保存标注 JSON');
  }, []);

  const exportHtml = useCallback(() => {
    const s = usePinHTMLStore.getState();
    if (!s.project || !s.protoCleanSource) return;
    downloadHtml(s.protoCleanSource, s.project);
    s.markSaved();
    removeDraft(draftKey(s.project.protoName, s.project.protoHash));
    toast.success('已导出标注 HTML');
  }, []);

  const importJson = useCallback(async (file: File) => {
    const s = usePinHTMLStore.getState();
    if (!s.project || !s.protoCleanSource) {
      toast.error('请先打开原型');
      return;
    }
    const text = await file.text();
    const imported = parseProjectJson(text);
    if (!imported) {
      toast.error('无效的标注 JSON');
      return;
    }

    const doc = getTargetDoc();
    const mismatch = doc !== null && imported.protoHash !== s.protoHash;
    let staleIds: string[] = [];

    if (mismatch && doc) {
      // 原型已变更：全量三态判定导入的锚点（R8 / R7）
      const outcome = reanchorAll(doc, imported.anchors);
      let movedCount = 0;
      for (const { anchor, element } of outcome.moved) {
        element.setAttribute('data-anno-id', anchor.id);
        anchor.selector = buildSelector(element);
        anchor.snippet = getSnippet(element);
        movedCount += 1;
      }
      staleIds = outcome.stale.map((a) => a.id);
      if (movedCount > 0) toast('原型已变更，部分锚点已自动重绑');
      if (staleIds.length > 0) toast.warning(`${staleIds.length} 个锚点失联，需重新选择`);
    }

    const merged = mergeProjects(s.project, imported);
    usePinHTMLStore.getState().loadProject(merged, s.protoCleanSource, s.protoHash ?? '');
    if (staleIds.length > 0) usePinHTMLStore.getState().setStaleAnchorIds(staleIds);
    toast.success('已导入标注');
  }, []);

  const recheckAnchors = useCallback(() => {
    const s = usePinHTMLStore.getState();
    const doc = getTargetDoc();
    if (!s.project || !doc) return;

    // 仅检查 data-anno-id 未命中的锚点（元素可能已被原型重渲染 / 移除）
    const missing = s.project.anchors.filter((a) => !doc.querySelector(`[data-anno-id="${a.id}"]`));
    let movedCount = 0;
    const staleIds: string[] = [];
    if (missing.length > 0) {
      const outcome = reanchorAll(doc, missing);
      for (const { anchor, element } of outcome.moved) {
        usePinHTMLStore
          .getState()
          .rebindAnchor(anchor.id, element, buildSelector(element), getSnippet(element));
        movedCount += 1;
      }
      staleIds.push(...outcome.stale.map((a) => a.id));
    }

    // 失联集合以「本次判定结果」为准替换而非累加：锚点恢复正常后自动摘除，
    // 且仅在集合真正变化时提示，避免结构频繁变化时反复弹 toast
    const prev = s.staleAnchorIds;
    const changed = prev.length !== staleIds.length || prev.some((id) => !staleIds.includes(id));
    if (changed) {
      usePinHTMLStore.getState().setStaleAnchorIds(staleIds);
      if (staleIds.length > 0) toast.warning(`${staleIds.length} 个锚点失联，需重新选择`);
    }
    if (movedCount > 0) toast('锚点已自动重绑');

    // 通知侧栏重算依赖文档顺序的编号与排序（图钉序号与卡片刻号保持一致）
    usePinHTMLStore.getState().bumpStructure();
  }, []);

  return { saveJson, exportHtml, importJson, recheckAnchors };
}