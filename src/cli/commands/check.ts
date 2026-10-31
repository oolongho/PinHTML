/**
 * check.ts —— `pinhtml check` 命令（spec R8：只读 · 三态报告）。
 *
 * 职责：对项目内每个**锚点**（不是每条标注）用与工具内 / list 完全相同的
 * `resolveAnchor` 证据链判定三态，汇总 counts，并列出锚点证据（selector / snippet）
 * 与该锚点上挂载的标注 id。默认输出 JSON；`--text` 输出逐行人类可读文本。
 *
 * 边界：
 * - **只报不回写**：绝不修改 input 或 `.anno.json`。moved 只报告「可自动重绑」，
 *   不静默写回 data-anno-id / selector（回写属于工具内人工确认路径，reanchor 本身是纯判定）。
 * - `--strict` 仅在存在 stale 时 exit 3；moved 不算失败。
 * - 判定口径与 list.ts 一致：两者都直接消费 `resolveAnchor` 的三态，不另立规则。
 * - 解析失败由入口统一处理，这里假定 `ctx.cleanSource` 可解析（与其它命令一致）。
 */
import { resolveAnchor, type ReanchorState } from '@/lib/reanchor';
import type { Args } from '../args';
import type { CliContext, CommandResult } from '../types';

/** 单个锚点的体检结果 */
export interface CheckedAnchor {
  /** 锚点 id（e-N） */
  anchorId: string;
  /** 相对当前干净源的三态 */
  state: ReanchorState;
  /** 锚点 selector 证据（原样输出，便于人工复核） */
  selector: string;
  /** 锚点 snippet 证据 */
  snippet: string;
  /** 挂在该锚点上的标注 id（可能为空；按项目内 annotations 顺序） */
  annotationIds: string[];
}

/** check 命令的 JSON 输出（counts 按锚点计数） */
export interface CheckOutput {
  proto: string;
  protoHash: string;
  counts: Record<ReanchorState, number>;
  anchors: CheckedAnchor[];
}

/** 人类可读文本（--text）：每锚点一行 + 末尾三态汇总 */
function renderText(output: CheckOutput): string {
  const lines = output.anchors.map((anchor) => {
    const ids = anchor.annotationIds.length > 0 ? anchor.annotationIds.join(',') : '-';
    return `${anchor.anchorId} ${anchor.state} ${ids} ${anchor.selector}`;
  });
  lines.push(
    `fresh ${output.counts.fresh} / moved ${output.counts.moved} / stale ${output.counts.stale}`,
  );
  return lines.join('\n') + '\n';
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const doc = new DOMParser().parseFromString(ctx.cleanSource, 'text/html');

  // 一个锚点可挂多条标注：先建反向索引，再逐锚点复用
  const annotationIdsByAnchor = new Map<string, string[]>();
  for (const annotation of ctx.project.annotations) {
    const ids = annotationIdsByAnchor.get(annotation.anchorId);
    if (ids) ids.push(annotation.id);
    else annotationIdsByAnchor.set(annotation.anchorId, [annotation.id]);
  }

  const counts: Record<ReanchorState, number> = { fresh: 0, moved: 0, stale: 0 };
  const anchors: CheckedAnchor[] = ctx.project.anchors.map((anchor) => {
    const { state } = resolveAnchor(doc, anchor);
    counts[state] += 1;
    return {
      anchorId: anchor.id,
      state,
      selector: anchor.selector,
      snippet: anchor.snippet,
      annotationIds: annotationIdsByAnchor.get(anchor.id) ?? [],
    };
  });

  const output: CheckOutput = {
    proto: ctx.project.protoName,
    protoHash: ctx.project.protoHash,
    counts,
    anchors,
  };

  // 退出码与输出形态无关：--strict 只看是否存在 stale（moved 不算失败）
  const exitCode = args.options.strict === true && counts.stale > 0 ? 3 : 0;

  // 默认 JSON；两个旗标同给时以 --json 为准（不报错）
  const wantText = args.options.text === true && args.options.json === undefined;
  if (wantText) {
    return { exitCode, text: renderText(output) };
  }

  return { exitCode, json: output };
}
