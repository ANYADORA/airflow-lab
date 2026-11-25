/**
 * 流体物性・無次元数（Re, M）・動圧・単位スパン揚力のリアルタイムプレビュー計算。
 * バックエンドの services/fluid_properties.py（NUMERICAL_METHOD.md 第8章）と同一の物理定数・数式を使用。
 */

import type { FluidPreset, FluidPropertiesInput } from '../types/api';
import type { FluidPreviewMetrics } from '../types/analysis';

const R_AIR = 287.058; // J/(kg·K)
const GAMMA_AIR = 1.4;
const SUTHERLAND_MU0 = 1.716e-5; // Pa·s
const SUTHERLAND_T0 = 273.15; // K
const SUTHERLAND_S = 110.4; // K

export const WATER_20C = {
  temperature_k: 293.15,
  static_pressure_pa: 101325.0,
  density_kg_m3: 998.2,
  dynamic_viscosity_pa_s: 1.002e-3,
  kinematic_viscosity_m2_s: 1.002e-3 / 998.2,
  speed_of_sound_mps: 1482.0,
} as const;

export const FLUID_PRESET_LABELS: Record<FluidPreset, string> = {
  air_std_20c: '標準空気 (20℃, 1気圧)',
  air_0c: '低温空気 (0℃, 1気圧)',
  water_20c: '水 (20℃)',
  custom: 'カスタム物性',
};

export function createFluidInputForPreset(preset: FluidPreset): FluidPropertiesInput {
  if (preset === 'air_0c') {
    return {
      preset: 'air_0c',
      mode: 'temperature_auto',
      temperature_k: 273.15,
      static_pressure_pa: 101325.0,
      density_kg_m3: null,
      dynamic_viscosity_pa_s: null,
      kinematic_viscosity_m2_s: null,
      speed_of_sound_mps: null,
    };
  }
  if (preset === 'water_20c') {
    return {
      preset: 'water_20c',
      mode: 'temperature_auto',
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      density_kg_m3: null,
      dynamic_viscosity_pa_s: null,
      kinematic_viscosity_m2_s: null,
      speed_of_sound_mps: null,
    };
  }
  if (preset === 'custom') {
    return {
      preset: 'custom',
      mode: 'direct_mu',
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      density_kg_m3: 1.2041,
      dynamic_viscosity_pa_s: 1.813e-5,
      kinematic_viscosity_m2_s: null,
      speed_of_sound_mps: 343.24,
    };
  }
  return {
    preset: 'air_std_20c',
    mode: 'temperature_auto',
    temperature_k: 293.15,
    static_pressure_pa: 101325.0,
    density_kg_m3: null,
    dynamic_viscosity_pa_s: null,
    kinematic_viscosity_m2_s: null,
    speed_of_sound_mps: null,
  };
}

/** 乾燥空気の Sutherland 則による粘性係数 μ [Pa·s]。 */
export function computeAirViscositySutherland(temperatureK: number): number {
  const t = Math.max(50.0, temperatureK);
  return SUTHERLAND_MU0 * Math.pow(t / SUTHERLAND_T0, 1.5) * ((SUTHERLAND_T0 + SUTHERLAND_S) / (t + SUTHERLAND_S));
}

/** 入力条件からリアルタイムプレビュー用の物性・Re・Mach・動圧を算出する。 */
export function computeFluidPreview(
  fluid: FluidPropertiesInput,
  velocityMps: number,
  chordLengthM: number
): FluidPreviewMetrics | null {
  if (!Number.isFinite(velocityMps) || velocityMps <= 0) return null;
  if (!Number.isFinite(chordLengthM) || chordLengthM <= 0) return null;

  let rho: number;
  let mu: number;
  let nu: number;
  let a: number;

  if (fluid.preset === 'water_20c') {
    rho = WATER_20C.density_kg_m3;
    mu = WATER_20C.dynamic_viscosity_pa_s;
    nu = WATER_20C.kinematic_viscosity_m2_s;
    a = WATER_20C.speed_of_sound_mps;
  } else if (fluid.mode === 'direct_mu') {
    if (
      fluid.density_kg_m3 === null ||
      fluid.dynamic_viscosity_pa_s === null ||
      fluid.density_kg_m3 <= 0 ||
      fluid.dynamic_viscosity_pa_s <= 0
    ) {
      return null;
    }
    rho = fluid.density_kg_m3;
    mu = fluid.dynamic_viscosity_pa_s;
    nu = mu / rho;
    if (fluid.speed_of_sound_mps !== null && fluid.speed_of_sound_mps > 0) {
      a = fluid.speed_of_sound_mps;
    } else if (rho > 10.0) {
      return null;
    } else {
      a = Math.sqrt(GAMMA_AIR * R_AIR * Math.max(50.0, fluid.temperature_k));
    }
  } else if (fluid.mode === 'direct_nu') {
    if (
      fluid.density_kg_m3 === null ||
      fluid.kinematic_viscosity_m2_s === null ||
      fluid.density_kg_m3 <= 0 ||
      fluid.kinematic_viscosity_m2_s <= 0
    ) {
      return null;
    }
    rho = fluid.density_kg_m3;
    nu = fluid.kinematic_viscosity_m2_s;
    mu = rho * nu;
    if (fluid.speed_of_sound_mps !== null && fluid.speed_of_sound_mps > 0) {
      a = fluid.speed_of_sound_mps;
    } else if (rho > 10.0) {
      return null;
    } else {
      a = Math.sqrt(GAMMA_AIR * R_AIR * Math.max(50.0, fluid.temperature_k));
    }
  } else {
    const t = fluid.temperature_k;
    const p = fluid.static_pressure_pa ?? 101325.0;
    if (!Number.isFinite(t) || t < 50.0 || !Number.isFinite(p) || p <= 0) {
      return null;
    }
    rho = p / (R_AIR * t);
    mu = computeAirViscositySutherland(t);
    nu = mu / rho;
    a = fluid.speed_of_sound_mps ?? Math.sqrt(GAMMA_AIR * R_AIR * t);
  }

  const reynolds_number = (rho * velocityMps * chordLengthM) / mu;
  const mach_number = velocityMps / a;
  const dynamic_pressure_pa = 0.5 * rho * velocityMps * velocityMps;

  return {
    density_kg_m3: rho,
    dynamic_viscosity_pa_s: mu,
    kinematic_viscosity_m2_s: nu,
    speed_of_sound_mps: a,
    reynolds_number,
    mach_number,
    dynamic_pressure_pa,
  };
}

/** 動圧 q_inf = 0.5 * rho * V^2 [Pa] を算出する。 */
export function computeDynamicPressure(densityKgM3: number, velocityMps: number): number {
  return 0.5 * densityKgM3 * velocityMps * velocityMps;
}

/** 単位スパン揚力 L' = q_inf * c * CL [N/m] を算出する。 */
export function computeUnitSpanLift(
  densityKgM3: number,
  velocityMps: number,
  chordLengthM: number,
  cl: number
): number {
  return computeDynamicPressure(densityKgM3, velocityMps) * chordLengthM * cl;
}

/** レイノルズ数を読みやすい指数表記（例: 1.99 × 10⁵）に整形する。 */
export function formatReynolds(re: number): string {
  if (!Number.isFinite(re) || re <= 0) return '—';
  const exp = Math.floor(Math.log10(re));
  const mantissa = re / Math.pow(10, exp);
  const superDigits: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '-': '⁻',
  };
  const expStr = String(exp)
    .split('')
    .map((ch) => superDigits[ch] ?? ch)
    .join('');
  return `${mantissa.toFixed(2)} × 10${expStr}`;
}
