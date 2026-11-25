/** UIモード・可視化レイヤー・ホバー状態の型定義。 */

export type UiMode = 'simple' | 'advanced';

export type ContourLayer = 'none' | 'speed' | 'cp';

export type ViewFrame = 'airfoil_fixed' | 'wind_tunnel';

export type AdvancedRightTab = 'explanation' | 'diagnostics' | 'compare_io';

export interface VisualizationSettings {
  showStreamlines: boolean;
  showVectors: boolean;
  contourLayer: ContourLayer;
  viewFrame: ViewFrame;
  invertCpAxis: boolean;
}

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface FlowHoverSample {
  /** 回転前の無次元翼弦座標 x/c（Cp グラフ縦ガイド線同期基準）。 */
  x_c: number;
  /** 回転前の無次元翼弦座標 y/c。 */
  y_c: number;
  screenX: number;
  screenY: number;
  isInsideAirfoil: boolean;
  u_ratio: number | null;
  v_ratio: number | null;
  speed_ratio: number | null;
  speed_mps: number | null;
  cp: number | null;
}

export interface ApiErrorBanner {
  status: number | null;
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}
