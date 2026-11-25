"""contracts/ 配下の JSON Schema / OpenAPI 3.1 に100%準拠する Pydantic v2 API契約モデル群。"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _ensure_finite(value: float | None, field_name: str) -> float | None:
    """NaN / Inf の混入を拒否する有限数値バリデータ補助。"""
    if value is not None and not math.isfinite(value):
        raise ValueError(f"{field_name} には有限の実数を指定してください。")
    return value


class _StrictModel(BaseModel):
    """未定義フィールドを厳格に拒否（additionalProperties: false）する共通基底。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ---------------------------------------------------------------------------
# 共通エラー・警告・ヘルスチェック
# ---------------------------------------------------------------------------


class ErrorDetail(_StrictModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(_StrictModel):
    error: ErrorDetail


WarningCode = Literal[
    "HIGH_AOA_CAUTION",
    "STALL_UNMODELED",
    "COMPRESSIBILITY_CAUTION",
    "TRANSONIC_OUT_OF_RANGE",
    "LOW_RE_CAUTION",
    "CL_CROSSCHECK_WARN",
    "CUSTOM_AIRFOIL_NORMALIZED",
    "OPEN_TE_CLOSED_AUTO",
]
WarningSeverity = Literal["info", "warning", "critical"]


class WarningItem(_StrictModel):
    code: WarningCode
    severity: WarningSeverity
    title: str
    message: str


SolverMethod = Literal["panel_method", "xfoil", "cfd_su2"]


class SolverCapabilitySchema(_StrictModel):
    method: SolverMethod
    label: str
    available: bool
    phase: Literal[1, 2, 3]
    supports_cd: bool
    description: str


class HealthResponse(_StrictModel):
    status: Literal["ok"] = "ok"
    version: str
    solvers: list[SolverCapabilitySchema]


# ---------------------------------------------------------------------------
# 翼型 API モデル
# ---------------------------------------------------------------------------


class PreviewCoords(_StrictModel):
    x: list[float]
    y: list[float]


class AirfoilPresetItem(_StrictModel):
    id: str
    name: str
    naca_code: str = Field(pattern=r"^[0-9]{4}$")
    is_symmetric: bool
    max_thickness_ratio: float
    max_camber_ratio: float
    max_camber_pos: float
    description: str
    preview_coords: PreviewCoords


class AirfoilPresetListResponse(_StrictModel):
    presets: list[AirfoilPresetItem]


AirfoilSourceType = Literal["naca4", "custom_dat", "custom_csv"]


class AirfoilInput(_StrictModel):
    source_type: AirfoilSourceType
    naca_code: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    name: str | None = Field(default=None, max_length=120)
    raw_coordinates_text: str | None = None

    @model_validator(mode="after")
    def _validate_source_fields(self) -> AirfoilInput:
        if self.source_type == "naca4":
            if self.naca_code is None:
                raise ValueError("source_type='naca4' のときは naca_code（4桁数字）が必須です。")
        else:
            if self.raw_coordinates_text is None or len(self.raw_coordinates_text) < 10:
                raise ValueError(
                    "source_type='custom_dat' / 'custom_csv' のときは raw_coordinates_text（10文字以上）が必須です。"
                )
        return self


class AirfoilGenerateRequest(_StrictModel):
    source_type: AirfoilSourceType
    naca_code: str | None = Field(default=None, pattern=r"^[0-9]{4}$")
    name: str | None = Field(default=None, max_length=120)
    raw_coordinates_text: str | None = None
    num_panels: int = Field(default=160, ge=40, le=300)
    closed_te: bool = True

    @field_validator("num_panels")
    @classmethod
    def _validate_even_panels(cls, value: int) -> int:
        if value % 2 != 0:
            raise ValueError("num_panels は 40 以上 300 以下の偶数で指定してください。")
        return value

    @model_validator(mode="after")
    def _validate_source_fields(self) -> AirfoilGenerateRequest:
        if self.source_type == "naca4":
            if self.naca_code is None:
                raise ValueError("source_type='naca4' のときは naca_code（4桁数字）が必須です。")
        else:
            if self.raw_coordinates_text is None or len(self.raw_coordinates_text) < 10:
                raise ValueError(
                    "source_type='custom_dat' / 'custom_csv' のときは raw_coordinates_text（10文字以上）が必須です。"
                )
        return self


class AirfoilGeometrySummary(_StrictModel):
    num_panels: int = Field(ge=40, le=300)
    max_thickness_ratio: float = Field(ge=0.0)
    max_camber_ratio: float
    max_camber_pos: float = Field(ge=0.0, le=1.0)
    is_symmetric: bool
    is_closed_te: bool


class AirfoilGenerateResponse(_StrictModel):
    name: str
    coordinates: PreviewCoords
    geometry: AirfoilGeometrySummary
    warnings: list[WarningItem]


# ---------------------------------------------------------------------------
# 解析実行リクエスト（必須7キー完全準拠）
# ---------------------------------------------------------------------------

FluidPreset = Literal["air_std_20c", "air_0c", "water_20c", "custom"]
FluidMode = Literal["temperature_auto", "direct_mu", "direct_nu"]


class FluidPropertiesInput(_StrictModel):
    preset: FluidPreset = "air_std_20c"
    mode: FluidMode = "temperature_auto"
    temperature_k: float = Field(default=293.15, ge=50.0, le=2000.0)
    static_pressure_pa: float | None = Field(default=101325.0, gt=0.0)
    density_kg_m3: float | None = Field(default=None, gt=0.0)
    dynamic_viscosity_pa_s: float | None = Field(default=None, gt=0.0)
    kinematic_viscosity_m2_s: float | None = Field(default=None, gt=0.0)
    speed_of_sound_mps: float | None = Field(default=None, gt=0.0)

    @field_validator(
        "temperature_k",
        "static_pressure_pa",
        "density_kg_m3",
        "dynamic_viscosity_pa_s",
        "kinematic_viscosity_m2_s",
        "speed_of_sound_mps",
    )
    @classmethod
    def _check_finite(cls, value: float | None, info: Any) -> float | None:
        return _ensure_finite(value, info.field_name)

    @model_validator(mode="after")
    def _validate_mode_requirements(self) -> FluidPropertiesInput:
        if self.mode == "direct_mu":
            if self.density_kg_m3 is None or self.dynamic_viscosity_pa_s is None:
                raise ValueError(
                    "mode='direct_mu' のときは density_kg_m3 と dynamic_viscosity_pa_s が必須です。"
                )
        elif self.mode == "direct_nu":
            if self.density_kg_m3 is None or self.kinematic_viscosity_m2_s is None:
                raise ValueError(
                    "mode='direct_nu' のときは density_kg_m3 と kinematic_viscosity_m2_s が必須です。"
                )

        if (
            self.preset == "custom"
            and self.mode in ("direct_mu", "direct_nu")
            and self.density_kg_m3 is not None
            and self.density_kg_m3 > 10.0
            and self.speed_of_sound_mps is None
        ):
            raise ValueError(
                "高密度液体相当（preset='custom' かつ density_kg_m3 > 10.0）では "
                "空気音速式を誤適用しないため speed_of_sound_mps の指定が必須です。"
            )
        return self


class SolverInputSchema(_StrictModel):
    method: SolverMethod = "panel_method"


class NumericalSettingsInput(_StrictModel):
    num_panels: int = Field(default=160, ge=40, le=300)
    closed_te: bool = True
    grid_nx: int = Field(default=120, ge=40, le=240)
    grid_ny: int = Field(default=80, ge=30, le=180)
    x_range: tuple[float, float] = (-0.5, 1.6)
    y_range: tuple[float, float] = (-0.7, 0.7)
    num_streamlines: int = Field(default=28, ge=10, le=60)

    @field_validator("num_panels")
    @classmethod
    def _validate_even_panels(cls, value: int) -> int:
        if value % 2 != 0:
            raise ValueError("num_panels は 40 以上 300 以下の偶数で指定してください。")
        return value

    @field_validator("x_range")
    @classmethod
    def _validate_x_range(cls, value: tuple[float, float]) -> tuple[float, float]:
        x_min, x_max = value
        if not (math.isfinite(x_min) and math.isfinite(x_max)):
            raise ValueError("x_range には有限値を指定してください。")
        if not (-5.0 <= x_min < 0.0 and 1.0 < x_max <= 5.0):
            raise ValueError(
                "x_range は -5.0 <= x_min < 0.0 かつ 1.0 < x_max <= 5.0 の範囲で指定してください。"
            )
        return value

    @field_validator("y_range")
    @classmethod
    def _validate_y_range(cls, value: tuple[float, float]) -> tuple[float, float]:
        y_min, y_max = value
        if not (math.isfinite(y_min) and math.isfinite(y_max)):
            raise ValueError("y_range には有限値を指定してください。")
        if not (-5.0 <= y_min < 0.0 < y_max <= 5.0):
            raise ValueError(
                "y_range は -5.0 <= y_min < 0.0 < y_max <= 5.0 の範囲で指定してください。"
            )
        return value


class AnalysisRequest(_StrictModel):
    """POST /api/analysis/run の必須7キー契約モデル。"""

    airfoil: AirfoilInput
    angle_of_attack: float = Field(default=4.0, ge=-45.0, le=45.0)
    velocity: float = Field(default=15.0, ge=0.01, le=1000.0)
    chord_length: float = Field(default=0.2, ge=0.0001, le=100.0)
    fluid_properties: FluidPropertiesInput
    solver: SolverInputSchema
    numerical_settings: NumericalSettingsInput

    @field_validator("angle_of_attack", "velocity", "chord_length")
    @classmethod
    def _check_finite(cls, value: float, info: Any) -> float:
        res = _ensure_finite(value, info.field_name)
        assert res is not None
        return res


# ---------------------------------------------------------------------------
# 解析実行レスポンス・2条件比較モデル
# ---------------------------------------------------------------------------


class SolverInfo(_StrictModel):
    method: SolverMethod
    model_type: str
    version: str
    supports_cd: bool


class ResolvedFluid(_StrictModel):
    density_kg_m3: float = Field(gt=0.0)
    dynamic_viscosity_pa_s: float = Field(gt=0.0)
    kinematic_viscosity_m2_s: float = Field(gt=0.0)
    temperature_k: float = Field(gt=0.0)
    static_pressure_pa: float = Field(gt=0.0)
    speed_of_sound_mps: float = Field(gt=0.0)


class AirfoilGeometryResult(_StrictModel):
    name: str
    x: list[float]
    y: list[float]
    num_panels: int = Field(ge=40, le=300)
    max_thickness_ratio: float = Field(ge=0.0)
    max_camber_ratio: float
    max_camber_pos: float = Field(ge=0.0, le=1.0)
    is_symmetric: bool
    is_closed_te: bool


class DimensionlessNumbers(_StrictModel):
    reynolds_number: float = Field(gt=0.0)
    mach_number: float = Field(ge=0.0)


class AerodynamicCoefficients(_StrictModel):
    cl: float
    cl_kutta_joukowski: float
    cl_pressure_integration: float
    cd: float | None = None
    cd_unavailable_reason: str | None = None
    cm_quarter_chord: float


class AnalysisDiagnostics(_StrictModel):
    converged: bool
    condition_number: float | None = None
    linear_residual_max: float | None = None
    te_cp_diff: float | None = None
    cl_discrepancy: float | None = None
    cl_discrepancy_relative: float | None = None
    cd_pressure_numerical_error: float | None = None
    cp_min: float | None = None
    cp_min_xc: float | None = None
    max_velocity_ratio: float | None = None
    compute_time_ms: float = Field(ge=0.0)


class SurfaceDistributionSchema(_StrictModel):
    x_c: list[float]
    y_c: list[float]
    side: list[Literal["upper", "lower"]]
    cp: list[float]
    vt_ratio: list[float]


class FlowFieldData(_StrictModel):
    """2次元配列はすべて [grid_ny][grid_nx]（外側 y_grid 昇順、内側 x_grid 昇順）。"""

    x_grid: list[float]
    y_grid: list[float]
    u_ratio: list[list[float | None]]
    v_ratio: list[list[float | None]]
    speed_ratio: list[list[float | None]]
    cp: list[list[float | None]]
    is_inside_airfoil: list[list[bool]]


class StreamlinePolyline(_StrictModel):
    x: list[float]
    y: list[float]


class FailureInfoSchema(_StrictModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class AnalysisResponse(_StrictModel):
    analysis_id: UUID
    created_at: datetime
    status: Literal["success", "failed"]
    solver_info: SolverInfo
    inputs: AnalysisRequest
    resolved_fluid: ResolvedFluid
    airfoil_geometry: AirfoilGeometryResult | None
    dimensionless: DimensionlessNumbers
    coefficients: AerodynamicCoefficients | None
    diagnostics: AnalysisDiagnostics
    surface: SurfaceDistributionSchema | None
    flow_field: FlowFieldData | None
    streamlines: list[StreamlinePolyline] | None
    warnings: list[WarningItem]
    failure: FailureInfoSchema | None

    @model_validator(mode="after")
    def _enforce_status_and_cd_invariants(self) -> AnalysisResponse:
        if self.status == "success":
            if (
                self.coefficients is None
                or self.surface is None
                or self.flow_field is None
                or self.streamlines is None
                or self.failure is not None
            ):
                raise ValueError(
                    "status='success' では coefficients / surface / flow_field / streamlines が必須で failure は null でなければなりません。"
                )
            if not self.solver_info.supports_cd:
                if self.coefficients.cd is not None:
                    raise ValueError(
                        "supports_cd=False のソルバーで coefficients.cd を非 null にすることは禁止されています。"
                    )
                if not self.coefficients.cd_unavailable_reason:
                    raise ValueError(
                        "supports_cd=False のときは cd_unavailable_reason が必須です。"
                    )
        else:
            if (
                self.coefficients is not None
                or self.surface is not None
                or self.flow_field is not None
                or self.streamlines is not None
                or self.failure is None
            ):
                raise ValueError(
                    "status='failed' では coefficients / surface / flow_field / streamlines はすべて null で failure が必須です。"
                )
        return self


class CompareRequest(_StrictModel):
    base_analysis_id: UUID | None = None
    target_analysis_id: UUID | None = None
    base_request: AnalysisRequest | None = None
    target_request: AnalysisRequest | None = None

    @model_validator(mode="after")
    def _validate_xor_pair(self) -> CompareRequest:
        if (self.base_analysis_id is None) == (self.base_request is None):
            raise ValueError(
                "base_analysis_id と base_request はどちらか一方のみを非 null で指定してください。"
            )
        if (self.target_analysis_id is None) == (self.target_request is None):
            raise ValueError(
                "target_analysis_id と target_request はどちらか一方のみを非 null で指定してください。"
            )
        return self


class CompareDiff(_StrictModel):
    delta_cl: float | None = None
    delta_cm_quarter_chord: float | None = None
    delta_cd: float | None = None
    delta_cp_min: float | None = None
    delta_reynolds_number: float
    delta_mach_number: float


class CompareResponse(_StrictModel):
    base: AnalysisResponse
    target: AnalysisResponse
    diff: CompareDiff
