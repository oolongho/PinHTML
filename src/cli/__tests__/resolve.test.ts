/**
 * resolve.test.ts —— `pinhtml resolve` 命令单测（spec R3）。
 *
 * 夹具一律在本文件内以最小 HTML 字符串自建，CliContext 手工构造，
 * 不依赖 test/ 下的真实原型与文件系统。
 */
import { describe, expect, it } from 'vitest';
import type { CliContext } from '../types';
import { run } from '../commands/resolve';

/**
 * 最小夹具：
 * - #bar 内两个按钮（保存 / 取消）；
 * - #footer 内两个 span 均为「保存」——加上按钮共 3 处「保存」。
 * 祖先容器的 snippet 因含其他文字而不等于「保存」，不会干扰文字扫描计数。
 */
const HTML =
  '<!DOCTYPE html><html><head><title>demo</title></head><body>' +
  '<div id="bar"><button>保存</button><button>取消</button></div>' +
  '<div id="footer"><span>保存</span><span>保存</span></div>' +
  '</body></html>';

/** 手工构造命令上下文（resolve 只用 cleanSource，其余字段取最小合法值） */
function makeContext(): CliContext {
  return {
    inputPath: '/tmp/demo.html',
    cleanSource: HTML,
    project: {
      schema: 1,
      protoName: 'demo.html',
      protoHash: 'abcdef1234567890',
      anchorSeq: 0,
      annoSeq: 0,
      anchors: [],
      annotations: [],
    },
    inputEmbedded: false,
    writebackPath: '/tmp/demo.anno.json',
  };
}

/** 调命令并取 JSON（断言成功路径） */
async function resolveJson(options: Record<string, string | boolean>) {
  const result = await run({ command: 'resolve', input: '/tmp/demo.html', options }, makeContext());
  expect(result.exitCode).toBe(0);
  return result.json as {
    clue: { selector?: string; text?: string };
    count: number;
    state: string;
    candidates: Array<{ selector: string; tag: string; text: string; path: string }>;
  };
}

describe('resolve：候选与三态判定', () => {
  it('selector + text 唯一命中 → count 1、state fresh、候选形状完整', async () => {
    const json = await resolveJson({ selector: '#bar > button:first-child', text: '保存' });
    expect(json.count).toBe(1);
    expect(json.state).toBe('fresh');
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]).toEqual({
      selector: expect.stringContaining('button'),
      tag: 'button',
      text: '保存',
      path: 'body>div>button',
    });
    expect(json.clue).toEqual({ selector: '#bar > button:first-child', text: '保存' });
  });

  it('文字出现 3 次且只给 --text → count 3、state stale、退出码 0', async () => {
    const json = await resolveJson({ text: '保存' });
    expect(json.count).toBe(3);
    expect(json.state).toBe('stale');
    expect(json.candidates).toHaveLength(3);
    // 文档顺序：按钮先于 footer 内两个 span
    expect(json.candidates.map((c) => c.tag)).toEqual(['button', 'span', 'span']);
  });

  it('selector + text 从多元素收窄成 1 条 → count 1、state fresh', async () => {
    const json = await resolveJson({ selector: '#bar > button', text: '取消' });
    expect(json.count).toBe(1);
    expect(json.state).toBe('fresh');
    expect(json.candidates[0]?.text).toBe('取消');
  });

  it('只给 --selector 命中多个元素 → state stale', async () => {
    const json = await resolveJson({ selector: 'button' });
    expect(json.count).toBe(2);
    expect(json.state).toBe('stale');
    expect(json.clue).toEqual({ selector: 'button' });
  });

  it('只给 --selector 唯一命中带文字的元素 → count 1、state fresh、退出码 0', async () => {
    const json = await resolveJson({ selector: '#bar > button:first-child' });
    expect(json.count).toBe(1);
    expect(json.state).toBe('fresh');
    expect(json.candidates[0]?.text).toBe('保存');
    expect(json.clue).toEqual({ selector: '#bar > button:first-child' });
  });

  it('非法 --selector → count 0、state stale、退出码 0', async () => {
    const json = await resolveJson({ selector: '[[[' });
    expect(json.count).toBe(0);
    expect(json.state).toBe('stale');
    expect(json.candidates).toEqual([]);
  });

  it('只给 --text 且唯一命中 → state moved（仅 snippet 兜底）', async () => {
    const json = await resolveJson({ text: '取消' });
    expect(json.count).toBe(1);
    expect(json.state).toBe('moved');
    expect(json.candidates[0]?.path).toBe('body>div>button');
  });

  it('0 候选 → count 0、state stale', async () => {
    const json = await resolveJson({ text: '不存在的文字' });
    expect(json.count).toBe(0);
    expect(json.state).toBe('stale');
    expect(json.candidates).toEqual([]);
  });

  it('--limit 1 截断 candidates，但 count 保持完整', async () => {
    const json = await resolveJson({ text: '保存', limit: '1' });
    expect(json.count).toBe(3);
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]?.tag).toBe('button');
  });

  it('--text 与 --selector 都不给 → exit 1，不输出 JSON', async () => {
    const result = await run({ command: 'resolve', input: '/tmp/demo.html', options: {} }, makeContext());
    expect(result.exitCode).toBe(1);
    expect(result.json).toBeUndefined();
  });
});
