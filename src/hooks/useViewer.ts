/**
 * hooks/useViewer.ts —— viewer 实例与 transport 的生命周期管理（工具模式，spec R5/R6）
 *
 * 职责：挂载/销毁 window.PinHTMLViewer 只读渲染实例与 iframe transport；向 React 层暴露
 * viewer 的实例 API（滚动定位 / 脉冲 / 刷新）与 transport（模式切换 / 拾取）。
 * viewer 的 getProject / getFilters 实时读 zustand store，故 store 变化后调用 refresh() 即可重算。
 */
import { useCallback, useRef } from 'react';
import { createDirectTransport } from '@/lib/transport';
import type { Transport } from '@/lib/transport';
import { usePinHTMLStore } from '@/lib/store';
import { setViewerInstance, setTargetDoc, setTransport } from '@/viewer/registry';
import type { ViewerInstance } from '@/viewer/types';

export interface ViewerController {
  /** viewer 渲染实例（未挂载时为 null） */
  viewerRef: React.MutableRefObject<ViewerInstance | null>;
  /** iframe transport（未握手时为 null） */
  transportRef: React.MutableRefObject<Transport | null>;
  /** 原型 iframe 加载完成后挂载 viewer 并建立 transport；返回 transport（可能为 null） */
  mountViewer: (iframe: HTMLIFrameElement) => Transport | null;
  /** 销毁 viewer 与 transport（切换/关闭原型时） */
  unmountViewer: () => void;
  /** 触发 viewer 全量重算（store 变更后调用） */
  refresh: () => void;
}

export function useViewer(): ViewerController {
  const viewerRef = useRef<ViewerInstance | null>(null);
  const transportRef = useRef<Transport | null>(null);

  const mountViewer = useCallback((iframe: HTMLIFrameElement): Transport | null => {
    const targetDoc = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!targetDoc || !frameWindow) return null;

    // 销毁旧实例（幂等），建立 transport 与 viewer
    viewerRef.current?.destroy();
    viewerRef.current = null;
    const transport = createDirectTransport(iframe);
    transportRef.current = transport;
    setTransport(transport);

    const api = window.PinHTMLViewer;
    if (api) {
      viewerRef.current = api.mount({
        targetDoc,
        viewportDoc: document,
        frameEl: iframe,
        cardsContainer: document.getElementById('annoList'),
        sidebarEl: null,
        getProject: () => usePinHTMLStore.getState().project,
        getFilters: () => usePinHTMLStore.getState().filters,
        interactive: true,
        onPinClick: (anchorId) => viewerRef.current?.scrollToAnchor(anchorId),
        // 卡片点击定位：工具模式由 React 卡片 onClick 调 scrollAnchorIntoView（不委托 viewport
        // 点击，避免与卡片内按钮的交互冲突；仅 pin 在 iframe 内需 viewer 委托）
      });
    }
    setViewerInstance(viewerRef.current);
    setTargetDoc(targetDoc);
    return transport;
  }, []);

  const unmountViewer = useCallback(() => {
    viewerRef.current?.destroy();
    viewerRef.current = null;
    transportRef.current = null;
    setViewerInstance(null);
    setTargetDoc(null);
    setTransport(null);
  }, []);

  const refresh = useCallback(() => {
    viewerRef.current?.refresh();
  }, []);

  return { viewerRef, transportRef, mountViewer, unmountViewer, refresh };
}