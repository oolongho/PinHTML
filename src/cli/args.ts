/**
 * args.ts —— CLI 参数解析（无第三方依赖）。
 *
 * 形态：pinhtml <command> <input> [--key value | --key=value | --flag]。
 * 仅做最小解析：前两个位置参数为 command / input；其余 `--x` 进入 options，
 * 无值跟随的记为 true，有值跟随的记为字符串；`-h` 归一为 options.help。
 */

/** 解析结果：command / input 缺省为 null，options 保留 --key 形态 */
export interface Args {
  command: string | null;
  input: string | null;
  options: Record<string, string | boolean>;
}

/** 解析 argv（不含 node 与脚本路径） */
export function parseArgs(argv: string[]): Args {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h') {
      options.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      options[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }

  return {
    command: positional[0] ?? null,
    input: positional[1] ?? null,
    options,
  };
}
