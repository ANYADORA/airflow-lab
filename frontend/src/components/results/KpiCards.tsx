import React from 'react';
import type { AnalysisResponse } from '../../types/api';
import {
  computeDynamicPressure,
  computeUnitSpanLift,
  formatReynolds,
} from '../../utils/fluidPhysics';

interface KpiCardsProps {
  result: AnalysisResponse | null;
  detailed?: boolean;
}

export const KpiCards: React.FC<KpiCardsProps> = ({ result, detailed = false }) => {
  if (!result || result.status !== 'success' || !result.coefficients) {
    return (
      <div className="kpi-grid" data-testid="kpi-cards-empty">
        <div className="kpi-card">
          <div className="kpi-label">揚力係数 CL</div>
          <div className="kpi-value">—</div>
          <div className="kpi-sub">翼を持ち上げる力の強さ</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">抗力係数 CD</div>
          <div className="kpi-value kpi-na">—（算出不可）</div>
          <div className="kpi-sub">非粘性パネル法では算出不可</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">レイノルズ数 Re</div>
          <div className="kpi-value">—</div>
          <div className="kpi-sub">慣性力と粘性力の比</div>
        </div>
      </div>
    );
  }

  const coeff = result.coefficients;
  const dim = result.dimensionless;
  const fluid = result.resolved_fluid;
  const inputs = result.inputs;
  const isHighAoa = Math.abs(inputs.angle_of_attack) > 10.0;
  const isWater = inputs.fluid_properties.preset === 'water_20c';

  const qInf = computeDynamicPressure(fluid.density_kg_m3, inputs.velocity);
  const liftPerSpan = computeUnitSpanLift(
    fluid.density_kg_m3,
    inputs.velocity,
    inputs.chord_length,
    coeff.cl
  );

  const cdReason =
    coeff.cd_unavailable_reason ??
    '非粘性ポテンシャル流れ（パネル法）では粘性抗力・剥離抗力を算出できません（Phase 2 XFOIL で対応予定）。';

  return (
    <div className="kpi-section" data-testid="kpi-cards">
      <div className="kpi-grid">
        <div className="kpi-card kpi-primary" data-testid="kpi-cl">
          <div className="kpi-label">
            揚力係数 CL
            {isHighAoa && (
              <span className="inline-warn-badge" data-testid="cl-stall-badge">
                ※剥離未考慮
              </span>
            )}
          </div>
          <div className="kpi-value">{coeff.cl.toFixed(3)}</div>
          <div className="kpi-sub">翼を持ち上げる力の強さ（KJ法）</div>
        </div>

        <div className="kpi-card" data-testid="kpi-cd" title={cdReason}>
          <div className="kpi-label">抗力係数 CD</div>
          <div className="kpi-value kpi-na" data-testid="kpi-cd-value">
            {coeff.cd === null ? '—（算出不可）' : coeff.cd.toFixed(4)}
          </div>
          <div className="kpi-sub">
            {coeff.cd === null ? '非粘性モデルのため算出不可' : '粘性抗力込み'}
          </div>
        </div>

        <div className="kpi-card" data-testid="kpi-re">
          <div className="kpi-label">レイノルズ数 Re</div>
          <div className="kpi-value">{formatReynolds(dim.reynolds_number)}</div>
          <div className="kpi-sub">慣性力と粘性力の比の目安</div>
        </div>

        {detailed && (
          <>
            <div className="kpi-card" data-testid="kpi-cm">
              <div className="kpi-label">ピッチングモーメント Cm,c/4</div>
              <div className="kpi-value">{coeff.cm_quarter_chord.toFixed(4)}</div>
              <div className="kpi-sub">1/4弦点周り（頭上げ Nose-up を正）</div>
            </div>
            <div className="kpi-card" data-testid="kpi-mach">
              <div className="kpi-label">マッハ数 M</div>
              <div className="kpi-value">{dim.mach_number.toFixed(4)}</div>
              <div className="kpi-sub">
                音速 a = {fluid.speed_of_sound_mps.toFixed(1)} m/s
              </div>
            </div>
          </>
        )}
      </div>

      <div className="kpi-aux-strip" data-testid="kpi-aux-lift">
        <span>
          参考換算：動圧 q∞ = <strong>{qInf.toFixed(1)} Pa</strong>
        </span>
        <span>
          単位スパン揚力 L&apos; = <strong>{liftPerSpan.toFixed(2)} N/m</strong>
        </span>
        {isWater && (
          <span className="water-caveat" data-testid="water-cavitation-note">
            ※水プリセット：キャビテーション未考慮
          </span>
        )}
      </div>
    </div>
  );
};
