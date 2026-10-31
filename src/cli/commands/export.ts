/**
 * export.ts —— `pinhtml export` 命令（spec R6）
 *
 * 职责：把项目数据注入干净源，按 `--kind` 导出单个 HTML 产物：
 * - share（默认）：`<stem>-标注.html`，含 style + data + runtime，双击即看；
 * - clean：`<stem>.annotated.html`，只含 data（无运行时），交给下游 agent 改原型。
 *
 * 边界：
 * - 只写一个 HTML 文件：不改 `ctx.inputPath`，也不写 `<stem>.anno.json`（`ctx.writebackPath`）；
 * - 例外：目标路径与输入重合（如对 `原型-标注.html` 重新导出同名产物）允许覆盖，
 *   这是派生交付物的幂等重生成，不是改写原型本体；
 * - `--kind` 非法 → exit 1；`--kind share --clean` 属矛盾输入 → exit 1，不猜；
 * - 不实现 `--dry-run` / `--strict`（不在本命令规格内）；写盘失败 → exit 2。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAnnotatedHtml, buildExportHtml } from '@/lib/exporter';
import { cleanHtmlName, exportHtmlName } from '@/lib/naming';
import type { Args } from '../args';
import { warn } from '../io';
import type { CliContext, CommandResult } from '../types';

/** 导出形态：share 含运行时；clean 只含数据 */
type ExportKind = 'share' | 'clean';

/** 命令 stdout 报告 */
export interface ExportReport {
  kind: ExportKind;
  /** 实际写盘的文件绝对路径（本命令固定一个） */
  written: string[];
}

/** fs 错误的可读描述（不假设具体错误类型） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取字符串型选项：未给 → 无；给了空值 / 非字符串 → 用法错误 */
function readStringOption(args: Args, key: string, label: string): { value?: string; error?: string } {
  const raw = args.options[key];
  if (raw === undefined) return {};
  if (typeof raw !== 'string' || raw.length === 0) return { error: `${label}需要一个值` };
  return { value: raw };
}

/**
 * 解析 `--kind` / `--clean`：默认 share；`--clean` 等价于 `--kind clean`；
 * 同时给出 `--kind share --clean` 视为矛盾输入，明确报错而不是二选一。
 */
function readKindOption(args: Args): { ok: true; kind: ExportKind } | { ok: false; message: string } {
  const clean = args.options.clean === true;
  const raw = args.options.kind;
  if (raw === undefined) return { ok: true, kind: clean ? 'clean' : 'share' };
  if (raw === 'share' || raw === 'clean') {
    if (clean && raw === 'share') {
      return { ok: false, message: '--clean 与 --kind share 矛盾：请只给出其一' };
    }
    return { ok: true, kind: raw };
  }
  return { ok: false, message: '--kind 只接受 share | clean' };
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const kindOption = readKindOption(args);
  if (!kindOption.ok) {
    warn(kindOption.message);
    return { exitCode: 1 };
  }
  const outOption = readStringOption(args, 'out', '--out ');
  if (outOption.error) {
    warn(outOption.error);
    return { exitCode: 1 };
  }

  const kind = kindOption.kind;
  const outDir = outOption.value !== undefined ? path.resolve(outOption.value) : path.dirname(ctx.inputPath);
  const target = path.join(
    outDir,
    kind === 'share' ? exportHtmlName(ctx.project.protoName) : cleanHtmlName(ctx.project.protoName),
  );
  const content =
    kind === 'share' ? buildExportHtml(ctx.cleanSource, ctx.project) : buildAnnotatedHtml(ctx.cleanSource, ctx.project);

  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  } catch (error) {
    warn(`写入失败 ${target}：${errorMessage(error)}`);
    return { exitCode: 2 };
  }

  const report: ExportReport = { kind, written: [target] };
  return { exitCode: 0, json: report };
}
