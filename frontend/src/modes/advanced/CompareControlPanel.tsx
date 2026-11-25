import React from 'react';
import { GitCompare, Pin, Trash2 } from 'lucide-react';
import { useAnalysisStore } from '../../store/useAnalysisStore';

function fmtSigned(val: number | null, digits = 4): string {
  if (val === null || !Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(digits)}`;
}

export const CompareControlPanel: React.FC = () => {
  const result = useAnalysisStore((s) => s.result);
  const compareState = useAnalysisStore((s) => s.compareState);
  const pinCurrentAsBase = useAnalysisStore((s) => s.pinCurrentAsBase);
  const runCompareWithCurrent = useAnalysisStore((s) => s.runCompareWithCurrent);
  const clearCompare = useAnalysisStore((s) => s.clearCompare);

  const canPin = Boolean(result && result.status === 'success');
  const pinned = compareState.pinnedBase;

  return (
    <div className="compare-panel" data-testid="compare-control-panel">
      <h4>2条件比較（Case A vs Case B）</h4>
      <p className="panel-desc">
        現在の解析結果を基準（Case A）としてピン留めし、左パネルで別条件へ変更した後に比較実行すると、表面 Cp グラフを重ね合わせて差分を表示します。
      </p>

      <div className="action-row-inline">
        <button
          type="button"
          className="secondary-btn"
          disabled={!canPin}
          onClick={pinCurrentAsBase}
        >
          <Pin size={14} />
          現在の結果を Case A に固定
        </button>

        {pinned && (
          <>
            <button
              type="button"
              className="primary-btn-sm"
              disabled={compareState.isComparing}
              onClick={() => void runCompareWithCurrent()}
            >
              <GitCompare size={14} />
              {compareState.isComparing ? '比較中...' : '現在条件 (Case B) と比較'}
            </button>
            <button type="button" className="secondary-btn" onClick={clearCompare}>
              <Trash2 size={14} />
              解除
            </button>
          </>
        )}
      </div>

      {pinned && (
        <div className="pinned-summary">
          <strong>Case A（基準）:</strong> {pinned.airfoil_geometry?.name ?? 'Airfoil'} / α ={' '}
          {pinned.inputs.angle_of_attack.toFixed(1)}° / CL ={' '}
          {pinned.coefficients ? pinned.coefficients.cl.toFixed(3) : '—'}
        </div>
      )}

      {compareState.diff && (
        <table className="diag-table" data-testid="compare-diff-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>差分（Case B − Case A）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>ΔCL</th>
              <td>{fmtSigned(compareState.diff.delta_cl, 4)}</td>
            </tr>
            <tr>
              <th>ΔCm,c/4</th>
              <td>{fmtSigned(compareState.diff.delta_cm_quarter_chord, 4)}</td>
            </tr>
            <tr>
              <th>ΔCD</th>
              <td>
                {compareState.diff.delta_cd === null
                  ? '—（算出不可）'
                  : fmtSigned(compareState.diff.delta_cd, 4)}
              </td>
            </tr>
            <tr>
              <th>ΔCp,min</th>
              <td>{fmtSigned(compareState.diff.delta_cp_min, 3)}</td>
            </tr>
            <tr>
              <th>ΔRe</th>
              <td>{fmtSigned(compareState.diff.delta_reynolds_number, 1)}</td>
            </tr>
            <tr>
              <th>ΔMach</th>
              <td>{fmtSigned(compareState.diff.delta_mach_number, 4)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
};
