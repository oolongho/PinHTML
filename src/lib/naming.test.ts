/**
 * naming.test.ts —— 原型名归一与下载命名单测（缺陷修复：重复导出导致文件名累积「-标注」）
 */
import { describe, expect, it } from 'vitest';
import { annoJsonName, exportHtmlName, normalizeProtoName, protoStem } from './naming';

describe('normalizeProtoName', () => {
  it('剥离尾部累积的多个「-标注」后缀，保留扩展名', () => {
    expect(normalizeProtoName('X-标注-标注-标注.html')).toBe('X.html');
    expect(normalizeProtoName('生图生视频-原型-标注.html')).toBe('生图生视频-原型.html');
  });

  it('无后缀时保持不变', () => {
    expect(normalizeProtoName('原型.html')).toBe('原型.html');
    expect(normalizeProtoName('原型.htm')).toBe('原型.htm');
    expect(normalizeProtoName('原型.anno.json')).toBe('原型.anno.json');
  });

  it('只剥离尾部，「标注」出现在中间时不动', () => {
    expect(normalizeProtoName('标注管理-标注.html')).toBe('标注管理.html');
    expect(normalizeProtoName('标注-配置.html')).toBe('标注-配置.html');
  });

  it('剥离后为空时回落「原型」', () => {
    expect(normalizeProtoName('-标注.html')).toBe('原型.html');
    expect(normalizeProtoName('   ')).toBe('原型');
  });
});

describe('protoStem', () => {
  it('去扩展名并去累积后缀', () => {
    expect(protoStem('X-标注-标注.html')).toBe('X');
    expect(protoStem('X.anno.json')).toBe('X');
    expect(protoStem('')).toBe('原型');
  });
});

describe('下载文件名', () => {
  it('导出 HTML：<主干>-标注.html（重复调用结果稳定）', () => {
    const first = exportHtmlName('X.html');
    expect(first).toBe('X-标注.html');
    // 模拟「打开导出产物 → 再导出」：用上一次的产物名继续请求文件名
    expect(exportHtmlName('X-标注.html')).toBe(first);
    expect(exportHtmlName('X-标注-标注-标注.html')).toBe(first);
  });

  it('保存 JSON：<主干>.anno.json', () => {
    expect(annoJsonName('X-标注.html')).toBe('X.anno.json');
    expect(annoJsonName('X.anno.json')).toBe('X.anno.json');
  });
});
