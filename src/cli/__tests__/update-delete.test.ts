/**
 * update-delete.test.ts —— `pinhtml update` / `pinhtml delete` 命令单测（spec R7）
 *
 * 夹具：最小 HTML + 一份 `.anno.json` 写入 os.tmpdir()，用 prepareContext 真实装载后调用
 * run（与 CLI 入口同一条路径，回写目标即该 `.anno.json`）；每个用例结束递归清理临时目录。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Annotation, Project } from '@/lib/types';
import type { Args } from '../args';
import { run as runDelete, type DeleteOutput } from '../commands/delete';
import { run as runUpdate, type UpdateOutput } from '../commands/update';
import { prepareContext } from '../load-input';
import type { CommandResult } from '../types';

/** 最小原型：三个已挂锚点的元素（更新 / 删除都不解析 DOM，仅保持产物形状） */
const HTML =
  '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
  '<div data-anno-id="e-1">保存</div><div data-anno-id="e-2">取消</div><div data-anno-id="e-3">删除</div>' +
  '</body></html>';

/** 造一条标注（字段与 schema v1 一致） */
function makeAnnotation(id: string, anchorId: string, title: string): Annotation {
  return {
    id,
    anchorId,
    title,
    body: `${title}的正文`,
    color: 'note',
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** 三条标注各挂一个独立锚点 */
function makeProject(): Project {
  return {
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 3,
    annoSeq: 3,
    anchors: [
      { id: 'e-1', selector: 'body > div:nth-of-type(1)', snippet: '保存', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'e-2', selector: 'body > div:nth-of-type(2)', snippet: '取消', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'e-3', selector: 'body > div:nth-of-type(3)', snippet: '删除', createdAt: '2026-01-01T00:00:00Z' },
    ],
    annotations: [
      makeAnnotation('a-1', 'e-1', '保存按钮'),
      makeAnnotation('a-2', 'e-2', '取消按钮'),
      makeAnnotation('a-3', 'e-3', '删除按钮'),
    ],
  };
}

/** 临时目录、输入原型与回写目标 */
let dir: string;
let inputPath: string;
let annoPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pinhtml-update-delete-'));
  inputPath = path.join(dir, 'demo.html');
  annoPath = path.join(dir, 'demo.anno.json');
  await writeFile(inputPath, HTML, 'utf8');
  await writeFile(annoPath, JSON.stringify(makeProject(), null, 2) + '\n', 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 用 prepareContext 装载真实临时文件后分发命令（--anno 使回写目标就是该 JSON） */
async function runCommand(
  command: 'update' | 'delete',
  options: Record<string, string | boolean>,
): Promise<CommandResult> {
  const args: Args = { command, input: inputPath, options: { anno: annoPath, ...options } };
  const prepared = await prepareContext(command, args);
  if (!prepared.ctx) throw new Error(`上下文准备失败：${prepared.message ?? '未知原因'}`);
  return command === 'update' ? runUpdate(args, prepared.ctx) : runDelete(args, prepared.ctx);
}

/** 读回落盘的原始文本（断言「未写盘」用） */
async function readAnnoText(): Promise<string> {
  return readFile(annoPath, 'utf8');
}

/** 读回落盘的项目 JSON */
async function readSaved(): Promise<Project> {
  return JSON.parse(await readAnnoText()) as Project;
}

describe('update：改一条', () => {
  it('--color visual → 目标更新、updatedAt 刷新，其余标注与锚点完全不变', async () => {
    const before = await readSaved();
    const result = await runCommand('update', { id: 'a-2', color: 'visual' });

    expect(result.exitCode).toBe(0);
    const json = result.json as UpdateOutput;
    expect(json.written).toEqual([annoPath]);
    expect(json.updated).toMatchObject({
      id: 'a-2',
      anchorId: 'e-2',
      title: '取消按钮',
      body: '取消按钮的正文',
      color: 'visual',
      status: 'open',
    });

    const after = await readSaved();
    const updated = after.annotations.find((annotation) => annotation.id === 'a-2')!;
    expect(updated.color).toBe('visual');
    expect(updated.createdAt).toBe(before.annotations[1].createdAt);
    expect(updated.updatedAt).not.toBe(before.annotations[1].updatedAt);

    // 其余标注与全部锚点逐字段不变
    expect(after.annotations.filter((annotation) => annotation.id !== 'a-2')).toEqual(
      before.annotations.filter((annotation) => annotation.id !== 'a-2'),
    );
    expect(after.anchors).toEqual(before.anchors);
    expect(after.annoSeq).toBe(before.annoSeq);
  });

  it('--title 空串视为给了值 → 清空标题成功', async () => {
    const result = await runCommand('update', { id: 'a-1', title: '' });

    expect(result.exitCode).toBe(0);
    expect((result.json as UpdateOutput).updated.title).toBe('');
    expect((await readSaved()).annotations[0].title).toBe('');
  });
});

describe('update：用法与目标校验', () => {
  it('缺 --id、只给 --id、字段缺值或非法 → exit 1，且不写盘', async () => {
    const beforeText = await readAnnoText();
    const invalidOptions: Array<Record<string, string | boolean>> = [
      { color: 'visual' },
      { id: 'a-1' },
      { id: 'a-1', title: true },
      { id: 'a-1', title: 'x'.repeat(61) },
      { id: 'a-1', body: 'x'.repeat(2001) },
      { id: 'a-1', color: 'purple' },
      { id: 'a-1', status: 'done' },
    ];

    for (const options of invalidOptions) {
      const result = await runCommand('update', options);
      expect(result.exitCode).toBe(1);
      expect(result.json).toBeUndefined();
    }
    expect(await readAnnoText()).toBe(beforeText);
  });

  it('目标 id 不存在 → exit 2，且 .anno.json 未被写', async () => {
    const beforeText = await readAnnoText();
    const result = await runCommand('update', { id: 'a-9', title: '不存在' });

    expect(result.exitCode).toBe(2);
    expect(result.json).toBeUndefined();
    expect(await readAnnoText()).toBe(beforeText);
  });
});

describe('delete：单条与批量', () => {
  it('单条 → 标注消失、锚点仍在，removed 为删除前快照', async () => {
    const before = await readSaved();
    const result = await runCommand('delete', { id: 'a-1' });

    expect(result.exitCode).toBe(0);
    const json = result.json as DeleteOutput;
    expect(json.removed).toEqual([before.annotations[0]]);
    expect(json.missing).toEqual([]);
    expect(json.written).toEqual([annoPath]);

    const after = await readSaved();
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(['a-2', 'a-3']);
    expect(after.anchors.map((anchor) => anchor.id)).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('--anchor → 锚点一并消失', async () => {
    const result = await runCommand('delete', { id: 'a-2', anchor: true });

    expect(result.exitCode).toBe(0);
    const after = await readSaved();
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(['a-1', 'a-3']);
    expect(after.anchors.map((anchor) => anchor.id)).toEqual(['e-1', 'e-3']);
  });

  it('--ids a-1,a-2 → 两条都删、第三条与锚点不动', async () => {
    const result = await runCommand('delete', { ids: 'a-1,a-2' });

    expect(result.exitCode).toBe(0);
    const json = result.json as DeleteOutput;
    expect(json.removed.map((annotation) => annotation.id)).toEqual(['a-1', 'a-2']);
    expect(json.missing).toEqual([]);

    const after = await readSaved();
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(['a-3']);
    expect(after.anchors.map((anchor) => anchor.id)).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('混合命中与未命中 → 命中的删掉、missing 列出、exit 0', async () => {
    const result = await runCommand('delete', { ids: 'a-1, a-9' });

    expect(result.exitCode).toBe(0);
    const json = result.json as DeleteOutput;
    expect(json.removed.map((annotation) => annotation.id)).toEqual(['a-1']);
    expect(json.missing).toEqual(['a-9']);
    expect((await readSaved()).annotations.map((annotation) => annotation.id)).toEqual(['a-2', 'a-3']);
  });

  it('--ids 与 --id 同时给 → --ids 优先', async () => {
    const result = await runCommand('delete', { ids: 'a-2', id: 'a-1' });

    expect(result.exitCode).toBe(0);
    expect((result.json as DeleteOutput).removed.map((annotation) => annotation.id)).toEqual(['a-2']);
    expect((await readSaved()).annotations.map((annotation) => annotation.id)).toEqual(['a-1', 'a-3']);
  });
});

describe('delete：边界', () => {
  it('缺 --id / --ids 或列表为空 → exit 1，且不写盘', async () => {
    const beforeText = await readAnnoText();
    const invalidOptions: Array<Record<string, string | boolean>> = [
      {},
      { ids: true },
      { ids: ' , ' },
    ];

    for (const options of invalidOptions) {
      const result = await runCommand('delete', options);
      expect(result.exitCode).toBe(1);
      expect(result.json).toBeUndefined();
    }
    expect(await readAnnoText()).toBe(beforeText);
  });

  it('全部 id 未命中 → exit 2，且不写盘', async () => {
    const beforeText = await readAnnoText();
    const result = await runCommand('delete', { ids: 'a-8,a-9' });

    expect(result.exitCode).toBe(2);
    expect(result.json).toBeUndefined();
    expect(await readAnnoText()).toBe(beforeText);
  });
});
