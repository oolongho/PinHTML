/**
 * components/EmptyState.tsx —— 空状态（spec R1 空状态 Scenario）
 *
 * 职责：左侧原型区的中央拖放区，支持拖拽 .html/.htm 与点击选择文件。
 */
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';

interface EmptyStateProps {
  onFile: (file: File) => void;
}

export function EmptyState({ onFile }: EmptyStateProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && /\.html?$/i.test(file.name)) onFile(file);
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center p-8"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors ${
          dragging ? 'border-matcha bg-matcha-wash' : 'border-border bg-background hover:border-matcha-line'
        }`}
      >
        <FileUp className="size-8 text-matcha-deep" />
        <div className="text-sm font-medium">拖入或选择 HTML 原型</div>
        <div className="text-xs text-muted-foreground">支持 .html / .htm 文件</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}