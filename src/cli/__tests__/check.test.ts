/**
 * check.test.ts —— `pinhtml check` 命令单测（spec R8）。
 *
 * 夹具在本文件内以最小 HTML + 手造 Project 自建；只读性用例落盘到 os.tmpdir()，
 * 用真实的 prepareContext 装载输入与 --anno，验证命令不改任何文件。
 * 不读取 test/ 下的真实原型。
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Annotation, Project } from '@/lib/types';
import type { Args } from '../args';
import { prepareContext } from '../load-input';
import type { CliContext } from '../types';
import { run, type CheckOutput } from '../commands/check';

/** 最小原型：两个 fresh 锚点 + 一段可被 snippet 唯一命中的文字 */
const HTML = `<!DOCTYPE html>
<html><head><title>demo</title></head><body>
  <div data-anno-id="e-1">保存</div>
  <div data-anno-id="e-2">取消</div>
  <section><p>图片生成</p></section>
</body></html>`;

/** 失联哨兵证据（与 annotate 写出的失联锚点同形） */
const SENTINEL_SELECTOR = '[data-anno-id="__unbound__"]';
const SENTINEL_SNIPPET = '\u0000pinhtml-unbound';

/** 造一条标注 */
function makeAnnotation(id: string, anchorId: string, title: string): Annotation {
  return {
    id,
    anchorId,
    title,
    body: `${title}的正文`,
    color: 'note',
    status: 'open',
    createdAt: '2026-01-01T00:00:01Z',
    updatedAt: '2026-01-01T00:00:01Z',
  };
}

/** 全部 fresh 的项目：e-1 挂两条标注，e-2 挂一条 */
function freshProject(): Project {
  return {
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 2,
    annoSeq: 3,
    anchors: [
      { id: 'e-1', selector: 'body > div:nth-of-type(1)', snippet: '保存', createdAt: '2026-01-01T00:00:01Z' },
      { id: 'e-2', selector: 'body > div:nth-of-type(2)', snippet: '取消', createdAt: '2026-01-01T00:00:02Z' },
    ],
    annotations: [
      makeAnnotation('a-1', 'e-1', '保存按钮'),
      makeAnnotation('a-2', 'e-1', '保存说明'),
      makeAnnotation('a-3', 'e-2', '取消按钮'),
    ],
  };
}

/** 追加一条失联锚点（selector / snippet 都不可能命中） */
function withStale(project: Project): Project {
  return {
    ...project,
    anchorSeq: project.anchorSeq + 1,
    annoSeq: project.annoSeq + 1,
    anchors: [
      ...project.anchors,
      { id: 'e-3', selector: SENTINEL_SELECTOR, snippet: SENTINEL_SNIPPET, createdAt: '2026-01-01T00:00:03Z' },
    ],
    annotations: [...project.annotations, makeAnnotation('a-4', 'e-3', '已删元素')],
  };
}

/** 追加一条 moved 锚点（selector 失效，snippet 在文档内唯一） */
function withMoved(project: Project): Project {
  return {
    ...project,
    anchorSeq: project.anchorSeq + 1,
    annoSeq: project.annoSeq + 1,
    anchors: [
      ...project.anchors,
      { id: 'e-4', selector: 'body > main > p', snippet: '图片生成', createdAt: '2026-01-01T00:00:04Z' },
    ],
    annotations: [...project.annotations, makeAnnotation('a-5', 'e-4', '图片生成')],
  };
}

/** 直接构造命令上下文（check 只读 cleanSource 与 project） */
function contextOf(project: Project): CliContext {
  return {
    inputPath: '/tmp/demo.html',
    cleanSource: HTML,
    project,
    inputEmbedded: false,
    writebackPath: '/tmp/demo.anno.json',
  };
}

/** 执行命令并按 JSON 输出断言 */
async function runCheck(
  options: Record<string, string | boolean>,
  ctx: CliContext,
): Promise<{ exitCode: number; result: Awaited<ReturnType<typeof run>> }> {
  const result = await run({ command: 'check', input: '/tmp/demo.html', options }, ctx);
  return { exitCode: result.exitCode, result };
}

describe('run：逐锚点三态与计数', () => {
  it('全部 fresh → counts.stale 为 0、exit 0，annotationIds 按锚点聚合', async () => {
    const { exitCode, result } = await runCheck({}, contextOf(freshProject()));
    expect(exitCode).toBe(0);

    const json = result.json as CheckOutput;
    expect(json.proto).toBe('demo.html');
    expect(json.protoHash).toBe('abcdef1234567890');
    expect(json.counts).toEqual({ fresh: 2, moved: 0, stale: 0 });
    expect(json.anchors).toHaveLength(2);

    const byId = new Map(json.anchors.map((anchor) => [anchor.anchorId, anchor]));
    expect(byId.get('e-1')).toMatchObject({
      state: 'fresh',
      selector: 'body > div:nth-of-type(1)',
      snippet: '保存',
    });
    // 同一锚点挂两条标注 → 数组长度 2（counts 仍按锚点计，不重复计数）
    expect(byId.get('e-1')?.annotationIds).toEqual(['a-1', 'a-2']);
    expect(byId.get('e-2')?.annotationIds).toEqual(['a-3']);
  });

  it('moved 只报告可自动重绑，不算失败（--strict 也 exit 0）', async () => {
    const { exitCode, result } = await runCheck({ strict: true }, contextOf(withMoved(freshProject())));
    expect(exitCode).toBe(0);

    const json = result.json as CheckOutput;
    expect(json.counts).toEqual({ fresh: 2, moved: 1, stale: 0 });
    expect(json.anchors.find((anchor) => anchor.anchorId === 'e-4')?.state).toBe('moved');
  });

  it('存在 stale → 默认 exit 0；--strict → exit 3', async () => {
    const ctx = contextOf(withStale(freshProject()));
    const normal = await runCheck({}, ctx);
    expect(normal.exitCode).toBe(0);
    expect((normal.result.json as CheckOutput).counts).toEqual({ fresh: 2, moved: 0, stale: 1 });

    const strict = await runCheck({ strict: true }, ctx);
    expect(strict.exitCode).toBe(3);
  });
});

describe('run：输出通道', () => {
  it('--text 输出逐行文本与汇总，不输出 JSON', async () => {
    const { exitCode, result } = await runCheck(
      { text: true },
      contextOf(withStale(freshProject())),
    );
    expect(exitCode).toBe(0);
    expect(result.json).toBeUndefined();

    const text = result.text ?? '';
    expect(text).toContain('e-1 fresh a-1,a-2 body > div:nth-of-type(1)');
    expect(text).toContain('e-2 fresh a-3 body > div:nth-of-type(2)');
    expect(text).toContain('e-3 stale a-4 [data-anno-id="__unbound__"]');
    expect(text).toContain('fresh 2 / moved 0 / stale 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('--json 与 --text 同给 → 以 --json 为准，不报错', async () => {
    const { exitCode, result } = await runCheck(
      { json: true, text: true },
      contextOf(freshProject()),
    );
    expect(exitCode).toBe(0);
    expect(result.text).toBeUndefined();
    expect((result.json as CheckOutput).counts).toEqual({ fresh: 2, moved: 0, stale: 0 });
  });
});

describe('run：只读性', () => {
  /** 每个用例一个临时目录 */
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-check-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** 已标注产物：干净原型 + 内嵌 #pinhtml-data */
  function embeddedHtml(project: Project): string {
    return (
      '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
      '<div data-anno-id="e-1">保存</div>' +
      '<div data-anno-id="e-2">取消</div>' +
      '<section><p>图片生成</p></section>' +
      '<script id="pinhtml-data" type="application/json">' +
      JSON.stringify(project) +
      '</' +
      'script>' +
      '</body></html>'
    );
  }

  it('运行前后 input 与 --anno 内容不变，且不生成 <stem>.anno.json', async () => {
    const inputPath = path.join(dir, 'demo.html');
    const annoPath = path.join(dir, 'data.json');
    const inputBefore = embeddedHtml(freshProject());
    const annoBefore = JSON.stringify(withStale(freshProject()), null, 2);
    await writeFile(inputPath, inputBefore, 'utf8');
    await writeFile(annoPath, annoBefore, 'utf8');

    const args: Args = { command: 'check', input: inputPath, options: { anno: annoPath } };
    const prepared = await prepareContext('check', args);
    if (!prepared.ctx) throw new Error(`预期装载成功，实际失败：${prepared.message ?? ''}`);

    const result = await run(args, prepared.ctx);
    expect(result.exitCode).toBe(0);
    expect((result.json as CheckOutput).counts).toEqual({ fresh: 2, moved: 0, stale: 1 });

    // 输入原型与 --anno 均原样保留；同目录没有新增（尤其没有 <stem>.anno.json）
    expect(await readFile(inputPath, 'utf8')).toBe(inputBefore);
    expect(await readFile(annoPath, 'utf8')).toBe(annoBefore);
    expect((await readdir(dir)).sort()).toEqual(['data.json', 'demo.html']);
  });
});
