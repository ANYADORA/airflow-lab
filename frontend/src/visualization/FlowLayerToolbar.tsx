import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import type { ContourLayer, ViewFrame } from '../types/ui';

export const FlowLayerToolbar: React.FC = () => {
  const viewSettings = useAnalysisStore((s) => s.viewSettings);
  const setViewSettings = useAnalysisStore((s) => s.setViewSettings);
  const resetViewport = useAnalysisStore((s) => s.resetViewport);

  const setContour = (layer: ContourLayer) => setViewSettings({ contourLayer: layer });
  const setFrame = (frame: ViewFrame) => setViewSettings({ viewFrame: frame });

  return (
    <div className="flow-toolbar" role="toolbar" aria-label="流れ場表示レイヤー切替">
      <div className="toolbar-group">
        <button
          type="button"
          className={`tool-btn ${viewSettings.showStreamlines ? 'active' : ''}`}
          onClick={() => setViewSettings({ showStreamlines: !viewSettings.showStreamlines })}
        >
          流線 {viewSettings.showStreamlines ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className={`tool-btn ${viewSettings.showVectors ? 'active' : ''}`}
          onClick={() => setViewSettings({ showVectors: !viewSettings.showVectors })}
        >
          速度ベクトル {viewSettings.showVectors ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="toolbar-group" role="group" aria-label="背景コンター切替">
        <button
          type="button"
          className={`tool-btn ${viewSettings.contourLayer === 'speed' ? 'active' : ''}`}
          onClick={() => setContour('speed')}
        >
          速度分布 |V|/V∞
        </button>
        <button
          type="button"
          className={`tool-btn ${viewSettings.contourLayer === 'cp' ? 'active' : ''}`}
          onClick={() => setContour('cp')}
        >
          圧力分布 Cp
        </button>
        <button
          type="button"
          className={`tool-btn ${viewSettings.contourLayer === 'none' ? 'active' : ''}`}
          onClick={() => setContour('none')}
        >
          コンターなし
        </button>
      </div>

      <div className="toolbar-group" role="group" aria-label="表示視点切替">
        <button
          type="button"
          className={`tool-btn ${viewSettings.viewFrame === 'airfoil_fixed' ? 'active' : ''}`}
          onClick={() => setFrame('airfoil_fixed')}
          title="翼弦を水平に固定し、一様流を迎角分傾けて表示（Cpグラフ横軸 x/c と対応）"
        >
          翼固定（標準）
        </button>
        <button
          type="button"
          className={`tool-btn ${viewSettings.viewFrame === 'wind_tunnel' ? 'active' : ''}`}
          onClick={() => setFrame('wind_tunnel')}
          title="一様流を水平に固定し、翼型を迎角分傾けて表示（風洞実験の見た目）"
        >
          風洞視点
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={resetViewport}
          title="ズーム・パンを初期位置へリセット"
        >
          <RotateCcw size={14} />
          <span>リセット</span>
        </button>
      </div>
    </div>
  );
};
