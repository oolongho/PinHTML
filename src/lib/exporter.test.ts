/**
 * exporter.test.ts —— 导出产物组装单测（spec R8）
 *
 * 覆盖：锚点 data-anno-id 回放的证据链（selector+snippet 命中 / 片段不符不写 / 片段唯一兜底改绑）、
 * 三件注入物的相对顺序、JSON 的 `</` 转义；虚拟模块 virtual:viewer-src 由构建期 esbuild 提供，
 * 单测中以替身接管（内容不参与断言）。
 */
import { describe, expect, it } from 'vitest';

import { buildExportHtml } from './exporter';
import type { Anchor, Project } from './types';

function makeAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    id: 'e-1',
    selector: 'body > div.card > button#btn',
    snippet: '保存',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    schema: 1,
    protoName: 'p.html',
    protoHash: 'h',
    anchorSeq: 1,
    annoSeq: 0,
    anchors: [makeAnchor()],
    annotations: [],
    ...over,
  };
}

describe('锚点回放到干净源', () => {
  it('selector + snippet 命中：写入 data-anno-id', () => {
    const html = buildExportHtml(
      '<html><body><div class="card"><button id="btn">保存</button></div></body></html>',
      makeProject(),
    );
    expect(html).toContain('data-anno-id="e-1"');
  });

  it('selector 命中但片段不符：不写属性（锚点留在 JSON 交由三态判定）', () => {
    const html = buildExportHtml(
      '<html><body><div class="card"><button id="btn">取消</button></div></body></html>',
      makeProject(),
    );
    expect(html).not.toContain('data-anno-id="e-1"');
    expect(html).toContain('"e-1"'); // 锚点仍在注入的 JSON 中
  });

  it('selector 失效但片段全局唯一：兜底命中并写入（moved 态）', () => {
    const html = buildExportHtml(
      '<html><body><section class="bar"><button id="btn">保存</button></section></body></html>',
      makeProject(),
    );
    expect(html).toContain('data-anno-id="e-1"');
  });

  it('片段重复出现时不猜：不写属性', () => {
    const html = buildExportHtml(
      '<html><body><section><button id="a">保存</button><button id="b">保存</button></section></body></html>',
      makeProject(),
    );
    expect(html).not.toContain('data-anno-id="e-1"');
  });

  it('干净源已带 data-anno-id（导出物再导出）：fresh 命中并保持', () => {
    const html = buildExportHtml(
      '<html><body><div class="card"><button id="btn" data-anno-id="e-1">保存</button></div></body></html>',
      makeProject(),
    );
    expect(html).toContain('data-anno-id="e-1"');
  });
});

describe('注入三件与序列化', () => {
  const source = '<html><body><div class="card"><button id="btn">保存</button></div></body></html>';

  it('style → data → runtime 依序注入，且都在末个 </body> 之前', () => {
    const html = buildExportHtml(source, makeProject());
    const styleIdx = html.indexOf('<style id="pinhtml-style">');
    const dataIdx = html.indexOf('<script id="pinhtml-data" type="application/json">');
    const runtimeIdx = html.indexOf('<script id="pinhtml-runtime">');
    const lastBody = html.lastIndexOf('</body>');

    expect(styleIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeLessThan(dataIdx);
    expect(dataIdx).toBeLessThan(runtimeIdx);
    expect(runtimeIdx).toBeLessThan(lastBody);
  });

  it('正文里的转义 &lt;/body&gt; 不干扰注入点（注入到最后一个真实 </body> 之前）', () => {
    const html = buildExportHtml(
      '<html><body><p>&lt;/body&gt;</p></body></html>',
      makeProject(),
    );
    expect(html.indexOf('<script id="pinhtml-runtime">')).toBeLessThan(html.lastIndexOf('</body>'));
  });

  it('结构完整：注入后仍以 </html> 收尾', () => {
    const html = buildExportHtml(source, makeProject());
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('无 </body> 的源走兜底追加（防御路径）', () => {
    const html = buildExportHtml('<!DOCTYPE html>', makeProject());
    expect(html.indexOf('<script id="pinhtml-runtime">')).toBeGreaterThan(-1);
  });

  it('JSON 内的 </ 被转义，不产生裸闭合标签', () => {
    const html = buildExportHtml(
      source,
      makeProject({
        annotations: [
          {
            id: 'a-1',
            anchorId: 'e-1',
            title: '含 </script> 的标题',
            body: '',
            color: 'note',
            status: 'open',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(html).toContain('<\\/script>');
    expect(html).not.toContain('</script> 的标题');
  });
});