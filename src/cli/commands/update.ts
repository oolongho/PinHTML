/**
 * update.ts —— `pinhtml update` 命令（spec R7）
 *
 * 职责：按 id 修改已有标注的标题 / 正文 / 分类 / 状态，把变更后的项目写回
 * `ctx.writebackPath`（--anno 指定的 JSON，或输入同目录的 `<stem>.anno.json`），
 * stdout 输出 `{ updated, written }`，供外部 agent 直接读取新值。
 *
 * 边界：
 * - 只改标注本身，不动锚点与其余标注（语义由 project-ops.updateAnnotation 提供）；
 * - 至少需要一个可改字段；字段约束与 annotate 一致（title ≤60 / body ≤2000 /
 *   color 四类 / status 二态）；
 * - 空串是合法取值（显式清空），只有「键存在但没跟值」（true）才算用法错误；
 * - 原型本体只读：唯一落点是 ctx.writebackPath。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { updateAnnotation, type UpdateAnnotationPatch } from '@/lib/project-ops';
import type { AnnoStatus, Annotation, Category, Project } from '@/lib/types';
import type { Args } from '../args';
import { warn } from '../io';
import type { CliContext, CommandResult } from '../types';

/** 与 annotate 一致的字段约束 */
const MAX_TITLE_LENGTH = 60;
const MAX_BODY_LENGTH = 2000;

/** 四分类（顺序与 types 保持一致） */
const CATEGORIES: readonly Category[] = ['interaction', 'visual', 'question', 'note'];

/** 标注状态二态 */
const STATUSES: readonly AnnoStatus[] = ['open', 'resolved'];

/** 可改字段 */
const FIELDS = ['title', 'body', 'color', 'status'] as const;
type Field = (typeof FIELDS)[number];

/** 单项读取结果：present = 键存在（含空串）；error = 用法错误 */
interface FieldOption {
  present: boolean;
  value?: string;
  error?: string;
}

/** 命令 stdout 报告 */
export interface UpdateOutput {
  /** 更新后的完整标注对象 */
  updated: Annotation;
  /** 实际写盘的文件绝对路径 */
  written: string[];
}

/** fs 错误的可读描述（不假设具体错误类型） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 分类合法性判定（顺带完成类型收窄） */
function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** 状态合法性判定（顺带完成类型收窄） */
function isStatus(value: string): value is AnnoStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/**
 * 读取可改字段（update 专用）：键不存在 → 未给；值为 true（--title 后没跟值）→ 用法错误；
 * 空串视为给了值（显式清空）。
 */
function readField(args: Args, key: Field): FieldOption {
  const raw = args.options[key];
  if (raw === undefined) return { present: false };
  if (typeof raw !== 'string') return { present: true, error: `--${key} 需要一个值` };
  return { present: true, value: raw };
}

/** 读取 --id 的结果：命中给 id，否则给可读原因 */
type IdOption = { id: string } | { error: string };

/** 读取 --id：必填；true / 空串都算缺值 */
function readId(args: Args): IdOption {
  const raw = args.options.id;
  if (raw === undefined) return { error: 'update 需要 --id <annoId>' };
  if (typeof raw !== 'string' || raw.length === 0) return { error: '--id 需要一个标注 id' };
  return { id: raw };
}

/** 写回项目 JSON（父目录递归创建）；调用方负责把异常转成 exit 2 */
async function writeProject(target: string, project: Project): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(project, null, 2) + '\n', 'utf8');
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  // ① --id 必填
  const idOption = readId(args);
  if ('error' in idOption) {
    warn(idOption.error);
    return { exitCode: 1 };
  }
  const id = idOption.id;

  // ② 至少给一个可改字段
  const fields: Record<Field, FieldOption> = {
    title: readField(args, 'title'),
    body: readField(args, 'body'),
    color: readField(args, 'color'),
    status: readField(args, 'status'),
  };
  for (const key of FIELDS) {
    const field = fields[key];
    if (field.error) {
      warn(field.error);
      return { exitCode: 1 };
    }
  }
  if (!FIELDS.some((key) => fields[key].present)) {
    warn('update 至少需要一个可改字段：--title / --body / --color / --status');
    return { exitCode: 1 };
  }

  // ③ 字段校验（与 annotate 同规则；空串只在 title / body 上合法）
  const patch: UpdateAnnotationPatch = {};
  const title = fields.title;
  const body = fields.body;
  const color = fields.color;
  const status = fields.status;

  if (title.value !== undefined) {
    if (title.value.length > MAX_TITLE_LENGTH) {
      warn(`--title 超过 ${MAX_TITLE_LENGTH} 字`);
      return { exitCode: 1 };
    }
    patch.title = title.value;
  }
  if (body.value !== undefined) {
    if (body.value.length > MAX_BODY_LENGTH) {
      warn(`--body 超过 ${MAX_BODY_LENGTH} 字`);
      return { exitCode: 1 };
    }
    patch.body = body.value;
  }
  if (color.value !== undefined) {
    if (!isCategory(color.value)) {
      warn('--color 只接受 interaction | visual | question | note');
      return { exitCode: 1 };
    }
    patch.color = color.value;
  }
  if (status.value !== undefined) {
    if (!isStatus(status.value)) {
      warn('--status 只接受 open | resolved');
      return { exitCode: 1 };
    }
    patch.status = status.value;
  }

  // ④ 目标标注必须存在（不存在时 updateAnnotation 会静默返回原 project）
  if (!ctx.project.annotations.some((annotation) => annotation.id === id)) {
    warn(`找不到标注 ${id}，先用 pinhtml list 查看可用 id`);
    return { exitCode: 2 };
  }

  // ⑤ 应用补丁并回写（updatedAt 由 project-ops 刷新）
  const project = updateAnnotation(ctx.project, id, patch);
  const updated = project.annotations.find((annotation) => annotation.id === id);
  if (!updated) {
    warn(`更新后找不到标注 ${id}`);
    return { exitCode: 2 };
  }

  try {
    await writeProject(ctx.writebackPath, project);
  } catch (error) {
    warn(`写入失败 ${ctx.writebackPath}：${errorMessage(error)}`);
    return { exitCode: 2 };
  }

  const report: UpdateOutput = { updated, written: [path.resolve(ctx.writebackPath)] };
  return { exitCode: 0, json: report };
}
