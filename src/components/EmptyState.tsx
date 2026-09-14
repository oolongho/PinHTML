/**
 * components/EmptyState.tsx —— 空状态（spec R1 空状态 Scenario）
 *
 * 职责：左侧原型区的中央拖放区，点击可选择文件。
 * 拖入文件的接收统一由 App 的窗口级监听处理（「窗口任意位置拖入」），
 * 此处不再单独处理 drop，避免同一次拖放被两条路径重复分派。
 */
import { useRef } from 'react';
import { FileUp } from 'lucide-react';

interface EmptyStateProps {
  onFile: (file: File) => void;
}

export function EmptyState({ onFile }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-background px-8 py-14 text-center transition-colors hover:border-matcha-line"
      >
        <FileUp className="size-8 text-matcha-deep" />
        <div className="text-sm font-medium">拖入或选择 HTML 原型</div>
        <div className="text-xs text-muted-foreground">
          支持 .html / .htm 文件（拖到窗口任意位置均可）
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}