import { useMemo, useState } from 'react';
import type { Floor } from '../model';
import { checkDueInfo, validateFloor } from '../lib/engine';
import { getState, useStore, setLastValidation } from '../store/store';
import { floorLabel } from '../store/id';
import { Link } from '../router';
import { FloorMapSheet, PageSizeStyle, PAPER, SummarySheet, type FloorSummary, type PaperKey } from '../components/PrintSheet';

export function BatchPrintPage({ buildingId }: { buildingId: string }) {
  const building = useStore((s) => s.buildings.find((b) => b.id === buildingId));
  const allFloors = useStore((s) => s.floors);
  const rules = useStore((s) => (building ? s.rules[building.kind] : undefined));
  const marks = useStore((s) => s.marks);
  const [paper, setPaper] = useState<PaperKey>('a4l');
  // 默认全选：进入页面时勾选整栋楼全部楼层
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [validating, setValidating] = useState(false);

  // 楼层按层号从低到高（B2、B1、1F、2F……）
  const floors: Floor[] = useMemo(() => {
    if (!building) return [];
    return building.floors
      .map((id) => allFloors[id])
      .filter(Boolean)
      .sort((a, b) => a.level - b.level);
  }, [building, allFloors]);

  const checked = selected ?? new Set(floors.map((f) => f.id));
  const chosen = floors.filter((f) => checked.has(f.id));
  const chosenKey = chosen.map((f) => f.id).join(',');

  // 各层台账实时统计（过期/缺检/损坏），以及来自最近校验的超限数
  const summaries = useMemo<FloorSummary[]>(
    () =>
      chosen.map((f) => {
        const r = f.lastValidation;
        let overdue = 0;
        let missing = 0;
        let defect = 0;
        for (const fac of f.facilities) {
          const info = checkDueInfo(fac, Date.now());
          if (info.overdue) overdue++;
          if (info.missing) missing++;
          if (info.defect) defect++;
        }
        return {
          floorId: f.id,
          level: f.level,
          facilities: f.facilities.length,
          validated: !!r,
          pass: r?.pass ?? false,
          errors: r ? r.items.filter((i) => i.severity === 'error').length : 0,
          warnings: r ? r.items.filter((i) => i.severity === 'warning').length : 0,
          overdue,
          missing,
          defect,
        };
      }),
    [chosen, rules],
  );

  // 勾选集或纸张变化时刷新「出图时间」；逐层写回校验结果不应让时间跳动
  const generatedAt = useMemo(() => new Date(), [chosenKey, paper]);

  if (!building || !rules) {
    return <div className="page">建筑不存在。<Link to="/">返回首页</Link></div>;
  }

  const unvalidatedChosen = chosen.filter((f) => !f.lastValidation);
  const totalPages = chosen.length + (chosen.length ? 1 : 0);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(floors.map((f) => f.id)));
  const selectNone = () => setSelected(new Set());

  // 批量补校验：只跑没校验过的楼层；每跑完一层写回结果，列表状态逐层刷新
  const runMissingValidation = () => {
    const targets = floors.filter((f) => !f.lastValidation);
    if (!targets.length) return;
    setValidating(true);
    let i = 0;
    const step = () => {
      if (i >= targets.length) {
        setValidating(false);
        return;
      }
      // 每步从 store 取最新楼层：上一步写回后拿到的是新引用，与编辑器同一引擎
      const fresh = getState().floors[targets[i].id];
      if (fresh && !fresh.lastValidation) {
        setLastValidation(fresh.id, validateFloor(fresh, rules));
      }
      i++;
      setTimeout(step, 30);
    };
    setTimeout(step, 30);
  };

  const doPrint = () => {
    if (unvalidatedChosen.length && !confirm(
      `有 ${unvalidatedChosen.length} 个勾选楼层从未校验（${unvalidatedChosen.map((f) => floorLabel(f.level)).join('、')}），\n` +
      '这些图纸的合规状态未知。仍要继续批量出图吗？',
    )) {
      return;
    }
    window.print();
  };

  const rowBadge = (f: Floor) => {
    const v = f.lastValidation;
    if (!v) return <span className="badge unval">未校验 · 合规未知</span>;
    if (v.pass) return <span className="badge st-ok">合规</span>;
    return <span className="badge st-damaged">{v.items.filter((i) => i.severity === 'error').length} 项超限</span>;
  };

  return (
    <div className="page printpage batchprint">
      <PageSizeStyle paper={paper} />

      <div className="toolbar no-print">
        <h2 style={{ margin: 0 }}>{building.name} · 整楼批量出图</h2>
      </div>
      <div className="toolbar no-print">
        <select value={paper} onChange={(e) => setPaper(e.target.value as PaperKey)}>
          {Object.entries(PAPER).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={doPrint} disabled={!chosen.length}>打印 / 另存 PDF（共 {totalPages} 页）</button>
        <button onClick={runMissingValidation} disabled={validating || !floors.some((f) => !f.lastValidation)}>
          {validating ? '校验中…' : '补跑未校验楼层'}
        </button>
        <button className="ghost" onClick={selectAll}>全选</button>
        <button className="ghost" onClick={selectNone}>清空</button>
        <Link className="btn" to={`/building/${buildingId}`}>返回楼栋</Link>
      </div>

      {unvalidatedChosen.length > 0 && (
        <div className="section warn-banner no-print">
          勾选的楼层中有 <b>{unvalidatedChosen.length}</b> 个从未校验（{unvalidatedChosen.map((f) => floorLabel(f.level)).join('、')}），
          图纸合规状态未知。可点「补跑未校验楼层」直接在本页完成校验，或先
          打开对应楼层编辑器；强行出图时会再次确认，且相应图纸页脚与汇总页均会标注「未校验」。
        </div>
      )}

      {/* 出图预览清单：打之前先看清共几页、每页哪一层 */}
      <div className="section no-print">
        <h3>出图清单（共 {totalPages} 页{chosen.length ? '，末页为全楼汇总' : ''}）</h3>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>页码</th>
              <th>楼层</th>
              <th>房间/设施</th>
              <th>校验状态</th>
              <th>过期/缺检</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {floors.map((f) => {
              const on = checked.has(f.id);
              const due = f.facilities.reduce(
                (acc, fac) => {
                  const info = checkDueInfo(fac, Date.now());
                  if (info.overdue) acc.overdue++;
                  if (info.missing) acc.missing++;
                  if (info.defect) acc.defect++;
                  return acc;
                },
                { overdue: 0, missing: 0, defect: 0 },
              );
              return (
                <tr key={f.id} className={!f.lastValidation ? 'unval-row' : undefined}>
                  <td>
                    <input type="checkbox" checked={on} onChange={() => toggle(f.id)} aria-label={`选择 ${floorLabel(f.level)}`} />
                  </td>
                  <td>{on ? `第 ${chosen.indexOf(f) + 1}/${totalPages} 页` : '—'}</td>
                  <td>
                    <b>{floorLabel(f.level)}</b>
                    {!f.lastValidation && <span className="unval-flag" title="从未运行校验">⚠</span>}
                  </td>
                  <td>{f.rooms.length} / {f.facilities.length}</td>
                  <td>{rowBadge(f)}</td>
                  <td className={due.overdue + due.missing + due.defect > 0 ? 'warn' : ''}>
                    {due.overdue + due.missing + due.defect > 0
                      ? `过期 ${due.overdue} · 缺检 ${due.missing} · 损坏/缺失 ${due.defect}`
                      : '—'}
                  </td>
                  <td>
                    <Link to={`/floor/${f.id}`}>去校验</Link>{' '}
                    <Link to={`/floor/${f.id}/print`}>单层出图</Link>
                  </td>
                </tr>
              );
            })}
            {floors.length === 0 && (
              <tr><td colSpan={7} className="hint">该楼栋还没有楼层。</td></tr>
            )}
            {chosen.length > 0 && (
              <tr className="summary-total">
                <td />
                <td>{`第 ${totalPages}/${totalPages} 页`}</td>
                <td><b>全楼汇总</b></td>
                <td colSpan={2} className="hint">各层超限项数量、过期/缺失设施数（按当前勾选楼层统计）</td>
                <td />
                <td />
              </tr>
            )}
          </tbody>
        </table>
        <p className="hint">每层独立起一页，页眉含楼栋名、层号、比例尺与依据文号，页脚带「层号 第 x/N 页」。</p>
      </div>

      {/* 打印区域：仅勾选楼层 + 末页汇总 */}
      <div className="sheets">
        {chosen.map((f, i) => (
          <FloorMapSheet
            key={f.id}
            floor={f}
            buildingName={building.name}
            rules={rules}
            paper={paper}
            pageLabel={floorLabel(f.level)}
            pageOf={`第 ${i + 1}/${totalPages} 页`}
            mark={marks[f.id]}
          />
        ))}
        {chosen.length > 0 && (
          <SummarySheet
            buildingName={building.name}
            paper={paper}
            rows={summaries}
            pageOf={`第 ${totalPages}/${totalPages} 页`}
            source={rules.source}
            generatedAt={generatedAt}
          />
        )}
      </div>
    </div>
  );
}
