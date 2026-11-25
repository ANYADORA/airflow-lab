import React from 'react';
import { MainWorkspace } from '../../components/layout/MainWorkspace';
import { AiExplanationPlaceholder } from '../../components/results/AiExplanationPlaceholder';
import { EducationalExplanation } from '../../components/results/EducationalExplanation';
import { ErrorOverlay } from '../../components/results/ErrorOverlay';
import { KpiCards } from '../../components/results/KpiCards';
import { WarningBanner } from '../../components/results/WarningBanner';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import { CpDistributionChart } from '../../visualization/CpDistributionChart';
import { FlowFieldCanvas } from '../../visualization/FlowFieldCanvas';
import { SimpleControlPanel } from './SimpleControlPanel';

export const SimpleModeView: React.FC = () => {
  const result = useAnalysisStore((s) => s.result);
  const apiError = useAnalysisStore((s) => s.apiError);

  const hasBlockedError = Boolean(apiError || (result && result.status !== 'success'));

  return (
    <MainWorkspace
      leftPane={<SimpleControlPanel />}
      centerPane={
        hasBlockedError ? (
          <ErrorOverlay apiError={apiError} failure={result?.failure ?? null} />
        ) : (
          <div className="center-stack">
            <FlowFieldCanvas />
            <CpDistributionChart />
          </div>
        )
      }
      rightPane={
        <div className="right-stack">
          {!hasBlockedError && result && <WarningBanner warnings={result.warnings} />}
          <KpiCards result={hasBlockedError ? null : result} detailed={false} />
          <EducationalExplanation result={hasBlockedError ? null : result} />
          <AiExplanationPlaceholder />
        </div>
      }
    />
  );
};
