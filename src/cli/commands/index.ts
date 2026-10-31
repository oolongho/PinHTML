/**
 * commands/index.ts —— 命令表：CLI 名称到实现的唯一映射。
 *
 * 职责：导出 COMMANDS，供入口按 parseArgs 得到的 command 分发；
 * 新增命令只改这里与 commands 目录。
 */
import type { Args } from '../args';
import type { CliContext, CommandResult } from '../types';
import { run as annotate } from './annotate';
import { run as check } from './check';
import { run as deleteRun } from './delete';
import { run as exportRun } from './export';
import { run as list } from './list';
import { run as outline } from './outline';
import { run as resolve } from './resolve';
import { run as update } from './update';

/** 命令名 → 执行函数 */
export const COMMANDS: Record<string, (args: Args, ctx: CliContext) => Promise<CommandResult>> = {
  outline,
  resolve,
  list,
  annotate,
  export: exportRun,
  update,
  delete: deleteRun,
  check,
};
