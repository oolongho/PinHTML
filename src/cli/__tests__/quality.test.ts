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

  it('DUPLICATE_ANCHOR：同一锚点第二条及以后各一条，带草稿 index', () => {
    const project = makeProject([
      makeAnnotation('a-1', 'e-1'),
      makeAnnotation('a-2', 'e-1'),
      makeAnnotation('a-3', 'e-1'),
    ]);
    const warnings = reviewDraft(project, [
      { index: 0, annotationId: 'a-1' },
      { index: 1, annotationId: 'a-2' },
      { index: 2, annotationId: 'a-3' },
    ]).warnings.filter((w) => w.code === 'DUPLICATE_ANCHOR');
    expect(warnings.map((w) => w.index)).toEqual([1, 2]);
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
