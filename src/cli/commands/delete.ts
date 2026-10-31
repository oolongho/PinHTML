/**
 * delete.ts —— `pinhtml delete` 命令（spec R7）
 *
 * 职责：按 id（单个 `--id` 或批量 `--ids a-1,a-2`）删除标注，把变更后的项目写回
 * `ctx.writebackPath`（--anno 指定的 JSON，或输入同目录的 `<stem>.anno.json`），
 * stdout 输出 `{ removed, missing, written }`，其中 removed 是删除前的标注快照。
 *
 * 边界：
 * - 默认只删标注、保留锚点；`--anchor` 才连带删锚点，且锚点仍被其他标注引用时保留
 *   （语义由 project-ops.removeAnnotation 提供）；
 * - 未命中的 id 收进 missing，不中断其余 id；全部未命中时 exit 2 且不写盘；
 * - `--ids` 优先于 `--id`（两者同时给不报错）；
 * - 原型本体只读：唯一落点是 ctx.writebackPath。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { removeAnnotation } from '@/lib/project-ops';
import type { Annotation, Project } from '@/lib/types';
import type { Args } from '../args';
import { warn } from '../io';
import type { CliContext, CommandResult } from '../types';

/** 命令 stdout 报告 */
export interface DeleteOutput {
  /** 删除前的标注快照（便于人工复核 / 撤销） */
  removed: Annotation[];
  /** 未命中的 id（不中断其余删除） */
  missing: string[];
  /** 实际写盘的文件绝对路径 */
  written: string[];
}

/** fs 错误的可读描述（不假设具体错误类型） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取待删 id 列表的结果：命中给数组，否则给可读原因 */
type IdList = { ids: string[] } | { error: string };

/**
 * 读取待删 id 列表（delete 专用）：`--ids` 优先，按英文逗号 split 并 trim、过滤空串；
 * 否则用 `--id`。两者都没给（或给了却无有效值）→ 用法错误。
 */
function readIds(args: Args): IdList {
  const rawIds = args.options.ids;
  if (rawIds !== undefined) {
    if (typeof rawIds !== 'string') return { error: '--ids 需要一个逗号分隔的标注 id 列表' };
    const ids = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) return { error: '--ids 需要一个逗号分隔的标注 id 列表' };
    return { ids };
  }

  const rawId = args.options.id;
  if (rawId === undefined) return { error: 'delete 需要 --id <annoId> 或 --ids <a-1,a-2>' };
  if (typeof rawId !== 'string' || rawId.length === 0) return { error: '--id 需要一个标注 id' };
  return { ids: [rawId] };
}

/** 写回项目 JSON（父目录递归创建）；调用方负责把异常转成 exit 2 */
async function writeProject(target: string, project: Project): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(project, null, 2) + '\n', 'utf8');
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  // ① 取待删 id 列表
  const idList = readIds(args);
  if ('error' in idList) {
    warn(idList.error);
    return { exitCode: 1 };
  }
  const ids = idList.ids;

  // ② 逐 id 删除并累积；未命中的只记进 missing
  const withAnchor = args.options.anchor === true;
  let project = ctx.project;
  const removed: Annotation[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const result = removeAnnotation(project, id, { anchor: withAnchor });
    if (result.removed === null) {
      missing.push(id);
      continue;
    }
    project = result.project;
    removed.push(result.removed);
  }

  // ③ 全部未命中：不写盘
  if (removed.length === 0) {
    warn(`没有找到可删除的标注：${missing.join(', ')}`);
    return { exitCode: 2 };
  }

  try {
    await writeProject(ctx.writebackPath, project);
  } catch (error) {
    warn(`写入失败 ${ctx.writebackPath}：${errorMessage(error)}`);
    return { exitCode: 2 };
  }

  const report: DeleteOutput = { removed, missing, written: [path.resolve(ctx.writebackPath)] };
  return { exitCode: 0, json: report };
}
