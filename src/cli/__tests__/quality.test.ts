/**
 * quality.test.ts —— 可机检质量报告单测（spec R5 / DC11）
 *
 * 五个 warning code 各一条 + byColor / avgBodyLength / maxBodyLength 数值断言；
 * 全部用内存 Project 自建，不依赖文件系统与 test/ 下的真实原型。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation, Project } from '@/lib/types';
import { reviewDraft } from '../quality';

/** 造一条标注（字段顺序与 schema v1 一致） */
function makeAnnotation(id: string, anchorId: string, over: Partial<Annotation> = {}): Annotation {
  return {
    id,
    anchorId,
    title: `标题 ${id}`,
    body: '正文',
    color: 'interaction',
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** 造项目（quality 只读 annotations，锚点留空） */
function makeProject(annotations: Annotation[]): Project {
  return {
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'h',
    anchorSeq: 0,
    annoSeq: annotations.length,
    anchors: [],
    annotations,
  };
}

describe('统计口径：合并后的整个项目', () => {
  it('byColor / avgBodyLength / maxBodyLength 按全量标注计算', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { body: 'x'.repeat(100), color: 'interaction' }),
      makeAnnotation('a-2', 'e-2', { body: 'x'.repeat(300), color: 'visual' }),
      makeAnnotation('a-3', 'e-3', { body: 'x'.repeat(200), color: 'visual' }),
    ]);
    const report = reviewDraft(project);

    expect(report.items).toBe(3);
    expect(report.byColor).toEqual({ interaction: 1, visual: 2, question: 0, note: 0 });
    expect(report.avgBodyLength).toBe(200);
    expect(report.maxBodyLength).toBe(300);
  });

  it('空项目：全 0、无 warning', () => {
    const report = reviewDraft(makeProject([]));
    expect(report).toMatchObject({ items: 0, avgBodyLength: 0, maxBodyLength: 0, warnings: [] });
  });
});

describe('五个 warning code', () => {
  it('TOO_MANY_ITEMS：条数超过 maxItems（默认 15 / 显式传值）', () => {
    const many = makeProject([makeAnnotation('a-1', 'e-1'), makeAnnotation('a-2', 'e-2')]);
    expect(reviewDraft(many, [], { maxItems: 1 }).warnings.map((w) => w.code)).toContain('TOO_MANY_ITEMS');
    expect(reviewDraft(many).warnings.map((w) => w.code)).not.toContain('TOO_MANY_ITEMS');

    const sixteen = makeProject(
      Array.from({ length: 16 }, (_, i) => makeAnnotation(`a-${i + 1}`, `e-${i + 1}`)),
    );
    expect(reviewDraft(sixteen).warnings.map((w) => w.code)).toContain('TOO_MANY_ITEMS');
  });

  it('BODY_TOO_LONG：正文 > 200 字，带草稿 index；恰好 200 字不告警', () => {
    const long = makeProject([makeAnnotation('a-1', 'e-1', { body: 'x'.repeat(201) })]);
    const warnings = reviewDraft(long, [{ index: 2, annotationId: 'a-1' }]).warnings;
    expect(warnings.filter((w) => w.code === 'BODY_TOO_LONG')).toEqual([
      expect.objectContaining({ index: 2, code: 'BODY_TOO_LONG' }),
    ]);

    const boundary = makeProject([makeAnnotation('a-1', 'e-1', { body: 'x'.repeat(200) })]);
    expect(reviewDraft(boundary).warnings.map((w) => w.code)).not.toContain('BODY_TOO_LONG');
  });

  it('EMPTY_TITLE：标题仅空白，带草稿 index', () => {
    const project = makeProject([makeAnnotation('a-1', 'e-1', { title: '   ' })]);
    const warnings = reviewDraft(project, [{ index: 1, annotationId: 'a-1' }]).warnings;
    expect(warnings.filter((w) => w.code === 'EMPTY_TITLE')).toEqual([
      expect.objectContaining({ index: 1, code: 'EMPTY_TITLE' }),
    ]);
  });

  it('DUPLICATE_ANCHOR：同一锚点但标题不同 → 不报（同锚点多条是允许用法）', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1'),
      makeAnnotation('a-2', 'e-1'),
      makeAnnotation('a-3', 'e-1'),
    ]);
    expect(reviewDraft(project).warnings.map((w) => w.code)).not.toContain('DUPLICATE_ANCHOR');
  });

  it('DUPLICATE_ANCHOR：同一锚点同标题 → 报 1 条，带草稿 index', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { title: '按钮不可点击' }),
      makeAnnotation('a-2', 'e-1', { title: '按钮不可点击' }),
    ]);
    const warnings = reviewDraft(project, [
      { index: 0, annotationId: 'a-1' },
      { index: 1, annotationId: 'a-2' },
    ]).warnings.filter((w) => w.code === 'DUPLICATE_ANCHOR');
    expect(warnings).toEqual([expect.objectContaining({ index: 1, code: 'DUPLICATE_ANCHOR' })]);
  });

  it('DUPLICATE_ANCHOR：同锚点三条里两条同标题 → 报 1 条（指向第二条）', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { title: '按钮不可点击' }),
      makeAnnotation('a-2', 'e-1', { title: '按钮不可点击' }),
      makeAnnotation('a-3', 'e-1', { title: '按钮缺少禁用态' }),
    ]);
    const warnings = reviewDraft(project).warnings.filter((w) => w.code === 'DUPLICATE_ANCHOR');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('a-2');
  });

  it('NO_CATEGORY：全部是 note 才告警（含非 note 时不告警）', () => {
    const allNote = makeProject([
      makeAnnotation('a-1', 'e-1', { color: 'note' }),
      makeAnnotation('a-2', 'e-2', { color: 'note' }),
    ]);
    expect(reviewDraft(allNote).warnings.map((w) => w.code)).toContain('NO_CATEGORY');

    const mixed = makeProject([
      makeAnnotation('a-1', 'e-1', { color: 'note' }),
      makeAnnotation('a-2', 'e-2', { color: 'question' }),
    ]);
    expect(reviewDraft(mixed).warnings.map((w) => w.code)).not.toContain('NO_CATEGORY');
  });
});

describe('PROTO_NUMERIC_VALUE：引用原型样式数值', () => {
  it('title 含 20px、body 含 1.5rem 命中；100% / §3.2 / v0.9 不命中', () => {
    const titled = makeProject([makeAnnotation('a-1', 'e-1', { title: '按钮高 20px' })]);
    expect(reviewDraft(titled).warnings.map((w) => w.code)).toContain('PROTO_NUMERIC_VALUE');

    const bodied = makeProject([makeAnnotation('a-1', 'e-1', { body: '间距 1.5rem' })]);
    expect(reviewDraft(bodied).warnings.map((w) => w.code)).toContain('PROTO_NUMERIC_VALUE');

    const ignored = makeProject([
      makeAnnotation('a-1', 'e-1', { body: '占据 100% 宽度' }),
      makeAnnotation('a-2', 'e-2', { body: '见 §3.2' }),
      makeAnnotation('a-3', 'e-3', { body: 'v0.9 版本' }),
    ]);
    expect(reviewDraft(ignored).warnings).toEqual([]);
  });

  it('top/right:-8px 与 min(840px, 100% - 32px) 命中', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { body: 'top/right:-8px' }),
      makeAnnotation('a-2', 'e-2', { body: '宽度 min(840px, 100% - 32px)' }),
    ]);
    expect(
      reviewDraft(project).warnings.filter((w) => w.code === 'PROTO_NUMERIC_VALUE').map((w) => w.index),
    ).toEqual([undefined, undefined]);
  });

  it('同一条 title 和 body 都含数值只报 1 条，带草稿 index', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { title: '高 20px', body: '间距 1.5rem' }),
    ]);
    const warnings = reviewDraft(project, [{ index: 3, annotationId: 'a-1' }]).warnings.filter(
      (w) => w.code === 'PROTO_NUMERIC_VALUE',
    );
    expect(warnings).toEqual([expect.objectContaining({ index: 3, code: 'PROTO_NUMERIC_VALUE' })]);
    expect(warnings[0].message).toContain('20px');
  });
});

describe('TOO_MANY_QUESTIONS：待定问题占比过高', () => {
  it('4 条里 2 条 question 命中（2 > 4/3 且 >= 2）', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { color: 'question' }),
      makeAnnotation('a-2', 'e-2', { color: 'question' }),
      makeAnnotation('a-3', 'e-3', { color: 'interaction' }),
      makeAnnotation('a-4', 'e-4', { color: 'visual' }),
    ]);
    const warnings = reviewDraft(project).warnings.filter((w) => w.code === 'TOO_MANY_QUESTIONS');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].index).toBeUndefined();
  });

  it('6 条里 2 条 question 不命中（2 不大于 2）', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1', { color: 'question' }),
      makeAnnotation('a-2', 'e-2', { color: 'question' }),
      ...Array.from({ length: 4 }, (_, i) => makeAnnotation(`a-${i + 3}`, `e-${i + 3}`)),
    ]);
    expect(reviewDraft(project).warnings.map((w) => w.code)).not.toContain('TOO_MANY_QUESTIONS');
  });

  it('1 条 question 单项不命中（< 2）；空项目不崩、不报', () => {
    const single = makeProject([makeAnnotation('a-1', 'e-1', { color: 'question' })]);
    expect(reviewDraft(single).warnings.map((w) => w.code)).not.toContain('TOO_MANY_QUESTIONS');

    const empty = reviewDraft(makeProject([]));
    expect(empty.items).toBe(0);
    expect(empty.warnings).toEqual([]);
  });
});
