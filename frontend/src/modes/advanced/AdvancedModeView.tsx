import React from 'react';
import { MainWorkspace } from '../../components/layout/MainWorkspace';
import { AiExplanationPlaceholder } from '../../components/results/AiExplanationPlaceholder';
import { DiagnosticsPanel } from '../../components/results/DiagnosticsPanel';
import { EducationalExplanation } from '../../components/results/EducationalExplanation';
import { ErrorOverlay } from '../../components/results/ErrorOverlay';
import { KpiCards } from '../../components/results/KpiCards';
import { WarningBanner } from '../../components/results/WarningBanner';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import { CompareChart } from '../../visualization/CompareChart';
import { CpDistributionChart } from '../../visualization/CpDistributionChart';
import { FlowFieldCanvas } from '../../visualization/FlowFieldCanvas';
import { AdvancedControlPanel } from './AdvancedControlPanel';
import { CompareControlPanel } from './CompareControlPanel';
import { ExportImportPanel } from './ExportImportPanel';

export const AdvancedModeView: React.FC = () => {
  const result = useAnalysisStore((s) => s.result);
  const apiError = useAnalysisStore((s) => s.apiError);
  const activeTab = useAnalysisStore((s) => s.advancedRightTab);
  const setActiveTab = useAnalysisStore((s) => s.setAdvancedRightTab);

  const hasBlockedError = Boolean(apiError || (result && result.status !== 'success'));

  return (
    <MainWorkspace
      leftPane={<AdvancedControlPanel />}
      centerPane={
        hasBlockedError ? (
          <ErrorOverlay apiError={apiError} failure={result?.failure ?? null} />
        ) : (
          <div className="center-stack">
            <FlowFieldCanvas />
            <CpDistributionChart />
            <CompareChart />
          </div>
        )
      }
      rightPane={
        <div className="right-stack">
          {!hasBlockedError && result && <WarningBanner warnings={result.warnings} />}
          <KpiCards result={hasBlockedError ? null : result} detailed={true} />

          <div className="right-tabs" role="tablist" aria-label="詳細結果タブ">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'explanation'}
              className={`tab-btn ${activeTab === 'explanation' ? 'active' : ''}`}
              onClick={() => setActiveTab('explanation')}
            >
              学習解説
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
              onClick={() => setActiveTab('diagnostics')}
            >
              結果・診断
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'compare_io'}
              className={`tab-btn ${activeTab === 'compare_io' ? 'active' : ''}`}
              onClick={() => setActiveTab('compare_io')}
            >
              比較・入出力
            </button>
          </div>

          {activeTab === 'explanation' && (
            <>
              <EducationalExplanation result={hasBlockedError ? null : result} />
              <AiExplanationPlaceholder />
            </>
          )}
          {activeTab === 'diagnostics' && <DiagnosticsPanel result={result} />}
          {activeTab === 'compare_io' && (
            <div className="compare-io-stack">
              <CompareControlPanel />
              <ExportImportPanel />
            </div>
          )}
        </div>
      }
    />
  );
};
