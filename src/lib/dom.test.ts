/**
 * dom.test.ts —— 编号与排序单测（spec R4：图钉序号 = 卡片刻号，固定编号允许跳号）
 */
import { describe, expect, it } from 'vitest';
import {
  docPageKey,
  getSnippet,
  isVisible,
  numberAnnotations,
  orderAnnotations,
  pageKeyFromHref,
} from './dom';
import type { Annotation } from './types';

function makeAnno(id: string, anchorId: string, createdAt = '2026-01-01T00:00:00Z'): Annotation {
  return {
    id,
    anchorId,
    title: `标题-${id}`,
    body: '',
    color: 'note',
    status: 'open',
    createdAt,
    updatedAt: createdAt,
  };
}

/** 三个锚点元素，文档顺序为 e-1 → e-2 → e-3 */
const doc = new DOMParser().parseFromString(
  '<body><div data-anno-id="e-1">甲</div><div data-anno-id="e-2">乙</div><span data-anno-id="e-3">丙</span></body>',
  'text/html',
);

describe('pageKeyFromHref（锚点页面归属，R13）', () => {
  it('真实 URL：取 pathname + search（不含 origin，换端口仍成立）', () => {
    expect(pageKeyFromHref('http://localhost:8000/dir/p1.html?v=2')).toBe('/dir/p1.html?v=2');
    expect(pageKeyFromHref('http://127.0.0.1:9000/dir/p1.html?v=2')).toBe('/dir/p1.html?v=2');
  });

  it('hash 是同文档内路由，不参与页面键', () => {
    expect(pageKeyFromHref('http://localhost:8000/p1.html#colors')).toBe('/p1.html');
  });

  it('about: 文档（srcdoc 文件模式）与空 URL 返回 null（单文档不做分页归属）', () => {
    expect(pageKeyFromHref('about:srcdoc')).toBeNull();
    expect(pageKeyFromHref('about:blank')).toBeNull();
    expect(pageKeyFromHref('')).toBeNull();
  });

  it('docPageKey 对空文档安全', () => {
    expect(docPageKey(null)).toBeNull();
    expect(docPageKey(undefined)).toBeNull();
  });
});

describe('numberAnnotations', () => {
  it('序号按原型文档顺序分配，与传入数组顺序无关', () => {
    const annos = [makeAnno('a-3', 'e-3'), makeAnno('a-1', 'e-1'), makeAnno('a-2', 'e-2')];
    const numbers = numberAnnotations(annos, doc);
    expect(numbers.get('a-1')).toBe(1);
    expect(numbers.get('a-2')).toBe(2);
    expect(numbers.get('a-3')).toBe(3);
  });

  it('固定编号：只展示子集时保留原序号（允许跳号）', () => {
    const annos = [makeAnno('a-1', 'e-1'), makeAnno('a-2', 'e-2'), makeAnno('a-3', 'e-3')];
    const numbers = numberAnnotations(annos, doc);
    // 模拟筛掉 a-2（如按分类筛选）后的展示序号
    const shown = annos.filter((a) => a.id !== 'a-2').map((a) => numbers.get(a.id));
    expect(shown).toEqual([1, 3]);
  });

  it('同一锚点多条标注按 createdAt 升序编号', () => {
    const annos = [
      makeAnno('a-2', 'e-1', '2026-02-01T00:00:00Z'),
      makeAnno('a-1', 'e-1', '2026-01-01T00:00:00Z'),
    ];
    const numbers = numberAnnotations(annos, doc);
    expect(numbers.get('a-1')).toBe(1);
    expect(numbers.get('a-2')).toBe(2);
  });

  it('空列表返回空映射', () => {
    expect(numberAnnotations([], doc).size).toBe(0);
  });
});

describe('orderAnnotations', () => {
  it('失联（找不到锚点元素）的标注排到最后', () => {
    const annos = [makeAnno('a-x', 'e-missing'), makeAnno('a-1', 'e-1')];
    expect(orderAnnotations(annos, doc).map((a) => a.id)).toEqual(['a-1', 'a-x']);
  });
});

describe('getSnippet', () => {
  it('折叠空白并截取前 40 字符', () => {
    const el = new DOMParser().parseFromString(
      `<body><div>  图片   生成\n\n按钮  </div></body>`,
      'text/html',
    ).body.firstElementChild as Element;
    expect(getSnippet(el)).toBe('图片 生成 按钮');
  });

  it('超长文本截断为 40 字符', () => {
    const long = 'a'.repeat(100);
    const el = new DOMParser().parseFromString(`<body><div>${long}</div></body>`, 'text/html').body
      .firstElementChild as Element;
    expect(getSnippet(el)).toHaveLength(40);
  });
});

describe('isVisible', () => {
  it('零尺寸元素判为不可见（spec 勘误：不用 offsetParent）', () => {
    const el = new DOMParser().parseFromString('<body><div>x</div></body>', 'text/html').body
      .firstElementChild as Element;
    // happy-dom 中未布局元素的 getClientRects 为空 / rect 为 0，即不可见
    expect(isVisible(el)).toBe(false);
  });
});
