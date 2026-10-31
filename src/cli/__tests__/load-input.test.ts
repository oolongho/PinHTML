/**
 * load-input.test.ts —— CLI 输入识别与 project 来源解析单测（spec R1 / DC3）。
 *
 * 夹具一律在本文件内以最小 HTML 字符串自建并写入临时目录，
 * 不依赖 test/ 下的真实原型；每个用例结束清理临时目录。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeProtoHash } from '@/lib/loading';
import type { Args } from '../args';
import { loadInput, prepareContext, type LoadInputResult } from '../load-input';

/** 原始原型（无任何 PinHTML 注入物） */
const RAW_HTML =
  '<!DOCTYPE html><html><head><title>demo</title></head>' +
  '<body><div class="card">普通原型</div></body></html>';

/** 一份合法项目 JSON，用于 --anno 与内嵌数据 */
function projectJson(title: string): string {
  return JSON.stringify({
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 1,
    annoSeq: 1,
    anchors: [{ id: 'e-1', selector: 'body > div', snippet: '甲', createdAt: '2026-01-01T00:00:00Z' }],
    annotations: [
      {
        id: 'a-1',
        anchorId: 'e-1',
        title,
        body: '正文',
        color: 'note',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  });
}

/** 已标注产物：干净原型 + #pinhtml-data（最小注入形态） */
function embeddedHtml(title: string): string {
  return (
    '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
    '<div data-anno-id="e-1">甲</div>' +
    '<script id="pinhtml-data" type="application/json">' +
    projectJson(title) +
    '</' +
    'script>' +
    '</body></html>'
  );
}

/** 每个用例一个临时目录；afterEach 统一清理 */
const tempDirs: string[] = [];

/** 把文本写入临时目录中的文件，返回绝对路径 */
async function writeFixture(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-cli-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

/** 新建一个临时目录（用于把原型与旁挂 json 放在同一目录） */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-cli-'));
  tempDirs.push(dir);
  return dir;
}

/** 在指定临时目录中写入文件，返回绝对路径 */
async function writeIn(dir: string, name: string, content: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 断言成功并取出装载结果 */
function unwrap(result: LoadInputResult) {
  if (!result.ok) throw new Error(`预期成功，实际失败：${result.message}`);
  return result.value;
}

/** 断言失败并取出错误信息 */
function unwrapFailure(result: LoadInputResult) {
  if (result.ok) throw new Error('预期失败，实际成功');
  return result;
}

/** 构造 Args（prepareContext 只读 input / options） */
function argsOf(input: string | null, options: Record<string, string | boolean> = {}): Args {
  return { command: 'outline', input, options };
}

describe('loadInput：输入自动识别', () => {
  it('原始原型 → inputEmbedded 为 false，project 为空项目', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const value = unwrap(await loadInput(file));
    expect(value.inputEmbedded).toBe(false);
    expect(value.projectSource).toBe('empty');
    expect(value.project.protoName).toBe('raw.html');
    expect(value.project.anchorSeq).toBe(0);
    expect(value.project.annoSeq).toBe(0);
    expect(value.project.anchors).toEqual([]);
    expect(value.project.annotations).toEqual([]);
    expect(value.project.protoHash).toMatch(/^[0-9a-f]{16}$/);
    expect(value.cleanSource).toBe(RAW_HTML);
  });

  it('已标注产物 → inputEmbedded 为 true，且能取到内嵌标注', async () => {
    const file = await writeFixture('artifact.html', embeddedHtml('内嵌标题'));
    const value = unwrap(await loadInput(file));
    expect(value.inputEmbedded).toBe(true);
    expect(value.projectSource).toBe('embedded');
    expect(value.project.annotations).toHaveLength(1);
    expect(value.project.annotations[0]?.title).toBe('内嵌标题');
    // 干净源已剥掉注入物
    expect(value.cleanSource).not.toContain('pinhtml-data');
    expect(value.cleanSource).toContain('data-anno-id="e-1"');
  });

  it('两种输入的 project 字段集合一致（下游 JSON 形状一致）', async () => {
    const raw = unwrap(await loadInput(await writeFixture('raw.html', RAW_HTML)));
    const artifact = unwrap(await loadInput(await writeFixture('artifact.html', embeddedHtml('内嵌标题'))));
    expect(Object.keys(artifact.project).sort()).toEqual(Object.keys(raw.project).sort());
  });

  it('输入文件不存在 → exit 2 且不抛异常', async () => {
    const dir = path.dirname(await writeFixture('raw.html', RAW_HTML));
    const result = unwrapFailure(await loadInput(path.join(dir, 'missing.html')));
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('无法读取输入文件');
  });
});

describe('loadInput：--anno 与 project 来源优先级', () => {
  it('--anno 非法 JSON → exit 2', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const anno = await writeFixture('bad.anno.json', '{oops');
    const result = unwrapFailure(await loadInput(file, { annoPath: anno }));
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('校验失败');
  });

  it('--anno 合法 → project 来自该 JSON', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const anno = await writeFixture('p.anno.json', projectJson('来自 --anno'));
    const value = unwrap(await loadInput(file, { annoPath: anno }));
    expect(value.projectSource).toBe('anno');
    expect(value.project.annotations[0]?.title).toBe('来自 --anno');
    expect(value.inputEmbedded).toBe(false);
  });

  it('② --anno 覆盖 ① 内嵌项目', async () => {
    const file = await writeFixture('artifact.html', embeddedHtml('内嵌标题'));
    const anno = await writeFixture('p.anno.json', projectJson('来自 --anno'));
    const value = unwrap(await loadInput(file, { annoPath: anno }));
    expect(value.projectSource).toBe('anno');
    expect(value.project.annotations[0]?.title).toBe('来自 --anno');
    // 输入本身仍是产物
    expect(value.inputEmbedded).toBe(true);
  });

  it('--anno 文件不存在 → exit 2', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const dir = path.dirname(file);
    const result = unwrapFailure(await loadInput(file, { annoPath: path.join(dir, 'missing.anno.json') }));
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('无法读取 --anno 文件');
  });
});

describe('loadInput：同目录旁挂 .anno.json', () => {
  it('原始原型 + 同目录 <stem>.anno.json → 来源为 sibling，protoName/protoHash 以输入为准', async () => {
    const dir = await makeTempDir();
    const file = await writeIn(dir, 'demo.html', RAW_HTML);
    const sibling = await writeIn(dir, 'demo.anno.json', projectJson('来自旁挂'));
    const value = unwrap(await loadInput(file));
    expect(value.projectSource).toBe('sibling');
    expect(value.inputEmbedded).toBe(false);
    expect(value.project.annotations[0]?.title).toBe('来自旁挂');
    expect(value.project.protoName).toBe('demo.html');
    expect(value.project.protoHash).toBe(await computeProtoHash(RAW_HTML));
    expect(value.notice).toContain('使用同目录标注数据');
    expect(value.notice).toContain(sibling);
  });

  it('③ 显式 --anno 与旁挂并存 → 取 --anno 那份且没有 notice', async () => {
    const dir = await makeTempDir();
    const file = await writeIn(dir, 'demo.html', RAW_HTML);
    await writeIn(dir, 'demo.anno.json', projectJson('来自旁挂'));
    const anno = await writeIn(dir, 'p.anno.json', projectJson('来自 --anno'));
    const value = unwrap(await loadInput(file, { annoPath: anno }));
    expect(value.projectSource).toBe('anno');
    expect(value.project.annotations[0]?.title).toBe('来自 --anno');
    expect(value.notice).toBeUndefined();
  });

  it('旁挂 json 内容非法 → exit 2', async () => {
    const dir = await makeTempDir();
    const file = await writeIn(dir, 'demo.html', RAW_HTML);
    await writeIn(dir, 'demo.anno.json', '{');
    const result = unwrapFailure(await loadInput(file));
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('同目录标注 JSON 校验失败');
  });

  it('① 内嵌 #pinhtml-data 与旁挂并存 → 内嵌优先，来源为 embedded', async () => {
    const dir = await makeTempDir();
    const file = await writeIn(dir, 'artifact.html', embeddedHtml('内嵌标题'));
    await writeIn(dir, 'artifact.anno.json', projectJson('来自旁挂'));
    const value = unwrap(await loadInput(file));
    expect(value.projectSource).toBe('embedded');
    expect(value.project.annotations[0]?.title).toBe('内嵌标题');
    expect(value.notice).toBeUndefined();
  });

  it('同目录没有 <stem>.anno.json → 来源仍为 empty', async () => {
    const dir = await makeTempDir();
    const file = await writeIn(dir, 'demo.html', RAW_HTML);
    await writeIn(dir, 'other.anno.json', projectJson('不是这份原型的'));
    const value = unwrap(await loadInput(file));
    expect(value.projectSource).toBe('empty');
    expect(value.project.annotations).toEqual([]);
    expect(value.notice).toBeUndefined();
  });
});

describe('prepareContext：空项目判定与回写目标', () => {
  it('check 在 ①/② 皆无时 → exit 2 并说明没有可操作的标注数据', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const result = await prepareContext('check', argsOf(file));
    expect(result.ctx).toBeUndefined();
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('没有可操作的标注数据');
  });

  it('outline 在 ①/② 皆无时 → 以空项目继续', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const result = await prepareContext('outline', argsOf(file));
    expect(result.exitCode).toBeUndefined();
    expect(result.ctx?.project.annotations).toEqual([]);
    expect(result.ctx?.project.protoName).toBe('raw.html');
  });

  it('export 接受已标注产物（① 可用）', async () => {
    const file = await writeFixture('artifact.html', embeddedHtml('内嵌标题'));
    const result = await prepareContext('export', argsOf(file));
    expect(result.exitCode).toBeUndefined();
    expect(result.ctx?.inputEmbedded).toBe(true);
    expect(result.ctx?.project.annotations).toHaveLength(1);
  });

  it('export 接受 --anno（② 可用）', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const anno = await writeFixture('p.anno.json', projectJson('来自 --anno'));
    const result = await prepareContext('export', argsOf(file, { anno }));
    expect(result.exitCode).toBeUndefined();
    expect(result.ctx?.project.annotations[0]?.title).toBe('来自 --anno');
  });

  it('缺少 input → exit 1', async () => {
    const result = await prepareContext('outline', argsOf(null));
    expect(result.ctx).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('缺少输入文件');
  });

  it('--anno 有选项无值 → exit 1', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const result = await prepareContext('outline', argsOf(file, { anno: true }));
    expect(result.exitCode).toBe(1);
  });

  it('--anno 给定 → 回写目标就是该文件', async () => {
    const file = await writeFixture('raw.html', RAW_HTML);
    const anno = await writeFixture('p.anno.json', projectJson('来自 --anno'));
    const result = await prepareContext('annotate', argsOf(file, { anno }));
    expect(result.ctx?.writebackPath).toBe(anno);
  });

  it('无 --anno → 回写目标为同目录 <stem>.anno.json', async () => {
    const file = await writeFixture('原型.html', RAW_HTML);
    const result = await prepareContext('outline', argsOf(file));
    expect(result.ctx?.writebackPath).toBe(path.join(path.dirname(file), '原型.anno.json'));
  });

  it('产物输入无 --anno → 回写目标为同目录 <stem>.anno.json（stem 取 protoName）', async () => {
    const file = await writeFixture('artifact.html', embeddedHtml('内嵌标题'));
    const result = await prepareContext('list', argsOf(file));
    expect(result.ctx?.writebackPath).toBe(path.join(path.dirname(file), 'demo.anno.json'));
  });
});
