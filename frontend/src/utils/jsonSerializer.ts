/**
 * 解析条件の保存・再読込（.airflow.json）シリアライザ・バリデータ（API_SPEC.md 3-1 準拠）。
 */

import type { AnalysisRequest, AnalysisResponse } from '../types/api';
import type { AirflowProjectFile } from '../types/analysis';

export type ProjectParseResult =
  | { ok: true; data: AirflowProjectFile }
  | { ok: false; error: string };

const REQUIRED_CONFIG_KEYS: readonly (keyof AnalysisRequest)[] = [
  'airfoil',
  'angle_of_attack',
  'velocity',
  'chord_length',
  'fluid_properties',
  'solver',
  'numerical_settings',
];

export function serializeProjectFile(
  config: AnalysisRequest,
  result?: AnalysisResponse | null
): string {
  const payload: AirflowProjectFile = {
    schema_version: '1.0',
    app: 'AirFlow Lab',
    exported_at: new Date().toISOString(),
    config,
    summary:
      result && result.status === 'success' && result.coefficients
        ? {
            solver_model: result.solver_info.model_type,
            cl: result.coefficients.cl,
            cm_quarter_chord: result.coefficients.cm_quarter_chord,
            cd: result.coefficients.cd,
            reynolds_number: result.dimensionless.reynolds_number,
            mach_number: result.dimensionless.mach_number,
          }
        : null,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function serializeFullResultJson(result: AnalysisResponse): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseProjectFile(jsonText: string): ProjectParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'JSON の構文エラーのためファイルを読み込めませんでした。' };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, error: 'トップレベルが JSON オブジェクトではありません。' };
  }

  if (raw.schema_version !== '1.0') {
    return {
      ok: false,
      error: `未対応の schema_version です（期待値: "1.0", 実際: ${String(raw.schema_version)}）。`,
    };
  }

  if (!isPlainObject(raw.config)) {
    return { ok: false, error: 'config オブジェクトが見つかりません。' };
  }

  const cfg = raw.config;
  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!(key in cfg)) {
      return { ok: false, error: `必須キー config.${key} が不足しています。` };
    }
  }

  // 数値範囲の基本検証
  if (!isFiniteNumber(cfg.angle_of_attack) || cfg.angle_of_attack < -45 || cfg.angle_of_attack > 45) {
    return { ok: false, error: 'angle_of_attack は -45〜45 の範囲で指定してください。' };
  }
  if (!isFiniteNumber(cfg.velocity) || cfg.velocity < 0.01 || cfg.velocity > 1000) {
    return { ok: false, error: 'velocity は 0.01〜1000 m/s の範囲で指定してください。' };
  }
  if (!isFiniteNumber(cfg.chord_length) || cfg.chord_length < 0.0001 || cfg.chord_length > 100) {
    return { ok: false, error: 'chord_length は 0.0001〜100 m の範囲で指定してください。' };
  }

  if (!isPlainObject(cfg.airfoil)) {
    return { ok: false, error: 'config.airfoil が不正です。' };
  }
  const sourceType = cfg.airfoil.source_type;
  if (sourceType !== 'naca4' && sourceType !== 'custom_dat' && sourceType !== 'custom_csv') {
    return { ok: false, error: 'config.airfoil.source_type が不正です。' };
  }
  if (sourceType === 'naca4') {
    if (typeof cfg.airfoil.naca_code !== 'string' || !/^[0-9]{4}$/.test(cfg.airfoil.naca_code)) {
      return { ok: false, error: 'naca4 指定時は4桁数字の naca_code が必須です。' };
    }
  } else if (
    typeof cfg.airfoil.raw_coordinates_text !== 'string' ||
    cfg.airfoil.raw_coordinates_text.length < 10
  ) {
    return { ok: false, error: 'カスタム翼型指定時は raw_coordinates_text が必須です。' };
  }

  if (!isPlainObject(cfg.fluid_properties)) {
    return { ok: false, error: 'config.fluid_properties が不正です。' };
  }
  const fp = cfg.fluid_properties;
  if (fp.mode !== 'temperature_auto' && fp.mode !== 'direct_mu' && fp.mode !== 'direct_nu') {
    return { ok: false, error: 'config.fluid_properties.mode が不正です。' };
  }
  if (!isFiniteNumber(fp.temperature_k) || fp.temperature_k < 50 || fp.temperature_k > 2000) {
    return { ok: false, error: 'temperature_k は 50〜2000 K の範囲で指定してください。' };
  }

  if (!isPlainObject(cfg.solver)) {
    return { ok: false, error: 'config.solver が不正です。' };
  }
  if (
    cfg.solver.method !== 'panel_method' &&
    cfg.solver.method !== 'xfoil' &&
    cfg.solver.method !== 'cfd_su2'
  ) {
    return { ok: false, error: 'config.solver.method が不正です。' };
  }

  if (!isPlainObject(cfg.numerical_settings)) {
    return { ok: false, error: 'config.numerical_settings が不正です。' };
  }
  const ns = cfg.numerical_settings;
  if (
    !isFiniteNumber(ns.num_panels) ||
    !Number.isInteger(ns.num_panels) ||
    ns.num_panels < 40 ||
    ns.num_panels > 300 ||
    ns.num_panels % 2 !== 0
  ) {
    return { ok: false, error: 'num_panels は 40〜300 の偶数で指定してください。' };
  }
  if (
    !isFiniteNumber(ns.num_streamlines) ||
    !Number.isInteger(ns.num_streamlines) ||
    ns.num_streamlines < 10 ||
    ns.num_streamlines > 60
  ) {
    return { ok: false, error: 'num_streamlines は 10〜60 の整数で指定してください。' };
  }

  return { ok: true, data: raw as unknown as AirflowProjectFile };
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
