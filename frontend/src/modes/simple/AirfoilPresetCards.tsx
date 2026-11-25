import React from 'react';
import { useAnalysisStore } from '../../store/useAnalysisStore';

function buildSvgPath(xs: number[], ys: number[]): string {
  if (xs.length < 2) return '';
  const width = 96;
  const height = 32;
  const padX = 6;
  const scale = width - padX * 2;
  const cy = height * 0.56;
  const pts = xs.map((x, i) => {
    const sx = padX + x * scale;
    const sy = cy - ys[i] * scale * 1.4;
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
  });
  return `${pts.join(' ')} Z`;
}

export const AirfoilPresetCards: React.FC = () => {
  const presets = useAnalysisStore((s) => s.presets);
  const airfoil = useAnalysisStore((s) => s.config.airfoil);
  const selectNacaPreset = useAnalysisStore((s) => s.selectNacaPreset);
  const setUiMode = useAnalysisStore((s) => s.setUiMode);

  return (
    <div className="control-block">
      <label className="control-label">翼の形（翼型）</label>
      <div className="preset-grid">
        {presets.map((p) => {
          const selected =
            airfoil.source_type === 'naca4' && airfoil.naca_code === p.naca_code;
          return (
            <button
              key={p.id}
              type="button"
              className={`preset-card ${selected ? 'selected' : ''}`}
              onClick={() => selectNacaPreset(p.naca_code, p.name)}
              data-testid={`preset-card-${p.naca_code}`}
            >
              <svg viewBox="0 0 96 32" className="preset-svg" aria-hidden="true">
                <path
                  d={buildSvgPath(p.preview_coords.x, p.preview_coords.y)}
                  fill={selected ? '#93c5fd' : '#cbd5e1'}
                  stroke={selected ? '#1d4ed8' : '#334155'}
                  strokeWidth="1.4"
                />
              </svg>
              <span className="preset-name">{p.name}</span>
              <span className="preset-tag">
                {p.is_symmetric ? '対称翼' : `反り ${(p.max_camber_ratio * 100).toFixed(0)}%`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="custom-airfoil-slot">
        <span className="slot-label">カスタム翼型（DAT/CSV）</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => setUiMode('advanced')}
        >
          自分の翼型データを使うには本格モードへ切替 →
        </button>
      </div>
    </div>
  );
};
