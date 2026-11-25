"""流体物性推算（理想気体空気＋Sutherland則・水プリセット・直接指定）および Re / Mach 算出サービス。"""

from __future__ import annotations

import math
from typing import Any

from app.models.api_schemas import (
    DimensionlessNumbers,
    FluidPropertiesInput,
    ResolvedFluid,
)

# 乾燥空気の標準物性定数（NUMERICAL_METHOD.md 8.1節）
R_AIR = 287.058  # [J/(kg*K)]
GAMMA_AIR = 1.4
STD_PRESSURE_PA = 101325.0  # [Pa]

# Sutherland の粘性式定数
SUTHERLAND_MU0 = 1.716e-5  # [Pa*s]
SUTHERLAND_T0 = 273.15  # [K]
SUTHERLAND_S = 110.4  # [K]

# 水（20℃）標準物性定数
WATER_20C_DENSITY = 998.2  # [kg/m^3]
WATER_20C_DYNAMIC_VISCOSITY = 1.002e-3  # [Pa*s]
WATER_20C_TEMPERATURE_K = 293.15  # [K]
WATER_20C_SPEED_OF_SOUND = 1482.0  # [m/s]


class FluidPropertiesError(ValueError):
    """流体物性パラメータまたは流速・弦長の範囲外・整合性違反を表す例外（API 422 対応）。"""

    def __init__(
        self,
        message: str,
        *,
        code: str = "INVALID_FLUID_PROPERTIES",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def resolve_fluid_properties(fluid_input: FluidPropertiesInput) -> ResolvedFluid:
    """FluidPropertiesInput から確定 SI 物性値（rho, mu, nu, T, p_inf, a）を決定する。

    決定優先順位（NUMERICAL_METHOD.md 8.1節）:
    1. preset == "water_20c" の場合は mode に関わらず水（20℃）標準値を最優先適用。
    2. mode == "temperature_auto" の場合は理想気体状態方程式 + Sutherland 則で推算。
    3. mode == "direct_mu" / "direct_nu" の場合は直接入力値を使用（高密度液体相当 rho > 10 で
       speed_of_sound_mps 未指定の場合は FluidPropertiesError を送出）。
    """
    temp_k = float(fluid_input.temperature_k)
    static_p = (
        float(fluid_input.static_pressure_pa)
        if fluid_input.static_pressure_pa is not None
        else STD_PRESSURE_PA
    )

    if not math.isfinite(temp_k) or temp_k < 50.0 or temp_k > 2000.0:
        raise FluidPropertiesError(
            "静温 temperature_k は 50.0 K 以上 2000.0 K 以下の有限値で指定してください。",
            details={"temperature_k": temp_k},
        )
    if not math.isfinite(static_p) or static_p <= 0.0:
        raise FluidPropertiesError(
            "静圧 static_pressure_pa は正の有限値で指定してください。",
            details={"static_pressure_pa": static_p},
        )

    # 1. 水（20℃）プリセットは mode より最優先で適用
    if fluid_input.preset == "water_20c":
        rho = WATER_20C_DENSITY
        mu = WATER_20C_DYNAMIC_VISCOSITY
        nu = mu / rho
        speed_a = WATER_20C_SPEED_OF_SOUND
        return ResolvedFluid(
            density_kg_m3=rho,
            dynamic_viscosity_pa_s=mu,
            kinematic_viscosity_m2_s=nu,
            temperature_k=WATER_20C_TEMPERATURE_K,
            static_pressure_pa=static_p,
            speed_of_sound_mps=speed_a,
        )

    # 2. 温度・静圧からの空気物性自動推算（理想気体 + Sutherland 則）
    if fluid_input.mode == "temperature_auto":
        rho = static_p / (R_AIR * temp_k)
        mu = (
            SUTHERLAND_MU0
            * ((temp_k / SUTHERLAND_T0) ** 1.5)
            * ((SUTHERLAND_T0 + SUTHERLAND_S) / (temp_k + SUTHERLAND_S))
        )
        nu = mu / rho
        if fluid_input.speed_of_sound_mps is not None:
            speed_a = float(fluid_input.speed_of_sound_mps)
            if not math.isfinite(speed_a) or speed_a <= 0.0:
                raise FluidPropertiesError("音速 speed_of_sound_mps は正の有限値で指定してください。")
        else:
            speed_a = math.sqrt(GAMMA_AIR * R_AIR * temp_k)

        return ResolvedFluid(
            density_kg_m3=rho,
            dynamic_viscosity_pa_s=mu,
            kinematic_viscosity_m2_s=nu,
            temperature_k=temp_k,
            static_pressure_pa=static_p,
            speed_of_sound_mps=speed_a,
        )

    # 3 & 4. 密度・粘性係数の直接指定モード（direct_mu / direct_nu）
    if fluid_input.density_kg_m3 is None or fluid_input.density_kg_m3 <= 0.0:
        raise FluidPropertiesError(
            f"mode='{fluid_input.mode}' では正の密度 density_kg_m3 の指定が必須です。",
            details={"mode": fluid_input.mode, "density_kg_m3": fluid_input.density_kg_m3},
        )
    rho = float(fluid_input.density_kg_m3)

    if fluid_input.mode == "direct_mu":
        if (
            fluid_input.dynamic_viscosity_pa_s is None
            or fluid_input.dynamic_viscosity_pa_s <= 0.0
        ):
            raise FluidPropertiesError(
                "mode='direct_mu' では正の粘性係数 dynamic_viscosity_pa_s の指定が必須です。",
                details={"dynamic_viscosity_pa_s": fluid_input.dynamic_viscosity_pa_s},
            )
        mu = float(fluid_input.dynamic_viscosity_pa_s)
        nu = mu / rho
    elif fluid_input.mode == "direct_nu":
        if (
            fluid_input.kinematic_viscosity_m2_s is None
            or fluid_input.kinematic_viscosity_m2_s <= 0.0
        ):
            raise FluidPropertiesError(
                "mode='direct_nu' では正の動粘性係数 kinematic_viscosity_m2_s の指定が必須です。",
                details={"kinematic_viscosity_m2_s": fluid_input.kinematic_viscosity_m2_s},
            )
        nu = float(fluid_input.kinematic_viscosity_m2_s)
        mu = rho * nu
    else:
        raise FluidPropertiesError(f"未対応の流体物性モードです: '{fluid_input.mode}'")

    if fluid_input.speed_of_sound_mps is not None:
        speed_a = float(fluid_input.speed_of_sound_mps)
        if not math.isfinite(speed_a) or speed_a <= 0.0:
            raise FluidPropertiesError("音速 speed_of_sound_mps は正の有限値で指定してください。")
    elif rho > 10.0:
        raise FluidPropertiesError(
            "高密度液体相当（density_kg_m3 > 10.0）では空気音速式の誤適用を防ぐため "
            "speed_of_sound_mps の明示指定が必須です。",
            details={"density_kg_m3": rho, "preset": fluid_input.preset},
        )
    else:
        speed_a = math.sqrt(GAMMA_AIR * R_AIR * temp_k)

    return ResolvedFluid(
        density_kg_m3=rho,
        dynamic_viscosity_pa_s=mu,
        kinematic_viscosity_m2_s=nu,
        temperature_k=temp_k,
        static_pressure_pa=static_p,
        speed_of_sound_mps=speed_a,
    )


def compute_dimensionless_numbers(
    velocity: float,
    chord_length: float,
    fluid: ResolvedFluid,
) -> DimensionlessNumbers:
    """一様流風速 V_inf [m/s]・翼弦長 c [m]・確定物性値からレイノルズ数 Re とマッハ数 M を算出する。"""
    v_val = float(velocity)
    c_val = float(chord_length)
    if not (math.isfinite(v_val) and v_val > 0.0):
        raise FluidPropertiesError(
            "流速 velocity は正の有限値で指定してください。",
            code="INVALID_FLOW_CONDITION",
            details={"velocity": velocity},
        )
    if not (math.isfinite(c_val) and c_val > 0.0):
        raise FluidPropertiesError(
            "翼弦長 chord_length は正の有限値で指定してください。",
            code="INVALID_CHORD_LENGTH",
            details={"chord_length": chord_length},
        )

    reynolds = (fluid.density_kg_m3 * v_val * c_val) / fluid.dynamic_viscosity_pa_s
    mach = v_val / fluid.speed_of_sound_mps
    return DimensionlessNumbers(
        reynolds_number=float(reynolds),
        mach_number=float(mach),
    )
