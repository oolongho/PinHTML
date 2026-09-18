/**
 * store.test.ts —— 标注数据状态机单测（spec R2 / R3 / R7 / R9）
 *
 * 覆盖：锚点分配与复用（同一元素不重复建锚点）、编辑期改绑、删除与撤销、
 * 重绑清 stale、筛选、编辑栈撤回、loadProject 整体重置与 dirty 语义。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { filterAnnotations, usePinHTMLStore } from './store';
import { buildSelector, getSnippet } from './dom';
import { DEFAULT_FILTERS } from './types';
import type { Annotation, Project } from './types';

const s = (): ReturnType<typeof usePinHTMLStore.getState> => usePinHTMLStore.getState();

function makeProject(over: Partial<Project> = {}): Project {
  return {
    schema: 1,
    protoName: 'p.html',
    protoHash: 'h',
    anchorSeq: 0,
    annoSeq: 0,
    anchors: [],
    annotations: [],
    ...over,
  };
}

function makeAnno(id: string, anchorId: string, over: Partial<Annotation> = {}): Annotation {
  const iso = '2026-01-01T00:00:00Z';
  return {
    id,
    anchorId,
    title: `标题-${id}`,
    body: '',
    color: 'note',
    status: 'open',
    createdAt: iso,
    updatedAt: iso,
    ...over,
  };
}

/** 原型文档：一个按钮（有 id）与一个段落 */
let doc: Document;
let btn: Element;
let para: Element;

beforeEach(() => {
  doc = new DOMParser().parseFromString(
    '<body><div class="card"><button id="btn">保存</button></div><section class="box"><p>说明文字</p></section></body>',
    'text/html',
  );
  btn = doc.getElementById('btn') as Element;
  para = doc.querySelector('p') as Element;
  s().loadProject(makeProject(), '<html></html>', 'h');
});

describe('commitAnnotation', () => {
  it('新建锚点：分配 e-1 / a-1、写 data-anno-id、清编辑态并置 dirty', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    const result = s().commitAnnotation({ title: '标题', body: '正文', color: 'interaction' });

    expect(result?.anchorId).toBe('e-1');
    expect(result?.annotation.id).toBe('a-1');
    expect(btn.getAttribute('data-anno-id')).toBe('e-1');
    expect(s().project?.anchorSeq).toBe(1);
    expect(s().project?.annoSeq).toBe(1);
    expect(s().project?.anchors[0].selector).toBe('body > div.card > button#btn');
    expect(s().project?.anchors[0].snippet).toBe('保存');
    expect(s().editing).toBeNull();
    expect(s().dirty).toBe(true);
  });

  it('同一元素追加标注：复用锚点，不新增 anchor、不推进 anchorSeq', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().commitAnnotation({ title: '第一条', body: '', color: 'note' });
    // 第二次拾取同一元素（bridge 回传元素携带 data-anno-id → 编辑上下文复用锚点）
    s().beginEdit({ annotationId: null, anchorId: btn.getAttribute('data-anno-id'), element: btn, pickHistory: [] });
    const second = s().commitAnnotation({ title: '第二条', body: '', color: 'visual' });

    expect(second?.anchorId).toBe('e-1');
    expect(s().project?.anchors).toHaveLength(1);
    expect(s().project?.anchorSeq).toBe(1);
    expect(s().project?.annotations).toHaveLength(2);
  });

  it('data-anno-id 丢失时按 selector + snippet 双证据复用锚点（图钉不重复的兜底）', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().commitAnnotation({ title: '第一条', body: '', color: 'note' });
    // 模拟原型重渲染导致属性丢失
    btn.removeAttribute('data-anno-id');

    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    const result = s().commitAnnotation({ title: '第二条', body: '', color: 'note' });

    expect(result?.anchorId).toBe('e-1');
    expect(s().project?.anchors).toHaveLength(1);
    expect(btn.getAttribute('data-anno-id')).toBe('e-1');
  });

  it('编辑期间「上移一层」：锚点改绑父元素，旧元素属性移除', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().commitAnnotation({ title: 'T', body: '', color: 'note' });

    s().beginEdit({ annotationId: 'a-1', anchorId: 'e-1', element: btn, pickHistory: [] });
    s().updateEditElement(para);
    const result = s().commitAnnotation({ title: 'T2', body: '', color: 'note' });

    expect(result?.anchorId).toBe('e-1');
    expect(btn.hasAttribute('data-anno-id')).toBe(false);
    expect(para.getAttribute('data-anno-id')).toBe('e-1');
    expect(s().project?.anchors[0].snippet).toBe('说明文字');
    expect(s().project?.annotations).toHaveLength(1);
    expect(s().project?.annotations[0].title).toBe('T2');
  });

  it('无编辑上下文或无项目时返回 null，不产生变更', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: null, pickHistory: [] });
    expect(s().commitAnnotation({ title: 'T', body: '', color: 'note' })).toBeNull();
    s().cancelEdit();
    expect(s().commitAnnotation({ title: 'T', body: '', color: 'note' })).toBeNull();
    expect(s().dirty).toBe(false);
  });
});

describe('删除与撤销', () => {
  it('removeAnnotation 只删标注、保留锚点；restoreAnnotation 幂等回插', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().commitAnnotation({ title: 'T', body: '', color: 'note' });
    const removed = s().project?.annotations[0] as Annotation;

    s().removeAnnotation(removed.id);
    expect(s().project?.annotations).toHaveLength(0);
    expect(s().project?.anchors).toHaveLength(1);

    s().restoreAnnotation(removed);
    expect(s().project?.annotations.map((a) => a.id)).toEqual([removed.id]);
    s().restoreAnnotation(removed); // 已存在 → 不重复插入
    expect(s().project?.annotations).toHaveLength(1);
  });
});

describe('rebindAnchor', () => {
  it('改绑证据、写 data-anno-id 并从失联集合摘除', () => {
    s().loadProject(
      makeProject({
        anchors: [{ id: 'e-1', selector: 'body > div.card', snippet: '旧片段', createdAt: '2026-01-01T00:00:00Z' }],
        anchorSeq: 1,
      }),
      '<html></html>',
      'h',
    );
    s().setStaleAnchorIds(['e-1']);

    s().rebindAnchor('e-1', para, buildSelector(para), getSnippet(para));

    expect(para.getAttribute('data-anno-id')).toBe('e-1');
    expect(s().project?.anchors[0].snippet).toBe('说明文字');
    expect(s().staleAnchorIds).toEqual([]);
    expect(s().dirty).toBe(true);
  });
});

describe('filterAnnotations', () => {
  const project = makeProject({
    annotations: [
      makeAnno('a-1', 'e-1', { color: 'interaction', status: 'open' }),
      makeAnno('a-2', 'e-2', { color: 'visual', status: 'resolved' }),
    ],
  });

  it('状态筛选 + 分类开关', () => {
    expect(filterAnnotations(project, DEFAULT_FILTERS)).toHaveLength(2);
    expect(filterAnnotations(project, { ...DEFAULT_FILTERS, status: 'open' })).toHaveLength(1);
    expect(
      filterAnnotations(project, {
        ...DEFAULT_FILTERS,
        categories: { ...DEFAULT_FILTERS.categories, interaction: false },
      }),
    ).toHaveLength(1);
  });

  it('project 为 null 时返回空数组', () => {
    expect(filterAnnotations(null, DEFAULT_FILTERS)).toEqual([]);
  });
});

describe('编辑栈撤回', () => {
  it('undoEditElement 弹出栈顶恢复元素，栈空返回 null', () => {
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().updateEditElement(para);

    expect(s().undoEditElement()).toBe(btn);
    expect(s().editing?.element).toBe(btn);
    expect(s().undoEditElement()).toBeNull();
  });
});

describe('loadProject', () => {
  it('整体重置（模式 / 筛选 / 搜索 / 编辑态 / 失联集合 / 结构版本 / dirty）', () => {
    s().setMode('annotate');
    s().setQuery('关键词');
    s().setFilters({ status: 'open' });
    s().beginEdit({ annotationId: null, anchorId: null, element: btn, pickHistory: [] });
    s().setStaleAnchorIds(['e-9']);
    s().setPendingRebind('e-9');
    s().bumpStructure();
    // UI 态变更不置 dirty
    expect(s().dirty).toBe(false);

    s().loadProject(makeProject(), '<html></html>', 'h');

    expect(s().mode).toBe('browse');
    expect(s().query).toBe('');
    expect(s().filters).toEqual(DEFAULT_FILTERS);
    expect(s().editing).toBeNull();
    expect(s().staleAnchorIds).toEqual([]);
    expect(s().pendingRebindAnchorId).toBeNull();
    expect(s().structureVersion).toBe(0);
  });
});

describe('setPendingRebind', () => {
  it('记录 / 清除一次性拾取意图，且不置 dirty', () => {
    s().setPendingRebind('e-1');
    expect(s().pendingRebindAnchorId).toBe('e-1');
    expect(s().dirty).toBe(false);

    s().setPendingRebind(null);
    expect(s().pendingRebindAnchorId).toBeNull();
  });
});