import { describe, expect, it } from 'vitest';
import type { AnalysisResponse } from '../../src/types/api';
import { createDefaultConfig } from '../../src/store/useAnalysisStore';
import { generateRuleBasedExplanation } from '../../src/utils/explanationEngine';

function makeMockResult(overrides?: {
  nacaCode?: string;
  name?: string;
  isSymmetric?: boolean;
  alpha?: number;
  cl?: number;
  cpMin?: number;
  cpMinXc?: number;
  maxVel?: number;
  preset?: 'air_std_20c' | 'water_20c';
}): AnalysisResponse {
  const cfg = createDefaultConfig();
  cfg.airfoil.naca_code = overrides?.nacaCode ?? '2412';
  cfg.airfoil.name = overrides?.name ?? 'NACA 2412';
  cfg.angle_of_attack = overrides?.alpha ?? 4.0;
  if (overrides?.preset === 'water_20c') {
    cfg.fluid_properties.preset = 'water_20c';
  }

  return {
    analysis_id: '550e8400-e29b-41d4-a716-446655440000',
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
      density_kg_m3: overrides?.preset === 'water_20c' ? 998.2 : 1.204085,
      dynamic_viscosity_pa_s: overrides?.preset === 'water_20c' ? 1.002e-3 : 1.813322e-5,
      kinematic_viscosity_m2_s: overrides?.preset === 'water_20c' ? 1.0038e-6 : 1.505975e-5,
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      speed_of_sound_mps: overrides?.preset === 'water_20c' ? 1482.0 : 343.2368,
    },
    airfoil_geometry: {
      name: overrides?.name ?? 'NACA 2412',
      x: [1.0, 0.5, 0.0, 0.5, 1.0],
      y: [0.0, -0.03, 0.0, 0.07, 0.0],
      num_panels: 160,
      max_thickness_ratio: 0.12,
      max_camber_ratio: overrides?.isSymmetric ? 0.0 : 0.02,
      max_camber_pos: overrides?.isSymmetric ? 0.0 : 0.4,
      is_symmetric: overrides?.isSymmetric ?? false,
      is_closed_te: true,
    },
    dimensionless: {
      reynolds_number: 199206.4,
      mach_number: 0.0437,
    },
    coefficients: {
      cl: overrides?.cl ?? 0.728,
      cl_kutta_joukowski: overrides?.cl ?? 0.728,
      cl_pressure_integration: (overrides?.cl ?? 0.728) - 0.002,
      cd: null,
      cd_unavailable_reason: '非粘性パネル法では抗力係数を算出できません。',
      cm_quarter_chord: -0.0531,
    },
    diagnostics: {
      converged: true,
      condition_number: 380,
      linear_residual_max: 1e-14,
      te_cp_diff: 1e-13,
      cl_discrepancy: 0.002,
      cl_discrepancy_relative: 0.003,
      cd_pressure_numerical_error: 0.0004,
      cp_min: overrides?.cpMin ?? -1.5,
      cp_min_xc: overrides?.cpMinXc ?? 0.04,
      max_velocity_ratio: overrides?.maxVel ?? 1.58,
      compute_time_ms: 25.0,
    },
    surface: {
      x_c: [0.99, 0.5, 0.04, 0.5, 0.99],
      y_c: [0.0, -0.03, 0.02, 0.07, 0.0],
      side: ['lower', 'lower', 'upper', 'upper', 'upper'],
      cp: [0.2, 0.1, -1.5, -0.6, 0.2],
      vt_ratio: [-0.9, -0.95, 1.58, 1.26, 0.9],
    },
    flow_field: null,
    streamlines: null,
    warnings: [],
    failure: null,
  };
}

describe('UT-FE-01: explanationEngine (実数値埋め込み & 同着理論完全排除)', () => {
  const PROHIBITED_PHRASES = [
    '同時に到達',
    '同時に着く',
    '同時に出会わなければならない',
    '距離が長いから速い',
    '道のりが長いから速く',
  ];

  it('4ブロック構成で実数値（CL, Cp,min, x/c, 最大速度比, Re）を埋め込む', () => {
    const res = makeMockResult({
      nacaCode: '4412',
      name: 'NACA 4412',
      isSymmetric: false,
      alpha: 5.0,
      cl: 1.092,
      cpMin: -2.14,
      cpMinXc: 0.03,
      maxVel: 1.77,
    });
    const exp = generateRuleBasedExplanation(res);

    expect(exp.sourceBadge).toContain('ルールベース解説');
    expect(exp.blocks).toHaveLength(4);

    const fullText = exp.blocks
      .flatMap((b) => [...b.paragraphs, ...(b.bullets ?? [])])
      .join('\n');

    expect(fullText).toContain('NACA 4412');
    expect(fullText).toContain('1.092');
    expect(fullText).toContain('-2.14');
    expect(fullText).toContain('0.03');
    expect(fullText).toContain('1.77');
    expect(fullText).toContain('クッタの条件');
    expect(fullText).toContain('ベルヌーイの定理');
  });

  it('全シナリオで誤った同着理論の肯定表現を一切含まない', () => {
    const scenarios = [
      makeMockResult({ nacaCode: '0012', name: 'NACA 0012', isSymmetric: true, alpha: 0, cl: 0 }),
      makeMockResult({ nacaCode: '0012', name: 'NACA 0012', isSymmetric: true, alpha: 5, cl: 0.604 }),
      makeMockResult({ nacaCode: '4412', name: 'NACA 4412', isSymmetric: false, alpha: 0, cl: 0.501 }),
      makeMockResult({ nacaCode: '4412', name: 'NACA 4412', isSymmetric: false, alpha: 14, cl: 2.1 }),
    ];

    for (const sc of scenarios) {
      const exp = generateRuleBasedExplanation(sc);
      const allText = [
        ...exp.blocks.flatMap((b) => [...b.paragraphs, ...(b.bullets ?? [])]),
        exp.misconception.title,
        exp.misconception.misconceptionLabel,
        ...exp.misconception.correctionParagraphs,
        ...exp.misconception.tryItSteps,
      ].join('\n');

      for (const forbidden of PROHIBITED_PHRASES) {
        expect(allText).not.toContain(forbidden);
      }
    }
  });

  it('水プリセット時にキャビテーション未考慮の注記を含める', () => {
    const waterRes = makeMockResult({ preset: 'water_20c' });
    const exp = generateRuleBasedExplanation(waterRes);
    const summaryText = exp.blocks[0].paragraphs.join('\n');
    expect(summaryText).toContain('キャビテーション');
  });
});
