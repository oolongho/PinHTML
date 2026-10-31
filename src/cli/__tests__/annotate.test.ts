/**
 * annotate.test.ts —— `pinhtml annotate` 命令单测（spec R5 / DC2 / DC5 / DC6 / DC7 / DC10）
 *
 * 夹具：最小 HTML 写入 os.tmpdir()，CliContext 以真实临时 inputPath 构造（覆盖写盘与
 * 「原型只读」断言）；不读取 test/ 下的真实原型。每个用例结束递归清理临时目录。
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stripInjections } from '@/lib/loading';
import type { Project } from '@/lib/types';
import { run, type AnnotateReport } from '../commands/annotate';
import type { CliContext } from '../types';

/** 最小原型：两个按钮，可唯一命中 / 可制造失联 */
const HTML =
  '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
  '<div id="card"><button id="save">保存</button><button id="cancel">取消</button></div>' +
  '</body></html>';

/** buildSelector 对该按钮的结果（与 outline 输出同口径） */
const SAVE_SELECTOR = 'body > div#card > button#save';

/** 临时目录与输入原型 */
let dir: string;
let inputPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-annotate-'));
  inputPath = path.join(dir, 'demo.html');
  await writeFile(inputPath, HTML, 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 空项目（原始原型输入时 loadInput 的产物形状） */
function emptyProject(): Project {
  return {
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 0,
    annoSeq: 0,
    anchors: [],
    annotations: [],
  };
}

/** 构造命令上下文：默认空项目，可换成已落盘的项目（模拟第二次运行） */
function contextOf(project: Project = emptyProject()): CliContext {
  return {
    inputPath,
    cleanSource: HTML,
    project,
    inputEmbedded: false,
    writebackPath: path.join(dir, 'demo.anno.json'),
  };
}

/** 写草稿文件并返回路径 */
async function writeDraft(items: unknown[], name = 'draft.json'): Promise<string> {
  const draftPath = path.join(dir, name);
  await writeFile(draftPath, JSON.stringify({ proto: 'demo.html', items }, null, 2), 'utf8');
  return draftPath;
}

/** 执行命令 */
async function runAnnotate(
  options: Record<string, string | boolean>,
  ctx: CliContext = contextOf(),
): Promise<{ exitCode: number; report: AnnotateReport }> {
  const result = await run({ command: 'annotate', input: inputPath, options }, ctx);
  return { exitCode: result.exitCode, report: result.json as AnnotateReport };
}

/** 读回落盘的项目 JSON */
async function readSavedProject(fileName = 'demo.anno.json'): Promise<Project> {
  return JSON.parse(await readFile(path.join(dir, fileName), 'utf8')) as Project;
}

/** 一条能唯一命中的草稿项 */
function hitItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clue: { selector: SAVE_SELECTOR, text: '保存' },
    title: '保存前先校验',
    body: '未通过校验时按钮不提交',
    color: 'interaction',
    ...over,
  };
}

describe('逐条应用：唯一命中与失联兜底', () => {
  it('唯一命中 → 写真实 selector/snippet，state fresh，默认产出两份', async () => {
    const draft = await writeDraft([hitItem({ source: 'PRD §3.2' })]);
    const { exitCode, report } = await runAnnotate({ draft });

    expect(exitCode).toBe(0);
    expect(report.applied).toEqual([
      { index: 0, annotationId: 'a-1', anchorId: 'e-1', state: 'fresh' },
    ]);
    expect(report.skipped).toEqual([]);
    expect(report.counts).toEqual({ fresh: 1, moved: 0, stale: 0 });
    expect(report.written).toEqual([
      path.join(dir, 'demo.anno.json'),
      path.join(dir, 'demo-标注.html'),
    ]);
    expect(report.quality).toMatchObject({ items: 1, byColor: { interaction: 1 } });

    const saved = await readSavedProject();
    expect(saved.anchors[0]).toMatchObject({ id: 'e-1', selector: SAVE_SELECTOR, snippet: '保存' });
    expect(saved.annotations[0]).toMatchObject({ id: 'a-1', source: 'PRD §3.2', color: 'interaction' });
  });

  it('线索写错 → 写哨兵证据、state stale、exit 0；加 --strict → exit 3', async () => {
    const draft = await writeDraft([
      hitItem({ clue: { selector: 'body > div#card > button#missing', text: '不存在的文案' } }),
    ]);
    const { exitCode, report } = await runAnnotate({ draft });

    expect(exitCode).toBe(0);
    expect(report.applied).toEqual([
      { index: 0, annotationId: 'a-1', anchorId: 'e-1', state: 'stale' },
    ]);
    expect(report.counts).toEqual({ fresh: 0, moved: 0, stale: 1 });

    const saved = await readSavedProject();
    expect(saved.anchors[0].selector).toBe('[data-anno-id="__unbound__"]');
    expect(saved.anchors[0].snippet).toBe('\u0000pinhtml-unbound');

    const strict = await runAnnotate({ draft, strict: true });
    expect(strict.exitCode).toBe(3);
  });

  it('带 id 且已存在 → 更新原标注而非新增，锚点不动，总数不变', async () => {
    const first = await writeDraft([hitItem()], 'draft-1.json');
    const { report: firstReport } = await runAnnotate({ draft: first });
    expect(firstReport.counts).toEqual({ fresh: 1, moved: 0, stale: 0 });

    const savedOnce = await readSavedProject();
    const second = await writeDraft(
      [hitItem({ id: 'a-1', title: '二次改写', body: '改后的正文', color: 'visual' })],
      'draft-2.json',
    );
    const { exitCode, report } = await runAnnotate({ draft: second }, contextOf(savedOnce));

    expect(exitCode).toBe(0);
    expect(report.applied).toEqual([
      { index: 0, annotationId: 'a-1', anchorId: 'e-1', state: 'moved' },
    ]);

    const saved = await readSavedProject();
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annoSeq).toBe(1);
    expect(saved.annotations[0]).toMatchObject({ title: '二次改写', body: '改后的正文', color: 'visual' });
    // 锚点不动：证据仍是第一次写入的真实 selector / snippet
    expect(saved.anchors).toHaveLength(1);
    expect(saved.anchors[0]).toMatchObject({ selector: SAVE_SELECTOR, snippet: '保存' });
  });

  it('一条校验失败 → 只进 skipped，其余照常处理', async () => {
    const draft = await writeDraft([
      hitItem({ body: 'x'.repeat(2001) }),
      hitItem({ clue: { selector: 'body > div#card > button#cancel', text: '取消' }, title: '取消可回退' }),
      hitItem({ title: 'x'.repeat(61) }),
    ]);
    const { exitCode, report } = await runAnnotate({ draft });

    expect(exitCode).toBe(0);
    expect(report.skipped).toEqual([
      { index: 0, reason: 'body 超过 2000 字' },
      { index: 2, reason: 'title 超过 60 字' },
    ]);
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0]).toMatchObject({ index: 1, state: 'fresh' });

    const saved = await readSavedProject();
    expect(saved.annotations.map((a) => a.title)).toEqual(['取消可回退']);
  });
});

describe('--dry-run 与产出文件', () => {
  it('--dry-run → written 为空数组，目录里不新增任何文件', async () => {
    const draft = await writeDraft([hitItem()]);
    const before = (await readdir(dir)).sort();

    const { exitCode, report } = await runAnnotate({ draft, 'dry-run': true });

    expect(exitCode).toBe(0);
    expect(report.written).toEqual([]);
    expect(report.counts).toEqual({ fresh: 1, moved: 0, stale: 0 });
    expect((await readdir(dir)).sort()).toEqual(before);
  });

  it('--clean 多写一份 .annotated.html，且不含 #pinhtml-style / #pinhtml-runtime', async () => {
    const draft = await writeDraft([hitItem()]);
    const { report } = await runAnnotate({ draft, clean: true });

    expect(report.written).toEqual([
      path.join(dir, 'demo.anno.json'),
      path.join(dir, 'demo-标注.html'),
      path.join(dir, 'demo.annotated.html'),
    ]);

    const share = await readFile(path.join(dir, 'demo-标注.html'), 'utf8');
    expect(share).toContain('pinhtml-runtime');
    expect(share).toContain('pinhtml-style');

    const clean = await readFile(path.join(dir, 'demo.annotated.html'), 'utf8');
    expect(clean).toContain('id="pinhtml-data"');
    expect(clean).not.toContain('pinhtml-style');
    expect(clean).not.toContain('pinhtml-runtime');
    expect(clean).toContain('data-anno-id="e-1"');
  });

  it('默认产出的 -标注.html 可被 stripInjections 还原成同一项目，并保留 data-anno-id', async () => {
    const draft = await writeDraft([hitItem()]);
    await runAnnotate({ draft });

    const saved = await readSavedProject();
    const share = await readFile(path.join(dir, 'demo-标注.html'), 'utf8');
    const stripped = stripInjections(share);

    expect(stripped.project).toEqual(saved);
    expect(stripped.cleanSource).toContain('data-anno-id="e-1"');
    // 运行时已剥离，干净源与原始原型同形（属性回放除外）
    expect(stripped.cleanSource).not.toContain('pinhtml-runtime');
  });

  it('执行后原原型文件内容与 mtime 不变（DC10）', async () => {
    const draft = await writeDraft([hitItem(), hitItem({ clue: {}, title: '无线索' })]);
    const before = await stat(inputPath);
    const beforeText = await readFile(inputPath, 'utf8');

    await runAnnotate({ draft, clean: true });

    const after = await stat(inputPath);
    expect(await readFile(inputPath, 'utf8')).toBe(beforeText);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
