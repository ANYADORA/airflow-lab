import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import { AirfoilCoordinatePanel } from './AirfoilCoordinatePanel';
import { FluidPropertiesForm } from './FluidPropertiesForm';
import { SolverSettingsForm } from './SolverSettingsForm';

export const AdvancedControlPanel: React.FC = () => {
  const isRunning = useAnalysisStore((s) => s.isRunning);
  const runAnalysis = useAnalysisStore((s) => s.runAnalysis);

  const [openAirfoil, setOpenAirfoil] = useState(true);
  const [openFluid, setOpenFluid] = useState(true);
  const [openSolver, setOpenSolver] = useState(true);

  const handleSubmit: React.FormEventHandler = (e) => {
    e.preventDefault();
    void runAnalysis();
  };

  return (
    <form className="control-panel" onSubmit={handleSubmit} noValidate data-testid="advanced-control-panel">
      <div className="accordion-section">
        <button
          type="button"
          className="accordion-header"
          onClick={() => setOpenAirfoil((v) => !v)}
          aria-expanded={openAirfoil}
        >
          {openAirfoil ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>① 翼型（NACA / DAT・CSV / 座標表）</span>
        </button>
        {openAirfoil && <AirfoilCoordinatePanel />}
      </div>

      <div className="accordion-section">
        <button
          type="button"
          className="accordion-header"
          onClick={() => setOpenFluid((v) => !v)}
          aria-expanded={openFluid}
        >
          {openFluid ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>② 流れ条件・流体物性</span>
        </button>
        {openFluid && <FluidPropertiesForm />}
      </div>

      <div className="accordion-section">
        <button
          type="button"
          className="accordion-header"
          onClick={() => setOpenSolver((v) => !v)}
          aria-expanded={openSolver}
        >
          {openSolver ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>③ 計算手法・数値設定</span>
        </button>
        {openSolver && <SolverSettingsForm />}
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
