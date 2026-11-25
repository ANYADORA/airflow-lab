import React from 'react';
import { FileText, Wind } from 'lucide-react';
import { IS_BROWSER_ENGINE } from '../../services/apiClient';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import { ModeToggle } from './ModeToggle';

export const AppHeader: React.FC = () => {
  const healthStatus = useAnalysisStore((s) => s.healthStatus);

  const okLabel = IS_BROWSER_ENGINE ? 'ブラウザ解析稼働中' : 'API 接続正常';

  return (
    <header className="app-header">
      <div className="header-brand">
        <Wind size={22} className="brand-icon" />
        <span className="brand-name">AirFlow Lab</span>
        <span className="model-badge" data-testid="physical-model-badge">
          2D 非粘性ポテンシャル流れ（パネル法）
        </span>
      </div>

      <ModeToggle />

      <div className="header-right">
        <a
          href="./paper/AirFlow_Lab_Phase1_Validation_Paper.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="paper-link"
          title="Phase 1 理論・妥当性検証論文（PDF）を開く"
        >
          <FileText size={14} />
          <span>検証論文 (PDF)</span>
        </a>

        <div className="header-status" aria-label="API 接続状態">
          <span className={`status-dot status-${healthStatus}`} />
          <span className="status-text">
            {healthStatus === 'ok'
              ? okLabel
              : healthStatus === 'loading'
                ? '接続確認中...'
                : 'API オフライン'}
          </span>
        </div>
      </div>
    </header>
  );
};
