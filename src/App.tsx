/**
 * App.tsx —— 工具壳根组件（spec R1 三段式壳 / R13 URL 模式）
 *
 * 布局：顶栏（Topbar）+ 左原型 iframe 区（空状态为拖放区 + URL 入口）+ 右侧 340px 标注栏（AnnoPanel）。
 * 编排：文件/URL 两种加载流水线 → iframe（srcdoc 或 src）→ 握手挂载 viewer/transport；
 * 模式切换 / 筛选取值 / 草稿自动保存 / 结构变化重锚定 / 关闭保护 / 草稿恢复提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import bridgeSource from '@/bridge?raw';
import { usePinHTMLStore } from '@/lib/store';
import {
  loadPrototypeFile,
  loadPrototypeText,
  prototypeNameFromUrl,
  injectBridgeIntoDoc,
  buildSrcdoc,
} from '@/lib/loading';
import { draftKey, saveDraft, loadDraft, removeDraft } from '@/lib/draft';
import { pageKeyFromHref } from '@/lib/dom';
import type { DraftContent } from '@/lib/draft';
import { useViewer } from '@/hooks/useViewer';
import { useAnnotationActions } from '@/hooks/useAnnotationActions';
import { useProjectActions } from '@/hooks/useProjectActions';
import { Topbar } from '@/components/Topbar';
import { EmptyState } from '@/components/EmptyState';
import { AnnoPanel } from '@/components/AnnoPanel';
import { Toaster } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/types';

/**
 * iframe 来源（两种加载模式）：
 * - srcdoc（文件模式）：干净源 + 中性 base + bridge 组装为 srcdoc，原文件不参与；
 * - url（URL 模式）：iframe 直接加载同源服务上的原型原文件，bridge 由父页在 load 后注入，
 *   从而原型内的相对链接、多页跳转与同目录资源都自然工作。
 */
type FrameSource =
  | { kind: 'srcdoc'; html: string; seq: number }
  | { kind: 'url'; url: string; seq: number };

export default function App() {
  const { viewerRef, transportRef, mountViewer, unmountViewer, refresh } = useViewer();
  const { handlePick, handleLayerKey } = useAnnotationActions();
  const { saveJson, exportHtml, importJson, recheckAnchors } = useProjectActions();

  const [frame, setFrame] = useState<FrameSource | null>(null);
  /** 文件拖拽悬停窗口时显示落点提示 */
  const [dropActive, setDropActive] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<{
    key: string;
    content: DraftContent;
    fallback: { project: Project; cleanSource: string };
    /** 草稿所属原型的 URL 模式地址（文件模式为 null），恢复时沿用同一加载模式 */
    url: string | null;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const structureTimerRef = useRef<number | null>(null);
  /** iframe 重载序号：作为 key 强制重建，避免重复打开同一文件时 srcDoc 未变化而不触发 load */
  const loadSeqRef = useRef(0);
  /** 上一次 iframe 文档 URL：URL 模式下据此识别「原型内部跳页」（多页原型） */
  const lastDocUrlRef = useRef<string | null>(null);

  const mode = usePinHTMLStore((s) => s.mode);

  // store 变更（project / filters）→ viewer 重算
  useEffect(() => {
    const unsub = usePinHTMLStore.subscribe((state, prev) => {
      if (state.project !== prev.project || state.filters !== prev.filters) refresh();
    });
    return unsub;
  }, [refresh]);

  // 模式切换 → transport 拦截开关 + pin 交互开关
  useEffect(() => {
    transportRef.current?.setMode(mode);
    viewerRef.current?.setPinInteractive(mode !== 'annotate');
  }, [mode, transportRef, viewerRef]);

  // 草稿自动保存（project 变更 → 300ms 防抖写 localStorage，R9）
  useEffect(() => {
    let timer: number | null = null;
    const unsub = usePinHTMLStore.subscribe((state, prev) => {
      if (state.project !== prev.project && state.project && state.protoCleanSource) {
        const key = draftKey(state.project.protoName, state.project.protoHash);
        const proj = state.project;
        const src = state.protoCleanSource;
        if (timer !== null) clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          saveDraft(key, { project: proj, protoCleanSource: src });
        }, 300);
      }
    });
    return () => {
      unsub();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // 关闭保护（dirty → beforeunload 提示，R9）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (usePinHTMLStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const renderProject = useCallback(
    (project: Project, cleanSource: string, sourceUrl: string | null): void => {
      // 旧原型退场（viewer + transport/bridge 一并销毁）。只在真正切换原型时执行：
      // 草稿弹窗被取消时屏上原型与侧栏保持一致，不会被提前清空。
      unmountViewer();
      // 丢弃切换前挂起的结构重扫（否则会在新原型 DOM 上多跑一次无用判定）
      if (structureTimerRef.current !== null) {
        clearTimeout(structureTimerRef.current);
        structureTimerRef.current = null;
      }
      usePinHTMLStore.getState().loadProject(project, cleanSource, project.protoHash);
      loadSeqRef.current += 1;
      const seq = loadSeqRef.current;
      // 新原型：重置文档 URL 记忆（URL 模式据此判断原型内部跳页）
      lastDocUrlRef.current = null;
      setFrame(
        sourceUrl
          ? { kind: 'url', url: sourceUrl, seq }
          : { kind: 'srcdoc', html: buildSrcdoc(cleanSource, bridgeSource), seq },
      );
    },
    [unmountViewer],
  );

  /** 草稿恢复检测（D2）：同键存在草稿且有标注 → 提示恢复或忽略 */
  const offerDraftOrRender = useCallback(
    (
      result: { project: Project; cleanSource: string; protoHash: string },
      url: string | null,
    ): void => {
      const key = draftKey(result.project.protoName, result.protoHash);
      const draft = loadDraft(key);
      if (draft && draft.project.annotations.length > 0) {
        setPendingDraft({
          key,
          content: draft,
          fallback: { project: result.project, cleanSource: result.cleanSource },
          url,
        });
        return;
      }
      renderProject(result.project, result.cleanSource, url);
    },
    [renderProject],
  );

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        offerDraftOrRender(await loadPrototypeFile(file), null);
      } catch (err) {
        console.error(err);
        toast.error('原型加载失败');
      }
    },
    [offerDraftOrRender],
  );

  /**
   * URL 模式（spec R13）：打开同源服务上的原型，iframe 用真实 URL 加载，
   * 原型内的相对链接、多页跳转与同目录资源都自然工作。
   */
  const handleUrl = useCallback(
    async (raw: string): Promise<void> => {
      let parsed: URL;
      try {
        parsed = new URL(raw, window.location.href);
      } catch {
        toast.error('URL 格式不正确');
        return;
      }
      // contentDocument 直连要求同源（D1）：不同源无法注入 bridge / 访问文档
      if (parsed.origin !== window.location.origin) {
        toast.error('URL 模式需与工具同源', {
          description: '请把 PinHTML.html 放进原型目录，并通过该服务打开工具后重试',
        });
        return;
      }
      try {
        const res = await fetch(parsed.href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const result = await loadPrototypeText(
          prototypeNameFromUrl(parsed.href),
          text,
          pageKeyFromHref(parsed.href),
        );
        if (result.isExportArtifact) {
          toast.info('该地址是本工具导出产物，请改用「拖入 / 选择文件」打开以继续标注');
          return;
        }
        offerDraftOrRender(result, parsed.href);
      } catch (err) {
        console.error(err);
        toast.error('URL 加载失败', { description: '确认服务已启动、路径正确且与工具同源' });
      }
    },
    [offerDraftOrRender],
  );

  /** 按扩展名分派拖入的文件：.html/.htm → 打开原型；.json → 导入标注 */
  const routeFiles = useCallback(
    (files: FileList | File[]): void => {
      const list = Array.from(files);
      const html = list.find((f) => /\.html?$/i.test(f.name));
      if (html) {
        setDropActive(false);
        void handleFile(html);
        return;
      }
      const json = list.find((f) => /\.json$/i.test(f.name));
      if (json) {
        setDropActive(false);
        void importJson(json);
        return;
      }
      toast.error('仅支持拖入 .html / .htm 原型或 .json 标注数据');
    },
    [handleFile, importJson],
  );

  // 工具外壳（顶栏 / 侧栏 / 空状态）区域的拖入；原型区域内的拖入由 bridge 转发（见 onIframeLoad）
  useEffect(() => {
    const hasFiles = (dt: DataTransfer | null): boolean =>
      !!dt && Array.from(dt.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    };
    const onDragLeave = (e: DragEvent): void => {
      if (e.relatedTarget) return; // 指针仍在窗口内
      setDropActive(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setDropActive(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) routeFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [routeFiles]);

  // 全局快捷键：⌘/Ctrl+S 保存 JSON、⌘/Ctrl+E 导出 HTML、Esc 取消编辑
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveJson();
        return;
      }
      if (mod && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        exportHtml();
        return;
      }
      if (e.key === 'Escape' && usePinHTMLStore.getState().editing) {
        usePinHTMLStore.getState().cancelEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveJson, exportHtml]);

  const onIframeLoad = (): void => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const docUrl = iframe.contentWindow?.location.href ?? '';
    // URL 模式：原型原文件没有 srcdoc 注入环节，bridge 由父页在其文档内注入后再握手
    if (frame?.kind === 'url') injectBridgeIntoDoc(iframe.contentDocument, bridgeSource);
    const transport = mountViewer(iframe);
    const currentMode = usePinHTMLStore.getState().mode;
    transport?.setMode(currentMode);
    transport?.onPick(handlePick);
    transport?.onLayerKey?.(handleLayerKey);
    // 原型区域内拖入文件 / 快捷键（bridge 转发，实现「窗口任意位置」可用）
    transport?.onFileDrop(routeFiles);
    transport?.onFileDragState(setDropActive);
    transport?.onShortcut((key) => {
      if (key === 'save') saveJson();
      else if (key === 'export') exportHtml();
      else if (usePinHTMLStore.getState().editing) usePinHTMLStore.getState().cancelEdit();
    });
    // 原型内的跳转在工具里无法跟随：相对路径在 srcdoc 下没有有效基准、绝对外链会把原型视图顶掉、
    // 表单提交会离开当前文档——bridge 已拦下，这里给出可操作提示（外链提供新标签页打开）
    transport?.onBlockedNavigation((href) => {
      const external = /^https?:/i.test(href);
      toast.info('已阻止原型内的页面跳转', {
        id: 'blocked-navigation',
        description: external
          ? `「${href}」会离开当前原型，已阻止；可用下方按钮在新标签页打开`
          : `「${href}」无法在工具内跟随，请用 [打开原型] 单独打开该文件`,
        action: external
          ? { label: '打开', onClick: () => window.open(href, '_blank', 'noopener,noreferrer') }
          : undefined,
      });
    });
    // 结构变化（含锚点元素消失）→ 防抖后三态判定（R7）
    transport?.onStructureChange(() => {
      if (structureTimerRef.current !== null) clearTimeout(structureTimerRef.current);
      structureTimerRef.current = window.setTimeout(() => {
        structureTimerRef.current = null;
        recheckAnchors();
      }, 300);
    });
    viewerRef.current?.setPinInteractive(currentMode !== 'annotate');

    // URL 模式：原型内部跳页（多页原型）时 iframe 会再次 load——新文档已重新注入并挂载，
    // 锚点按新 DOM 重跑三态判定（selector + snippet 双证据自动重绑，找不到的标失联）
    if (frame?.kind === 'url') {
      if (!transport) {
        toast.error('无法在该页面注入标注脚本', {
          description: '可能被页面 CSP 限制，请改用「拖入 / 选择文件」模式',
        });
      } else if (lastDocUrlRef.current !== null && lastDocUrlRef.current !== docUrl) {
        recheckAnchors();
      }
      lastDocUrlRef.current = docUrl;
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar
        onOpenFile={() => fileInputRef.current?.click()}
        onImportJson={() => jsonInputRef.current?.click()}
        onSaveJson={saveJson}
        onExportHtml={exportHtml}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {frame ? (
            <iframe
              key={frame.seq}
              ref={iframeRef}
              title="原型"
              srcDoc={frame.kind === 'srcdoc' ? frame.html : undefined}
              src={frame.kind === 'url' ? frame.url : undefined}
              onLoad={onIframeLoad}
              className="h-full w-full border-0"
            />
          ) : (
            <EmptyState onFile={handleFile} onUrl={handleUrl} />
          )}
        </main>
        <AnnoPanel />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
          e.target.value = '';
        }}
      />

      {/* 草稿恢复对话框（D2） */}
      <Dialog open={pendingDraft !== null} onOpenChange={(o) => !o && setPendingDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现未保存的草稿</DialogTitle>
            <DialogDescription>检测到该原型存在自动保存的草稿，是否恢复？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (pendingDraft) {
                  removeDraft(pendingDraft.key);
                  renderProject(
                    pendingDraft.fallback.project,
                    pendingDraft.fallback.cleanSource,
                    pendingDraft.url,
                  );
                }
                setPendingDraft(null);
              }}
            >
              忽略并删除
            </Button>
            <Button
              onClick={() => {
                if (pendingDraft) {
                  renderProject(
                    pendingDraft.content.project,
                    pendingDraft.content.protoCleanSource,
                    pendingDraft.url,
                  );
                }
                setPendingDraft(null);
              }}
            >
              恢复草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拖入文件落点提示（pointer-events:none，不干扰 drop 命中） */}
      {dropActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/50">
          <div className="rounded-2xl border-2 border-dashed border-matcha bg-white/95 px-10 py-7 text-center shadow-sm">
            <div className="text-sm font-medium">松开以打开</div>
            <div className="mt-1 text-xs text-muted-foreground">
              .html / .htm 原型，或 .json 标注数据
            </div>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}