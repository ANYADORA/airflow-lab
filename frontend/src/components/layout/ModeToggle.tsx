import React from 'react';
import { useAnalysisStore } from '../../store/useAnalysisStore';

export const ModeToggle: React.FC = () => {
  const uiMode = useAnalysisStore((s) => s.uiMode);
  const setUiMode = useAnalysisStore((s) => s.setUiMode);

  return (
    <div className="mode-toggle" role="tablist" aria-label="表示モード切替">
      <button
        type="button"
        role="tab"
        aria-selected={uiMode === 'simple'}
        className={`mode-btn ${uiMode === 'simple' ? 'active' : ''}`}
        onClick={() => setUiMode('simple')}
        data-testid="mode-btn-simple"
      >
        簡易モード
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={uiMode === 'advanced'}
        className={`mode-btn ${uiMode === 'advanced' ? 'active' : ''}`}
        onClick={() => setUiMode('advanced')}
        data-testid="mode-btn-advanced"
      >
        本格モード
      </button>
    </div>
  );
};
