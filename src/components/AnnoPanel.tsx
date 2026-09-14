/**
 * components/AnnoPanel.tsx —— 右侧标注栏（spec R1/R4/R6）
 *
 * 职责：340px 固定标注栏，含栏头统计、状态/分类筛选、卡片列表容器（#annoList，viewer 查询
 * 连线终点与 hover 联动依赖此容器）。卡片与编辑表单的渲染在 Task 6（AnnoCard / EditorForm）接入。
 */
import { useState } from 'react';
import { CATEGORY_META, getCategoryLabel } from '@/lib/types';
import type { AnnoStatus, Category } from '@/lib/types';
import { usePinHTMLStore } from '@/lib/store';
import { AnnoList } from '@/components/AnnoList';
import { CategoryLabelDialog } from '@/components/CategoryLabelDialog';
import { Input } from '@/components/ui/input';
import { Search, Settings2, X } from 'lucide-react';

const STATUS_OPTIONS: Array<{ value: 'all' | AnnoStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '待确认' },
  { value: 'resolved', label: '已确认' },
];

const CATEGORIES = Object.keys(CATEGORY_META) as Category[];

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? 'border-matcha bg-matcha-wash text-matcha-deep'
          : 'border-border bg-background text-muted-foreground hover:border-matcha-line'
      }`}
    >
      {children}
    </button>
  );
}

export function AnnoPanel() {
  const project = usePinHTMLStore((s) => s.project);
  const filters = usePinHTMLStore((s) => s.filters);
  const setFilters = usePinHTMLStore((s) => s.setFilters);
  const query = usePinHTMLStore((s) => s.query);
  const setQuery = usePinHTMLStore((s) => s.setQuery);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const total = project?.annotations.length ?? 0;
  const open = project?.annotations.filter((a) => a.status === 'open').length ?? 0;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-[#FAFAF8]">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            标注 {total} · 待确认 {open}
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-matcha-deep"
            title="编辑分类标签"
            onClick={() => setLabelsOpen(true)}
          >
            <Settings2 className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <PillButton
              key={opt.value}
              active={filters.status === opt.value}
              onClick={() => setFilters({ status: opt.value })}
            >
              {opt.label}
            </PillButton>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <PillButton
              key={cat}
              active={filters.categories[cat]}
              onClick={() =>
                setFilters({
                  categories: { ...filters.categories, [cat]: !filters.categories[cat] },
                })
              }
            >
              <span
                className="mr-1 inline-block size-2 rounded-full align-middle"
                style={{ background: CATEGORY_META[cat].color }}
              />
              {getCategoryLabel(project, cat)}
            </PillButton>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题 / 正文"
            className="h-8 pr-7 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              title="清除搜索"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div id="annoList" className="flex-1 overflow-y-auto p-3">
        <AnnoList />
      </div>

      <CategoryLabelDialog open={labelsOpen} onOpenChange={setLabelsOpen} />
    </aside>
  );
}