/**
 * io.ts —— CLI 输出通道集中处：正常结果走 stdout，诊断信息走 stderr。
 *
 * 职责：保证 JSON 输出可被管道解析（单行 + 换行结尾）、文本输出不被额外改动，
 * 且日志类信息不污染 stdout。
 */

/** 诊断 / 警告统一写 stderr，空格连接参数 */
function writeStderr(args: unknown[]): void {
  const line = args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ');
  process.stderr.write(line + '\n');
}

/** 把值序列化为单行 JSON 写到 stdout */
export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

/** 原样写文本到 stdout（调用方自行保证结尾换行） */
export function writeText(text: string): void {
  process.stdout.write(text);
}

/** 普通日志写 stderr */
export function log(...args: unknown[]): void {
  writeStderr(args);
}

/** 警告 / 错误写 stderr */
export function warn(...args: unknown[]): void {
  writeStderr(args);
}
