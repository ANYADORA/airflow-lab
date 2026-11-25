import React, { useEffect, useRef } from 'react';
import Plotly, { type PlotlyHTMLElement, type PlotlyLayout, type PlotlyTrace } from 'plotly.js-dist-min';
import { useAnalysisStore } from '../store/useAnalysisStore';

export const CpDistributionChart: React.FC = () => {
  const result = useAnalysisStore((s) => s.result);
  const viewSettings = useAnalysisStore((s) => s.viewSettings);
  const hoveredXc = useAnalysisStore((s) => s.hoveredXc);
  const setViewSettings = useAnalysisStore((s) => s.setViewSettings);
  const setHoveredXc = useAnalysisStore((s) => s.setHoveredXc);

  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    if (!result || result.status !== 'success' || !result.surface || !result.airfoil_geometry) {
      Plotly.purge(el);
      return;
    }

    const { x_c, side, cp } = result.surface;
    const upperX: number[] = [];
    const upperCp: number[] = [];
    const lowerX: number[] = [];
    const lowerCp: number[] = [];

    for (let i = 0; i < x_c.length; i += 1) {
      if (side[i] === 'upper') {
        upperX.push(x_c[i]);
        upperCp.push(cp[i]);
      } else {
        lowerX.push(x_c[i]);
        lowerCp.push(cp[i]);
      }
    }

    const traces: PlotlyTrace[] = [
      {
        type: 'scatter',
        mode: 'lines',
        name: '上面 (Upper / 負圧側)',
        x: upperX,
        y: upperCp,
        xaxis: 'x',
        yaxis: 'y',
        line: { color: '#2563EB', width: 2.4 },
        hovertemplate: '上面 x/c=%{x:.3f}<br>Cp=%{y:.3f}<extra></extra>',
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: '下面 (Lower / 正圧側)',
        x: lowerX,
        y: lowerCp,
        xaxis: 'x',
        yaxis: 'y',
        line: { color: '#DC2626', width: 2.2, dash: 'dash' },
        hovertemplate: '下面 x/c=%{x:.3f}<br>Cp=%{y:.3f}<extra></extra>',
      },
      // 下部翼型シルエット（x軸を厳密同期）
      {
        type: 'scatter',
        mode: 'lines',
        name: '翼型断面',
        x: result.airfoil_geometry.x,
        y: result.airfoil_geometry.y,
        xaxis: 'x',
        yaxis: 'y2',
        fill: 'toself',
        fillcolor: 'rgba(148, 163, 184, 0.45)',
        line: { color: '#0f172a', width: 1.5 },
        showlegend: false,
        hovertemplate: '翼型 x/c=%{x:.3f}, y/c=%{y:.3f}<extra></extra>',
      },
    ];

    // Cp,min ピークマーカー
    if (result.diagnostics.cp_min !== null && result.diagnostics.cp_min_xc !== null) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `Cp,min (${result.diagnostics.cp_min.toFixed(2)})`,
        x: [result.diagnostics.cp_min_xc],
        y: [result.diagnostics.cp_min],
        xaxis: 'x',
        yaxis: 'y',
        marker: { color: '#f59e0b', size: 8, symbol: 'diamond' },
        hovertemplate: 'Cp,min=%{y:.3f} (x/c=%{x:.3f})<extra></extra>',
      });
    }

    const shapes =
      hoveredXc !== null && hoveredXc >= 0 && hoveredXc <= 1
        ? [
            {
              type: 'line',
              x0: hoveredXc,
              x1: hoveredXc,
              y0: 0,
              y1: 1,
              xref: 'x',
              yref: 'paper',
              line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
            },
          ]
        : [];

    const layout: PlotlyLayout = {
      margin: { l: 54, r: 18, t: 18, b: 36 },
      height: 290,
      autosize: true,
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#f8fafc',
      hovermode: 'x unified',
      legend: { orientation: 'h', x: 0, y: 1.12, font: { size: 11 } },
      xaxis: {
        title: { text: '翼弦方向位置 x/c [-]', font: { size: 11 } },
        range: [-0.02, 1.02],
        gridcolor: '#e2e8f0',
      },
      yaxis: {
        title: {
          text: viewSettings.invertCpAxis ? '圧力係数 Cp（上向きが負圧 -Cp）' : '圧力係数 Cp',
          font: { size: 11 },
        },
        autorange: viewSettings.invertCpAxis ? 'reversed' : true,
        domain: [0.28, 1.0],
        gridcolor: '#e2e8f0',
        zeroline: true,
        zerolinecolor: '#64748b',
      },
      yaxis2: {
        domain: [0.0, 0.22],
        scaleanchor: 'x',
        scaleratio: 1,
        showticklabels: false,
        showgrid: false,
        zeroline: false,
      },
      shapes,
    };

    void Promise.resolve(
      Plotly.react(el, traces, layout, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      })
    ).then((gd: PlotlyHTMLElement) => {
      if (gd && typeof gd.on === 'function') {
        gd.removeAllListeners?.('plotly_hover');
        gd.removeAllListeners?.('plotly_unhover');
        gd.on('plotly_hover', (ev) => {
          const xVal = ev?.points?.[0]?.x;
          if (typeof xVal === 'number' && Number.isFinite(xVal)) {
            setHoveredXc(xVal);
          }
        });
        gd.on('plotly_unhover', () => {
          setHoveredXc(null);
        });
      }
    });

    return () => {
      Plotly.purge(el);
    };
  }, [result, viewSettings.invertCpAxis, hoveredXc, setHoveredXc]);

  return (
    <section className="panel-card cp-chart-card" aria-label="翼表面の圧力係数 Cp 分布">
      <div className="section-header-row">
        <div>
          <h3 className="section-title">翼表面の圧力係数 Cp 分布</h3>
          <span
            className="hint-inline"
            title="航空工学では翼上面の負圧（吸い上げの強さ）が山の高さとして直感的に見えるよう、-Cp を上向きに描くのが標準です。"
          >
            ※負圧を上向きに描くのが航空工学の標準です
          </span>
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className={`tool-btn ${viewSettings.invertCpAxis ? 'active' : ''}`}
            onClick={() => setViewSettings({ invertCpAxis: true })}
          >
            -Cp 上向き（標準）
          </button>
          <button
            type="button"
            className={`tool-btn ${!viewSettings.invertCpAxis ? 'active' : ''}`}
            onClick={() => setViewSettings({ invertCpAxis: false })}
          >
            Cp 上向き（通常軸）
          </button>
        </div>
      </div>

      {result && result.status === 'success' ? (
        <div ref={plotRef} className="plotly-container" data-testid="cp-distribution-chart" />
      ) : (
        <div className="chart-empty-hint">解析を実行すると翼表面の Cp 分布が表示されます。</div>
      )}
    </section>
  );
};
