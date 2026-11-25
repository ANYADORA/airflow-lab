import React from 'react';
import type { FlowHoverSample } from '../types/ui';

interface FlowTooltipProps {
  sample: FlowHoverSample;
}

export const FlowTooltip: React.FC<FlowTooltipProps> = ({ sample }) => {
  return (
    <div
      className="flow-tooltip"
      style={{
        left: `${Math.min(Math.max(12, sample.screenX + 14), 460)}px`,
        top: `${Math.max(12, sample.screenY + 14)}px`,
      }}
      data-testid="flow-hover-tooltip"
    >
      <div className="tooltip-coord">
        (x/c, y/c) = ({sample.x_c.toFixed(3)}, {sample.y_c.toFixed(3)})
      </div>
      {sample.isInsideAirfoil ? (
        <div className="tooltip-inside">翼型内部（ポテンシャル評価対象外）</div>
      ) : (
        <div className="tooltip-grid">
          <span>|V|/V∞:</span>
          <strong>{sample.speed_ratio !== null ? sample.speed_ratio.toFixed(3) : '—'}</strong>
          <span>|V|:</span>
          <strong>{sample.speed_mps !== null ? `${sample.speed_mps.toFixed(2)} m/s` : '—'}</strong>
          <span>Cp:</span>
          <strong>{sample.cp !== null ? sample.cp.toFixed(3) : '—'}</strong>
          <span>(u, v)/V∞:</span>
          <strong>
            ({sample.u_ratio !== null ? sample.u_ratio.toFixed(2) : '—'},{' '}
            {sample.v_ratio !== null ? sample.v_ratio.toFixed(2) : '—'})
          </strong>
        </div>
      )}
    </div>
  );
};
