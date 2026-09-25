import { useRef, useState } from 'react';
import { FACILITY_LABELS } from '../model';
import { checkDueInfo } from '../lib/engine';
import { useStore, setMark } from '../store/store';
import { floorLabel } from '../store/id';
import { Link } from '../router';
import { FloorSheet, PAPER } from '../components/FloorSheet';
import { download } from './Facilities';

export function PrintPage({ floorId }: { floorId: string }) {
  const floor = useStore((s) => s.floors[floorId]);
  const building = useStore((s) => s.buildings.find((b) => b.id === floor?.buildingId));
  const rules = useStore((s) => (floor ? s.rules[s.buildings.find((b) => b.id === floor.buildingId)?.kind ?? 'office'] : undefined));
  const mark = useStore((s) => s.marks[floorId]);
  const [paper, setPaper] = useState<keyof typeof PAPER>('a4l');
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!floor || !rules) {
    return <div className="page">楼层不存在。<Link to="/">返回首页</Link></div>;
  }

  const result = floor.lastValidation;

  // 整改清单：不合规项 + 过期/缺失检查
  const overdueFacs = floor.facilities.filter((f) => {
    const info = checkDueInfo(f, Date.now());
    return info.overdue || info.missing || info.defect;
  });

  const ledgerCsv = () => {
    const header = '点位编号,类型,X(m),Y(m),规格,最近检查,状态';
    const lines = floor.facilities.map((f) => {
      const sorted = [...f.checks].sort((a, b) => b.date.localeCompare(a.date));
      const spec = f.spec ? `${f.spec.extType ?? ''} ${f.spec.weightKg ?? ''}kg`.trim() : '';
      return [f.code, FACILITY_LABELS[f.kind], (f.x / 1000).toFixed(1), (f.y / 1000).toFixed(1), spec, sorted[0]?.date ?? '未检', sorted[0]?.status ?? 'missing'].join(',');
    });
    download(`${floorLabel(floor.level)}_设施台账.csv`, [header, ...lines].join('\n'));
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    clone.setAttribute('width', String(Math.round(vb.width / 40)));
    clone.setAttribute('height', String(Math.round(vb.height / 40)));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vb.width / 20);
    canvas.height = Math.round(vb.height / 20);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${building?.name ?? '建筑'}_${floorLabel(floor.level)}_疏散图.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };

  return (
    <div className="page printpage">
      <div className="toolbar no-print">
        <select value={paper} onChange={(e) => setPaper(e.target.value as keyof typeof PAPER)}>
          {Object.entries(PAPER).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={() => window.print()}>打印 / 另存 PDF</button>
        <button onClick={exportPng}>导出 PNG</button>
        <button onClick={ledgerCsv}>导出设施台账 CSV</button>
        {building && <Link className="btn" to={`/building/${building.id}/print`}>整栋批量出图</Link>}
        <Link className="btn" to={`/floor/${floorId}`}>返回编辑</Link>
      </div>

      {/* 出图区域：白底、图例、比例尺、指北针、「您在此」 */}
      <FloorSheet
        floor={floor}
        buildingName={building?.name ?? '建筑'}
        rules={rules}
        paper={PAPER[paper]}
        markPt={mark}
        onMarkMove={(pt) => setMark(floorId, pt)}
        svgRef={svgRef}
      />

      {/* 整改清单 */}
      <div className="section no-print" style={{ maxWidth: 900 }}>
        <h3>整改清单（不合规项汇总）</h3>
        {(result?.items.length ?? 0) === 0 && overdueFacs.length === 0 && <p className="hint">无不合规项</p>}
        <ul>
          {result?.items.map((it, i) => (
            <li key={i} className={it.severity}>
              [{it.severity === 'error' ? '超限' : '警告'}] {it.message}
            </li>
          ))}
          {overdueFacs.map((f) => {
            const already = result?.items.some((i) => i.facilityId === f.id && (i.type === 'CHECK_OVERDUE' || i.type === 'CHECK_MISSING' || i.type === 'FACILITY_DEFECT'));
            if (already) return null;
            return (
              <li key={f.id} className="warning">
                [警告] {f.code} 检查记录过期/缺失
              </li>
            );
          })}
        </ul>
        <p className="hint">过期项 100% 出现在本清单中（按检查周期判定）。</p>
      </div>
    </div>
  );
}
