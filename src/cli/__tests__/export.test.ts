/**
 * export.test.ts —— `pinhtml export` 命令单测（spec R6）
 *
 * 夹具：最小 HTML + 最小项目 JSON 写入 os.tmpdir()；先经 prepareContext 装载再执行命令
 * （与 CLI 入口同路径，覆盖「无 project 来源 → exit 2」）；每个用例结束递归清理临时目录。
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Args } from '../args';
import { prepareContext } from '../load-input';
import { run, type ExportReport } from '../commands/export';

/** 最小原型：一个按钮，锚点可唯一命中 */
const HTML =
  '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
  '<div id="card"><button id="save">保存</button></div>' +
  '</body></html>';

/** 最小合法项目 JSON（protoName = demo.html，一条 fresh 标注） */
function projectJson(): string {
  return JSON.stringify({
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 1,
    annoSeq: 1,
    anchors: [
      { id: 'e-1', selector: 'body > div#card > button#save', snippet: '保存', createdAt: '2026-01-01T00:00:00Z' },
    ],
    annotations: [
      {
        id: 'a-1',
        anchorId: 'e-1',
        title: '保存前先校验',
        body: '未通过校验时按钮不提交',
        color: 'interaction',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  });
}

/** 临时目录、输入原型与 --anno 文件路径 */
let dir: string;
let inputPath: string;
let annoPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-export-'));
  inputPath = path.join(dir, 'demo.html');
  annoPath = path.join(dir, 'source.anno.json');
  await writeFile(inputPath, HTML, 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 按 CLI 入口顺序执行：prepareContext → run（无 ctx 时直接返回前置退出码） */
async function runExport(
  options: Record<string, string | boolean>,
): Promise<{ exitCode: number; json?: ExportReport }> {
  const args: Args = { command: 'export', input: inputPath, options };
  const prepared = await prepareContext('export', args);
  if (!prepared.ctx) return { exitCode: prepared.exitCode ?? 1 };
  const result = await run(args, prepared.ctx);
  return { exitCode: result.exitCode, json: result.json as ExportReport | undefined };
}

/** 目录内文件名（排序后便于整体断言） */
async function filesIn(directory = dir): Promise<string[]> {
  return (await readdir(directory)).sort();
}

describe('--kind share（默认）', () => {
  it('从 --anno 导出 <stem>-标注.html，含 runtime 与 data，stdout 报绝对路径', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const sharePath = path.join(dir, 'demo-标注.html');

    const { exitCode, json } = await runExport({ anno: annoPath });

    expect(exitCode).toBe(0);
    expect(json).toEqual({ kind: 'share', written: [sharePath] });

    const html = await readFile(sharePath, 'utf8');
    expect(html).toContain('pinhtml-runtime');
    expect(html).toContain('pinhtml-data');
    expect(html).toContain('data-anno-id="e-1"');
  });
});

describe('--kind clean / --clean', () => {
  /** clean 产物的共同断言 */
  async function expectCleanOutput(): Promise<void> {
    const cleanPath = path.join(dir, 'demo.annotated.html');
    const html = await readFile(cleanPath, 'utf8');
    expect(html).toContain('pinhtml-data');
    expect(html).not.toContain('pinhtml-runtime');
    expect(html).toContain('data-anno-id="e-1"');
  }

  it('--kind clean → <stem>.annotated.html，无 runtime，含 data', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');

    const { exitCode, json } = await runExport({ anno: annoPath, kind: 'clean' });

    expect(exitCode).toBe(0);
    expect(json).toEqual({ kind: 'clean', written: [path.join(dir, 'demo.annotated.html')] });
    await expectCleanOutput();
  });

  it('--clean 等价于 --kind clean', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');

    const { exitCode, json } = await runExport({ anno: annoPath, clean: true });

    expect(exitCode).toBe(0);
    expect(json).toEqual({ kind: 'clean', written: [path.join(dir, 'demo.annotated.html')] });
    await expectCleanOutput();
  });
});

describe('project 来源与选项校验', () => {
  it('纯原型且无 --anno → prepareContext 直接 exit 2，不产出文件', async () => {
    const { exitCode } = await runExport({});
    expect(exitCode).toBe(2);
    expect(await filesIn()).toEqual(['demo.html']);
  });

  it('--kind 非法 → exit 1，不写文件', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const { exitCode } = await runExport({ anno: annoPath, kind: 'viewer' });
    expect(exitCode).toBe(1);
    expect(await filesIn()).toEqual(['demo.html', 'source.anno.json']);
  });

  it('--kind share --clean 矛盾 → exit 1，不猜', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const { exitCode } = await runExport({ anno: annoPath, kind: 'share', clean: true });
    expect(exitCode).toBe(1);
    expect(await filesIn()).toEqual(['demo.html', 'source.anno.json']);
  });

  it('--out 指向不存在的嵌套目录 → 递归创建并写出绝对路径', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const outDir = path.join(dir, 'dist', 'v1');

    const { exitCode, json } = await runExport({ anno: annoPath, out: outDir });

    expect(exitCode).toBe(0);
    expect(json?.written).toEqual([path.join(outDir, 'demo-标注.html')]);
    expect(await filesIn(outDir)).toEqual(['demo-标注.html']);
  });
});

describe('只读性与幂等', () => {
  it('执行后原型与 --anno 文件内容不变，且不额外写 .anno.json', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const inputText = await readFile(inputPath, 'utf8');
    const inputStat = await stat(inputPath);
    const annoText = await readFile(annoPath, 'utf8');

    const { exitCode } = await runExport({ anno: annoPath, clean: true });

    expect(exitCode).toBe(0);
    expect(await readFile(inputPath, 'utf8')).toBe(inputText);
    expect((await stat(inputPath)).mtimeMs).toBe(inputStat.mtimeMs);
    expect(await readFile(annoPath, 'utf8')).toBe(annoText);
    // 不写回写目标（本命令只产一个 HTML）
    expect(await filesIn()).toEqual(['demo.annotated.html', 'demo.html', 'source.anno.json']);
  });

  it('重复执行两次文件名不变，不累积「-标注」后缀', async () => {
    await writeFile(annoPath, projectJson(), 'utf8');
    const sharePath = path.join(dir, 'demo-标注.html');

    const first = await runExport({ anno: annoPath });
    const second = await runExport({ anno: annoPath });

    expect(second.json?.written).toEqual(first.json?.written);
    expect(second.json?.written).toEqual([sharePath]);
    expect(await filesIn()).toEqual(['demo-标注.html', 'demo.html', 'source.anno.json']);
  });
});
