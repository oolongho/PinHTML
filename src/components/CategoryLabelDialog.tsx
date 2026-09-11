/**
 * components/CategoryLabelDialog.tsx —— 分类标签自定义（用户需求：标签文字可自定义，颜色固定）
 *
 * 职责：弹窗内逐类编辑显示名（仅改文字，颜色与类别数量固定四类）；保存后写入 project.categoryLabels。
 * 表单拆为独立子组件：弹窗打开时才挂载，State 初始化即读取当前项目值——无需在 effect 内 setState。
 */
import { useState } from 'react';
import { CATEGORY_META, getCategoryLabel } from '@/lib/types';
import type { Category } from '@/lib/types';
import { usePinHTMLStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORIES = Object.keys(CATEGORY_META) as Category[];

interface CategoryLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 各分类当前显示名（自定义优先，否则默认） */
function currentLabels(project: { categoryLabels?: Partial<Record<Category, string>> } | null) {
  return Object.fromEntries(CATEGORIES.map((c) => [c, getCategoryLabel(project, c)])) as Record<
    Category,
    string
  >;
}

/** 表单主体：仅在弹窗打开期间挂载，故 useState 初值即当次打开时的最新值 */
function CategoryLabelFields({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (labels: Partial<Record<Category, string>>) => void;
}) {
  const project = usePinHTMLStore((s) => s.project);
  const [labels, setLabels] = useState<Record<Category, string>>(() => currentLabels(project));

  const submit = (): void => {
    // 空串视为未自定义（回退默认名）
    const patch: Partial<Record<Category, string>> = {};
    for (const c of CATEGORIES) {
      const v = labels[c].trim();
      if (v) patch[c] = v;
    }
    onSave(patch);
  };

  return (
    <>
      <div className="space-y-3">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="flex items-center gap-2">
            <span
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ background: CATEGORY_META[cat].color }}
            />
            <Input
              value={labels[cat]}
              maxLength={10}
              placeholder={CATEGORY_META[cat].label}
              onChange={(e) => setLabels({ ...labels, [cat]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit}>保存</Button>
      </DialogFooter>
    </>
  );
}

export function CategoryLabelDialog({ open, onOpenChange }: CategoryLabelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑分类标签</DialogTitle>
        </DialogHeader>
        <CategoryLabelFields
          onCancel={() => onOpenChange(false)}
          onSave={(labels) => {
            usePinHTMLStore.getState().setCategoryLabels(labels);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}