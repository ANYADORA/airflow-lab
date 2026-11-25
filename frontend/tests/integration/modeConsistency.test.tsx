import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../../src/App';
import { apiClient } from '../../src/services/apiClient';
import { createDefaultConfig, useAnalysisStore } from '../../src/store/useAnalysisStore';
import type { AnalysisRequest, AnalysisResponse } from '../../src/types/api';

vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn().mockResolvedValue({ on: vi.fn(), removeAllListeners: vi.fn() }),
    purge: vi.fn(),
  },
  react: vi.fn().mockResolvedValue({ on: vi.fn(), removeAllListeners: vi.fn() }),
  purge: vi.fn(),
}));

function makeSuccessResponse(req: AnalysisRequest): AnalysisResponse {
  return {
    analysis_id: '550e8400-e29b-41d4-a716-446655440010',
    created_at: '2026-11-24T12:10:00Z',
    status: 'success',
    solver_info: {
      method: 'panel_method',
      model_type: 'inviscid_incompressible_potential',
      version: '0.1.0',
      supports_cd: false,
    },
    inputs: req,
    resolved_fluid: {
      density_kg_m3: 1.204085,
      dynamic_viscosity_pa_s: 1.813322e-5,
      kinematic_viscosity_m2_s: 1.505975e-5,
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      speed_of_sound_mps: 343.2368,
    },
    airfoil_geometry: {
      name: req.airfoil.name ?? 'NACA 2412',
      x: [1.0, 0.5, 0.0, 0.5, 1.0],
      y: [0.0, -0.03, 0.0, 0.07, 0.0],
      num_panels: req.numerical_settings.num_panels,
      max_thickness_ratio: 0.12,
      max_camber_ratio: 0.02,
      max_camber_pos: 0.4,
      is_symmetric: false,
      is_closed_te: req.numerical_settings.closed_te,
    },
    dimensionless: {
      reynolds_number: 332010.7,
      mach_number: 0.05827,
    },
    coefficients: {
      cl: 0.9612,
      cl_kutta_joukowski: 0.9612,
      cl_pressure_integration: 0.9591,
      cd: null,
      cd_unavailable_reason: '非粘性パネル法では算出不可',
      cm_quarter_chord: -0.0532,
    },
    diagnostics: {
      converged: true,
      condition_number: 384.2,
      linear_residual_max: 1.4e-14,
      te_cp_diff: 2.1e-13,
      cl_discrepancy: 0.0021,
      cl_discrepancy_relative: 0.0022,
      cd_pressure_numerical_error: 0.0004,
      cp_min: -2.01,
      cp_min_xc: 0.03,
      max_velocity_ratio: 1.73,
      compute_time_ms: 21.0,
    },
    surface: {
      x_c: [0.99, 0.5, 0.03, 0.99],
      y_c: [0.0, -0.03, 0.02, 0.0],
      side: ['lower', 'lower', 'upper', 'upper'],
      cp: [0.2, 0.1, -2.01, 0.2],
      vt_ratio: [-0.9, -0.95, 1.73, 0.9],
    },
    flow_field: {
      x_grid: [-0.5, 1.6],
      y_grid: [-0.7, 0.7],
      u_ratio: [[1, 1], [1, 1]],
      v_ratio: [[0, 0], [0, 0]],
      speed_ratio: [[1, 1], [1, 1]],
      cp: [[0, 0], [0, 0]],
      is_inside_airfoil: [[false, false], [false, false]],
    },
    streamlines: [{ x: [-0.5, 1.6], y: [0.2, 0.2] }],
    warnings: [],
    failure: null,
  };
}

describe('INT-MODE-01: 簡易モード ⇔ 本格モードの同一条件結果100%一致と詳細設定保持', () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      uiMode: 'simple',
      config: createDefaultConfig(),
      isAdvancedCustomized: false,
      result: null,
      isRunning: false,
      apiError: null,
    });
    vi.clearAllMocks();
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      version: '0.1.0',
      solvers: [],
    });
    vi.spyOn(apiClient, 'listAirfoils').mockResolvedValue({ presets: [] });
  });

  it('簡易モードと本格モードで同一条件時に100%同一の7キーペイロードを送信する', async () => {
    const runSpy = vi
      .spyOn(apiClient, 'runAnalysis')
      .mockImplementation(async (req) => makeSuccessResponse(req));

    render(<App />);

    // 簡易モードで条件設定: α=6.0, V=20.0, c=0.25
    act(() => {
      useAnalysisStore.getState().setAngleOfAttack(6.0);
      useAnalysisStore.getState().setVelocity(20.0);
      useAnalysisStore.getState().setChordLength(0.25);
    });

    fireEvent.click(screen.getByTestId('run-analysis-btn'));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    const simplePayload = structuredClone(runSpy.mock.calls[0][0]);

    // 本格モードへ切替（値を変更せずに再実行）
    fireEvent.click(screen.getByTestId('mode-btn-advanced'));
    fireEvent.click(screen.getByTestId('run-analysis-btn'));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2));
    const advancedPayload = structuredClone(runSpy.mock.calls[1][0]);

    expect(advancedPayload).toEqual(simplePayload);
    expect(Object.keys(simplePayload).sort()).toEqual([
      'airfoil',
      'angle_of_attack',
      'chord_length',
      'fluid_properties',
      'numerical_settings',
      'solver',
      'velocity',
    ]);
  });

  it('本格モードでパネル数=200に変更して簡易モードへ戻してもリセットされず詳細設定適用中バッジを表示する', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('mode-btn-advanced'));
    act(() => {
      useAnalysisStore.getState().setNumericalSettings({ num_panels: 200 });
    });

    fireEvent.click(screen.getByTestId('mode-btn-simple'));
    expect(useAnalysisStore.getState().config.numerical_settings.num_panels).toBe(200);
    expect(screen.getByTestId('advanced-customized-badge')).toBeInTheDocument();

    // 「標準値に戻す」ボタンで 160 に戻る
    fireEvent.click(screen.getByTestId('reset-advanced-defaults-btn'));
    expect(useAnalysisStore.getState().config.numerical_settings.num_panels).toBe(160);
    expect(screen.queryByTestId('advanced-customized-badge')).not.toBeInTheDocument();
  });
});
