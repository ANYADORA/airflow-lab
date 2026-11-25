import React from 'react';
import { useAnalysisStore } from '../../store/useAnalysisStore';

export const SolverSettingsForm: React.FC = () => {
  const config = useAnalysisStore((s) => s.config);
  const setNumericalSettings = useAnalysisStore((s) => s.setNumericalSettings);
  const ns = config.numerical_settings;

  return (
    <div className="adv-subpanel">
      <div className="solver-radio-group" role="radiogroup" aria-label="計算手法（ソルバー）選択">
        <label className="solver-card selected">
          <input
            type="radio"
            name="solver-method"
            value="panel_method"
            checked={config.solver.method === 'panel_method'}
            readOnly
          />
          <div>
            <strong>パネル法（2D 非粘性・非圧縮）</strong>
            <span className="solver-phase-tag active">Phase 1 利用可</span>
            <p>Hess-Smith ポテンシャル流れ（CL, Cm, Cp 算出。CD は算出不可）</p>
          </div>
        </label>

        <label className="solver-card disabled">
          <input
            type="radio"
            name="solver-method"
            value="xfoil"
            disabled
            data-testid="solver-option-xfoil"
          />
          <div>
            <strong>XFOIL（2D 粘性境界層連成）</strong>
            <span className="solver-phase-tag planned">Phase 2 開発予定</span>
            <p>粘性抗力 CD・遷移・軽度剥離に対応予定（現在利用不可）</p>
          </div>
        </label>

        <label className="solver-card disabled">
          <input
            type="radio"
            name="solver-method"
            value="cfd_su2"
            disabled
            data-testid="solver-option-cfd"
          />
          <div>
            <strong>2D CFD（SU2 / RANS）</strong>
            <span className="solver-phase-tag planned">Phase 3 開発予定</span>
            <p>大規模剥離・失速後流・圧縮性流れに対応予定（現在利用不可）</p>
          </div>
        </label>
      </div>

      <div className="field-row">
        <label htmlFor="adv-num-panels">パネル数 N（40〜300 偶数）</label>
        <input
          id="adv-num-panels"
          type="number"
          className="num-input"
          min={40}
          max={300}
          step={2}
          value={ns.num_panels}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) {
              setNumericalSettings({ num_panels: Math.round(v) });
            }
          }}
        />
      </div>

      <div className="field-row checkbox-row">
        <label htmlFor="adv-closed-te">後縁閉合（closed_te）</label>
        <input
          id="adv-closed-te"
          type="checkbox"
          checked={ns.closed_te}
          onChange={(e) => setNumericalSettings({ closed_te: e.target.checked })}
        />
      </div>

      <div className="field-row-2col">
        <div>
          <label htmlFor="adv-grid-nx">格子 Nx (40〜240)</label>
          <input
            id="adv-grid-nx"
            type="number"
            className="num-input"
            min={40}
            max={240}
            value={ns.grid_nx}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setNumericalSettings({ grid_nx: Math.round(v) });
            }}
          />
        </div>
        <div>
          <label htmlFor="adv-grid-ny">格子 Ny (30〜180)</label>
          <input
            id="adv-grid-ny"
            type="number"
            className="num-input"
            min={30}
            max={180}
            value={ns.grid_ny}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setNumericalSettings({ grid_ny: Math.round(v) });
            }}
          />
        </div>
      </div>

      <div className="field-row">
        <label htmlFor="adv-streamlines">流線本数 (10〜60)</label>
        <input
          id="adv-streamlines"
          type="number"
          className="num-input"
          min={10}
          max={60}
          value={ns.num_streamlines}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setNumericalSettings({ num_streamlines: Math.round(v) });
          }}
        />
      </div>
    </div>
  );
};
