/**
 * outline.test.ts —— `pinhtml outline` 剪枝树单测（spec R2）。
 *
 * 夹具为文件内自建的最小 HTML，不读 test/ 下的真实原型；
 * 直接构造 CliContext 调用 run，不经过 load-input。
 */
import { describe, expect, it } from 'vitest';
import { docPageKey, getSnippet } from '@/lib/dom';
import type { Annotation } from '@/lib/types';
import type { Args } from '../args';
import type { CliContext } from '../types';
import { run, type OutlineJson, type OutlineNode } from '../commands/outline';

/**
 * 最小原型：div#root 下依次为
 * - div.wrap（纯容器，只含 button → 应折叠，button 提升到 root 直下）
 * - p（条件 a：直系文本）
 * - span（内联 display:none → 默认不可见）
 * - div.hero（纯容器，只含 h1 → 折叠，h1 提升）
 * - label（条件 b）> input#name（条件 b + c，落在第 3 层）
 */
const HTML = [
  '<!DOCTYPE html><html><head><title>demo</title></head><body>',
  '<div id="root">',
  '<div class="wrap"><button>保存</button></div>',
  '<p>纯文本段落</p>',
  '<span style="display:none">隐藏文本</span>',
  '<div class="hero"><h1>主标题</h1></div>',
  '<label>名称<input id="name"></label>',
  '</div>',
  '</body></html>',
].join('');

/** 一条最小标注（只用于摘要断言） */
function makeAnno(): Annotation {
  return {
    id: 'a-1',
    anchorId: 'e-1',
    title: '保存按钮缺少禁用态',
    body: '不应出现在 outline 输出里',
    color: 'interaction',
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** 构造上下文（project 手写，避免依赖导入/哈希路径） */
function makeCtx(annotations: Annotation[] = []): CliContext {
  return {
    inputPath: '/tmp/demo.html',
    cleanSource: HTML,
    project: {
      schema: 1,
      protoName: 'demo.html',
      protoHash: 'abcdef1234567890',
      anchorSeq: 0,
      annoSeq: 0,
      anchors: [],
      annotations,
    },
    inputEmbedded: false,
    writebackPath: '/tmp/demo.anno.json',
  };
}

/** 构造 Args */
function makeArgs(options: Record<string, string | boolean> = {}): Args {
  return { command: 'outline', input: 'demo.html', options };
}

/** 跑一次并取出 JSON（断言成功） */
async function outline(options: Record<string, string | boolean> = {}): Promise<OutlineJson> {
  const result = await run(makeArgs(options), makeCtx());
  expect(result.exitCode).toBe(0);
  expect(result.json).toBeDefined();
  return result.json as OutlineJson;
}

/** 展平输出树（前序遍历） */
function flatten(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

describe('outline：剪枝与条件命中', () => {
  it('纯容器折叠，其后代出现在正确的嵌套位置', async () => {
    const json = await outline();
    const nodes = flatten(json.elements);

    // div.wrap 自身不出现在输出里
    expect(nodes.some((node) => node.tag === 'div' && node.selector.endsWith('div.wrap'))).toBe(false);
    // 但其中的 button 被提升到 div#root 的直下，selector 仍是完整路径
    expect(json.elements).toHaveLength(1);
    const root = json.elements[0];
    expect(root.id).toBe('root');
    expect(root.children?.map((node) => node.tag)).toEqual(['button', 'p', 'h1', 'label']);
    const button = root.children?.[0];
    expect(button?.text).toBe('保存');
    expect(button?.selector).toBe('body > div#root > div.wrap > button');
  });

  it('三类保留条件各命中一次：直系文本 / 交互标签 / 带 id', async () => {
    const nodes = flatten((await outline()).elements);
    const byTag = (tag: string) => nodes.filter((node) => node.tag === tag);

    // a：p 只有直系文本
    expect(byTag('p')).toHaveLength(1);
    expect(byTag('p')[0].text).toBe('纯文本段落');

    // b：button 无 id，仅靠标签进入结果
    expect(byTag('button')).toHaveLength(1);
    expect(byTag('button')[0].id).toBeUndefined();

    // c：div#root 靠 id 保留
    expect(nodes[0].tag).toBe('div');
    expect(nodes[0].id).toBe('root');
  });

  it('不可见元素默认剔除，--all 下出现', async () => {
    const hidden = (json: OutlineJson) => flatten(json.elements).find((node) => node.tag === 'span');

    expect(hidden(await outline())).toBeUndefined();
    const all = hidden(await outline({ all: true }));
    expect(all?.text).toBe('隐藏文本');
  });

  it('selector 可被 doc.querySelector 重新找到同一个元素', async () => {
    const doc = new DOMParser().parseFromString(HTML, 'text/html');
    const nodes = flatten((await outline({ all: true })).elements);
    expect(nodes.length).toBeGreaterThan(0);

    for (const node of nodes) {
      expect(doc.querySelectorAll(node.selector)).toHaveLength(1);
      const el = doc.querySelector(node.selector);
      expect(el?.tagName.toLowerCase()).toBe(node.tag);
      expect(getSnippet(el as Element)).toBe(node.text);
    }
  });
});

describe('outline：选项与顶层字段', () => {
  it('--depth 按输出层截断（根为 1）', async () => {
    const shallow = await outline({ depth: '1' });
    expect(shallow.elements).toHaveLength(1);
    expect(shallow.elements[0].children).toBeUndefined();

    const twoLevels = await outline({ depth: '2' });
    const root = twoLevels.elements[0];
    // label 在第 2 层，其 input 在第 3 层被截断
    expect(root.children?.map((node) => node.tag)).toEqual(['button', 'p', 'h1', 'label']);
    expect(flatten(root.children ?? []).some((node) => node.tag === 'input')).toBe(false);
  });

  it('--depth 非正整数 → 用法错误 exit 1', async () => {
    const result = await run(makeArgs({ depth: '0' }), makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.json).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  it('--text 走 text 通道，含缩进树与标注数量汇总', async () => {
    const result = await run(makeArgs({ text: true }), makeCtx([makeAnno()]));
    expect(result.exitCode).toBe(0);
    expect(result.json).toBeUndefined();
    const text = result.text ?? '';
    // 根节点行：div#root · <getSnippet 原样文本（含隐藏后代文本）>
    expect(text.split('\n')[0]).toMatch(/^div#root · /);
    expect(text).toContain('  button · 保存');
    expect(text.trimEnd().endsWith('标注 1 条')).toBe(true);
    expect(text).not.toContain('不应出现在 outline 输出里');
  });

  it('顶层字段与标注摘要（不含 body）', async () => {
    const json = await outline();
    expect(json.proto).toBe('demo.html');
    expect(json.protoHash).toBe('abcdef1234567890');
    // page 与 docPageKey 一致（测试环境文档 URL 由 happy-dom 决定，不硬编码）
    expect(json.page).toBe(docPageKey(new DOMParser().parseFromString(HTML, 'text/html')));
    expect(json.annotations).toEqual([]);

    const withAnno = await run(makeArgs(), makeCtx([makeAnno()]));
    const summary = (withAnno.json as OutlineJson).annotations[0];
    expect(Object.keys(summary).sort()).toEqual(['anchorId', 'color', 'id', 'status', 'title']);
    expect(summary.id).toBe('a-1');
    expect(summary.status).toBe('open');
  });
});
