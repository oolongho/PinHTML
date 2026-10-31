/**
 * list.test.ts —— `pinhtml list` 命令单测（spec R4）。
 *
 * 夹具在本文件内以最小 HTML + 手造 Project 自建，直接构造 CliContext 调用命令，
 * 不落盘、不依赖 test/ 下的真实原型。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation, Project } from '@/lib/types';
import type { CliContext, CommandResult } from '../types';
import { run, type ListOutput } from '../commands/list';

/** 最小原型：fresh（data-anno-id 命中）/ moved（selector 失效但 snippet 唯一）/ stale（均无） */
const HTML = `<!DOCTYPE html>
<html><head><title>demo</title></head><body>
  <div data-anno-id="e-1">保存</div>
  <section><p>图片生成</p></section>
  <div>其他内容</div>
</body></html>`;

/** 造一条标注（字段顺序与 schema v1 一致） */
function makeAnnotation(id: string, anchorId: string, title: string): Annotation {
  return {
    id,
    anchorId,
    title,
    body: `${title}的正文`,
    color: 'note',
    status: 'open',
    createdAt: `2026-01-01T00:00:0${id.slice(-1)}Z`,
    updatedAt: `2026-01-01T00:00:0${id.slice(-1)}Z`,
  };
}

/** 三态各一条的完整项目 */
function makeProject(): Project {
  return {
    schema: 1,
    protoName: 'demo.html',
    protoHash: 'abcdef1234567890',
    anchorSeq: 3,
    annoSeq: 3,
    anchors: [
      { id: 'e-1', selector: 'body > div', snippet: '保存', createdAt: '2026-01-01T00:00:01Z' },
      { id: 'e-2', selector: 'body > main > p', snippet: '图片生成', createdAt: '2026-01-01T00:00:02Z' },
      { id: 'e-3', selector: 'body > aside > div', snippet: '已删除的内容', createdAt: '2026-01-01T00:00:03Z' },
    ],
    annotations: [
      makeAnnotation('a-1', 'e-1', '保存按钮'),
      makeAnnotation('a-2', 'e-2', '图片生成'),
      makeAnnotation('a-3', 'e-3', '已删元素'),
    ],
  };
}

/** 直接构造命令上下文（list 只读 input 的 cleanSource 与 project） */
function contextOf(project: Project): CliContext {
  return {
    inputPath: '/tmp/demo.html',
    cleanSource: HTML,
    project,
    inputEmbedded: false,
    writebackPath: '/tmp/demo.anno.json',
  };
}

/** 执行命令并取 JSON 输出（断言前端统一在此收口） */
async function runList(options: Record<string, string | boolean> = {}): Promise<CommandResult> {
  return run({ command: 'list', input: '/tmp/demo.html', options }, contextOf(makeProject()));
}

describe('run：三态与计数', () => {
  it('counts 按三态各自计数，顶层带 proto / protoHash', async () => {
    const result = await runList();
    expect(result.exitCode).toBe(0);
    const json = result.json as ListOutput;
    expect(json.proto).toBe('demo.html');
    expect(json.protoHash).toBe('abcdef1234567890');
    expect(json.counts).toEqual({ fresh: 1, moved: 1, stale: 1 });
    expect(json.annotations).toHaveLength(3);
  });

  it('每条标注带完整 Annotation 字段 + id / anchorId / state / selector / snippet', async () => {
    const json = (await runList()).json as ListOutput;
    const byId = new Map(json.annotations.map((anno) => [anno.id, anno]));

    expect(byId.get('a-1')).toMatchObject({
      id: 'a-1',
      anchorId: 'e-1',
      title: '保存按钮',
      body: '保存按钮的正文',
      color: 'note',
      status: 'open',
      state: 'fresh',
      selector: 'body > div',
      snippet: '保存',
    });
    expect(byId.get('a-2')).toMatchObject({ anchorId: 'e-2', state: 'moved', snippet: '图片生成' });
    expect(byId.get('a-3')).toMatchObject({ anchorId: 'e-3', state: 'stale', snippet: '已删除的内容' });
  });
});

describe('run：--state 过滤', () => {
  it('--state stale 只返回 stale 标注，counts 仍统计全量', async () => {
    const json = (await runList({ state: 'stale' })).json as ListOutput;
    expect(json.annotations.map((anno) => anno.id)).toEqual(['a-3']);
    expect(json.counts).toEqual({ fresh: 1, moved: 1, stale: 1 });
  });
});

describe('run：空项目', () => {
  it('无锚点无标注 → counts 全 0、annotations 空、exit 0', async () => {
    const empty: Project = {
      schema: 1,
      protoName: 'demo.html',
      protoHash: 'abcdef1234567890',
      anchorSeq: 0,
      annoSeq: 0,
      anchors: [],
      annotations: [],
    };
    const result = await run({ command: 'list', input: '/tmp/demo.html', options: {} }, contextOf(empty));
    expect(result.exitCode).toBe(0);
    const json = result.json as ListOutput;
    expect(json.counts).toEqual({ fresh: 0, moved: 0, stale: 0 });
    expect(json.annotations).toEqual([]);
  });
});
