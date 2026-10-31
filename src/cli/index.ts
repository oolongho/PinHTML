/**
 * index.ts —— CLI 入口：安装 DOM 全局 → 解析参数 → 装载输入与项目 → 分发命令 → 输出结果。
 *
 * 说明：输入的自动识别、project 来源优先级与回写目标统一由 load-input.ts 处理；
 * 入口只负责把上下文交给命令，并按 CommandResult 决定退出码与输出通道。
 * 退出码：0 成功 / 1 用法错误 / 2 输入或数据问题 / 3 --strict 且存在 stale。
 */
import { parseArgs } from './args';
import { COMMANDS } from './commands';
import { prepareContext } from './load-input';
import { installNodeDom } from './node-dom';
import { warn, writeJson, writeText } from './io';
import type { CommandResult } from './types';

const USAGE = `用法: pinhtml <command> <input> [options]

命令:
  outline  <input> [--all] [--depth N] [--text] [--anno <json>]
      输出原型结构树（agent 的眼睛，selector 可直接复用）
  resolve  <input> [--text <s>|--selector <s>] [--limit N] [--anno <json>]
      把线索解析成候选元素（agent 的放大镜）
  list     <input> [--state <fresh|moved|stale>] [--anno <json>]
      列出已有标注及其三态（取 id 的入口）
  annotate <input> --draft <file.json> [--anno <json>] [--out <dir>] [--clean]
           [--max-items N] [--dry-run] [--strict]
      并入标注草稿；默认产出 <stem>.anno.json + <stem>-标注.html
  export   <input> [--anno <json>] [--out <dir>] [--kind <share|clean>] [--clean]
      从已有标注重新产出交付物（只读输入）
  update   <input> --id <a-N> [--title <s>] [--body <s>] [--color <c>] [--status <s>]
      更新一条标注并回写 .anno.json
  delete   <input> (--id <a-N> | --ids a-1,a-2) [--anchor]
      删除标注（默认保留锚点）并回写 .anno.json
  check    <input> [--anno <json>] [--json|--text] [--strict]
      逐锚点三态报告，只报不回写

选项:
  -h, --help  显示帮助

退出码: 0 成功 / 1 用法错误 / 2 输入或数据问题 / 3 --strict 且存在 stale
`;

/** 主流程：返回进程退出码 */
async function main(argv: string[]): Promise<number> {
  installNodeDom();
  const args = parseArgs(argv);

  if (!args.command || args.options.help === true) {
    writeText(USAGE);
    return 0;
  }

  const command = COMMANDS[args.command];
  if (!command) {
    warn(`未知命令: ${args.command}`);
    warn('运行 pinhtml --help 查看用法');
    return 1;
  }

  const prepared = await prepareContext(args.command, args);
  if (!prepared.ctx) {
    if (prepared.message) warn(prepared.message);
    return prepared.exitCode ?? 1;
  }
  if (prepared.notice) warn(prepared.notice);

  const result: CommandResult = await command(args, prepared.ctx);
  if (result.json !== undefined) writeJson(result.json);
  if (result.text !== undefined) writeText(result.text);
  return result.exitCode;
}

process.exitCode = await main(process.argv.slice(2));
