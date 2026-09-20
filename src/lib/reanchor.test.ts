/**
 * reanchor.test.ts —— 三态重锚定单测（spec R7：fresh / moved / stale）
 */
import { describe, expect, it } from 'vitest';
import { reanchorAll, partitionByPage, resolveAnchor } from './reanchor';
import type { Anchor } from './types';

function makeAnchor(id: string, selector: string, snippet: string): Anchor {
  return { id, selector, snippet, createdAt: '2026-01-01T00:00:00Z' };
}

const parse = (body: string): Document =>
  new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');

describe('resolveAnchor', () => {
  it('fresh：data-anno-id 命中 DOM', () => {
    const doc = parse('<div data-anno-id="e-1">图片生成</div>');
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body > div', '图片生成'));
    expect(r.state).toBe('fresh');
    expect(r.element?.getAttribute('data-anno-id')).toBe('e-1');
  });

  it('moved：属性丢失但 selector + snippet 唯一命中', () => {
    const doc = parse('<section><div>图片生成</div></section>');
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body > section > div', '图片生成'));
    expect(r.state).toBe('moved');
    expect(r.element?.textContent).toBe('图片生成');
  });

  it('moved：selector 失效时退回全文档 snippet 唯一匹配', () => {
    const doc = parse('<section><p>提示词区</p></section>');
    // selector 指向一个不存在的路径
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body > aside > p', '提示词区'));
    expect(r.state).toBe('moved');
    expect(r.element?.tagName.toLowerCase()).toBe('p');
  });

  it('stale：snippet 命中多个（无法判定唯一）', () => {
    const doc = parse('<div>重复文案</div><div>重复文案</div>');
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body > p', '重复文案'));
    expect(r.state).toBe('stale');
    expect(r.element).toBeNull();
  });

  it('stale：完全无匹配', () => {
    const doc = parse('<div>其他内容</div>');
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body > p', '已删除的元素'));
    expect(r.state).toBe('stale');
  });

  it('selector 非法（语法错误）时不抛异常，按无果处理', () => {
    const doc = parse('<div>内容</div>');
    const r = resolveAnchor(doc, makeAnchor('e-1', 'body >> [', '内容'));
    expect(r.state).toBe('moved'); // selector 无果 → snippet 唯一匹配到 div
  });
});

describe('reanchorAll', () => {
  it('按三态分组返回', () => {
    const doc = parse(
      '<div data-anno-id="e-1">甲</div><section><div>乙</div></section><div>丙</div><div>丙</div>',
    );
    const anchors = [
      makeAnchor('e-1', 'body > div', '甲'),
      makeAnchor('e-2', 'body > section > div', '乙'),
      makeAnchor('e-3', 'body > p', '丙'),
    ];
    const outcome = reanchorAll(doc, anchors);
    expect(outcome.fresh.map((a) => a.id)).toEqual(['e-1']);
    expect(outcome.moved.map((m) => m.anchor.id)).toEqual(['e-2']);
    expect(outcome.stale.map((a) => a.id)).toEqual(['e-3']);
  });
});

describe('partitionByPage（锚点页面归属，R13）', () => {
  const withPath = (id: string, docPath?: string) => {
    const a = makeAnchor(id, 'body > div', '甲');
    return docPath ? { ...a, docPath } : a;
  };

  it('docKey 为 null（srcdoc 单文档）时全部视为当前页', () => {
    const r = partitionByPage([withPath('e-1', '/p2.html'), withPath('e-2')], null);
    expect(r.onPage.map((a) => a.id)).toEqual(['e-1', 'e-2']);
    expect(r.offPage).toEqual([]);
  });

  it('未记录 docPath 的锚点（老项目 / 文件模式创建）视为当前页，避免集体误判失联', () => {
    const r = partitionByPage([withPath('e-1'), withPath('e-2', '/p1.html')], '/p1.html');
    expect(r.onPage.map((a) => a.id)).toEqual(['e-1', 'e-2']);
    expect(r.offPage).toEqual([]);
  });

  it('docPath 与当前页不同 → 归入其他页（不参与三态判定）', () => {
    const r = partitionByPage(
      [withPath('e-1', '/p1.html'), withPath('e-2', '/p2.html'), withPath('e-3')],
      '/p2.html',
    );
    expect(r.onPage.map((a) => a.id)).toEqual(['e-2', 'e-3']);
    expect(r.offPage.map((a) => a.id)).toEqual(['e-1']);
  });
});
