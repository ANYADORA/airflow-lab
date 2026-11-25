/**
 * 簡易モード ⇔ 本格モード単一状態共有ストア（Zustand）。
 *
 * - 単一の `config: AnalysisRequest`（必須7キー）と `result: AnalysisResponse | null` を保持。
 * - 簡易モード ⇔ 本格モード切替時に条件を変換・リセットせず、同一条件なら100%同一ペイロードを送信する。
 * - Gate 4: `status !== "success"` または API エラー時は前回成功時の描画データを即座にクリアする。
 */

import { create } from 'zustand';
import { apiClient, ApiClientError } from '../services/apiClient';
import type {
  AirfoilGenerateResponse,
  AirfoilInput,
  AirfoilPresetItem,
  AnalysisRequest,
  AnalysisResponse,
  FluidPreset,
  FluidPropertiesInput,
  HealthResponse,
  NumericalSettingsInput,
} from '../types/api';
import type { CompareState } from '../types/analysis';
import type {
  AdvancedRightTab,
  ApiErrorBanner,
  FlowHoverSample,
  UiMode,
  ViewportTransform,
  VisualizationSettings,
} from '../types/ui';
import { createFluidInputForPreset } from '../utils/fluidPhysics';

export const SIMPLE_PRESET_CODES = ['0012', '2412', '4412', '6412'] as const;

export const DEFAULT_NUMERICAL_SETTINGS: NumericalSettingsInput = {
  num_panels: 160,
  closed_te: true,
  grid_nx: 120,
  grid_ny: 80,
  x_range: [-0.5, 1.6],
  y_range: [-0.7, 0.7],
  num_streamlines: 28,
};

export function createDefaultConfig(): AnalysisRequest {
  return {
    airfoil: {
      source_type: 'naca4',
      naca_code: '2412',
      name: 'NACA 2412',
      raw_coordinates_text: null,
    },
    angle_of_attack: 4.0,
    velocity: 15.0,
    chord_length: 0.2,
    fluid_properties: createFluidInputForPreset('air_std_20c'),
    solver: {
      method: 'panel_method',
    },
    numerical_settings: {
      ...DEFAULT_NUMERICAL_SETTINGS,
      x_range: [...DEFAULT_NUMERICAL_SETTINGS.x_range],
      y_range: [...DEFAULT_NUMERICAL_SETTINGS.y_range],
    },
  };
}

export function detectAdvancedCustomized(config: AnalysisRequest): boolean {
  const ns = config.numerical_settings;
  if (
    ns.num_panels !== DEFAULT_NUMERICAL_SETTINGS.num_panels ||
    ns.closed_te !== DEFAULT_NUMERICAL_SETTINGS.closed_te ||
    ns.grid_nx !== DEFAULT_NUMERICAL_SETTINGS.grid_nx ||
    ns.grid_ny !== DEFAULT_NUMERICAL_SETTINGS.grid_ny ||
    ns.num_streamlines !== DEFAULT_NUMERICAL_SETTINGS.num_streamlines ||
    ns.x_range[0] !== DEFAULT_NUMERICAL_SETTINGS.x_range[0] ||
    ns.x_range[1] !== DEFAULT_NUMERICAL_SETTINGS.x_range[1] ||
    ns.y_range[0] !== DEFAULT_NUMERICAL_SETTINGS.y_range[0] ||
    ns.y_range[1] !== DEFAULT_NUMERICAL_SETTINGS.y_range[1]
  ) {
    return true;
  }

  if (
    config.airfoil.source_type !== 'naca4' ||
    !config.airfoil.naca_code ||
    !(SIMPLE_PRESET_CODES as readonly string[]).includes(config.airfoil.naca_code)
  ) {
    return true;
  }

  const fp = config.fluid_properties;
  if (fp.preset === 'custom' || fp.mode !== 'temperature_auto') {
    return true;
  }

  if (config.angle_of_attack < -10.0 || config.angle_of_attack > 15.0) {
    return true;
  }

  return false;
}

export const FALLBACK_PRESETS: AirfoilPresetItem[] = [
  {
    id: 'naca0012',
    name: 'NACA 0012',
    naca_code: '0012',
    is_symmetric: true,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.0,
    max_camber_pos: 0.0,
    description: '代表的な対称翼型（厚さ12%）。迎角0°で揚力0となり、対称性の学習に最適。',
    preview_coords: { x: [1, 0.5, 0, 0.5, 1], y: [0, -0.053, 0, 0.053, 0] },
  },
  {
    id: 'naca2412',
    name: 'NACA 2412',
    naca_code: '2412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.02,
    max_camber_pos: 0.4,
    description: '軽航空機で広く使われる標準キャンバー翼（最大反り2%、位置40%、厚さ12%）。',
    preview_coords: { x: [1, 0.5, 0, 0.5, 1], y: [0, -0.034, 0, 0.072, 0] },
  },
  {
    id: 'naca4412',
    name: 'NACA 4412',
    naca_code: '4412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.04,
    max_camber_pos: 0.4,
    description: '中程度のキャンバーを持つ実用翼型（最大反り4%、位置40%、厚さ12%）。',
    preview_coords: { x: [1, 0.5, 0, 0.5, 1], y: [0, -0.015, 0, 0.091, 0] },
  },
  {
    id: 'naca6412',
    name: 'NACA 6412',
    naca_code: '6412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.06,
    max_camber_pos: 0.4,
    description: '強いキャンバーを持つ高揚力翼型（最大反り6%、位置40%、厚さ12%）。',
    preview_coords: { x: [1, 0.5, 0, 0.5, 1], y: [0, 0.004, 0, 0.11, 0] },
  },
];

export interface AnalysisStoreState {
  uiMode: UiMode;
  advancedRightTab: AdvancedRightTab;
  config: AnalysisRequest;
  isAdvancedCustomized: boolean;
  result: AnalysisResponse | null;
  isRunning: boolean;
  apiError: ApiErrorBanner | null;

  health: HealthResponse | null;
  healthStatus: 'loading' | 'ok' | 'error';
  presets: AirfoilPresetItem[];
  generatedAirfoil: AirfoilGenerateResponse | null;
  airfoilPreviewError: string | null;

  viewSettings: VisualizationSettings;
  viewport: ViewportTransform;
  hoverSample: FlowHoverSample | null;
  hoveredXc: number | null;

  compareState: CompareState;

  // Actions
  setUiMode: (mode: UiMode) => void;
  setAdvancedRightTab: (tab: AdvancedRightTab) => void;
  setAirfoil: (airfoil: AirfoilInput) => void;
  selectNacaPreset: (nacaCode: string, name?: string) => void;
  setAngleOfAttack: (alphaDeg: number) => void;
  setVelocity: (velocity: number) => void;
  setChordLength: (chordLength: number) => void;
  setFluidPreset: (preset: FluidPreset) => void;
  setFluidProperties: (fluid: FluidPropertiesInput) => void;
  setNumericalSettings: (patch: Partial<NumericalSettingsInput>) => void;
  resetAdvancedToSimpleDefaults: () => void;
  importConfig: (config: AnalysisRequest) => void;

  setViewSettings: (patch: Partial<VisualizationSettings>) => void;
  setViewport: (patch: Partial<ViewportTransform>) => void;
  resetViewport: () => void;
  setHoverSample: (sample: FlowHoverSample | null) => void;
  setHoveredXc: (xc: number | null) => void;

  loadInitialData: () => Promise<void>;
  previewAirfoilGeometry: () => Promise<void>;
  runAnalysis: () => Promise<AnalysisResponse | null>;
  clearError: () => void;

  pinCurrentAsBase: () => void;
  clearCompare: () => void;
  runCompareWithCurrent: () => Promise<void>;
}

export const useAnalysisStore = create<AnalysisStoreState>((set, get) => ({
  uiMode: 'simple',
  advancedRightTab: 'explanation',
  config: createDefaultConfig(),
  isAdvancedCustomized: false,
  result: null,
  isRunning: false,
  apiError: null,

  health: null,
  healthStatus: 'loading',
  presets: FALLBACK_PRESETS,
  generatedAirfoil: null,
  airfoilPreviewError: null,

  viewSettings: {
    showStreamlines: true,
    showVectors: false,
    contourLayer: 'speed',
    viewFrame: 'airfoil_fixed',
    invertCpAxis: true,
  },
  viewport: {
    zoom: 1.0,
    panX: 0,
    panY: 0,
  },
  hoverSample: null,
  hoveredXc: null,

  compareState: {
    pinnedBase: null,
    compareResult: null,
    diff: null,
    isCompareActive: false,
    isComparing: false,
  },

  setUiMode: (mode) => set({ uiMode: mode }),

  setAdvancedRightTab: (tab) => set({ advancedRightTab: tab }),

  setAirfoil: (airfoil) =>
    set((state) => {
      const next = { ...state.config, airfoil };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  selectNacaPreset: (nacaCode, name) =>
    set((state) => {
      const next: AnalysisRequest = {
        ...state.config,
        airfoil: {
          source_type: 'naca4',
          naca_code: nacaCode,
          name: name ?? `NACA ${nacaCode}`,
          raw_coordinates_text: null,
        },
      };
      return {
        config: next,
        isAdvancedCustomized: detectAdvancedCustomized(next),
        airfoilPreviewError: null,
      };
    }),

  setAngleOfAttack: (angle_of_attack) =>
    set((state) => {
      const next = { ...state.config, angle_of_attack };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  setVelocity: (velocity) =>
    set((state) => {
      const next = { ...state.config, velocity };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  setChordLength: (chord_length) =>
    set((state) => {
      const next = { ...state.config, chord_length };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  setFluidPreset: (preset) =>
    set((state) => {
      const next: AnalysisRequest = {
        ...state.config,
        fluid_properties: createFluidInputForPreset(preset),
      };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  setFluidProperties: (fluid_properties) =>
    set((state) => {
      const next = { ...state.config, fluid_properties };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  setNumericalSettings: (patch) =>
    set((state) => {
      const next: AnalysisRequest = {
        ...state.config,
        numerical_settings: {
          ...state.config.numerical_settings,
          ...patch,
        },
      };
      return { config: next, isAdvancedCustomized: detectAdvancedCustomized(next) };
    }),

  resetAdvancedToSimpleDefaults: () =>
    set((state) => {
      const isValidSimplePreset =
        state.config.airfoil.source_type === 'naca4' &&
        state.config.airfoil.naca_code !== null &&
        (SIMPLE_PRESET_CODES as readonly string[]).includes(state.config.airfoil.naca_code);

      const clampedAlpha = Math.max(-10.0, Math.min(15.0, state.config.angle_of_attack));

      const next: AnalysisRequest = {
        ...state.config,
        airfoil: isValidSimplePreset
          ? state.config.airfoil
          : {
              source_type: 'naca4',
              naca_code: '2412',
              name: 'NACA 2412',
              raw_coordinates_text: null,
            },
        angle_of_attack: clampedAlpha,
        fluid_properties:
          state.config.fluid_properties.preset === 'custom' ||
          state.config.fluid_properties.mode !== 'temperature_auto'
            ? createFluidInputForPreset('air_std_20c')
            : state.config.fluid_properties,
        numerical_settings: {
          ...DEFAULT_NUMERICAL_SETTINGS,
          x_range: [...DEFAULT_NUMERICAL_SETTINGS.x_range],
          y_range: [...DEFAULT_NUMERICAL_SETTINGS.y_range],
        },
      };
      return {
        config: next,
        isAdvancedCustomized: detectAdvancedCustomized(next),
      };
    }),

  importConfig: (config) =>
    set({
      config,
      isAdvancedCustomized: detectAdvancedCustomized(config),
      apiError: null,
    }),

  setViewSettings: (patch) =>
    set((state) => ({
      viewSettings: { ...state.viewSettings, ...patch },
    })),

  setViewport: (patch) =>
    set((state) => ({
      viewport: { ...state.viewport, ...patch },
    })),

  resetViewport: () =>
    set({
      viewport: { zoom: 1.0, panX: 0, panY: 0 },
    }),

  setHoverSample: (hoverSample) =>
    set({
      hoverSample,
      hoveredXc: hoverSample ? hoverSample.x_c : null,
    }),

  setHoveredXc: (hoveredXc) => set({ hoveredXc }),

  loadInitialData: async () => {
    set({ healthStatus: 'loading' });
    try {
      const [health, airfoils] = await Promise.all([
        apiClient.getHealth(),
        apiClient.listAirfoils(),
      ]);
      set({
        health,
        healthStatus: 'ok',
        presets: airfoils.presets.length > 0 ? airfoils.presets : FALLBACK_PRESETS,
      });
    } catch {
      set({ healthStatus: 'error' });
    }
  },

  previewAirfoilGeometry: async () => {
    const { config } = get();
    set({ airfoilPreviewError: null });
    try {
      const resp = await apiClient.generateAirfoil({
        source_type: config.airfoil.source_type,
        naca_code: config.airfoil.naca_code,
        name: config.airfoil.name,
        raw_coordinates_text: config.airfoil.raw_coordinates_text,
        num_panels: config.numerical_settings.num_panels,
        closed_te: config.numerical_settings.closed_te,
      });
      set({ generatedAirfoil: resp, airfoilPreviewError: null });
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : '翼型座標の生成・検証に失敗しました。';
      set({ generatedAirfoil: null, airfoilPreviewError: msg });
    }
  },

  runAnalysis: async () => {
    const { config, isRunning } = get();
    if (isRunning) return null;

    set({ isRunning: true, apiError: null });
    try {
      const response = await apiClient.runAnalysis(config);
      // Gate 4: status !== 'success' の場合も前回成功結果を即座に置き換える（古い描画を残さない）
      set({
        result: response,
        isRunning: false,
        apiError: null,
        hoverSample: null,
        hoveredXc: null,
      });
      return response;
    } catch (err) {
      // Gate 4: API エラー時は前回成功結果を即座にクリアする
      const apiError: ApiErrorBanner =
        err instanceof ApiClientError
          ? {
              status: err.status,
              code: err.code,
              message: err.message,
              details: err.details,
            }
          : {
              status: null,
              code: 'UNEXPECTED_ERROR',
              message: err instanceof Error ? err.message : '予期しないエラーが発生しました。',
              details: null,
            };
      set({
        result: null,
        isRunning: false,
        apiError,
        hoverSample: null,
        hoveredXc: null,
      });
      return null;
    }
  },

  clearError: () => set({ apiError: null }),

  pinCurrentAsBase: () =>
    set((state) => {
      if (!state.result || state.result.status !== 'success') return state;
      return {
        compareState: {
          pinnedBase: state.result,
          compareResult: null,
          diff: null,
          isCompareActive: false,
          isComparing: false,
        },
      };
    }),

  clearCompare: () =>
    set({
      compareState: {
        pinnedBase: null,
        compareResult: null,
        diff: null,
        isCompareActive: false,
        isComparing: false,
      },
    }),

  runCompareWithCurrent: async () => {
    const { compareState, config } = get();
    if (!compareState.pinnedBase) return;

    set({
      compareState: { ...compareState, isComparing: true },
      apiError: null,
    });
    try {
      const cmp = await apiClient.compareAnalyses({
        base_analysis_id: compareState.pinnedBase.analysis_id,
        target_request: config,
      });
      set({
        result: cmp.target,
        compareState: {
          pinnedBase: cmp.base,
          compareResult: cmp,
          diff: cmp.diff,
          isCompareActive: true,
          isComparing: false,
        },
      });
    } catch (err) {
      const apiError: ApiErrorBanner =
        err instanceof ApiClientError
          ? {
              status: err.status,
              code: err.code,
              message: err.message,
              details: err.details,
            }
          : {
              status: null,
              code: 'COMPARE_ERROR',
              message: '2条件比較の実行に失敗しました。',
              details: null,
            };
      set((state) => ({
        apiError,
        compareState: { ...state.compareState, isComparing: false },
      }));
    }
  },
}));
