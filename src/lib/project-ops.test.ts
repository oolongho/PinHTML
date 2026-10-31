/**
 * project-ops.test.ts —— 纯函数 CRUD 语义单测（spec DC4）
 *
 * 覆盖：id 分配连续性与锚点复用、upsert、updatedAt 刷新、删除默认保留锚点 /
 * 连带删锚点、以及「不改入参」的纯函数性。全部断言落在 project 数据上，不依赖 DOM。
 */
import { describe, expect, it } from 'vitest';
import { addAnnotation, removeAnnotation, updateAnnotation } from './project-ops';
import type { Project } from './types';

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

/** 新建一条标注的输入（selector / snippet 默认指向同一个元素） */
function input(over: Partial<Parameters<typeof addAnnotation>[1]> = {}) {
  return {
    selector: 'body > div.card > button#btn',
    snippet: '保存',
    title: '标题',
    body: '正文',
    color: 'note' as const,
    ...over,
  };
}

describe('addAnnotation', () => {
  it('连续新建 3 条：e-1/e-2/e-3、a-1/a-2/a-3，无跳号', () => {
    let project = makeProject();
    const anchorIds: string[] = [];
    const annotationIds: string[] = [];

    for (const snippet of ['甲', '乙', '丙']) {
      const result = addAnnotation(project, input({ selector: `body > p.${snippet}`, snippet }));
      project = result.project;
      anchorIds.push(result.anchorId);
      annotationIds.push(result.annotationId);
    }

    expect(anchorIds).toEqual(['e-1', 'e-2', 'e-3']);
    expect(annotationIds).toEqual(['a-1', 'a-2', 'a-3']);
    expect(project.anchors.map((a) => a.id)).toEqual(['e-1', 'e-2', 'e-3']);
    expect(project.annotations.map((a) => a.id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(project.anchorSeq).toBe(3);
    expect(project.annoSeq).toBe(3);
  });

  it('同一 selector+snippet 建两条：复用 e-1，标注 a-1/a-2 递增', () => {
    const first = addAnnotation(makeProject(), input({ title: '第一条' }));
    const second = addAnnotation(first.project, input({ title: '第二条' }));

    expect(second.anchorId).toBe('e-1');
    expect(second.annotationId).toBe('a-2');
    expect(second.project.anchors).toHaveLength(1);
    expect(second.project.anchorSeq).toBe(1);
    expect(second.project.annotations.map((a) => a.id)).toEqual(['a-1', 'a-2']);
    expect(second.project.annotations.map((a) => a.anchorId)).toEqual(['e-1', 'e-1']);
  });

  it('传入 anchorId 时复用该锚点并覆盖证据（改绑路径），不推进 anchorSeq', () => {
    const first = addAnnotation(makeProject(), input());
    const rebound = addAnnotation(
      first.project,
      input({ anchorId: 'e-1', selector: 'body > section.box > p', snippet: '说明文字' }),
    );

    expect(rebound.anchorId).toBe('e-1');
    expect(rebound.project.anchors).toHaveLength(1);
    expect(rebound.project.anchorSeq).toBe(1);
    expect(rebound.project.anchors[0].selector).toBe('body > section.box > p');
    expect(rebound.project.anchors[0].snippet).toBe('说明文字');
  });

  it('新建默认 status open、时间戳 ISO 8601；docPath 仅新建锚点时写入', () => {
    const result = addAnnotation(
      makeProject(),
      input({ createdAt: '2026-01-01T00:00:00.000Z', docPath: '/p.html' }),
    );
    const anno = result.project.annotations[0];

    expect(result.state).toBe('fresh');
    expect(anno.status).toBe('open');
    expect(anno.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(anno.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.project.anchors[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.project.anchors[0].docPath).toBe('/p.html');
    // 未传 createdAt 时取当前时间，且是合法 ISO 8601
    const now = addAnnotation(makeProject(), input()).project.annotations[0];
    expect(new Date(now.createdAt).toISOString()).toBe(now.createdAt);
  });

  it('传入已存在的 id 则更新该标注（upsert）：不推进 annoSeq、保留 createdAt / status', () => {
    const first = addAnnotation(
      makeProject(),
      input({ status: 'resolved', createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    const second = addAnnotation(first.project, input({ id: 'a-1', title: '二次' }));

    expect(second.annotationId).toBe('a-1');
    expect(second.project.annoSeq).toBe(1);
    expect(second.project.annotations).toHaveLength(1);
    expect(second.project.annotations[0].title).toBe('二次');
    expect(second.project.annotations[0].status).toBe('resolved');
    expect(second.project.annotations[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(second.project.annotations[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('updateAnnotation', () => {
  it('刷新 updatedAt，其余字段不变', () => {
    const created = addAnnotation(makeProject(), input({ createdAt: '2026-01-01T00:00:00.000Z' }));
    const before = created.project.annotations[0];

    const next = updateAnnotation(created.project, 'a-1', { title: '新标题', status: 'resolved' });
    const after = next.annotations[0];

    expect(after.title).toBe('新标题');
    expect(after.status).toBe('resolved');
    expect(after.body).toBe(before.body);
    expect(after.color).toBe(before.color);
    expect(after.anchorId).toBe(before.anchorId);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(next.anchors).toBe(created.project.anchors);
  });

  it('id 不存在时原样返回（引用相等）且不抛错', () => {
    const project = makeProject();
    expect(() => updateAnnotation(project, 'a-9', { title: 'x' })).not.toThrow();
    expect(updateAnnotation(project, 'a-9', { title: 'x' })).toBe(project);
  });
});

describe('removeAnnotation', () => {
  it('默认只删标注、保留锚点，并返回被删标注', () => {
    const { project } = addAnnotation(makeProject(), input());
    const result = removeAnnotation(project, 'a-1');

    expect(result.removed?.id).toBe('a-1');
    expect(result.project.annotations).toEqual([]);
    expect(result.project.anchors.map((a) => a.id)).toEqual(['e-1']);
    expect(result.project.anchors).toBe(project.anchors);
  });

  it('{ anchor: true } 连带删除锚点；锚点仍被其他标注引用时保留', () => {
    let project = addAnnotation(makeProject(), input({ title: '第一条' })).project;
    project = addAnnotation(project, input({ title: '第二条' })).project;

    // 删 a-1：a-2 仍引用 e-1 → 锚点保留（否则 a-2 的 anchorId 悬空）
    const first = removeAnnotation(project, 'a-1', { anchor: true });
    expect(first.project.anchors).toHaveLength(1);
    expect(first.project.annotations.map((a) => a.id)).toEqual(['a-2']);

    // 删 a-2：已无引用 → 锚点一并删除
    const second = removeAnnotation(first.project, 'a-2', { anchor: true });
    expect(second.project.annotations).toHaveLength(0);
    expect(second.project.anchors).toHaveLength(0);
  });

  it('id 不存在时返回 removed: null 且 project 引用不变', () => {
    const project = makeProject({
      anchorSeq: 1,
      anchors: [{ id: 'e-1', selector: 'body', snippet: '保存', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const result = removeAnnotation(project, 'a-9', { anchor: true });

    expect(result.removed).toBeNull();
    expect(result.project).toBe(project);
    expect(result.project.anchors).toHaveLength(1);
  });
});

describe('纯函数性', () => {
  it('入参 project 及其数组在调用后未被修改', () => {
    const project = makeProject();
    const { anchors, annotations } = project;

    const created = addAnnotation(project, input());
    expect(project.anchorSeq).toBe(0);
    expect(project.annoSeq).toBe(0);
    expect(project.anchors).toBe(anchors);
    expect(project.anchors).toHaveLength(0);
    expect(project.annotations).toBe(annotations);
    expect(project.annotations).toHaveLength(0);
    expect(created.project).not.toBe(project);
    expect(created.project.anchors).not.toBe(anchors);

    const before = created.project.annotations[0];
    updateAnnotation(created.project, 'a-1', { title: '改后' });
    expect(created.project.annotations[0]).toBe(before);
    expect(created.project.annotations[0].title).toBe('标题');

    removeAnnotation(created.project, 'a-1', { anchor: true });
    expect(created.project.annotations).toHaveLength(1);
    expect(created.project.anchors).toHaveLength(1);
  });
});
