import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../src/App';
import { apiClient } from '../../src/services/apiClient';
import { createDefaultConfig, useAnalysisStore } from '../../src/store/useAnalysisStore';
import type { AnalysisResponse } from '../../src/types/api';

vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn().mockResolvedValue({ on: vi.fn(), removeAllListeners: vi.fn() }),
    purge: vi.fn(),
  },
  react: vi.fn().mockResolvedValue({ on: vi.fn(), removeAllListeners: vi.fn() }),
  purge: vi.fn(),
}));

function makeResultWithWarnings(): AnalysisResponse {
  const cfg = createDefaultConfig();
  cfg.angle_of_attack = 14.0;
  return {
    analysis_id: '550e8400-e29b-41d4-a716-446655440020',
    created_at: '2026-11-24T12:10:00Z',
    status: 'success',
    solver_info: {
      method: 'panel_method',
      model_type: 'inviscid_incompressible_potential',
      version: '0.1.0',
      supports_cd: false,
    },
    inputs: cfg,
    resolved_fluid: {
      density_kg_m3: 1.204085,
      dynamic_viscosity_pa_s: 1.813322e-5,
      kinematic_viscosity_m2_s: 1.505975e-5,
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      speed_of_sound_mps: 343.2368,
    },
    airfoil_geometry: {
      name: 'NACA 2412',
      x: [1.0, 0.5, 0.0, 0.5, 1.0],
      y: [0.0, -0.03, 0.0, 0.07, 0.0],
      num_panels: 160,
      max_thickness_ratio: 0.12,
      max_camber_ratio: 0.02,
      max_camber_pos: 0.4,
      is_symmetric: false,
      is_closed_te: true,
    },
    dimensionless: {
      reynolds_number: 199206.4,
      mach_number: 0.0437,
    },
    coefficients: {
      cl: 1.892,
      cl_kutta_joukowski: 1.892,
      cl_pressure_integration: 1.889,
      cd: null,
      cd_unavailable_reason: '非粘性ポテンシャル流れでは抗力係数を算出できません。',
      cm_quarter_chord: -0.051,
    },
    diagnostics: {
      converged: true,
      condition_number: 390,
      linear_residual_max: 1e-14,
      te_cp_diff: 2e-13,
      cl_discrepancy: 0.003,
      cl_discrepancy_relative: 0.0016,
      cd_pressure_numerical_error: 0.0005,
      cp_min: -5.1,
      cp_min_xc: 0.01,
      max_velocity_ratio: 2.47,
      compute_time_ms: 28.0,
    },
    surface: {
      x_c: [0.99, 0.5, 0.01, 0.99],
      y_c: [0.0, -0.03, 0.01, 0.0],
      side: ['lower', 'lower', 'upper', 'upper'],
      cp: [0.2, 0.1, -5.1, 0.2],
      vt_ratio: [-0.9, -0.95, 2.47, 0.9],
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
    warnings: [
      {
        code: 'STALL_UNMODELED',
        severity: 'critical',
        title: '失速未考慮の強い警告',
        message: '迎角12°超では実流れで失速が起きますが、パネル法では再現できません。',
      },
    ],
    failure: null,
  };
}

function makeFailedResponse(): AnalysisResponse {
  const base = makeResultWithWarnings();
  return {
    ...base,
    status: 'failed',
    coefficients: null,
    surface: null,
    flow_field: null,
    streamlines: null,
    diagnostics: {
      ...base.diagnostics,
      converged: false,
      condition_number: 5.0e12,
    },
    warnings: [],
    failure: {
      code: 'ILL_CONDITIONED_MATRIX',
      message: '係数行列の条件数が許容上限を超えたため解析を中断しました。',
      details: { condition_number: 5.0e12 },
    },
  };
}

describe('INT-SAFE-01..03 & ERR-SOL-01: 物理安全ガード・未実装UI無効化・非収束描画遮断', () => {
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

  it('INT-SAFE-01 & INT-SAFE-02: cd===null は「—（算出不可）」と表示し0を出さず、高迎角警告バナーと剥離未考慮バッジを表示する', async () => {
    vi.spyOn(apiClient, 'runAnalysis').mockResolvedValue(makeResultWithWarnings());
    render(<App />);

    fireEvent.click(screen.getByTestId('run-analysis-btn'));
    await waitFor(() => expect(screen.getByTestId('kpi-cards')).toBeInTheDocument());

    const cdValue = screen.getByTestId('kpi-cd-value');
    expect(cdValue.textContent).toBe('—（算出不可）');
    expect(cdValue.textContent).not.toBe('0');
    expect(cdValue.textContent).not.toBe('0.000');

    expect(screen.getByTestId('warning-STALL_UNMODELED')).toBeInTheDocument();
    expect(screen.getByTestId('cl-stall-badge')).toBeInTheDocument();
  });

  it('INT-SAFE-03: 未実装ソルバー(XFOIL/CFD)・座標編集は disabled、ルールベース解説とAI準備中枠が分離され、パネル法を粘性CFDと呼ばない', () => {
    const { container } = render(<App />);

    // 簡易モードでの物理モデルバッジ・ルールベース解説・AI準備中枠
    expect(screen.getByTestId('physical-model-badge').textContent).toContain('非粘性ポテンシャル流れ');
    expect(screen.getByTestId('rule-based-badge')).toBeInTheDocument();
    expect(screen.getByTestId('ai-explanation-placeholder')).toBeInTheDocument();
    expect(container.textContent).not.toContain('粘性CFD');

    // 本格モードでの未実装ガード
    fireEvent.click(screen.getByTestId('mode-btn-advanced'));
    expect(screen.getByTestId('solver-option-xfoil')).toBeDisabled();
    expect(screen.getByTestId('solver-option-cfd')).toBeDisabled();
    expect(screen.getByTestId('coord-edit-disabled-btn')).toBeDisabled();
    expect(container.textContent).toContain('Phase 2 開発予定');
    expect(container.textContent).toContain('Phase 3 開発予定');
  });

  it('ERR-SOL-01 (Gate 4): 正常描画後に status="failed" を受信すると前回の流れ場・Cpグラフ・KPIを即座にクリアして ErrorOverlay のみ表示する', async () => {
    const runSpy = vi
      .spyOn(apiClient, 'runAnalysis')
      .mockResolvedValueOnce(makeResultWithWarnings())
      .mockResolvedValueOnce(makeFailedResponse());

    render(<App />);

    // 1回目: 成功結果を描画
    fireEvent.click(screen.getByTestId('run-analysis-btn'));
    await waitFor(() => expect(screen.getByTestId('cp-distribution-chart')).toBeInTheDocument());
    expect(screen.getByTestId('kpi-cl').textContent).toContain('1.892');

    // 2回目: 非収束 failed 応答
    fireEvent.click(screen.getByTestId('run-analysis-btn'));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('error-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('error-overlay').textContent).toContain('ILL_CONDITIONED_MATRIX');
    // 前回成功時のグラフ・流れ場・KPIが消えていること
    expect(screen.queryByTestId('cp-distribution-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('flow-field-canvas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-cl')).not.toBeInTheDocument();
  });
});
