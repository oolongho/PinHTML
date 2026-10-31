/**
 * types.ts —— CLI 命令的共享上下文与返回值契约。
 *
 * 职责：定义入口在加载输入后构造的 CliContext（命令只读消费），以及命令统一返回的
 * CommandResult（退出码 + 可选 JSON / 文本），由 index.ts 决定走哪个输出通道。
 */
import type { Project } from '@/lib/types';

/** 命令执行上下文：由入口读取并清洗输入后构造 */
export interface CliContext {
  /** 输入原型文件的绝对路径 */
  inputPath: string;
  /** 剥离既有注入物后的干净源文本（哈希与再导出均基于它） */
  cleanSource: string;
  /** 已加载或新建的项目数据 */
  project: Project;
  /** 输入原型是否已内嵌 PinHTML 数据（决定能否复用其中的项目） */
  inputEmbedded: boolean;
  /** 回写目标：--anno 给出时即该文件，否则与 input 同目录的 `<stem>.anno.json`（spec R1） */
  writebackPath: string;
}

/** 命令结果：exitCode 决定进程退出码；json / text 至多输出其一 */
export interface CommandResult {
  exitCode: number;
  json?: unknown;
  text?: string;
}
