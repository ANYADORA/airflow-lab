/**
 * 2D 流れ場描画の抽象インターフェース（Phase 1: Canvas 2D / Phase 3: WebGL 差し替え対応）。
 */

import type { AnalysisResponse } from '../types/api';
import type {
  FlowHoverSample,
  ViewportTransform,
  VisualizationSettings,
} from '../types/ui';

export interface FlowRenderOptions {
  result: AnalysisResponse;
  viewSettings: VisualizationSettings;
  viewport: ViewportTransform;
  hoveredXc: number | null;
}

export interface FlowRenderer {
  render(canvas: HTMLCanvasElement, options: FlowRenderOptions): void;
  clear(canvas: HTMLCanvasElement): void;
  hitTest(
    canvas: HTMLCanvasElement,
    clientOffsetX: number,
    clientOffsetY: number,
    options: FlowRenderOptions
  ): FlowHoverSample | null;
  dispose(): void;
}
