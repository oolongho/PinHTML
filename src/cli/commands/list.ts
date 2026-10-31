/**
 * list.ts —— `pinhtml list` 命令（spec R4）。
 *
 * 职责：只读列出项目内的标注，并为每条标注附上其锚点相对当前干净源的三态
 * （fresh / moved / stale）与锚点证据（selector / snippet）。
 * 输出 `{ proto, protoHash, counts, annotations }`；`--state` 只过滤 annotations，
 * counts 始终统计全量。命令不写任何文件；无标注时输出全 0 计数与空数组。
 */
import { orderAnnotations } from '@/lib/dom';
import { resolveAnchor, type ReanchorState } from '@/lib/reanchor';
import type { Annotation } from '@/lib/types';
import type { Args } from '../args';
import { warn } from '../io';
import type { CliContext, CommandResult } from '../types';

/** 带三态与锚点证据的标注（完整 Annotation + 附加字段） */
export interface ListedAnnotation extends Annotation {
  /** 锚点相对当前文档的三态；锚点缺失按 stale 处理 */
  state: ReanchorState;
  /** 锚点的 selector；锚点缺失为空字符串 */
  selector: string;
  /** 锚点的 snippet；锚点缺失为空字符串 */
  snippet: string;
}

/** list 命令的 JSON 输出 */
export interface ListOutput {
  proto: string;
  protoHash: string;
  /** 全量标注的三态计数（不受 --state 过滤影响） */
  counts: Record<ReanchorState, number>;
  annotations: ListedAnnotation[];
}

/** 合法 --state 取值判定（顺带完成类型收窄） */
function isReanchorState(value: string): value is ReanchorState {
  return value === 'fresh' || value === 'moved' || value === 'stale';
}

/** 解析 --state 选项：未给 → 无过滤；给了非法值 → 用法错误 exit 1 */
function readStateOption(args: Args): { state?: ReanchorState; exitCode?: number; message?: string } {
  const raw = args.options.state;
  if (raw === undefined) return {};
  if (typeof raw === 'string' && isReanchorState(raw)) return { state: raw };
  return { exitCode: 1, message: '--state 只接受 fresh | moved | stale' };
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const filter = readStateOption(args);
  if (filter.exitCode !== undefined) {
    if (filter.message) warn(filter.message);
    return { exitCode: filter.exitCode };
  }

  const doc = new DOMParser().parseFromString(ctx.cleanSource, 'text/html');

  // 一个锚点可挂多条标注：先按锚点解析一次，再复用到标注上（缺失锚点按 stale）
  const anchorById = new Map(ctx.project.anchors.map((anchor) => [anchor.id, anchor]));
  const stateByAnchor = new Map<string, ReanchorState>();
  for (const anchor of ctx.project.anchors) {
    stateByAnchor.set(anchor.id, resolveAnchor(doc, anchor).state);
  }

  // 排序复用 lib 的既有规则（文档顺序 + 同锚点 createdAt 升序，失联排末尾）
  const counts: Record<ReanchorState, number> = { fresh: 0, moved: 0, stale: 0 };
  const listed: ListedAnnotation[] = orderAnnotations(ctx.project.annotations, doc).map((annotation) => {
    const anchor = anchorById.get(annotation.anchorId);
    const state = stateByAnchor.get(annotation.anchorId) ?? 'stale';
    counts[state] += 1;
    return {
      ...annotation,
      state,
      selector: anchor?.selector ?? '',
      snippet: anchor?.snippet ?? '',
    };
  });

  const output: ListOutput = {
    proto: ctx.project.protoName,
    protoHash: ctx.project.protoHash,
    counts,
    annotations: filter.state === undefined
      ? listed
      : listed.filter((annotation) => annotation.state === filter.state),
  };

  return { exitCode: 0, json: output };
}
