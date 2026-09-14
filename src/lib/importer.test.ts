/**
 * importer.test.ts —— 导入解析与按 id 合并单测（spec R8 / D3：并集、冲突导入优先）
 */
import { describe, expect, it } from 'vitest';
import { mergeProjects, parseProjectJson } from './importer';
import type { Annotation, Project } from './types';

function anno(id: string, anchorId: string, title: string, createdAt = '2026-01-01T00:00:00Z'): Annotation {
  return {
    id,
    anchorId,
    title,
    body: '',
    color: 'note',
    status: 'open',
    createdAt,
    updatedAt: createdAt,
  };
}

function project(patch: Partial<Project> = {}): Project {
  return {
    schema: 1,
    protoName: 'p.html',
    protoHash: 'hash-1',
    anchorSeq: 1,
    annoSeq: 1,
    anchors: [{ id: 'e-1', selector: 'body > div', snippet: '甲', createdAt: 'x' }],
    annotations: [anno('a-1', 'e-1', '当前版本')],
    ...patch,
  };
}

describe('parseProjectJson', () => {
  it('非法 JSON 返回 null', () => {
    expect(parseProjectJson('{oops')).toBeNull();
  });

  it('schema 不符或缺少数组字段返回 null', () => {
    expect(parseProjectJson('{"schema":2,"anchors":[],"annotations":[]}')).toBeNull();
    expect(parseProjectJson('{"schema":1,"annotations":[]}')).toBeNull();
  });

  it('合法项目 JSON 返回对象', () => {
    expect(parseProjectJson(JSON.stringify(project()))?.protoName).toBe('p.html');
  });
});

describe('mergeProjects', () => {
  it('并集：两侧独有标注都保留', () => {
    const current = project();
    const imported = project({
      protoName: 'p.html',
      anchorSeq: 2,
      annoSeq: 2,
      anchors: [...project().anchors, { id: 'e-2', selector: 'body > span', snippet: '乙', createdAt: 'x' }],
      annotations: [...project().annotations, anno('a-2', 'e-2', '导入新增')],
    });
    const merged = mergeProjects(current, imported);
    expect(merged.annotations.map((a) => a.id).sort()).toEqual(['a-1', 'a-2']);
    expect(merged.anchors.map((a) => a.id).sort()).toEqual(['e-1', 'e-2']);
  });

  it('id 冲突时以导入文件为准', () => {
    const imported = project({ annotations: [anno('a-1', 'e-1', '导入覆盖版本')] });
    const merged = mergeProjects(project(), imported);
    expect(merged.annotations).toHaveLength(1);
    expect(merged.annotations[0].title).toBe('导入覆盖版本');
  });

  it('序列号取两侧较大值，避免后续编号重复', () => {
    const merged = mergeProjects(project({ anchorSeq: 3, annoSeq: 5 }), project({ anchorSeq: 7, annoSeq: 2 }));
    expect(merged.anchorSeq).toBe(7);
    expect(merged.annoSeq).toBe(5);
  });

  it('分类自定义显示名一并合并（导入优先）', () => {
    const current = project({ categoryLabels: { interaction: 'A', note: '本侧' } });
    const imported = project({ categoryLabels: { note: '导入侧' } });
    const merged = mergeProjects(current, imported);
    expect(merged.categoryLabels).toEqual({ interaction: 'A', note: '导入侧' });
  });
});
