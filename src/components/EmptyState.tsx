/**
 * components/EmptyState.tsx —— 空状态（spec R1 空状态 Scenario / R13 URL 模式）
 *
 * 职责：左侧原型区的中央拖放区（点击可选择文件）+ URL 模式入口（同源本地服务 URL）。
 * 拖入文件的接收统一由 App 的窗口级监听处理（「窗口任意位置拖入」），
 * 此处不再单独处理 drop，避免同一次拖放被两条路径重复分派。
 */
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onFile: (file: File) => void;
  /** URL 模式：打开同源服务上的原型（支持多页跳转与同目录资源） */
  onUrl: (url: string) => void;
}

export function EmptyState({ onFile, onUrl }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const trimmed = url.trim();

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-background px-8 py-12 text-center transition-colors hover:border-matcha-line"
        >
          <FileUp className="size-8 text-matcha-deep" />
          <div className="text-sm font-medium">拖入或选择 HTML 原型</div>
          <div className="text-xs text-muted-foreground">
            支持 .html / .htm 文件（拖到窗口任意位置均可）
          </div>
        </button>

        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onUrl(trimmed);
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="或粘贴本地服务 URL（多页原型）"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-xs outline-none transition-colors focus-visible:border-matcha-line"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!trimmed}>
            打开
          </Button>
        </form>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          需与工具同源：把 PinHTML.html 放进原型目录，用该服务打开工具
        </p>
      </div>

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
