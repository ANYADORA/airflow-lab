import React, { useMemo } from 'react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import type { FluidMode, FluidPreset } from '../../types/api';
import {
  computeFluidPreview,
  FLUID_PRESET_LABELS,
  formatReynolds,
} from '../../utils/fluidPhysics';

export const FluidPropertiesForm: React.FC = () => {
  const config = useAnalysisStore((s) => s.config);
  const setAngleOfAttack = useAnalysisStore((s) => s.setAngleOfAttack);
  const setVelocity = useAnalysisStore((s) => s.setVelocity);
  const setChordLength = useAnalysisStore((s) => s.setChordLength);
  const setFluidPreset = useAnalysisStore((s) => s.setFluidPreset);
  const setFluidProperties = useAnalysisStore((s) => s.setFluidProperties);

  const fp = config.fluid_properties;

  const preview = useMemo(
    () => computeFluidPreview(fp, config.velocity, config.chord_length),
    [fp, config.velocity, config.chord_length]
  );

  const handleModeChange = (mode: FluidMode) => {
    if (mode === 'temperature_auto') {
      setFluidProperties({
        ...fp,
        preset: fp.preset === 'water_20c' ? 'air_std_20c' : fp.preset,
        mode: 'temperature_auto',
        density_kg_m3: null,
        dynamic_viscosity_pa_s: null,
        kinematic_viscosity_m2_s: null,
      });
    } else if (mode === 'direct_mu') {
      setFluidProperties({
        ...fp,
        preset: 'custom',
        mode: 'direct_mu',
        density_kg_m3: fp.density_kg_m3 ?? 1.2041,
        dynamic_viscosity_pa_s: fp.dynamic_viscosity_pa_s ?? 1.813e-5,
        kinematic_viscosity_m2_s: null,
      });
    } else {
      setFluidProperties({
        ...fp,
        preset: 'custom',
        mode: 'direct_nu',
        density_kg_m3: fp.density_kg_m3 ?? 1.2041,
        dynamic_viscosity_pa_s: null,
        kinematic_viscosity_m2_s: fp.kinematic_viscosity_m2_s ?? 1.506e-5,
      });
    }
  };

  return (
    <div className="adv-subpanel">
      <div className="field-row">
        <label htmlFor="adv-aoa">迎角 α [deg] (-45〜45)</label>
        <input
          id="adv-aoa"
          type="number"
          className="num-input"
          step={0.1}
          min={-45}
          max={45}
          value={config.angle_of_attack}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setAngleOfAttack(v);
          }}
        />
      </div>

      <div className="field-row">
        <label htmlFor="adv-vel">一様流風速 V∞ [m/s]</label>
        <input
          id="adv-vel"
          type="number"
          className="num-input"
          step="any"
          min={0.01}
          max={1000}
          value={config.velocity}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setVelocity(v);
          }}
        />
      </div>

      <div className="field-row">
        <label htmlFor="adv-chord">翼弦長 c [m]</label>
        <input
          id="adv-chord"
          type="number"
          className="num-input"
          step="any"
          min={0.0001}
          max={100}
          value={config.chord_length}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setChordLength(v);
          }}
        />
      </div>

      <div className="field-row">
        <label htmlFor="adv-fluid-preset">流体プリセット</label>
        <select
          id="adv-fluid-preset"
          className="select-input"
          value={fp.preset}
          onChange={(e) => setFluidPreset(e.target.value as FluidPreset)}
        >
          {(['air_std_20c', 'air_0c', 'water_20c', 'custom'] as FluidPreset[]).map((p) => (
            <option key={p} value={p}>
              {FLUID_PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="adv-fluid-mode">物性入力モード</label>
        <select
          id="adv-fluid-mode"
          className="select-input"
          value={fp.mode}
          disabled={fp.preset === 'water_20c'}
          onChange={(e) => handleModeChange(e.target.value as FluidMode)}
        >
          <option value="temperature_auto">温度・静圧から自動推算（Sutherland則）</option>
          <option value="direct_mu">密度 ρ・粘性係数 μ 直接入力</option>
          <option value="direct_nu">密度 ρ・動粘性係数 ν 直接入力</option>
        </select>
      </div>

      {fp.preset !== 'water_20c' && fp.mode === 'temperature_auto' && (
        <>
          <div className="field-row">
            <label htmlFor="adv-temp">
              静温 T [K]（{(fp.temperature_k - 273.15).toFixed(1)} ℃）
            </label>
            <input
              id="adv-temp"
              type="number"
              className="num-input"
              step={1}
              min={50}
              max={2000}
              value={fp.temperature_k}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) {
                  setFluidProperties({ ...fp, preset: 'custom', temperature_k: v });
                }
              }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="adv-press">静圧 p∞ [Pa]</label>
            <input
              id="adv-press"
              type="number"
              className="num-input"
              step={100}
              min={1}
              value={fp.static_pressure_pa ?? 101325}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) {
                  setFluidProperties({ ...fp, preset: 'custom', static_pressure_pa: v });
                }
              }}
            />
          </div>
        </>
      )}

      {fp.preset !== 'water_20c' && fp.mode !== 'temperature_auto' && (
        <>
          <div className="field-row">
            <label htmlFor="adv-rho">密度 ρ [kg/m³]</label>
            <input
              id="adv-rho"
              type="number"
              className="num-input"
              step={0.01}
              value={fp.density_kg_m3 ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setFluidProperties({ ...fp, density_kg_m3: v });
              }}
            />
          </div>
          {fp.mode === 'direct_mu' ? (
            <div className="field-row">
              <label htmlFor="adv-mu">粘性係数 μ [Pa·s]</label>
              <input
                id="adv-mu"
                type="number"
                className="num-input"
                step={1e-6}
                value={fp.dynamic_viscosity_pa_s ?? ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setFluidProperties({ ...fp, dynamic_viscosity_pa_s: v });
                }}
              />
            </div>
          ) : (
            <div className="field-row">
              <label htmlFor="adv-nu">動粘性係数 ν [m²/s]</label>
              <input
                id="adv-nu"
                type="number"
                className="num-input"
                step={1e-6}
                value={fp.kinematic_viscosity_m2_s ?? ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    setFluidProperties({ ...fp, kinematic_viscosity_m2_s: v });
                  }
                }}
              />
            </div>
          )}
          <div className="field-row">
            <label htmlFor="adv-a">音速 a [m/s]（液体時は必須）</label>
            <input
              id="adv-a"
              type="number"
              className="num-input"
              step={1}
              value={fp.speed_of_sound_mps ?? ''}
              placeholder="空欄は空気音速"
              onChange={(e) => {
                const raw = e.target.value.trim();
                setFluidProperties({
                  ...fp,
                  speed_of_sound_mps: raw === '' ? null : Number(raw),
                });
              }}
            />
          </div>
        </>
      )}

      {preview && (
        <div className="preview-metrics-box" data-testid="fluid-preview-metrics">
          <div>
            プレビュー Re: <strong>{formatReynolds(preview.reynolds_number)}</strong>
          </div>
          <div>
            プレビュー Mach: <strong>{preview.mach_number.toFixed(4)}</strong>
          </div>
        </div>
      )}
    </div>
  );
};
