import React, { useMemo } from 'react';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import type { FluidPreset } from '../../types/api';
import { computeFluidPreview, FLUID_PRESET_LABELS } from '../../utils/fluidPhysics';
import { AirfoilPresetCards } from './AirfoilPresetCards';

const SIMPLE_FLUID_PRESETS: FluidPreset[] = ['air_std_20c', 'air_0c', 'water_20c'];

export const SimpleControlPanel: React.FC = () => {
  const config = useAnalysisStore((s) => s.config);
  const isAdvancedCustomized = useAnalysisStore((s) => s.isAdvancedCustomized);
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const setAngleOfAttack = useAnalysisStore((s) => s.setAngleOfAttack);
  const setVelocity = useAnalysisStore((s) => s.setVelocity);
  const setChordLength = useAnalysisStore((s) => s.setChordLength);
  const setFluidPreset = useAnalysisStore((s) => s.setFluidPreset);
  const resetAdvancedToSimpleDefaults = useAnalysisStore((s) => s.resetAdvancedToSimpleDefaults);
  const runAnalysis = useAnalysisStore((s) => s.runAnalysis);

  const preview = useMemo(
    () => computeFluidPreview(config.fluid_properties, config.velocity, config.chord_length),
    [config.fluid_properties, config.velocity, config.chord_length]
  );

  const absAlpha = Math.abs(config.angle_of_attack);
  const aoaZoneClass =
    absAlpha > 12 ? 'aoa-critical' : absAlpha > 10 ? 'aoa-warning' : 'aoa-normal';

  const handleSubmit: React.FormEventHandler = (e) => {
    e.preventDefault();
    void runAnalysis();
  };

  return (
    <form className="control-panel" onSubmit={handleSubmit} noValidate data-testid="simple-control-panel">
      {isAdvancedCustomized && (
        <div className="advanced-custom-badge" data-testid="advanced-customized-badge">
          <div>
            <strong>詳細設定を適用中</strong>
            <span>（本格モードの変更を保持しています）</span>
          </div>
          <button
            type="button"
            className="reset-inline-btn"
            onClick={resetAdvancedToSimpleDefaults}
            data-testid="reset-advanced-defaults-btn"
          >
            <RotateCcw size={13} />
            標準値に戻す
          </button>
        </div>
      )}

      <AirfoilPresetCards />

      <div className="control-block">
        <div className="control-row-header">
          <label htmlFor="simple-aoa" className="control-label">
            迎角 α（翼の傾き）[°]
          </label>
          <input
            id="simple-aoa"
            type="number"
            className="num-input-sm"
            step={0.5}
            min={-10}
            max={15}
            value={config.angle_of_attack}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setAngleOfAttack(v);
            }}
          />
        </div>
        <input
          type="range"
          className={`slider ${aoaZoneClass}`}
          min={-10}
          max={15}
          step={0.5}
          value={Math.max(-10, Math.min(15, config.angle_of_attack))}
          onChange={(e) => setAngleOfAttack(Number(e.target.value))}
          aria-label="迎角スライダー"
        />
        <div className="aoa-zone-bar" aria-hidden="true">
          <span className="zone-safe">-10° 〜 10°（通常域）</span>
          <span className="zone-amber">10〜12° 注意</span>
          <span className="zone-red">&gt;12° 失速域</span>
        </div>
      </div>

      <div className="control-block">
        <div className="control-row-header">
          <label htmlFor="simple-vel" className="control-label">
            風速 V∞ [m/s]
          </label>
          <input
            id="simple-vel"
            type="number"
            className="num-input-sm"
            step="any"
            min={0.1}
            max={300}
            value={config.velocity}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setVelocity(v);
            }}
          />
        </div>
        <input
          type="range"
          className="slider"
          min={1}
          max={100}
          step={0.5}
          value={Math.max(1, Math.min(100, config.velocity))}
          onChange={(e) => setVelocity(Number(e.target.value))}
          aria-label="風速スライダー"
        />
      </div>

      <div className="control-block">
        <div className="control-row-header">
          <label htmlFor="simple-chord" className="control-label">
            翼の長さ（翼弦長 c）[m]
          </label>
          <input
            id="simple-chord"
            type="number"
            className="num-input-sm"
            step={0.01}
            min={0.01}
            max={10}
            value={config.chord_length}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setChordLength(v);
            }}
          />
        </div>
        <input
          type="range"
          className="slider"
          min={0.05}
          max={2.0}
          step={0.05}
          value={Math.max(0.05, Math.min(2.0, config.chord_length))}
          onChange={(e) => setChordLength(Number(e.target.value))}
          aria-label="翼弦長スライダー"
        />
      </div>

      <div className="control-block">
        <label htmlFor="simple-fluid" className="control-label">
          流体の種類
        </label>
        <select
          id="simple-fluid"
          className="select-input"
          value={
            SIMPLE_FLUID_PRESETS.includes(config.fluid_properties.preset)
              ? config.fluid_properties.preset
              : 'air_std_20c'
          }
          onChange={(e) => setFluidPreset(e.target.value as FluidPreset)}
        >
          {SIMPLE_FLUID_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {FLUID_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
        {preview && (
          <div className="fluid-readonly-note">
            ρ = {preview.density_kg_m3.toFixed(3)} kg/m³ / ν ={' '}
            {preview.kinematic_viscosity_m2_s.toExponential(2)} m²/s
          </div>
        )}
      </div>

      <div className="panel-footer-sticky">
        <button
          type="submit"
          className="run-primary-btn"
          disabled={isRunning}
          data-testid="run-analysis-btn"
        >
          {isRunning ? (
            <>
              <Loader2 size={16} className="spin" />
              <span>解析を実行中...</span>
            </>
          ) : (
            <>
              <Play size={16} />
              <span>流れを解析する</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
