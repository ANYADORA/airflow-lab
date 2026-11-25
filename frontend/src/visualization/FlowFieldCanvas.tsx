import React, { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import { buildCssGradient } from '../utils/colormaps';
import { Canvas2DFlowRenderer } from './Canvas2DFlowRenderer';
import { FlowLayerToolbar } from './FlowLayerToolbar';
import { FlowTooltip } from './FlowTooltip';

export const FlowFieldCanvas: React.FC = () => {
  const result = useAnalysisStore((s) => s.result);
  const viewSettings = useAnalysisStore((s) => s.viewSettings);
  const viewport = useAnalysisStore((s) => s.viewport);
  const hoveredXc = useAnalysisStore((s) => s.hoveredXc);
  const hoverSample = useAnalysisStore((s) => s.hoverSample);
  const setViewport = useAnalysisStore((s) => s.setViewport);
  const setHoverSample = useAnalysisStore((s) => s.setHoverSample);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Canvas2DFlowRenderer | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [canvasTick, setCanvasTick] = useState(0);

  if (!rendererRef.current) {
    rendererRef.current = new Canvas2DFlowRenderer();
  }

  useEffect(() => {
    const renderer = rendererRef.current;
    return () => {
      renderer?.dispose();
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      setCanvasTick((n) => n + 1);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    if (!result || result.status !== 'success') {
      renderer.clear(canvas);
      return;
    }

    renderer.render(canvas, {
      result,
      viewSettings,
      viewport,
      hoveredXc,
    });
  }, [result, viewSettings, viewport, hoveredXc, canvasTick]);

  const handleWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nextZoom = Math.max(0.4, Math.min(8.0, viewport.zoom * factor));
    setViewport({ zoom: nextZoom });
  };

  const handleMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    setIsDragging(true);
    dragOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
  };

  const handleMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (isDragging && dragOriginRef.current) {
      const dx = e.clientX - dragOriginRef.current.x;
      const dy = e.clientY - dragOriginRef.current.y;
      setViewport({
        panX: dragOriginRef.current.panX + dx,
        panY: dragOriginRef.current.panY + dy,
      });
      return;
    }

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !result || result.status !== 'success') {
      setHoverSample(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const sample = renderer.hitTest(canvas, offsetX, offsetY, {
      result,
      viewSettings,
      viewport,
      hoveredXc,
    });
    setHoverSample(sample);
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
    dragOriginRef.current = null;
  };

  const handleMouseLeave = () => {
    handleMouseUpOrLeave();
    setHoverSample(null);
  };

  return (
    <section className="panel-card flow-viewer-card" aria-label="2D 流れ場ビューア">
      <FlowLayerToolbar />
      <div className="flow-canvas-wrapper" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="flow-canvas"
          data-testid="flow-field-canvas"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseLeave}
        />
        {!result && (
          <div className="flow-empty-hint">
            左のパネルで条件を選び「流れを解析する」を押すと、2D 流れ場がここに描画されます。
          </div>
        )}
        {result && result.status === 'success' && viewSettings.contourLayer !== 'none' && (
          <div className="colorbar-overlay" aria-label="カラーバー">
            <span className="colorbar-title">
              {viewSettings.contourLayer === 'speed' ? '速度比 |V|/V∞ (Viridis)' : '圧力係数 Cp (RdBu)'}
            </span>
            <div
              className="colorbar-bar"
              style={{ background: buildCssGradient(viewSettings.contourLayer) }}
            />
            <div className="colorbar-ticks">
              {viewSettings.contourLayer === 'speed' ? (
                <>
                  <span>0.0</span>
                  <span>0.9</span>
                  <span>1.8+</span>
                </>
              ) : (
                <>
                  <span>-2.0 (負圧)</span>
                  <span>0.0</span>
                  <span>+1.0 (正圧)</span>
                </>
              )}
            </div>
          </div>
        )}
        {hoverSample && <FlowTooltip sample={hoverSample} />}
      </div>
    </section>
  );
};
