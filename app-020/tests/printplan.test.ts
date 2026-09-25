/**
 * 批量出图验收用例：
 * - 页面计划：勾选楼层按层号升序各占一页，末尾附一页全楼汇总，页码分母含汇总页
 * - 楼层统计：未校验楼层标得出；超限项数量、过期/缺失/损坏设施数口径与整改清单一致
 */
import { describe, expect, it } from 'vitest';
import type { Floor } from '../src/model';
import { mkFloor, mkRoom, rect, validateFloor } from './helpers';
import { buildPrintPlan, floorPrintStat, pageLabelOf } from '../src/lib/printplan';

const DAY = 86400000;
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

function floorAt(id: string, level: number): Floor {
  const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 10, 2))], []);
  return { ...floor, id, level };
}

describe('buildPrintPlan（出图页面计划）', () => {
  it('P1 勾选楼层按层号升序（地下在前）各占一页，末尾附全楼汇总页', () => {
    const floors = [floorAt('f2', 2), floorAt('fb1', -1), floorAt('f1', 1)]; // 乱序给入
    const plan = buildPrintPlan(floors, new Set(['f2', 'fb1', 'f1']));
    expect(plan.floorPages).toBe(3);
    expect(plan.totalPages).toBe(4); // 3 层 + 1 汇总
    expect(plan.pages.map((p) => (p.kind === 'floor' ? p.label : 'summary'))).toEqual(['B1', '1F', '2F', 'summary']);
    expect(plan.pages.map((p) => p.pageNo)).toEqual([1, 2, 3, 4]);
  });

  it('P2 只勾选部分楼层时，未勾选的层不占页', () => {
    const floors = [floorAt('f1', 1), floorAt('f2', 2), floorAt('f3', 3)];
    const plan = buildPrintPlan(floors, new Set(['f3', 'f1']));
    expect(plan.floorPages).toBe(2);
    expect(plan.totalPages).toBe(3);
    expect(plan.pages.map((p) => (p.kind === 'floor' ? p.floorId : 'summary'))).toEqual(['f1', 'f3', 'summary']);
  });

  it('P3 一层都不勾时只剩汇总页（1 页）', () => {
    const plan = buildPrintPlan([floorAt('f1', 1)], new Set());
    expect(plan.floorPages).toBe(0);
    expect(plan.totalPages).toBe(1);
    expect(plan.pages[0]).toEqual({ kind: 'summary', pageNo: 1 });
  });

  it('P4 页码文字：楼层页带层号「3F 第 2/5 页」，汇总页「全楼汇总 第 5/5 页」', () => {
    const floors = [floorAt('f1', 1), floorAt('f2', 2), floorAt('f3', 3), floorAt('f4', 4)];
    const plan = buildPrintPlan(floors, new Set(floors.map((f) => f.id)));
    expect(plan.totalPages).toBe(5);
    expect(pageLabelOf(plan.pages[1], plan.totalPages)).toBe('2F 第 2/5 页');
    expect(pageLabelOf(plan.pages[4], plan.totalPages)).toBe('全楼汇总 第 5/5 页');
  });
});

describe('floorPrintStat（单层打印统计）', () => {
  it('P5 未跑过校验的楼层：validated=false，结论与计数为空', () => {
    const st = floorPrintStat(floorAt('f1', 3), Date.now());
    expect(st.label).toBe('3F');
    expect(st.validated).toBe(false);
    expect(st.pass).toBeNull();
    expect(st.errorCount).toBe(0);
    expect(st.warningCount).toBe(0);
    expect(st.checkedAt).toBeNull();
  });

  it('P6 已校验楼层：超限项数量取自校验结果 error 项', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 10, 2))], []); // 无出口 → EXIT_COUNT error
    const result = validateFloor(floor, rules);
    expect(result.items.some((i) => i.type === 'EXIT_COUNT' && i.severity === 'error')).toBe(true);
    const st = floorPrintStat({ ...floor, lastValidation: result }, Date.now());
    expect(st.validated).toBe(true);
    expect(st.pass).toBe(false);
    expect(st.errorCount).toBe(result.items.filter((i) => i.severity === 'error').length);
    expect(st.errorCount).toBeGreaterThan(0);
    expect(st.checkedAt).toBe(result.checkedAt);
  });

  it('P7 过期 / 缺失 / 损坏的设施全部计入待整改数，正常的不计', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 10, 2))], [
      { kind: 'extinguisher', x: 2, y: 1 }, // 无记录 → 缺失
      { kind: 'extinguisher', x: 5, y: 1, checks: [{ date: dateStr(45), status: 'ok' }] }, // 超 30 天周期 → 过期
      { kind: 'hydrant', x: 8, y: 1, checks: [{ date: dateStr(2), status: 'damaged' }] }, // 损坏
      { kind: 'exit_sign', x: 9, y: 1, checks: [{ date: dateStr(5), status: 'ok' }] }, // 正常
    ]);
    const st = floorPrintStat(floor, Date.now());
    expect(st.facilityIssueCount).toBe(3);
  });
});
