import { useEffect, useRef, useState } from 'react';
import type { Floor, Pt, RuleSet, ValidationResult } from '../model';
import { FACILITY_LABELS, USAGE_LABELS } from '../model';
import { bboxOf, niceScaleBarM } from '../lib/geometry';
import { setMark } from '../store/store';
import { floorLabel } from '../store/id';
import { FloorPlan, mmFromEvent, type DragState, type View } from './FloorPlan';
import { FacilityGlyph, facilitySymbol } from './symbols';

export const PAPER: Record<string, { w: number; h: number; label: string; css: string }> = {
  a4l: { w: 297, h: 210, label: 'A4 横向', css: 'A4 landscape' },
  a4p: { w: 210, h: 297, label: 'A4 纵向', css: 'A4 portrait' },
  a3l: { w: 420, h: 297, label: 'A3 横向', css: 'A3 landscape' },
  a3p: { w: 297, h: 420, label: 'A3 纵向', css: 'A3 portrait' },
};

export type PaperKey = keyof typeof PAPER;

/** 让 @page 跟随当前纸张选择（CSS 中另有一份 A4 横向兜底） */
export function PageSizeStyle({ paper }: { paper: PaperKey }) {
  return <style>{`@media print { @page { size: ${PAPER[paper].css}; margin: 8mm; } }`}</style>;
}

export const KIND_ORDER = ['extinguisher', 'hydrant', 'exit_sign', 'emergency_light', 'exit', 'sprinkler'] as const;
const ROOM_LEGEND = Object.entries(USAGE_LABELS);

/** 按楼层内容适配视野（与单层打印页一致的留白与取框） */
function fitView(floor: Floor, el: SVGSVGElement | null): View {
  const fallback = { cx: 0, cy: 0, zoom: 0.05 };
  const polys = floor.rooms.map((r) => r.polygon);
  if (!polys.length) return fallback;
  const bb = bboxOf(polys);
  const pxW = el ? el.clientWidth : 900;
  const pxH = el ? el.clientHeight : 640;
  const wMm = bb.maxX - bb.minX + 10000;
  const hMm = bb.maxY - bb.minY + 10000;
  return {
    cx: (bb.minX + bb.maxX) / 2,
    cy: (bb.minY + bb.maxY) / 2,
    zoom: Math.min(pxW / wMm, pxH / hMm),
  };
}

/** 默认「您在此」标记：楼层水平中点、最上方 */
export function defaultMark(floor: Floor): Pt {
  const bb = bboxOf(floor.rooms.map((r) => r.polygon));
  return { x: (bb.minX + bb.maxX) / 2, y: 0 };
}

export function FloorMapSheet({
  floor,
  buildingName,
  rules,
  paper,
  pageLabel,
  pageOf,
  mark,
  onSvgRef,
}: {
  floor: Floor;
  buildingName: string;
  rules: RuleSet;
  paper: PaperKey;
  /** 页内标签，如「3F」 */
  pageLabel: string;
  /** 全册页码，如「第 2/5 页」 */
  pageOf: string;
  mark: Pt | undefined;
  onSvgRef?: (el: SVGSVGElement | null) => void;
}) {
  const [view, setView] = useState<View>({ cx: 0, cy: 0, zoom: 0.05 });
  const [drag, setDrag] = useState<DragState>(null);
  const [dragDelta, setDragDelta] = useState<Pt>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markRef = useRef<Pt>(mark ?? defaultMark(floor));

  // 视野适配图纸内容；批量出图时离屏图纸首帧可能尚无尺寸，需延后再适配一次
  useEffect(() => {
    setView(fitView(floor, svgRef.current));
    const raf = requestAnimationFrame(() => setView(fitView(floor, svgRef.current)));
    const t = window.setTimeout(() => setView(fitView(floor, svgRef.current)), 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id]);

  useEffect(() => {
    onSvgRef?.(svgRef.current);
    return () => onSvgRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 显示比例：沿用单层打印页的 96dpi 近似（px → 图上 mm）
  const scaleInfo = view.zoom * 0.2646;

  const p = PAPER[paper];
  const result: ValidationResult | undefined = floor.lastValidation;
  const barM = niceScaleBarM(80 / (scaleInfo || 0.05) / 1000);
  const markPt = mark ?? markRef.current;

  const toMm = (e: { clientX: number; clientY: number }) => mmFromEvent(svgRef.current!, view, e);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      setDrag({ kind: 'pan', startMm: toMm(e), orig: { cx: view.cx, cy: view.cy }, moved: false });
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const mm = toMm(e);
      const o = drag.orig as { cx: number; cy: number };
      setView({ ...view, cx: o.cx - (mm.x - drag.startMm.x), cy: o.cy - (mm.y - drag.startMm.y) });
    }
  };
  const onPointerUp = () => {
    if (drag?.kind === 'mark' && (dragDelta.x !== 0 || dragDelta.y !== 0) && mark) {
      setMark(floor.id, { x: mark.x + dragDelta.x, y: mark.y + dragDelta.y });
    }
    setDrag(null);
    setDragDelta({ x: 0, y: 0 });
  };

  const onMarkDown = (e: React.PointerEvent<SVGGElement>) => {
    const start = toMm(e);
    setDrag({ kind: 'mark', startMm: start, orig: markPt, moved: false });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const q = toMm(ev);
      setDragDelta({ x: q.x - start.x, y: q.y - start.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const q = toMm(ev);
      setMark(floor.id, { x: q.x, y: q.y });
      setDrag(null);
      setDragDelta({ x: 0, y: 0 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="print-sheet" style={{ aspectRatio: `${p.w} / ${p.h}`, maxWidth: p.w * 3.2 }}>
      <div className="sheet-title">
        <b>{buildingName} {pageLabel}层 疏散指示图</b>
        <span>
          比例尺 1 : {Math.round(1000 / (scaleInfo || 0.05))} ｜ 依据：{rules.source}
          <em className="sheet-page">　{pageLabel} {pageOf}</em>
        </span>
      </div>
      <div className="sheet-map">
        <svg
          ref={svgRef}
          className="print-svg"
          viewBox={`${view.cx - 500 / view.zoom} ${view.cy - 400 / view.zoom} ${1000 / view.zoom} ${800 / view.zoom}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={(e) => e.preventDefault()}
        >
          <FloorPlan
            floor={floor}
            view={view}
            svgRef={svgRef}
            underlayUrl={null}
            showGrid={false}
            selected={null}
            drag={drag}
            dragDelta={dragDelta}
            draftPoints={[]}
            draftCursor={null}
            coverageCells={null}
            highlight={null}
            markPt={markPt}
            onMarkPointerDown={onMarkDown}
          />
          {/* 比例尺 */}
          <g transform={`translate(${view.cx - 500 / view.zoom + 1500 / view.zoom},${view.cy + 380 / view.zoom})`} stroke="#333" fill="#333">
            <line x1={0} y1={0} x2={barM * 1000} y2={0} strokeWidth={4} vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={-300} x2={0} y2={300} strokeWidth={3} vectorEffect="non-scaling-stroke" />
            <line x1={barM * 1000} y1={-300} x2={barM * 1000} y2={300} strokeWidth={3} vectorEffect="non-scaling-stroke" />
            <text x={barM * 500} y={-800} textAnchor="middle" fontSize={500} stroke="none">{barM}m</text>
          </g>
          {/* 指北针 */}
          <g transform={`translate(${view.cx + 440 / view.zoom},${view.cy - 340 / view.zoom})`}>
            <polygon points="0,-2600 900,1600 0,600 -900,1600" fill="#333" />
            <text y={2600} textAnchor="middle" fontSize={1400} fill="#333">N</text>
          </g>
        </svg>
      </div>
      <div className="sheet-legend">
        <div>
          {KIND_ORDER.map((k) => {
            const sym = facilitySymbol(k);
            return (
              <span key={k} className="legendrow">
                <span className="glyphbox"><FacilityGlyph kind={k} s={6} /></span>
                {FACILITY_LABELS[k]}（{sym.letter}）
              </span>
            );
          })}
        </div>
        <div>
          {ROOM_LEGEND.map(([k, v]) => (
            <span key={k} className="legendrow">
              <span className="swatch" style={{ background: '#fff', border: '1px solid #999' }} />
              {v}
            </span>
          ))}
        </div>
      </div>
      <div className="sheet-foot">
        {result ? (
          <>
            <span>
              校验结论：{result.pass ? '合规' : '存在不合规项'} · 疏散最远 {result.travelWorstM != null ? `${result.travelWorstM.toFixed(1)}m` : '—'}（限值 {result.rulesSnapshot.maxTravelDistanceM}m） · 规则 {result.rulesSnapshot.buildingKind} v{result.rulesSnapshot.version}
              {!result.pass && <b className="foot-warn"> · 超限 {result.items.filter((i) => i.severity === 'error').length} 项，详见末页汇总</b>}
            </span>
            <span>依据文号：{result.rulesSnapshot.source} ｜ 校验时间：{new Date(result.checkedAt).toLocaleString('zh-CN')} ｜ {pageLabel} {pageOf}</span>
          </>
        ) : (
          <>
            <span className="foot-warn">本层尚未校验——本图合规状态未知，应先在编辑器中打开本层完成校验后再出图</span>
            <span>依据文号：{rules.source} ｜ {pageLabel} {pageOf}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** 末页：全楼汇总 */
export function SummarySheet({
  buildingName,
  paper,
  rows,
  pageOf,
  source,
  generatedAt,
}: {
  buildingName: string;
  paper: PaperKey;
  rows: FloorSummary[];
  pageOf: string;
  source: string;
  generatedAt: Date;
}) {
  const p = PAPER[paper];
  const totals = rows.reduce(
    (acc, r) => ({
      errors: acc.errors + r.errors,
      warnings: acc.warnings + r.warnings,
      overdue: acc.overdue + r.overdue,
      missing: acc.missing + r.missing,
      defect: acc.defect + r.defect,
      facilities: acc.facilities + r.facilities,
    }),
    { errors: 0, warnings: 0, overdue: 0, missing: 0, defect: 0, facilities: 0 },
  );

  return (
    <div className="print-sheet summary-sheet" style={{ aspectRatio: `${p.w} / ${p.h}`, maxWidth: p.w * 3.2 }}>
      <div className="sheet-title">
        <b>{buildingName} 全楼校验汇总</b>
        <span>出图时间：{generatedAt.toLocaleString('zh-CN')}<em className="sheet-page">　汇总 {pageOf}</em></span>
      </div>
      <div className="sheet-summary">
        <table className="table summary-table">
          <thead>
            <tr>
              <th>楼层</th>
              <th>设施数</th>
              <th>校验结论</th>
              <th>超限项</th>
              <th>警告项</th>
              <th>检查过期</th>
              <th>检查缺失</th>
              <th>损坏/缺失</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.floorId} className={r.validated ? undefined : 'unval-row'}>
                <td>{floorLabel(r.level)}</td>
                <td>{r.facilities}</td>
                <td>
                  {r.validated ? (
                    r.pass ? <span className="good">合规</span> : <span className="bad">存在超限项</span>
                  ) : (
                    <span className="warn">未校验</span>
                  )}
                </td>
                <td className={r.errors > 0 ? 'bad' : ''}>{r.validated ? r.errors : '—'}</td>
                <td className={r.warnings > 0 ? 'warn' : ''}>{r.validated ? r.warnings : '—'}</td>
                <td className={r.overdue > 0 ? 'warn' : ''}>{r.overdue}</td>
                <td className={r.missing > 0 ? 'warn' : ''}>{r.missing}</td>
                <td className={r.defect > 0 ? 'bad' : ''}>{r.defect}</td>
              </tr>
            ))}
            <tr className="summary-total">
              <td>合计（{rows.length} 层）</td>
              <td>{totals.facilities}</td>
              <td>
                {rows.some((r) => !r.validated) ? (
                  <span className="warn">含未校验楼层</span>
                ) : totals.errors > 0 ? (
                  <span className="bad">整楼不合规</span>
                ) : (
                  <span className="good">整楼合规</span>
                )}
              </td>
              <td className={totals.errors > 0 ? 'bad' : ''}>{totals.errors}</td>
              <td>{totals.warnings}</td>
              <td className={totals.overdue > 0 ? 'warn' : ''}>{totals.overdue}</td>
              <td className={totals.missing > 0 ? 'warn' : ''}>{totals.missing}</td>
              <td className={totals.defect > 0 ? 'bad' : ''}>{totals.defect}</td>
            </tr>
          </tbody>
        </table>
        <ul className="summary-note">
          <li>「超限项」取最近一次校验结果中 severity=error 的条数；「未校验」楼层无校验结论，对应单元格以 — 表示，图纸结论未知。</li>
          <li>「检查过期 / 检查缺失 / 损坏缺失」按当前设施台账实时统计（过期判定：最近检查日期超出该类设施的检查周期）。</li>
          <li>各层图纸的详细不合规项可在该层出图页的「整改清单」中查看。</li>
        </ul>
      </div>
      <div className="sheet-foot">
        <span>依据文号：{source}</span>
        <span>汇总 {pageOf}</span>
      </div>
    </div>
  );
}

export type FloorSummary = {
  floorId: string;
  level: number;
  facilities: number;
  validated: boolean;
  pass: boolean;
  errors: number;
  warnings: number;
  overdue: number;
  missing: number;
  defect: number;
};
