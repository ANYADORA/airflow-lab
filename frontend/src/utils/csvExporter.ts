/**
 * 表面圧力分布 CSV エクスポート純粋関数（API_SPEC.md 3-2 準拠）。
 * - UTF-8（BOM なし）、改行 LF
 * - 先頭 `#` コメント行で非粘性モデル・物性・動圧・主要係数・cd: N/A を明記
 * - 6列固定: index,side,x_c,y_c,cp,vt_over_vinf
 */

import type { AnalysisResponse } from '../types/api';
import { computeDynamicPressure } from './fluidPhysics';

export function buildSurfaceCsv(result: AnalysisResponse): string {
  if (result.status !== 'success' || !result.surface || !result.coefficients) {
    throw new Error('正常に収束した解析結果がないため CSV を生成できません。');
  }

  const inputs = result.inputs;
  const fluid = result.resolved_fluid;
  const dim = result.dimensionless;
  const coeff = result.coefficients;
  const surf = result.surface;
  const airfoilName =
    result.airfoil_geometry?.name ??
    inputs.airfoil.name ??
    (inputs.airfoil.naca_code ? `NACA ${inputs.airfoil.naca_code}` : 'Custom Airfoil');

  const qInf = computeDynamicPressure(fluid.density_kg_m3, inputs.velocity);
  const cdLine =
    coeff.cd === null
      ? '# cd: N/A (inviscid potential flow; viscous drag not modeled)'
      : `# cd: ${coeff.cd.toFixed(6)}`;

  const lines: string[] = [
    `# app: AirFlow Lab ${result.solver_info.version}`,
    `# solver_method: ${result.solver_info.method}`,
    '# physical_model: 2D inviscid incompressible potential flow (Hess-Smith panel method)',
    '# note: Viscous drag and stall are NOT modeled; CD is unavailable (N/A).',
    `# airfoil: ${airfoilName}`,
    `# angle_of_attack_deg: ${inputs.angle_of_attack.toFixed(4)}`,
    `# velocity_mps: ${inputs.velocity.toFixed(4)}`,
    `# chord_length_m: ${inputs.chord_length.toFixed(6)}`,
    `# density_kg_m3: ${fluid.density_kg_m3.toFixed(6)}`,
    `# static_pressure_pa: ${fluid.static_pressure_pa.toFixed(2)}`,
    `# dynamic_pressure_pa: ${qInf.toFixed(4)}`,
    `# reynolds_number: ${dim.reynolds_number.toFixed(2)}`,
    `# mach_number: ${dim.mach_number.toFixed(6)}`,
    `# num_panels: ${inputs.numerical_settings.num_panels}`,
    `# cl_kutta_joukowski: ${coeff.cl_kutta_joukowski.toFixed(6)}`,
    `# cl_pressure_integration: ${coeff.cl_pressure_integration.toFixed(6)}`,
    `# cm_quarter_chord: ${coeff.cm_quarter_chord.toFixed(6)}`,
    cdLine,
    'index,side,x_c,y_c,cp,vt_over_vinf',
  ];

  for (let i = 0; i < surf.x_c.length; i += 1) {
    lines.push(
      [
        i,
        surf.side[i],
        surf.x_c[i].toFixed(6),
        surf.y_c[i].toFixed(6),
        surf.cp[i].toFixed(6),
        surf.vt_ratio[i].toFixed(6),
      ].join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

export function buildSurfaceCsvFilename(result: AnalysisResponse): string {
  const rawName =
    result.airfoil_geometry?.name ??
    result.inputs.airfoil.name ??
    (result.inputs.airfoil.naca_code ? `NACA${result.inputs.airfoil.naca_code}` : 'custom');
  const safeName = rawName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const alphaStr = result.inputs.angle_of_attack.toFixed(1).replace('-', 'm');
  return `airflow_surface_${safeName}_a${alphaStr}.csv`;
}
