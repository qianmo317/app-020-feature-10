import { useMemo, useState } from 'react';
import { getState, setLastValidation, useStore } from '../store/store';
import { validateFloor } from '../lib/engine';
import { floorLabel } from '../store/id';
import { buildPrintPlan, floorPrintStat, pageLabelOf, type FloorPrintStat } from '../lib/printplan';
import { FloorSheet, PAPER } from '../components/FloorSheet';
import { Link } from '../router';

/**
 * 整栋批量出图：勾选楼层（默认全选）一次生成整份图纸 —— 每层起一页并带楼层页码，
 * 末尾附一页全楼汇总。未跑过校验的楼层在列表里标出，打印前二次确认。
 */
export function PrintBuildingPage({ buildingId }: { buildingId: string }) {
  const building = useStore((s) => s.buildings.find((b) => b.id === buildingId));
  const floorsMap = useStore((s) => s.floors);
  const rules = useStore((s) => s.rules[building?.kind ?? 'office']);
  const marks = useStore((s) => s.marks);
  const [paper, setPaper] = useState<keyof typeof PAPER>('a4l');
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null); // null = 未动过，默认全选
  const [validating, setValidating] = useState(false);

  // 楼层按层号升序（地下在前），与出图页序一致
  const floors = useMemo(
    () => (building ? building.floors.map((id) => floorsMap[id]).filter(Boolean).sort((a, b) => a.level - b.level) : []),
    [building, floorsMap],
  );

  const checked = useMemo(() => picked ?? new Set(floors.map((f) => f.id)), [picked, floors]);
  const plan = useMemo(() => buildPrintPlan(floors, checked), [floors, checked]);
  const stats = useMemo(() => floors.map((f) => floorPrintStat(f, Date.now())), [floors]);
  const statByFloor = useMemo(() => new Map(stats.map((s) => [s.floorId, s])), [stats]);

  if (!building) return <div className="page">建筑不存在。<Link to="/">返回首页</Link></div>;

  const planFloors = floors.filter((f) => checked.has(f.id));
  const unvalidated = planFloors.filter((f) => !f.lastValidation);
  const allOn = floors.length > 0 && floors.every((f) => checked.has(f.id));

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(floors.map((f) => f.id)));

  // 一键跑全楼校验：没点过校验的楼层也能出带结论的图（逐层让出主线程，楼层多时不卡界面）
  const runValidation = async () => {
    setValidating(true);
    try {
      for (const f of floors) {
        await new Promise((r) => setTimeout(r, 0));
        const fresh = getState().floors[f.id];
        if (fresh) setLastValidation(f.id, validateFloor(fresh, rules));
      }
    } finally {
      setValidating(false);
    }
  };

  const doPrint = () => {
    if (unvalidated.length) {
      const names = unvalidated.map((f) => floorLabel(f.level)).join('、');
      if (!confirm(`以下楼层尚未校验：${names}\n打印的图纸将缺少校验结论，合规性未知。\n仍要打印吗？（可先点「校验全部楼层」）`)) return;
    }
    window.print();
  };

  return (
    <div className="page printpage">
      <div className="toolbar no-print">
        <select value={paper} onChange={(e) => setPaper(e.target.value as keyof typeof PAPER)}>
          {Object.entries(PAPER).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={doPrint} disabled={planFloors.length === 0}>打印 / 另存 PDF（共 {plan.totalPages} 页）</button>
        <button onClick={runValidation} disabled={validating}>{validating ? '校验中…' : '校验全部楼层'}</button>
        <Link className="btn" to={`/building/${building.id}`}>返回楼栋</Link>
      </div>

      {/* 楼层勾选：默认全选；未校验的楼层醒目标出 */}
      <div className="section no-print">
        <h3>选择要出图的楼层（{planFloors.length}/{floors.length}）</h3>
        {unvalidated.length > 0 && (
          <p className="bad">有 {unvalidated.length} 层尚未校验（{unvalidated.map((f) => floorLabel(f.level)).join('、')}），打印的图纸将缺少校验结论。</p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allOn} onChange={toggleAll} title="全选 / 全不选" /></th>
              <th>楼层</th>
              <th>房间</th>
              <th>设施</th>
              <th>校验状态</th>
              <th>超限 / 警告</th>
              <th>过期/缺失设施</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((st) => (
              <tr key={st.floorId} className={!st.validated ? 'overdue-row' : ''}>
                <td><input type="checkbox" checked={checked.has(st.floorId)} onChange={() => toggle(st.floorId)} /></td>
                <td>{st.label}</td>
                <td>{floorsMap[st.floorId]?.rooms.length ?? 0}</td>
                <td>{floorsMap[st.floorId]?.facilities.length ?? 0}</td>
                <td>
                  {!st.validated ? (
                    <span className="badge st-damaged">未校验</span>
                  ) : st.pass ? (
                    <span className="badge st-ok">合规</span>
                  ) : (
                    <span className="badge st-expired">{st.errorCount} 项超限</span>
                  )}
                </td>
                <td>{st.validated ? `${st.errorCount} / ${st.warningCount}` : '—'}</td>
                <td>{st.facilityIssueCount > 0 ? <span className="bad">{st.facilityIssueCount}</span> : 0}</td>
              </tr>
            ))}
            {floors.length === 0 && (
              <tr><td colSpan={7} className="hint">本楼栋暂无楼层</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 出图计划：打印前先看到一共几页、每页放哪一层 */}
      <div className="section no-print">
        <h3>出图计划（共 {plan.totalPages} 页）</h3>
        <ol className="planlist">
          {plan.pages.map((p) => (
            <li key={p.kind === 'floor' ? p.floorId : 'summary'}>
              第 {p.pageNo} 页：{p.kind === 'floor' ? `${p.label} 疏散指示图` : '全楼汇总（各层超限与设施待整改统计）'}
              {p.kind === 'floor' && !statByFloor.get(p.floorId)?.validated && <span className="badge st-damaged">未校验</span>}
            </li>
          ))}
        </ol>
        {planFloors.length === 0 && <p className="hint">未勾选任何楼层，勾选至少一层后才能打印整份图纸。</p>}
      </div>

      {/* 图纸本体：每层一页 + 末尾全楼汇总 */}
      {plan.pages.map((p) =>
        p.kind === 'floor' ? (
          <FloorSheet
            key={p.floorId}
            floor={floorsMap[p.floorId]}
            buildingName={building.name}
            rules={rules}
            paper={PAPER[paper]}
            markPt={marks[p.floorId]}
            pageLabel={pageLabelOf(p, plan.totalPages)}
          />
        ) : (
          <SummarySheet
            key="summary"
            buildingName={building.name}
            source={rules.source}
            stats={planFloors.map((f) => statByFloor.get(f.id)!)}
            floorPages={plan.floorPages}
            totalPages={plan.totalPages}
            paper={PAPER[paper]}
            pageLabel={pageLabelOf(p, plan.totalPages)}
          />
        ),
      )}
    </div>
  );
}

/** 末尾汇总页：各层超限项数量、过期/缺失设施数与校验结论一览 */
function SummarySheet({
  buildingName,
  source,
  stats,
  floorPages,
  totalPages,
  paper,
  pageLabel,
}: {
  buildingName: string;
  source: string;
  stats: FloorPrintStat[];
  floorPages: number;
  totalPages: number;
  paper: { w: number; h: number };
  pageLabel: string;
}) {
  const generatedAt = new Date().toLocaleString('zh-CN');
  const totalErrors = stats.reduce((s, x) => s + x.errorCount, 0);
  const totalIssues = stats.reduce((s, x) => s + x.facilityIssueCount, 0);
  return (
    <div className="print-sheet" style={{ aspectRatio: `${paper.w} / ${paper.h}`, maxWidth: paper.w * 3.2 }}>
      <div className="sheet-title">
        <b>{buildingName} 全楼汇总</b>
        <span>依据：{source} ｜ 出图时间：{generatedAt}</span>
      </div>
      <div className="sheet-body">
        <table className="table">
          <thead>
            <tr>
              <th>楼层</th>
              <th>校验结论</th>
              <th>超限项</th>
              <th>警告</th>
              <th>过期/缺失/损坏设施</th>
              <th>疏散最远</th>
              <th>校验时间</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((st) => (
              <tr key={st.floorId}>
                <td>{st.label}</td>
                <td>
                  {!st.validated ? (
                    <span className="bad">未校验</span>
                  ) : st.pass ? (
                    <span className="good">合规</span>
                  ) : (
                    <span className="bad">不合规</span>
                  )}
                </td>
                <td>{st.validated ? st.errorCount : '—'}</td>
                <td>{st.validated ? st.warningCount : '—'}</td>
                <td>{st.facilityIssueCount}</td>
                <td>{st.travelWorstM != null ? `${st.travelWorstM.toFixed(1)}m` : '—'}</td>
                <td>{st.checkedAt ? new Date(st.checkedAt).toLocaleString('zh-CN') : '—'}</td>
              </tr>
            ))}
            {stats.length === 0 && (
              <tr><td colSpan={7} className="hint">未勾选楼层</td></tr>
            )}
          </tbody>
        </table>
        <p className="hint">
          合计：超限项 {totalErrors} 个，过期/缺失/损坏设施 {totalIssues} 个。
          超限项为校验结果中的 error 项；设施按检查周期判定（无检查记录计缺失）。
        </p>
      </div>
      <div className="sheet-foot">
        <span>本栋出图楼层 {floorPages} 层，全份共 {totalPages} 页</span>
        <span className="pagenum">{pageLabel}</span>
      </div>
    </div>
  );
}
