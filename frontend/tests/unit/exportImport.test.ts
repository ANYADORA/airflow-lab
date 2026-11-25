import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/store/useAnalysisStore';
import type { AnalysisResponse } from '../../src/types/api';
import { buildSurfaceCsv, buildSurfaceCsvFilename } from '../../src/utils/csvExporter';
import { parseProjectFile, serializeProjectFile } from '../../src/utils/jsonSerializer';

function buildSampleResult(): AnalysisResponse {
  const cfg = createDefaultConfig();
  cfg.airfoil.naca_code = '4412';
  cfg.airfoil.name = 'NACA 4412';
  cfg.angle_of_attack = 4.5;
  cfg.velocity = 18.0;
  cfg.chord_length = 0.15;
  cfg.numerical_settings.num_panels = 200;

  return {
    analysis_id: '550e8400-e29b-41d4-a716-446655440001',
    created_at: '2026-11-24T12:15:00Z',
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
      name: 'NACA 4412',
      x: [1.0, 0.5, 0.0, 0.5, 1.0],
      y: [0.0, -0.02, 0.0, 0.09, 0.0],
      num_panels: 200,
      max_thickness_ratio: 0.12,
      max_camber_ratio: 0.04,
      max_camber_pos: 0.4,
      is_symmetric: false,
      is_closed_te: true,
    },
    dimensionless: {
      reynolds_number: 179285.8,
      mach_number: 0.052442,
    },
    coefficients: {
      cl: 1.0312,
      cl_kutta_joukowski: 1.0312,
      cl_pressure_integration: 1.0289,
      cd: null,
      cd_unavailable_reason: '非粘性パネル法では算出不可',
      cm_quarter_chord: -0.1052,
    },
    diagnostics: {
      converged: true,
      condition_number: 410.0,
      linear_residual_max: 1.2e-14,
      te_cp_diff: 3.0e-13,
      cl_discrepancy: 0.0023,
      cl_discrepancy_relative: 0.0022,
      cd_pressure_numerical_error: 0.0003,
      cp_min: -1.92,
      cp_min_xc: 0.04,
      max_velocity_ratio: 1.71,
      compute_time_ms: 42.1,
    },
    surface: {
      x_c: [0.99, 0.5, 0.04, 0.99],
      y_c: [0.0, -0.02, 0.03, 0.0],
      side: ['lower', 'lower', 'upper', 'upper'],
      cp: [0.21, 0.12, -1.92, 0.21],
      vt_ratio: [-0.89, -0.94, 1.71, 0.89],
    },
    flow_field: null,
    streamlines: null,
    warnings: [],
    failure: null,
  };
}

describe('INT-IO-01: JSON 保存/再読込 & 表面分布 CSV 出力', () => {
  it('.airflow.json のシリアライズと再読込で config が完全一致する', () => {
    const sample = buildSampleResult();
    const jsonText = serializeProjectFile(sample.inputs, sample);
    const parsed = parseProjectFile(jsonText);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data.schema_version).toBe('1.0');
    expect(parsed.data.config).toEqual(sample.inputs);
    expect(parsed.data.summary?.cd).toBeNull();
  });

  it('不正な JSON や非準拠スキーマをクラッシュせず安全に拒否する', () => {
    expect(parseProjectFile('{broken json').ok).toBe(false);
    expect(parseProjectFile(JSON.stringify({ schema_version: '2.0', config: {} })).ok).toBe(false);

    const badPanels = createDefaultConfig();
    badPanels.numerical_settings.num_panels = 155; // 奇数
    const badText = serializeProjectFile(badPanels, null);
    expect(parseProjectFile(badText).ok).toBe(false);
  });

  it('表面分布 CSV に必須メタデータヘッダ（非粘性・動圧・cd: N/A）と6列データが含まれる', () => {
    const sample = buildSampleResult();
    const csv = buildSurfaceCsv(sample);
    const filename = buildSurfaceCsvFilename(sample);

    expect(filename).toBe('airflow_surface_NACA_4412_a4.5.csv');
    expect(csv).toContain('# physical_model: 2D inviscid incompressible potential flow');
    expect(csv).toContain('# density_kg_m3:');
    expect(csv).toContain('# static_pressure_pa:');
    expect(csv).toContain('# dynamic_pressure_pa:');
    expect(csv).toContain('# cd: N/A');
    expect(csv).not.toMatch(/# cd:\s*0(\.0+)?$/m);

    const dataLines = csv
      .trim()
      .split('\n')
      .filter((line) => !line.startsWith('#'));

    expect(dataLines[0]).toBe('index,side,x_c,y_c,cp,vt_over_vinf');
    expect(dataLines.length).toBe(1 + (sample.surface?.x_c.length ?? 0));
    expect(dataLines[1].split(',')).toHaveLength(6);
  });
});
