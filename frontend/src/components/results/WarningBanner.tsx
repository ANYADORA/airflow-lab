import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { WarningItem } from '../../types/api';

interface WarningBannerProps {
  warnings: WarningItem[];
}

export const WarningBanner: React.FC<WarningBannerProps> = ({ warnings }) => {
  if (warnings.length === 0) return null;

  return (
    <div className="warning-banner-stack" data-testid="warning-banner-stack">
      {warnings.map((w) => (
        <div
          key={w.code}
          className={`warning-banner severity-${w.severity}`}
          role="status"
          data-testid={`warning-${w.code}`}
        >
          <div className="warning-icon">
            {w.severity === 'critical' ? (
              <AlertCircle size={18} />
            ) : w.severity === 'warning' ? (
              <AlertTriangle size={18} />
            ) : (
              <Info size={18} />
            )}
          </div>
          <div className="warning-body">
            <div className="warning-title">
              <strong>{w.title}</strong>
              <span className="warning-code-tag">{w.code}</span>
            </div>
            <p className="warning-msg">{w.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
