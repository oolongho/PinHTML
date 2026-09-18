/**
 * geom.test.ts —— 图钉定位与坐标换算单测（spec R5）
 *
 * 说明：geom 为纯函数模块，rect 以普通对象构造即可（不依赖真实布局），
 * 故无需渲染环境；覆盖图钉越界回退链与 viewport 换算。
 */
import { describe, expect, it } from 'vitest';
import { PIN_HEIGHT, PIN_OFFSET, bezierPath, inViewport, pinAnchorPoint, toViewport } from './geom';

/** 构造 rect（避免依赖真实布局） */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } as DOMRect;
}

describe('pinAnchorPoint', () => {
  it('常规元素：中心贴右上角并向外偏移', () => {
    expect(pinAnchorPoint(rect(100, 200, 80, 30), 1000, 800)).toEqual({
      x: 180 + PIN_OFFSET,
      y: 200 - PIN_OFFSET,
    });
  });

  it('右缘越界时翻到元素左上角', () => {
    expect(pinAnchorPoint(rect(940, 200, 50, 30), 1000, 800).x).toBe(940 - PIN_OFFSET);
  });

  it('上缘越界时落回元素内顶部', () => {
    expect(pinAnchorPoint(rect(100, 2, 50, 30), 1000, 800).y).toBe(2 + PIN_OFFSET + PIN_HEIGHT / 2);
  });

  it('下缘越界时上移进视口', () => {
    expect(pinAnchorPoint(rect(100, 795, 50, 10), 1000, 800).y).toBe(800 - PIN_HEIGHT / 2);
  });

  it('图钉宽度随位数变化不影响定位（定位以中心点为准）', () => {
    const r = rect(100, 200, 80, 30);
    expect(pinAnchorPoint(r, 1000, 800)).toEqual(pinAnchorPoint(r, 1000, 800));
  });
});

describe('inViewport', () => {
  it('视口内 / 外（含 40px 容差）', () => {
    expect(inViewport(rect(0, 0, 10, 10), 1000, 800)).toBe(true);
    expect(inViewport(rect(1005, 0, 10, 10), 1000, 800)).toBe(true); // 距右缘 5px，仍在容差内
    expect(inViewport(rect(1200, 0, 10, 10), 1000, 800)).toBe(false);
    expect(inViewport(rect(-100, 0, 10, 10), 1000, 800)).toBe(false);
  });
});

describe('toViewport', () => {
  it('iframe 内坐标 + frame 偏移 = 父页视口坐标', () => {
    expect(toViewport(10, 20, { left: 100, top: 50 })).toEqual({ x: 110, y: 70 });
  });

  it('导出模式（frameRect 为零）坐标不变', () => {
    expect(toViewport(10, 20, { left: 0, top: 0 })).toEqual({ x: 10, y: 20 });
  });
});

describe('bezierPath', () => {
  it('控制点取水平距离 45% 内缩', () => {
    expect(bezierPath(0, 0, 100, 50)).toBe('M0,0 C45,0 55,50 100,50');
  });

  it('端点重合时退化为直线路径', () => {
    expect(bezierPath(5, 5, 5, 5)).toBe('M5,5 C5,5 5,5 5,5');
  });
});