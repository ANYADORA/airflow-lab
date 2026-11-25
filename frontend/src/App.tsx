import React, { useEffect } from 'react';
import { AppHeader } from './components/layout/AppHeader';
import { AdvancedModeView } from './modes/advanced/AdvancedModeView';
import { SimpleModeView } from './modes/simple/SimpleModeView';
import { useAnalysisStore } from './store/useAnalysisStore';

export const App: React.FC = () => {
  const uiMode = useAnalysisStore((s) => s.uiMode);
  const loadInitialData = useAnalysisStore((s) => s.loadInitialData);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  return (
    <div className="app-shell">
      <AppHeader />
      {uiMode === 'simple' ? <SimpleModeView /> : <AdvancedModeView />}
    </div>
  );
};

export default App;
