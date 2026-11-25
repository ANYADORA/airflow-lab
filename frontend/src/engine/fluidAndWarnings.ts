/**
 * 流体物性推算（理想気体空気 + Sutherland 則 / 水プリセット / 直接指定）、Re/Mach 算出、
 * および統一警告評価モジュール（全8種）。
 *
 * Python 版 `backend/app/services/fluid_properties.py` および `warnings.py` と
 * 定数・判定閾値・日本語警告文言を完全一致させて移植している。
 */

import { ApiClientError } from '../services/apiClientError';
import type {
  AerodynamicCoefficients,
  AnalysisDiagnostics,
  DimensionlessNumbers,
  FluidPropertiesInput,
  ResolvedFluid,
  WarningItem,
} from '../types/api';

export const R_AIR = 287.058; // [J/(kg*K)]
export const GAMMA_AIR = 1.4;
export const STD_PRESSURE_PA = 101325.0; // [Pa]

export const SUTHERLAND_MU0 = 1.716e-5; // [Pa*s]
export const SUTHERLAND_T0 = 273.15; // [K]
export const SUTHERLAND_S = 110.4; // [K]

export const WATER_20C_DENSITY = 998.2; // [kg/m^3]
export const WATER_20C_DYNAMIC_VISCOSITY = 1.002e-3; // [Pa*s]
export const WATER_20C_TEMPERATURE_K = 293.15; // [K]
export const WATER_20C_SPEED_OF_SOUND = 1482.0; // [m/s]

export const AOA_CAUTION_DEG = 10.0;
export const AOA_STALL_CRITICAL_DEG = 12.0;
export const MACH_COMPRESSIBLE_CAUTION = 0.3;
export const MACH_TRANSONIC_CRITICAL = 0.7;
export const LOW_RE_THRESHOLD = 5.0e4;
export const CL_SMALL_LIFT_BOUNDARY = 0.2;
export const CL_REL_DIFF_WARN = 0.05;
export const CL_ABS_DIFF_WARN = 0.01;

function fluidError(
  message: string,
  code = 'INVALID_FLUID_PROPERTIES',
  details: Record<string, unknown> | null = null
): ApiClientError {
  return new ApiClientError(message, 422, code, details);
}

export function resolveFluidProperties(
  fluidInput: FluidPropertiesInput
): ResolvedFluid {
  const tempK = Number(fluidInput.temperature_k);
  const staticP =
    fluidInput.static_pressure_pa !== null && fluidInput.static_pressure_pa !== undefined
      ? Number(fluidInput.static_pressure_pa)
      : STD_PRESSURE_PA;

  if (!Number.isFinite(tempK) || tempK < 50.0 || tempK > 2000.0) {
    throw fluidError(
      '静温 temperature_k は 50.0 K 以上 2000.0 K 以下の有限値で指定してください。',
      'INVALID_FLUID_PROPERTIES',
      { temperature_k: tempK }
    );
  }
  if (!Number.isFinite(staticP) || staticP <= 0.0) {
    throw fluidError(
      '静圧 static_pressure_pa は正の有限値で指定してください。',
      'INVALID_FLUID_PROPERTIES',
      { static_pressure_pa: staticP }
    );
  }

  // 1. 水（20℃）プリセットは mode より最優先で適用
  if (fluidInput.preset === 'water_20c') {
    const rho = WATER_20C_DENSITY;
    const mu = WATER_20C_DYNAMIC_VISCOSITY;
    const nu = mu / rho;
    return {
      density_kg_m3: rho,
      dynamic_viscosity_pa_s: mu,
      kinematic_viscosity_m2_s: nu,
      temperature_k: WATER_20C_TEMPERATURE_K,
      static_pressure_pa: staticP,
      speed_of_sound_mps: WATER_20C_SPEED_OF_SOUND,
    };
  }

  // 2. 温度・静圧からの空気物性自動推算（理想気体 + Sutherland 則）
  if (fluidInput.mode === 'temperature_auto') {
    const rho = staticP / (R_AIR * tempK);
    const mu =
      SUTHERLAND_MU0 *
      Math.pow(tempK / SUTHERLAND_T0, 1.5) *
      ((SUTHERLAND_T0 + SUTHERLAND_S) / (tempK + SUTHERLAND_S));
    const nu = mu / rho;
    let speedA: number;
    if (
      fluidInput.speed_of_sound_mps !== null &&
      fluidInput.speed_of_sound_mps !== undefined
    ) {
      speedA = Number(fluidInput.speed_of_sound_mps);
      if (!Number.isFinite(speedA) || speedA <= 0.0) {
        throw fluidError('音速 speed_of_sound_mps は正の有限値で指定してください。');
      }
    } else {
      speedA = Math.sqrt(GAMMA_AIR * R_AIR * tempK);
    }

    return {
      density_kg_m3: rho,
      dynamic_viscosity_pa_s: mu,
      kinematic_viscosity_m2_s: nu,
      temperature_k: tempK,
      static_pressure_pa: staticP,
      speed_of_sound_mps: speedA,
    };
  }

  // 3 & 4. 密度・粘性係数の直接指定モード
  if (
    fluidInput.density_kg_m3 === null ||
    fluidInput.density_kg_m3 === undefined ||
    !Number.isFinite(fluidInput.density_kg_m3) ||
    fluidInput.density_kg_m3 <= 0.0
  ) {
    throw fluidError(
      `mode='${fluidInput.mode}' では正の密度 density_kg_m3 の指定が必須です。`,
      'INVALID_FLUID_PROPERTIES',
      { mode: fluidInput.mode, density_kg_m3: fluidInput.density_kg_m3 }
    );
  }
  const rho = Number(fluidInput.density_kg_m3);

  let mu: number;
  let nu: number;
  if (fluidInput.mode === 'direct_mu') {
    if (
      fluidInput.dynamic_viscosity_pa_s === null ||
      fluidInput.dynamic_viscosity_pa_s === undefined ||
      !Number.isFinite(fluidInput.dynamic_viscosity_pa_s) ||
      fluidInput.dynamic_viscosity_pa_s <= 0.0
    ) {
      throw fluidError(
        "mode='direct_mu' では正の粘性係数 dynamic_viscosity_pa_s の指定が必須です。",
        'INVALID_FLUID_PROPERTIES',
        { dynamic_viscosity_pa_s: fluidInput.dynamic_viscosity_pa_s }
      );
    }
    mu = Number(fluidInput.dynamic_viscosity_pa_s);
    nu = mu / rho;
  } else if (fluidInput.mode === 'direct_nu') {
    if (
      fluidInput.kinematic_viscosity_m2_s === null ||
      fluidInput.kinematic_viscosity_m2_s === undefined ||
      !Number.isFinite(fluidInput.kinematic_viscosity_m2_s) ||
      fluidInput.kinematic_viscosity_m2_s <= 0.0
    ) {
      throw fluidError(
        "mode='direct_nu' では正の動粘性係数 kinematic_viscosity_m2_s の指定が必須です。",
        'INVALID_FLUID_PROPERTIES',
        { kinematic_viscosity_m2_s: fluidInput.kinematic_viscosity_m2_s }
      );
    }
    nu = Number(fluidInput.kinematic_viscosity_m2_s);
    mu = rho * nu;
  } else {
    throw fluidError(`未対応の流体物性モードです: '${String(fluidInput.mode)}'`);
  }

  let speedA: number;
  if (
    fluidInput.speed_of_sound_mps !== null &&
    fluidInput.speed_of_sound_mps !== undefined
  ) {
    speedA = Number(fluidInput.speed_of_sound_mps);
    if (!Number.isFinite(speedA) || speedA <= 0.0) {
      throw fluidError('音速 speed_of_sound_mps は正の有限値で指定してください。');
    }
  } else if (rho > 10.0) {
    throw fluidError(
      '高密度液体相当（density_kg_m3 > 10.0）では空気音速式の誤適用を防ぐため speed_of_sound_mps の明示指定が必須です。',
      'INVALID_FLUID_PROPERTIES',
      { density_kg_m3: rho, preset: fluidInput.preset }
    );
  } else {
    speedA = Math.sqrt(GAMMA_AIR * R_AIR * tempK);
  }

  return {
    density_kg_m3: rho,
    dynamic_viscosity_pa_s: mu,
    kinematic_viscosity_m2_s: nu,
    temperature_k: tempK,
    static_pressure_pa: staticP,
    speed_of_sound_mps: speedA,
  };
}

export function computeDimensionlessNumbers(
  velocity: number,
  chordLength: number,
  fluid: ResolvedFluid
): DimensionlessNumbers {
  const vVal = Number(velocity);
  const cVal = Number(chordLength);
  if (!Number.isFinite(vVal) || vVal <= 0.0) {
    throw fluidError(
      '流速 velocity は正の有限値で指定してください。',
      'INVALID_FLOW_CONDITION',
      { velocity }
    );
  }
  if (!Number.isFinite(cVal) || cVal <= 0.0) {
    throw fluidError(
      '翼弦長 chord_length は正の有限値で指定してください。',
      'INVALID_CHORD_LENGTH',
      { chord_length: chordLength }
    );
  }

  const reynolds = (fluid.density_kg_m3 * vVal * cVal) / fluid.dynamic_viscosity_pa_s;
  const mach = vVal / fluid.speed_of_sound_mps;
  return {
    reynolds_number: reynolds,
    mach_number: mach,
  };
}

function formatSignedOneDecimal(val: number): string {
  const fixed = val.toFixed(1);
  return val >= 0 && !fixed.startsWith('+') ? `+${fixed}` : fixed;
}

export function evaluateAnalysisWarnings(params: {
  angleOfAttackDeg: number;
  reynoldsNumber: number;
  machNumber: number;
  coefficients: AerodynamicCoefficients | null;
  diagnostics: AnalysisDiagnostics | null;
  geometryWarnings: WarningItem[];
}): WarningItem[] {
  const {
    angleOfAttackDeg,
    reynoldsNumber,
    machNumber,
    coefficients,
    diagnostics,
    geometryWarnings,
  } = params;

  const items: WarningItem[] = [...geometryWarnings];
  const absAoa = Math.abs(angleOfAttackDeg);
  const aoaStr = formatSignedOneDecimal(angleOfAttackDeg);

  // 1. 迎角（剥離・失速未モデル化）
  if (absAoa > AOA_STALL_CRITICAL_DEG) {
    items.push({
      code: 'STALL_UNMODELED',
      severity: 'critical',
      title: '失速（ストール）未考慮の強い警告',
      message: `設定迎角（${aoaStr}°）は大迎角域にあり、実際の翼では境界層が大きく剥離して失速（揚力の急減・抗力の急増）が生じる可能性が高い領域です。非粘性パネル法は流れの剥離・失速を計算できないため、表示される CL は現実の流れより過大評価されています。`,
    });
  } else if (absAoa > AOA_CAUTION_DEG) {
    items.push({
      code: 'HIGH_AOA_CAUTION',
      severity: 'warning',
      title: '高迎角・剥離開始域の注意',
      message: `設定迎角（${aoaStr}°）では、実際の翼上面後縁側から境界層の剥離が始まり揚力の伸びが鈍化する傾向があります。パネル法は非粘性モデルのため剥離を考慮していません。`,
    });
  }

  // 2. マッハ数（圧縮性・遷音速衝撃波）
  const maxVelRatio =
    diagnostics !== null && diagnostics.max_velocity_ratio !== null
      ? diagnostics.max_velocity_ratio
      : 1.0;
  const localMaxMach = machNumber * maxVelRatio;

  if (machNumber >= MACH_TRANSONIC_CRITICAL || localMaxMach >= 1.0) {
    items.push({
      code: 'TRANSONIC_OUT_OF_RANGE',
      severity: 'critical',
      title: '遷音速・衝撃波領域（非圧縮モデルの適用範囲外）',
      message: `一様流マッハ数 M = ${machNumber.toFixed(3)}（翼面局所最大マッハ数推定 ${localMaxMach.toFixed(3)}）が音速域に達しています。衝撃波や造波抗力が発生するため、非圧縮ポテンシャル流パネル法の適用範囲外です。`,
    });
  } else if (machNumber >= MACH_COMPRESSIBLE_CAUTION) {
    items.push({
      code: 'COMPRESSIBILITY_CAUTION',
      severity: 'warning',
      title: '空気の圧縮性影響に関する注意',
      message: `マッハ数 M = ${machNumber.toFixed(3)} が 0.3 以上のため、空気の密度変化（圧縮性）が無視できなくなります。非圧縮近似による負圧ピークや揚力係数に数%以上の誤差が生じる可能性があります。`,
    });
  }

  // 3. 低レイノルズ数
  if (reynoldsNumber < LOW_RE_THRESHOLD) {
    items.push({
      code: 'LOW_RE_CAUTION',
      severity: 'info',
      title: '低レイノルズ数域（粘性影響大）の案内',
      message: `レイノルズ数 Re = ${reynoldsNumber.toExponential(2)} は 5.0×10^4 未満の低 Re 領域です。小型模型や昆虫スケールでは粘性境界層が厚く層流剥離泡や早期剥離が起きやすいため、理想流体（非粘性）の計算結果と実測値の差が大きくなります。`,
    });
  }

  // 4. Kutta-Joukowski CL と圧力積分 CL_p のクロスチェック警告
  if (
    coefficients !== null &&
    diagnostics !== null &&
    diagnostics.converged &&
    diagnostics.cl_discrepancy !== null
  ) {
    const absCl = Math.abs(coefficients.cl_kutta_joukowski);
    const disc = diagnostics.cl_discrepancy;
    const isWarn =
      (absCl >= CL_SMALL_LIFT_BOUNDARY && disc / absCl > CL_REL_DIFF_WARN) ||
      (absCl < CL_SMALL_LIFT_BOUNDARY && disc > CL_ABS_DIFF_WARN);
    if (isWarn) {
      items.push({
        code: 'CL_CROSSCHECK_WARN',
        severity: 'warning',
        title: '揚力係数クロスチェック差の拡大',
        message: `循環から算出した CL (${coefficients.cl_kutta_joukowski.toFixed(4)}) と表面圧力積分から算出した CL (${coefficients.cl_pressure_integration.toFixed(4)}) の差（ΔCL = ${disc.toFixed(4)}）が大きくなっています。本格モードでパネル数（num_panels）を増やすことを推奨します。`,
      });
    }
  }

  return items;
}
