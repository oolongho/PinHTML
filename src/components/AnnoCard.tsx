/**
 * components/AnnoCard.tsx —— 标注卡片（spec R4）
 *
 * 职责：复用 viewer 的 .pinhtml-card* 类名（与导出产物卡片同套样式 + 连线/hover 契约对齐），
 * 展示序号/分类/标题/正文/状态 pill；hover 显示 [编辑][删除]；点击卡片（非按钮）定位到锚点。
 */
import { CATEGORY_META, getCategoryLabel } from '@/lib/types';
import type { Annotation } from '@/lib/types';
import { usePinHTMLStore } from '@/lib/store';

interface AnnoCardProps {
  index: number;
  annotation: Annotation;
  hidden: boolean;
  /** 锚点失联（stale，R7）：置灰 + 提供「重新选择锚点」 */
  stale: boolean;
  onLocate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  onRebind: () => void;
}

export function AnnoCard({
  index,
  annotation,
  hidden,
  stale,
  onLocate,
  onEdit,
  onDelete,
  onToggleStatus,
  onRebind,
}: AnnoCardProps) {
  const meta = CATEGORY_META[annotation.color];
  const project = usePinHTMLStore((s) => s.project);
  const resolved = annotation.status === 'resolved';

  return (
    <div
      className={`pinhtml-card group cursor-pointer ${stale ? 'opacity-60' : ''}`}
      data-anno={annotation.id}
      style={{ '--pinhtml-cat': meta.color } as React.CSSProperties}
      onClick={stale ? undefined : onLocate}
    >
      <div className="pinhtml-card-bar" />
      <div className="pinhtml-card-head">
        <span className="pinhtml-card-index">#{index}</span>
        <span className="pinhtml-card-cat">{getCategoryLabel(project, annotation.color)}</span>
        {stale && <span className="text-xs text-destructive">锚点失联</span>}
      </div>
      <div className="pinhtml-card-title">{annotation.title}</div>
      {annotation.body && <div className="pinhtml-card-body">{annotation.body}</div>}
      <div className="pinhtml-card-foot">
        {!stale && (
          <button
            type="button"
            className={`pinhtml-card-status ${resolved ? 'is-resolved' : ''}`}
            title={resolved ? '点击标记为待确认' : '点击标记为已确认'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStatus();
            }}
          >
            {resolved ? '已确认' : '待确认'}
          </button>
        )}
        {hidden && <span className="pinhtml-card-badge">不可见（当前视图）</span>}
        <div className="ml-auto flex items-center gap-2">
          {stale && (
            <button
              type="button"
              className="text-xs text-matcha-deep hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onRebind();
              }}
            >
              重新选择锚点
            </button>
          )}
          {!stale && (
            <div className="hidden items-center gap-2 group-hover:flex">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-matcha-deep"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}