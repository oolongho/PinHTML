/**
 * components/EditorForm.tsx —— 标注编辑表单（spec R4）
 *
 * 职责：标题（必填 ≤60）、正文（textarea ≤2000、支持换行）、颜色四选一（默认 interaction）、
 * 保存 / 取消 / 上移一层。新建与编辑复用同一表单（初始值由父级传入）。
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CATEGORY_META, getCategoryLabel } from '@/lib/types';
import type { Category } from '@/lib/types';
import { usePinHTMLStore } from '@/lib/store';

export interface EditorInput {
  title: string;
  body: string;
  color: Category;
}

interface EditorFormProps {
  heading: string;
  initialTitle: string;
  initialBody: string;
  initialColor: Category;
  onSave: (input: EditorInput) => void;
  onCancel: () => void;
  onMoveUp: () => void;
}

const CATEGORIES = Object.keys(CATEGORY_META) as Category[];

export function EditorForm({
  heading,
  initialTitle,
  initialBody,
  initialColor,
  onSave,
  onCancel,
  onMoveUp,
}: EditorFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [color, setColor] = useState<Category>(initialColor);
  const project = usePinHTMLStore((s) => s.project);

  return (
    <div className="space-y-2 rounded-xl border border-matcha-line bg-background p-3 shadow-sm">
      <div className="text-xs font-semibold text-muted-foreground">{heading}</div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={60}
        placeholder="标题（必填）"
      />

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="正文（支持换行）"
      />

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              color === c
                ? 'border-matcha bg-matcha-wash text-matcha-deep'
                : 'border-border text-muted-foreground hover:border-matcha-line'
            }`}
          >
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: CATEGORY_META[c].color }}
            />
            {getCategoryLabel(project, c)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onMoveUp}>
          上移一层
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!title.trim()}
          onClick={() => onSave({ title: title.trim(), body, color })}
        >
          保存
        </Button>
      </div>
    </div>
  );
}