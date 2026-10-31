/**
 * load-input.ts —— CLI 公共前置：读取输入、识别产物、解析 project 来源与回写目标（spec R1 / DC3）。
 *
 * 职责：
 * - 读 <input> 文本：含 #pinhtml-data 视为已标注产物（stripInjections 得干净源 + 内嵌项目），
 *   否则视为原始原型（干净源即原文，空项目）；
 * - project 来源：① input 内嵌为底 → ② --anno <json> 覆盖（parseProjectJson 校验）
 *   → ③ 同目录旁挂的 <stem>.anno.json → ④ 空项目；
 * - 按命令校验是否允许落到 ④：export / update / delete / check 必须有 ①/②/③；
 * - 解析回写目标：--anno → 该文件本身；否则与 input 同目录的 <stem>.anno.json（node:path 拼装）。
 * 失败一律以返回值表达（exitCode + message），不向顶层抛异常。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseProjectJson } from '@/lib/importer';
import { computeProtoHash, createEmptyProject, stripInjections } from '@/lib/loading';
import { annoJsonName } from '@/lib/naming';
import type { Project } from '@/lib/types';
import type { Args } from './args';
import type { CliContext } from './types';

/** 允许落到 ④ 空项目的命令（即「从零开始标注」） */
const EMPTY_PROJECT_ALLOWED = new Set(['outline', 'resolve', 'list', 'annotate']);

/** 输入是否内嵌 PinHTML 数据；与 loading.ts 的产物识别保持同一形态 */
const EMBEDDED_DATA_RE = /id=["']pinhtml-data["']/;

/** project 来源：① 内嵌 / ② --anno / ③ 同目录旁挂 / ④ 空项目 */
export type ProjectSource = 'embedded' | 'anno' | 'sibling' | 'empty';

/** 装载成功后的结果 */
export interface LoadedInput {
  /** 剥离注入物后的干净源文本（原始原型则等于原文） */
  cleanSource: string;
  /** 按来源优先级选出的项目数据 */
  project: Project;
  /** 输入是否内嵌可复用的项目（损坏的内嵌数据不算） */
  inputEmbedded: boolean;
  /** 项目实际来源（供命令判断「是否有可操作的标注数据」） */
  projectSource: ProjectSource;
  /** 回写目标：--anno 为该文件本身，否则同目录 <stem>.anno.json */
  writebackPath: string;
  /** 使用了旁挂 json 时的提示语（由入口写 stderr，避免「标注从哪来的」变成隐式状态） */
  notice?: string;
}

/** 装载结果：失败携带退出码与可读原因（由入口写 stderr） */
export type LoadInputResult =
  | { ok: true; value: LoadedInput }
  | { ok: false; exitCode: number; message: string };

/** 失败结果构造 */
function fail(exitCode: number, message: string): LoadInputResult {
  return { ok: false, exitCode, message };
}

/** fs 错误的可读描述（不假设具体错误类型） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 是否为「文件不存在」（旁挂 json 缺省是正常状态，其它 fs 错误要报出来） */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * 读取并装载输入文件（spec R1 自动识别输入）。
 * 不抛异常：文件不可读 / --anno 非法均以 exitCode 2 返回，由调用方决定如何提示。
 */
export async function loadInput(
  inputPath: string,
  options: { annoPath?: string } = {},
): Promise<LoadInputResult> {
  let source: string;
  try {
    source = await readFile(inputPath, 'utf8');
  } catch (error) {
    return fail(2, `无法读取输入文件 ${inputPath}：${errorMessage(error)}`);
  }

  // 产物路径：stripInjections 同时给出干净源与内嵌项目（数据损坏时项目为 null）
  const stripped = EMBEDDED_DATA_RE.test(source) ? stripInjections(source) : null;
  const cleanSource = stripped?.cleanSource ?? source;
  const embeddedProject = stripped?.project ?? null;

  // ② --anno：给了就必须可读且通过校验，否则整次调用失败
  let annoProject: Project | null = null;
  if (options.annoPath !== undefined) {
    let annoText: string;
    try {
      annoText = await readFile(options.annoPath, 'utf8');
    } catch (error) {
      return fail(2, `无法读取 --anno 文件 ${options.annoPath}：${errorMessage(error)}`);
    }
    annoProject = parseProjectJson(annoText);
    if (annoProject === null) {
      return fail(2, `--anno 项目 JSON 校验失败：${options.annoPath}`);
    }
  }

  // ③ 同目录旁挂 <stem>.anno.json：只在 ① ② 都没有时生效。
  // 没有它，原始原型永远落在④空项目，第二次 annotate 会覆盖写掉上一次的全部标注（含人工补的）。
  // 存在但损坏 → 直接失败：静默忽略会让后续覆盖写把坏文件变成永久丢失。
  const siblingPath = path.join(path.dirname(inputPath), annoJsonName(path.basename(inputPath)));
  let siblingProject: Project | null = null;
  if (annoProject === null && embeddedProject === null) {
    let siblingText: string | null = null;
    try {
      siblingText = await readFile(siblingPath, 'utf8');
    } catch (error) {
      if (!isNotFound(error)) {
        return fail(2, `无法读取同目录标注 JSON ${siblingPath}：${errorMessage(error)}`);
      }
    }
    if (siblingText !== null) {
      siblingProject = parseProjectJson(siblingText);
      if (siblingProject === null) {
        return fail(2, `同目录标注 JSON 校验失败：${siblingPath}（请修复或删除该文件后重试）`);
      }
    }
  }

  // ② 覆盖 ①（显式指定的 JSON 是调用方的意图）；③ 只作兜底；全无才建空项目
  const projectSource: ProjectSource =
    annoProject !== null
      ? 'anno'
      : embeddedProject !== null
        ? 'embedded'
        : siblingProject !== null
          ? 'sibling'
          : 'empty';

  let project: Project;
  if (annoProject ?? embeddedProject) {
    project = (annoProject ?? embeddedProject) as Project;
  } else if (siblingProject !== null) {
    // protoName / protoHash 以当前输入为准：旁挂 json 定义上是这份原型的标注，
    // 若原型已改版，哈希必须刷新，否则工具内的变更检测会拿旧哈希比对，永远不提示重绑。
    project = {
      ...siblingProject,
      protoName: path.basename(inputPath),
      protoHash: await computeProtoHash(cleanSource),
    };
  } else {
    project = createEmptyProject(path.basename(inputPath), await computeProtoHash(cleanSource));
  }

  const writebackPath =
    options.annoPath !== undefined
      ? options.annoPath
      : path.join(path.dirname(inputPath), annoJsonName(project.protoName));

  return {
    ok: true,
    value: {
      cleanSource,
      project,
      inputEmbedded: embeddedProject !== null,
      projectSource,
      writebackPath,
      ...(projectSource === 'sibling'
        ? { notice: `使用同目录标注数据：${siblingPath}（可用 --anno 指定其它文件）` }
        : {}),
    },
  };
}

/** prepareContext 结果：成功给 ctx，失败给 exitCode 与可读原因 */
export interface PrepareContextResult {
  ctx?: CliContext;
  exitCode?: number;
  /** 失败原因（由入口写 stderr） */
  message?: string;
  /** 成功但需要提醒的事（如同目录旁挂 json 被自动采用；由入口写 stderr） */
  notice?: string;
}

/** 解析 --anno 选项：未给 → 无；给了却缺值 → 用法错误 exit 1 */
function readAnnoOption(args: Args): { annoPath?: string; exitCode?: number; message?: string } {
  const raw = args.options.anno;
  if (raw === undefined) return {};
  if (typeof raw === 'string' && raw.length > 0) return { annoPath: raw };
  return { exitCode: 1, message: '--anno 需要一个 JSON 文件路径' };
}

/**
 * 构造命令上下文（所有命令的公共前置）：
 * 读 input → 解析 project 来源 → 校验该命令是否允许空项目 → 计算回写目标。
 */
export async function prepareContext(command: string, args: Args): Promise<PrepareContextResult> {
  const input = args.input;
  if (input === null || input.length === 0) {
    return { exitCode: 1, message: `缺少输入文件：pinhtml ${command} <input>` };
  }

  const anno = readAnnoOption(args);
  if (anno.exitCode !== undefined) {
    return { exitCode: anno.exitCode, message: anno.message };
  }

  // 路径统一转绝对路径，避免命令在不同 cwd 下读写到不同文件；拼装一律走 node:path
  const inputPath = path.resolve(input);
  const annoPath = anno.annoPath !== undefined ? path.resolve(anno.annoPath) : undefined;

  const loaded = await loadInput(inputPath, { annoPath });
  if (!loaded.ok) {
    return { exitCode: loaded.exitCode, message: loaded.message };
  }

  if (loaded.value.projectSource === 'empty' && !EMPTY_PROJECT_ALLOWED.has(command)) {
    return {
      exitCode: 2,
      message: `没有可操作的标注数据：${command} 需要已标注产物（内嵌 #pinhtml-data）、--anno <json> 或同目录 <stem>.anno.json`,
    };
  }

  return {
    ctx: {
      inputPath,
      cleanSource: loaded.value.cleanSource,
      project: loaded.value.project,
      inputEmbedded: loaded.value.inputEmbedded,
      writebackPath: loaded.value.writebackPath,
    },
    ...(loaded.value.notice !== undefined ? { notice: loaded.value.notice } : {}),
  };
}
