/**
 * hooks/useAnnotationActions.ts —— 标注拾取与层级编辑的动作（spec R2 / R4 / R7）
 *
 * 职责：把 bridge 的拾取 / 层级回调桥接到 store 的编辑上下文（beginEdit / updateEditElement /
 * undoEditElement）与三态重锚定（rebindAnchor）。「上移一层」= 改绑父元素；「]」= 撤回上次上移；
 * stale 卡片「重新选择锚点」经 pickOnce 一次性拾取后改绑。
 */
import { useCallback, useRef } from 'react';
import { usePinHTMLStore } from '@/lib/store';
import { buildSelector, getSnippet } from '@/lib/dom';
import { getTransport } from '@/viewer/registry';

export interface AnnotationActions {
  /** 拾取元素 → 打开新建编辑上下文，或完成 stale 锚点的重新选择 */
  handlePick: (element: Element) => void;
  /** 键盘层级（bridge onLayerKey 转发）：仅编辑器打开时有意义 */
  handleLayerKey: (dir: 'up' | 'down') => void;
  /** 上移一层：改绑到父元素 */
  moveUp: () => void;
  /** 撤回上次上移 */
  undo: () => void;
  /** 开始 stale 锚点重新选择（进入一次性拾取态） */
  startRebind: (anchorId: string) => void;
}

export function useAnnotationActions(): AnnotationActions {
  /** 待重新选择的 stale 锚点 id（非空时，下一次拾取用于改绑） */
  const pendingRebindRef = useRef<string | null>(null);

  const moveUp = useCallback(() => {
    const { editing, updateEditElement } = usePinHTMLStore.getState();
    if (!editing || !editing.element) return;
    const el = editing.element;
    const parent = el.parentElement;
    const root = el.ownerDocument?.documentElement;
    if (parent && parent !== el.ownerDocument?.body && parent !== root) {
      updateEditElement(parent);
    }
  }, []);

  const undo = useCallback(() => {
    usePinHTMLStore.getState().undoEditElement();
  }, []);

  const handlePick = useCallback((element: Element) => {
    // stale 重选：改绑锚点到新元素
    const rebindId = pendingRebindRef.current;
    if (rebindId) {
      pendingRebindRef.current = null;
      usePinHTMLStore
        .getState()
        .rebindAnchor(rebindId, element, buildSelector(element), getSnippet(element));
      return;
    }
    const existingId = element.getAttribute('data-anno-id');
    usePinHTMLStore.getState().beginEdit({
      annotationId: null,
      anchorId: existingId, // 已有锚点则复用追加；否则提交时新建
      element,
      pickHistory: [],
    });
  }, []);

  const handleLayerKey = useCallback(
    (dir: 'up' | 'down') => {
      const { editing } = usePinHTMLStore.getState();
      if (!editing) return; // 未打开编辑器时，层级键仅驱动 bridge 自身高亮，不涉及锚点
      if (dir === 'up') moveUp();
      else undo();
    },
    [moveUp, undo],
  );

  const startRebind = useCallback((anchorId: string) => {
    pendingRebindRef.current = anchorId;
    // 进入一次性拾取态：下一次点击无论当前模式都回调 handlePick 一次
    getTransport()?.pickOnce(true);
  }, []);

  return { handlePick, handleLayerKey, moveUp, undo, startRebind };
}