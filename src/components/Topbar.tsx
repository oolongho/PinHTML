/**
 * components/Topbar.tsx —— 顶栏（spec R1 三段式壳 · 顶栏）
 *
 * 职责：PinHTML 标识、[打开原型][导入JSON]、[浏览|标注] 分段切换、[保存JSON][导出HTML]。
 * 未加载原型时，模式切换 / 保存 / 导出禁用。文件 IO 动作由父级 App 注入（涉及 iframe 与下载）。
 */
import { FolderOpen, Upload, Download, FileDown } from 'lucide-react';
import logoUrl from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePinHTMLStore } from '@/lib/store';
import type { Mode } from '@/lib/types';

interface TopbarProps {
  onOpenFile: () => void;
  onImportJson: () => void;
  onSaveJson: () => void;
  onExportHtml: () => void;
}

export function Topbar({ onOpenFile, onImportJson, onSaveJson, onExportHtml }: TopbarProps) {
  const mode = usePinHTMLStore((s) => s.mode);
  const setMode = usePinHTMLStore((s) => s.setMode);
  const hasProject = usePinHTMLStore((s) => s.project !== null);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <div className="mr-2 flex items-center gap-2">
        <img src={logoUrl} alt="PinHTML" className="size-6 rounded-md object-contain" />
        <span className="text-sm font-bold tracking-tight">PinHTML</span>
      </div>

      <Button variant="outline" size="sm" onClick={onOpenFile}>
        <FolderOpen className="size-3.5" />
        打开原型
      </Button>
      <Button variant="outline" size="sm" onClick={onImportJson}>
        <Upload className="size-3.5" />
        导入JSON
      </Button>

      <div className="mx-2 h-5 w-px bg-border" />

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={mode}
        disabled={!hasProject}
        onValueChange={(v) => {
          if (v) setMode(v as Mode);
        }}
      >
        <ToggleGroupItem value="browse">浏览</ToggleGroupItem>
        <ToggleGroupItem value="annotate">标注</ToggleGroupItem>
      </ToggleGroup>

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={onSaveJson} disabled={!hasProject}>
        <Download className="size-3.5" />
        保存JSON
      </Button>
      <Button variant="default" size="sm" onClick={onExportHtml} disabled={!hasProject}>
        <FileDown className="size-3.5" />
        导出HTML
      </Button>
    </header>
  );
}