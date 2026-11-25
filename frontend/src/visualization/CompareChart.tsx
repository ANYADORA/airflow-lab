import React, { useEffect, useRef } from 'react';
import Plotly, { type PlotlyLayout, type PlotlyTrace } from 'plotly.js-dist-min';
import { useAnalysisStore } from '../store/useAnalysisStore';

export const CompareChart: React.FC = () => {
  const compareState = useAnalysisStore((s) => s.compareState);
  const invertCpAxis = useAnalysisStore((s) => s.viewSettings.invertCpAxis);
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    const cmp = compareState.compareResult;
    if (
      !cmp ||
      cmp.base.status !== 'success' ||
      cmp.target.status !== 'success' ||
      !cmp.base.surface ||
      !cmp.target.surface
    ) {
      Plotly.purge(el);
      return;
    }

    const splitSide = (surf: NonNullable<typeof cmp.base.surface>) => {
      const ux: number[] = [];
      const uy: number[] = [];
      const lx: number[] = [];
      const ly: number[] = [];
      for (let i = 0; i < surf.x_c.length; i += 1) {
        if (surf.side[i] === 'upper') {
          ux.push(surf.x_c[i]);
          uy.push(surf.cp[i]);
        } else {
          lx.push(surf.x_c[i]);
          ly.push(surf.cp[i]);
        }
      }
      return { ux, uy, lx, ly };
    };

    const a = splitSide(cmp.base.surface);
    const b = splitSide(cmp.target.surface);
    const labelA = `${cmp.base.airfoil_geometry?.name ?? 'Case A'} (α=${cmp.base.inputs.angle_of_attack.toFixed(1)}°)`;
    const labelB = `${cmp.target.airfoil_geometry?.name ?? 'Case B'} (α=${cmp.target.inputs.angle_of_attack.toFixed(1)}°)`;

    const traces: PlotlyTrace[] = [
      {
        type: 'scatter',
        mode: 'lines',
        name: `Case A 上面: ${labelA}`,
        x: a.ux,
        y: a.uy,
        line: { color: '#2563EB', width: 2.4 },
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: `Case A 下面`,
        x: a.lx,
        y: a.ly,
        line: { color: '#93C5FD', width: 1.8 },
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: `Case B 上面: ${labelB}`,
        x: b.ux,
        y: b.uy,
        line: { color: '#DC2626', width: 2.4, dash: 'dash' },
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: `Case B 下面`,
        x: b.lx,
        y: b.ly,
        line: { color: '#FCA5A5', width: 1.8, dash: 'dot' },
      },
    ];

    const layout: PlotlyLayout = {
      margin: { l: 54, r: 16, t: 18, b: 36 },
      height: 260,
      autosize: true,
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#f8fafc',
      hovermode: 'x unified',
      legend: { orientation: 'h', x: 0, y: 1.18, font: { size: 10 } },
      xaxis: { title: { text: 'x/c [-]', font: { size: 11 } }, range: [-0.02, 1.02] },
      yaxis: {
        title: { text: invertCpAxis ? 'Cp（-Cp 上向き）' : 'Cp', font: { size: 11 } },
        autorange: invertCpAxis ? 'reversed' : true,
      },
    };

    void Plotly.react(el, traces, layout, { responsive: true, displaylogo: false });

    return () => {
      Plotly.purge(el);
    };
  }, [compareState.compareResult, invertCpAxis]);

  if (!compareState.isCompareActive || !compareState.compareResult) {
    return null;
  }

  return (
    <section className="panel-card compare-chart-card" aria-label="2条件 Cp 重ね合わせ比較グラフ">
      <div className="section-header-row">
        <h3 className="section-title">2条件比較：表面 Cp 分布重ね合わせ（Case A 実線 vs Case B 破線）</h3>
      </div>
      <div ref={plotRef} className="plotly-container" data-testid="compare-cp-chart" />
    </section>
  );
};
