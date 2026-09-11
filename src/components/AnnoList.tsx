/**
 * components/AnnoList.tsx —— 标注卡片列表（spec R4 / R6）
 *
 * 职责：读 store 项目与筛选，按「锚点文档顺序 + createdAt」排序、过滤后渲染 AnnoCard 列表；
 * 卡片刻号取 numberAnnotations 的固定编号（与图钉显示的序号同源，筛掉部分卡片时允许跳号）。
 * 承载编辑态表单（新建 / 编辑既有）；监听 viewer 的可见性变化事件驱动「不可见」角标。
 */
import { useEffect, useState } from 'react';
import { usePinHTMLStore, filterAnnotations } from '@/lib/store';
import { numberAnnotations, orderAnnotations } from '@/lib/dom';
import { getTargetDoc, getViewerInstance } from '@/viewer/registry';
import { useAnnotationActions } from '@/hooks/useAnnotationActions';
import type { Annotation } from '@/lib/types';
import { AnnoCard } from '@/components/AnnoCard';
import { EditorForm } from '@/components/EditorForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** 列表行：标注 + 其固定序号（= 图钉显示的序号） */
interface AnnoRow {
  anno: Annotation;
  no: number;
}

export function AnnoList() {
  const project = usePinHTMLStore((s) => s.project);
  const filters = usePinHTMLStore((s) => s.filters);
  const editing = usePinHTMLStore((s) => s.editing);
  const staleAnchorIds = usePinHTMLStore((s) => s.staleAnchorIds);
  const structureVersion = usePinHTMLStore((s) => s.structureVersion);
  const { moveUp, startRebind } = useAnnotationActions();

  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // 订阅 viewer 可见性变化（单一事实来源）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, boolean>>).detail;
      if (detail) setHiddenMap(detail);
    };
    document.addEventListener('pinhtml-visibility-change', handler);
    return () => document.removeEventListener('pinhtml-visibility-change', handler);
  }, []);

  // 固定编号（与图钉同源）+ 排序 + 过滤。
  // 有意不做 useMemo 缓存：编号依赖原型「实时」DOM 顺序，无法用依赖数组可靠表达；
  // 且标注量级很小（<100），每次渲染重算成本可忽略。
  // structureVersion 订阅用于在原型 DOM 结构变化时触发本组件重渲染（下方以 data 属性落地）。
  const targetDoc = getTargetDoc() ?? document;
  const rows: AnnoRow[] = project
    ? (() => {
        const numbers = numberAnnotations(project.annotations, targetDoc);
        const visibleIds = new Set(filterAnnotations(project, filters).map((a) => a.id));
        return orderAnnotations(project.annotations, targetDoc)
          .filter((a) => visibleIds.has(a.id))
          .map((anno) => ({ anno, no: numbers.get(anno.id) ?? 0 }));
      })()
    : [];
  const total = project?.annotations.length ?? 0;

  const locate = (anno: Annotation): void => {
    getViewerInstance()?.scrollAnchorIntoView(anno);
  };

  const beginEditNew = (anno: Annotation | null): void => {
    const doc = getTargetDoc();
    const el = anno ? (doc?.querySelector(`[data-anno-id="${anno.anchorId}"]`) ?? null) : null;
    usePinHTMLStore.getState().beginEdit({
      annotationId: anno ? anno.id : null,
      anchorId: anno ? anno.anchorId : null,
      element: el,
      pickHistory: [],
    });
  };

  const deleted = rows.find((r) => r.anno.id === pendingDeleteId)?.anno;

  return (
    <div className="space-y-2" data-structure-version={structureVersion}>
      {!project && (
        <div className="px-2 py-8 text-center text-xs text-muted-foreground">
          打开原型后，在这里书写标注
        </div>
      )}
      {project && rows.length === 0 && !editing && (
        <div className="px-2 py-8 text-center text-xs text-muted-foreground">
          {total > 0 ? '当前筛选条件下没有标注' : '开启标注模式，点击原型任意元素'}
        </div>
      )}

      {/* 编辑态表单（新建 → 顶部；编辑既有 → 替换对应卡片位置） */}
      {editing && editing.annotationId === null && (
        <EditorForm
          heading="新标注"
          initialTitle=""
          initialBody=""
          initialColor="interaction"
          onSave={(input) => usePinHTMLStore.getState().commitAnnotation(input)}
          onCancel={() => usePinHTMLStore.getState().cancelEdit()}
          onMoveUp={moveUp}
        />
      )}

      {rows.map(({ anno, no }) => {
        const isEditing = editing?.annotationId === anno.id;
        if (isEditing) {
          return (
            <EditorForm
              key={anno.id}
              heading="编辑标注"
              initialTitle={anno.title}
              initialBody={anno.body}
              initialColor={anno.color}
              onSave={(input) => usePinHTMLStore.getState().commitAnnotation(input)}
              onCancel={() => usePinHTMLStore.getState().cancelEdit()}
              onMoveUp={moveUp}
            />
          );
        }
        return (
          <AnnoCard
            key={anno.id}
            index={no}
            annotation={anno}
            hidden={hiddenMap[anno.anchorId] === false}
            stale={staleAnchorIds.includes(anno.anchorId)}
            onLocate={() => locate(anno)}
            onEdit={() => beginEditNew(anno)}
            onDelete={() => setPendingDeleteId(anno.id)}
            onToggleStatus={() => usePinHTMLStore.getState().toggleStatus(anno.id)}
            onRebind={() => startRebind(anno.anchorId)}
          />
        );
      })}

      {/* 删除确认对话框 */}
      <Dialog open={pendingDeleteId !== null} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除标注</DialogTitle>
            <DialogDescription>
              {deleted ? `确认删除「${deleted.title}」？此操作不可撤销。` : '确认删除该标注？'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDeleteId) usePinHTMLStore.getState().removeAnnotation(pendingDeleteId);
                setPendingDeleteId(null);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}