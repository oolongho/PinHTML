/**
 * loading.test.ts —— 原型加载与导出产物剥离单测（spec R1 加载原型 / R8 幂等）
 */
import { describe, expect, it } from 'vitest';
import { buildSrcdoc, computeProtoHash, createEmptyProject, loadPrototypeFile, stripInjections } from './loading';

const PROJECT_JSON = JSON.stringify({
  schema: 1,
  protoName: 'demo.html',
  protoHash: 'abcdef1234567890',
  anchorSeq: 1,
  annoSeq: 1,
  anchors: [{ id: 'e-1', selector: 'body > div', snippet: '甲', createdAt: 'x' }],
  annotations: [
    {
      id: 'a-1',
      anchorId: 'e-1',
      title: '标题',
      body: '正文',
      color: 'note',
      status: 'open',
      createdAt: 'x',
      updatedAt: 'x',
    },
  ],
});

/** 模拟本工具导出产物：干净原型 + 三件注入 + pin 层 + 拾取高亮 class */
const EXPORTED_HTML =
  '<!DOCTYPE html><html><head>' +
  '<style id="pinhtml-style">.pinhtml-card{}</style>' +
  '</head><body>' +
  '<div data-anno-id="e-1" class="pinhtml-pick-highlight card">甲</div>' +
  '<div id="pinhtml-pinlayer"><div class="pinhtml-pin">1</div></div>' +
  '<svg id="pinhtml-svg-layer"></svg>' +
  '<script id="pinhtml-data" type="application/json">' + PROJECT_JSON + '</' + 'script>' +
  '<script id="pinhtml-runtime">var x = 1;</' + 'script>' +
  '</body></html>';

describe('stripInjections', () => {
  it('剥离全部 pinhtml- 注入物但保留 data-anno-id', () => {
    const { cleanSource } = stripInjections(EXPORTED_HTML);
    expect(cleanSource).not.toContain('pinhtml-style');
    expect(cleanSource).not.toContain('pinhtml-data');
    expect(cleanSource).not.toContain('pinhtml-runtime');
    expect(cleanSource).not.toContain('pinhtml-pinlayer');
    expect(cleanSource).not.toContain('pinhtml-svg-layer');
    expect(cleanSource).not.toContain('pinhtml-pick-highlight');
    expect(cleanSource).toContain('data-anno-id="e-1"');
    expect(cleanSource).toContain('card'); // 非注入类名保留
  });

  it('从 #pinhtml-data 恢复项目（续编场景）', () => {
    const { project } = stripInjections(EXPORTED_HTML);
    expect(project?.protoName).toBe('demo.html');
    expect(project?.annotations[0]?.title).toBe('标题');
  });

  it('非导出产物：project 为 null，正文原样保留', () => {
    const { cleanSource, project } = stripInjections('<body><div class="card">普通原型</div></body>');
    expect(project).toBeNull();
    expect(cleanSource).toContain('普通原型');
  });

  it('数据损坏时 project 为 null 而不抛异常', () => {
    const broken = '<body><script id="pinhtml-data" type="application/json">{oops</' + 'script></body>';
    expect(() => stripInjections(broken)).not.toThrow();
    expect(stripInjections(broken).project).toBeNull();
  });

  it('幂等：剥离后再次剥离结果不变（重复导出无重复注入）', () => {
    const once = stripInjections(EXPORTED_HTML).cleanSource;
    const twice = stripInjections(once).cleanSource;
    expect(twice).toBe(once);
  });
});

describe('computeProtoHash', () => {
  it('返回 16 位十六进制字符串且稳定', async () => {
    const a = await computeProtoHash('<body>same</body>');
    const b = await computeProtoHash('<body>same</body>');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it('内容不同则哈希不同', async () => {
    expect(await computeProtoHash('<body>a</body>')).not.toBe(await computeProtoHash('<body>b</body>'));
  });
});

describe('buildSrcdoc', () => {
  it('在末个 </body> 前注入 bridge 脚本', () => {
    const out = buildSrcdoc('<html><body><p>x</p></body></html>', 'var bridge = 1;');
    expect(out).toContain('var bridge = 1;');
    expect(out.indexOf('var bridge = 1;')).toBeLessThan(out.indexOf('</body>'));
    expect(out.indexOf('</body>')).toBeGreaterThan(out.indexOf('<p>x</p>'));
  });

  it('无 body 结构时在末尾追加注入', () => {
    const out = buildSrcdoc('<div>plain</div>', 'var bridge = 1;');
    expect(out).toContain('var bridge = 1;');
    expect(out.indexOf('var bridge = 1;')).toBeGreaterThan(out.indexOf('<div>plain</div>'));
  });
});

describe('createEmptyProject', () => {
  it('序列号归零、无锚点与标注', () => {
    const p = createEmptyProject('a.html', 'hash');
    expect(p).toMatchObject({ schema: 1, protoName: 'a.html', protoHash: 'hash', anchorSeq: 0, annoSeq: 0 });
    expect(p.anchors).toEqual([]);
    expect(p.annotations).toEqual([]);
  });
});

describe('loadPrototypeFile 的命名稳定性', () => {
  it('打开导出产物时沿用文件内记录的原始原型名，避免「-标注」后缀累积', async () => {
    const file = new File([EXPORTED_HTML], 'demo-标注-标注.html', { type: 'text/html' });
    const result = await loadPrototypeFile(file);
    expect(result.restored).toBe(true);
    // 原型名取自 #pinhtml-data（demo.html），而非当前文件名
    expect(result.project.protoName).toBe('demo.html');
  });

  it('打开普通原型时以当前文件名为原型名', async () => {
    const file = new File(['<body><div>普通原型</div></body>'], '普通原型.html', { type: 'text/html' });
    const result = await loadPrototypeFile(file);
    expect(result.restored).toBe(false);
    expect(result.project.protoName).toBe('普通原型.html');
  });
});
