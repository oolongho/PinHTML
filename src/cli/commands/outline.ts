/**
 * outline.ts —— `pinhtml outline` 命令（spec R2：agent 的眼睛）。
 *
 * 职责：静态解析干净源，把原型压成「剪枝树」——只保留满足任一条件的可见元素
 * （含非空白直系文本 / 交互语义标签 / 带 id），纯容器折叠但后代照常递归，
 * 因此每个节点的 selector 始终是完整路径；同时附上标注摘要（不含 body）。
 * 只读：不写任何文件。
 */
import { buildSelector, docPageKey, getSnippet, isVisible, orderAnnotations } from '@/lib/dom';
import type { Args } from '../args';
import type { CliContext, CommandResult } from '../types';
import { warn } from '../io';

/** 交互 / 语义标签：即便没有直系文本也保留（表单控件、图标等常靠自身表达语义） */
const SEMANTIC_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'img',
  'svg',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'td',
  'th',
  'summary',
  'details',
]);

/** 静态解析下必然不参与渲染的标签（无布局可用时按标签静态排除，避免把脚本/样式正文当内容） */
const NON_RENDERED_TAGS = new Set(['script', 'style', 'template', 'head', 'meta', 'link', 'title', 'base']);

/** 输出节点（spec R2）：children 为空时省略 */
export interface OutlineNode {
  /** 从文档根算起的完整 CSS 路径（buildSelector） */
  selector: string;
  /** 小写标签名 */
  tag: string;
  /** 元素 id（无则省略） */
  id?: string;
  /** getSnippet(el) 原样结果 */
  text: string;
  /** 保留下来的子节点（折叠容器的后代被提升到当前层） */
  children?: OutlineNode[];
}

/** 标注摘要：只带定位与状态，不含 body */
export interface OutlineAnnotationSummary {
  id: string;
  anchorId: string;
  title: string;
  color: string;
  status: string;
}

/** 顶层 JSON 形状（非 --text 时的 stdout 数据） */
export interface OutlineJson {
  proto: string;
  protoHash: string;
  /** docPageKey(doc)：srcdoc / 空 URL 文档为 null */
  page: string | null;
  elements: OutlineNode[];
  annotations: OutlineAnnotationSummary[];
}

/** 遍历参数 */
interface WalkOptions {
  /** --all：取消可见性过滤（a/b/c 条件仍然生效） */
  all: boolean;
  /** 最大输出层数（根元素为 1），Infinity = 不限 */
  maxDepth: number;
  /** 文档是否具备布局信息（决定可见性判定方式） */
  layout: boolean;
}

/**
 * 文档是否具备布局信息：CLI 在 Node + happy-dom 下静态解析，无布局引擎，
 * body 尺寸恒为 0；此时 isVisible 会把所有元素判为不可见，需退化为静态判定。
 */
function hasLayout(doc: Document): boolean {
  const body = doc.body;
  if (!body) return false;
  const rect = body.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/**
 * 静态可见性近似：自身或祖先带 hidden 属性，或内联 style 声明 display:none /
 * visibility:hidden|collapse → 不可见。只读 style 属性（对 SVG 亦成立）；
 * 由 class / 样式表驱动的隐藏无法在无布局环境下判断，属已知近似。
 */
function isHiddenByStyle(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.hasAttribute('hidden')) return true;
    const style = node.getAttribute('style');
    if (style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/i.test(style)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** 元素是否可见：有布局时走 lib 的几何判定，无布局时退化为静态判定 */
function isShown(el: Element, layout: boolean): boolean {
  if (NON_RENDERED_TAGS.has(el.tagName.toLowerCase())) return false;
  return layout ? isVisible(el) : !isHiddenByStyle(el);
}

/** 条件 a：含非空白直系文本节点（不含后代文本，纯容器不应因后代文字而保留） */
function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );
}

/** a / b / c 三类保留条件任一命中 */
function shouldKeep(el: Element): boolean {
  return (
    hasDirectText(el) ||
    SEMANTIC_TAGS.has(el.tagName.toLowerCase()) ||
    (el.getAttribute('id') ?? '') !== ''
  );
}

/**
 * 递归收集节点：容器折叠时把后代提升到当前层（故输出树层数与 DOM 层数解耦）。
 * 深度按**输出树**层级计：根元素为 1，达到 maxDepth 的节点不再有 children。
 * 不可见节点整棵子树跳过（display:none 等隐藏对后代同样生效）。
 */
function collect(el: Element, level: number, options: WalkOptions): OutlineNode[] {
  if (!options.all && !isShown(el, options.layout)) return [];

  const keep = shouldKeep(el);
  // 折叠节点不占输出层，后代仍在当前层；保留节点则后代进入下一层
  const childLevel = keep ? level + 1 : level;
  const children: OutlineNode[] = [];
  if (childLevel <= options.maxDepth) {
    for (const child of Array.from(el.children)) {
      children.push(...collect(child, childLevel, options));
    }
  }

  if (!keep) return children;

  const node: OutlineNode = {
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    text: getSnippet(el),
  };
  const id = el.getAttribute('id');
  if (id) node.id = id;
  if (children.length > 0) node.children = children;
  return [node];
}

/** 人类可读缩进树（--text）：每节点一行 + 末尾标注数量汇总 */
function renderText(elements: OutlineNode[], annotationCount: number): string {
  const lines: string[] = [];
  const walk = (nodes: OutlineNode[], indent: number): void => {
    for (const node of nodes) {
      const id = node.id ? `#${node.id}` : '';
      lines.push(`${'  '.repeat(indent)}${node.tag}${id} · ${node.text}`);
      if (node.children) walk(node.children, indent + 1);
    }
  };
  walk(elements, 0);
  lines.push(`标注 ${annotationCount} 条`);
  return lines.join('\n') + '\n';
}

/** 解析 --depth：缺省不限；非正整数视为用法错误 */
function readDepth(args: Args): { maxDepth: number } | { error: string } {
  const raw = args.options.depth;
  if (raw === undefined) return { maxDepth: Number.POSITIVE_INFINITY };
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
    return { error: '--depth 需要一个正整数' };
  }
  return { maxDepth: Number(raw) };
}

/** 命令入口 */
export async function run(args: Args, ctx: CliContext): Promise<CommandResult> {
  const depth = readDepth(args);
  if ('error' in depth) {
    warn(depth.error);
    return { exitCode: 1 };
  }

  const doc = new DOMParser().parseFromString(ctx.cleanSource, 'text/html');
  const options: WalkOptions = {
    all: args.options.all === true,
    maxDepth: depth.maxDepth,
    layout: hasLayout(doc),
  };
  const elements = Array.from(doc.body?.children ?? []).flatMap((el) => collect(el, 1, options));

  // 标注摘要：按文档顺序（与工具内序号一致），只带定位与状态字段
  const annotations = orderAnnotations(ctx.project.annotations, doc).map((anno) => ({
    id: anno.id,
    anchorId: anno.anchorId,
    title: anno.title,
    color: anno.color,
    status: anno.status,
  }));

  if (args.options.text === true) {
    return { exitCode: 0, text: renderText(elements, annotations.length) };
  }

  const payload: OutlineJson = {
    proto: ctx.project.protoName,
    protoHash: ctx.project.protoHash,
    page: docPageKey(doc),
    elements,
    annotations,
  };
  return { exitCode: 0, json: payload };
}
