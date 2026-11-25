import React from 'react';
import type { AnalysisResponse } from '../../types/api';

interface DiagnosticsPanelProps {
  result: AnalysisResponse | null;
}

function fmtExp(val: number | null, digits = 2): string {
  if (val === null || !Number.isFinite(val)) return '—';
  return val.toExponential(digits);
}

function fmtFix(val: number | null, digits = 4): string {
  if (val === null || !Number.isFinite(val)) return '—';
  return val.toFixed(digits);
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ result }) => {
  if (!result) {
    return (
      <div className="empty-panel-note">
        解析を実行すると、収束状況・条件数・CL クロスチェックなどの数値診断が表示されます。
      </div>
    );
  }

  const d = result.diagnostics;
  const c = result.coefficients;

  return (
    <div className="diagnostics-panel" data-testid="diagnostics-panel">
      <div className={`convergence-pill ${d.converged ? 'ok' : 'fail'}`}>
        {d.converged ? '収束状態：正常（converged = true）' : '収束状態：失敗（converged = false）'}
      </div>

      <table className="diag-table">
        <tbody>
          <tr>
            <th>物理モデル</th>
            <td>{result.solver_info.model_type}</td>
          </tr>
          <tr>
            <th>CL（Kutta-Joukowski 主値）</th>
            <td>{c ? fmtFix(c.cl_kutta_joukowski, 5) : '—'}</td>
          </tr>
          <tr>
            <th>CL（表面圧力積分 検証値）</th>
            <td>{c ? fmtFix(c.cl_pressure_integration, 5) : '—'}</td>
          </tr>
          <tr>
            <th>CL クロスチェック差 ΔCL</th>
            <td>
              {d.cl_discrepancy !== null
                ? `${d.cl_discrepancy.toFixed(5)} (${((d.cl_discrepancy_relative ?? 0) * 100).toFixed(2)}%)`
                : '—'}
            </td>
          </tr>
          <tr>
            <th>行列条件数 cond(M)</th>
            <td>{fmtExp(d.condition_number, 2)}</td>
          </tr>
          <tr>
            <th>線形系最大残差</th>
            <td>{fmtExp(d.linear_residual_max, 2)}</td>
          </tr>
          <tr>
            <th>後縁圧力差 |Cp,1 - Cp,N|</th>
            <td>{fmtExp(d.te_cp_diff, 2)}</td>
          </tr>
          <tr>
            <th>圧力積分抗力残差（数値誤差・CDではない）</th>
            <td>{fmtFix(d.cd_pressure_numerical_error, 5)}</td>
          </tr>
          <tr>
            <th>最小圧力係数 Cp,min (位置 x/c)</th>
            <td>
              {d.cp_min !== null && d.cp_min_xc !== null
                ? `${d.cp_min.toFixed(3)} (x/c = ${d.cp_min_xc.toFixed(3)})`
                : '—'}
            </td>
          </tr>
          <tr>
            <th>最大速度比 (|V|/V∞)max</th>
            <td>{fmtFix(d.max_velocity_ratio, 3)}</td>
          </tr>
          <tr>
            <th>計算時間</th>
            <td>{d.compute_time_ms.toFixed(1)} ms</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
