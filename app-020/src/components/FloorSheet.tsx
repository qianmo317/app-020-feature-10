import { useEffect, useMemo, useRef, useState } from 'react';
import type { Floor, Pt, RuleSet } from '../model';
import { FACILITY_LABELS, USAGE_LABELS } from '../model';
import { bboxOf, niceScaleBarM } from '../lib/geometry';
import { floorLabel } from '../store/id';
import { FloorPlan, mmFromEvent, type DragState, type View } from './FloorPlan';
import { FacilityGlyph, facilitySymbol } from './symbols';

export const PAPER: Record<string, { w: number; h: number; label: string }> = {
  a4l: { w: 297, h: 210, label: 'A4 横向' },
  a4p: { w: 210, h: 297, label: 'A4 纵向' },
  a3l: { w: 420, h: 297, label: 'A3 横向' },
  a3p: { w: 297, h: 420, label: 'A3 纵向' },
};

const KIND_ORDER = ['extinguisher', 'hydrant', 'exit_sign', 'emergency_light', 'exit', 'sprinkler'] as const;

export type FloorSheetProps = {
  floor: Floor;
  buildingName: string;
  rules: RuleSet;
  paper: { w: number; h: number };
  /** 「您在此」标记：undefined 用默认位置（图纸中上方），null 不显示 */
  markPt?: Pt | null;
  /** 页脚页码，如「3F 第 2/5 页」（整栋批量出图时传） */
  pageLabel?: string;
  /** 拖动「您在此」后的回调；不传则标记只读（批量出图） */
  onMarkMove?: (pt: Pt) => void;
  /** 外部需要拿 svg 元素时传入（如导出 PNG） */
  svgRef?: React.RefObject<SVGSVGElement>;
};

/**
 * 一页疏散指示图：页眉（楼栋名 / 层号 / 比例 / 依据文号）+ 白底图纸（比例尺、指北针、「您在此」）
 * + 图例 + 页脚（校验结论 / 页码）。单层打印页与整栋批量出图共用，保证两处图面一致。
 */
export function FloorSheet({ floor, buildingName, rules, paper, markPt, pageLabel, onMarkMove, svgRef }: FloorSheetProps) {
  const innerRef = useRef<SVGSVGElement | null>(null);
  const svgEl = svgRef ?? innerRef;
  const [view, setView] = useState<View>({ cx: 0, cy: 0, zoom: 0.05 });
  const [drag, setDrag] = useState<DragState>(null);
  const [dragDelta, setDragDelta] = useState<Pt>({ x: 0, y: 0 });

  // 视野适配图纸内容（纸张切换后图幅比例变化，重新适配）
  useEffect(() => {
    const polys = floor.rooms.map((r) => r.polygon);
    if (!polys.length) return;
    const bb = bboxOf(polys);
    const el = svgEl.current;
    const pxW = el ? el.clientWidth : 900;
    const pxH = el ? el.clientHeight : 640;
    const wMm = bb.maxX - bb.minX + 10000;
    const hMm = bb.maxY - bb.minY + 10000;
    setView({
      cx: (bb.minX + bb.maxX) / 2,
      cy: (bb.minY + bb.maxY) / 2,
      zoom: Math.min(pxW / wMm, pxH / hMm),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id, paper.w, paper.h]);

  const scaleInfo = useMemo(() => {
    // 显示比例：1 图上 mm 代表多少真实 mm（px per mm * 视觉换算按 96dpi 近似 1px = 0.2646 图上 mm）
    const pxPerMm = view.zoom;
    const paperMmPerPx = 0.2646;
    return pxPerMm * paperMmPerPx; // 图上 1mm 对应的实际 mm
  }, [view.zoom]);

  const result = floor.lastValidation;
  const barM = niceScaleBarM(80 / (scaleInfo || 0.05) / 1000);
  const roomLegend = Object.entries(USAGE_LABELS);

  const mark =
    markPt === undefined
      ? floor.rooms.length
        ? {
            x: (bboxOf(floor.rooms.map((r) => r.polygon)).minX + bboxOf(floor.rooms.map((r) => r.polygon)).maxX) / 2,
            y: 0,
          }
        : null
      : markPt;

  const toMm = (e: { clientX: number; clientY: number }) => mmFromEvent(svgEl.current!, view, e);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      setDrag({ kind: 'pan', startMm: toMm(e), orig: { cx: view.cx, cy: view.cy }, moved: false });
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const p = toMm(e);
      const o = drag.orig as { cx: number; cy: number };
      setView({ ...view, cx: o.cx - (p.x - drag.startMm.x), cy: o.cy - (p.y - drag.startMm.y) });
    }
  };
  const onPointerUp = () => {
    if (drag?.kind === 'mark' && (dragDelta.x !== 0 || dragDelta.y !== 0) && mark) {
      onMarkMove?.({ x: mark.x + dragDelta.x, y: mark.y + dragDelta.y });
    }
    setDrag(null);
    setDragDelta({ x: 0, y: 0 });
  };

  const onMarkDown = (e: React.PointerEvent<SVGGElement>) => {
    if (!onMarkMove) return;
    const start = toMm(e);
    setDrag({ kind: 'mark', startMm: start, orig: mark ?? { x: 0, y: 0 }, moved: false });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = toMm(ev);
      setDragDelta({ x: p.x - start.x, y: p.y - start.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = toMm(ev);
      onMarkMove({ x: p.x, y: p.y });
      setDrag(null);
      setDragDelta({ x: 0, y: 0 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="print-sheet" style={{ aspectRatio: `${paper.w} / ${paper.h}`, maxWidth: paper.w * 3.2 }}>
      <div className="sheet-title">
        <b>{buildingName} {floorLabel(floor.level)}层 疏散指示图</b>
        <span>比例尺 1 : {Math.round(1000 / (scaleInfo || 0.05))} ｜ 依据：{rules.source}</span>
      </div>
      <div className="sheet-map">
        <svg
          ref={svgEl}
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
            svgRef={svgEl}
            underlayUrl={null}
            showGrid={false}
            selected={null}
            drag={drag}
            dragDelta={dragDelta}
            draftPoints={[]}
            draftCursor={null}
            coverageCells={null}
            highlight={null}
            markPt={mark}
            onMarkPointerDown={onMarkMove ? onMarkDown : undefined}
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
          {roomLegend.map(([k, v]) => (
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
            <span>校验结论：{result.pass ? '合规' : '存在不合规项'} · 疏散最远 {result.travelWorstM != null ? `${result.travelWorstM.toFixed(1)}m` : '—'}（限值 {result.rulesSnapshot.maxTravelDistanceM}m） · 规则 {result.rulesSnapshot.buildingKind} v{result.rulesSnapshot.version}</span>
            <span>依据文号：{result.rulesSnapshot.source} ｜ 校验时间：{new Date(result.checkedAt).toLocaleString('zh-CN')}</span>
          </>
        ) : (
          <span className="bad">本层尚未校验（在编辑器中打开本层即自动校验），本图缺少合规结论</span>
        )}
        {pageLabel && <span className="pagenum">{pageLabel}</span>}
      </div>
    </div>
  );
}
