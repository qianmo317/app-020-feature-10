import type { Floor } from '../model';
import { checkDueInfo } from './engine';
import { floorLabel } from '../store/id';

/**
 * 单层的打印汇总统计 —— 批量出图的楼层勾选列表与末尾「全楼汇总」页共用同一口径：
 * 超限项 = 校验结果中的 error 项；设施问题 = 过期 / 缺失（无记录）/ 损坏（defect）。
 */
export type FloorPrintStat = {
  floorId: string;
  label: string; // 层号，如 3F / B1
  level: number;
  validated: boolean; // 是否跑过校验（未校验的楼层要在列表里标出来）
  pass: boolean | null; // 未校验为 null
  errorCount: number; // 超限项数量
  warningCount: number; // 警告项数量
  facilityIssueCount: number; // 过期 / 缺失 / 损坏的设施数
  travelWorstM: number | null;
  checkedAt: string | null;
};

export function floorPrintStat(floor: Floor, now: number): FloorPrintStat {
  const v = floor.lastValidation;
  const facilityIssueCount = floor.facilities.filter((f) => {
    const info = checkDueInfo(f, now);
    return info.overdue || info.missing || info.defect;
  }).length;
  return {
    floorId: floor.id,
    label: floorLabel(floor.level),
    level: floor.level,
    validated: !!v,
    pass: v ? v.pass : null,
    errorCount: v ? v.items.filter((i) => i.severity === 'error').length : 0,
    warningCount: v ? v.items.filter((i) => i.severity === 'warning').length : 0,
    facilityIssueCount,
    travelWorstM: v?.travelWorstM ?? null,
    checkedAt: v?.checkedAt ?? null,
  };
}

export type PrintPlanPage =
  | { kind: 'floor'; floorId: string; label: string; pageNo: number }
  | { kind: 'summary'; pageNo: number };

export type PrintPlan = {
  pages: PrintPlanPage[];
  totalPages: number; // 含末尾汇总页
  floorPages: number; // 楼层页数
};

/**
 * 批量出图页面计划：勾选的楼层按层号升序（地下在前）各占一页，末尾附一页全楼汇总。
 * 页码从 1 起，分母含汇总页 —— 4 层时楼层页为 1/5..4/5，汇总页为 5/5。
 */
export function buildPrintPlan(floors: Floor[], selectedIds: ReadonlySet<string>): PrintPlan {
  const picked = floors.filter((f) => selectedIds.has(f.id)).sort((a, b) => a.level - b.level);
  const pages: PrintPlanPage[] = picked.map((f, i) => ({
    kind: 'floor',
    floorId: f.id,
    label: floorLabel(f.level),
    pageNo: i + 1,
  }));
  const totalPages = pages.length + 1;
  pages.push({ kind: 'summary', pageNo: totalPages });
  return { pages, totalPages, floorPages: picked.length };
}

/** 页脚页码文字：楼层页「3F 第 2/5 页」，汇总页「全楼汇总 第 5/5 页」 */
export function pageLabelOf(page: PrintPlanPage, totalPages: number): string {
  const name = page.kind === 'floor' ? page.label : '全楼汇总';
  return `${name} 第 ${page.pageNo}/${totalPages} 页`;
}
