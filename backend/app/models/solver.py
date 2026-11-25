"""ソルバー入出力・空力係数・数値診断・失敗情報のドメインデータモデル。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray

from app.models.airfoil import PanelSide

SolverStatus = Literal["success", "failed"]

PHASE1_CD_UNAVAILABLE_REASON = (
    "非粘性ポテンシャル流れ（パネル法）では粘性抗力・剥離抗力を算出できません"
    "（Phase 2 XFOIL で対応予定）。"
)


@dataclass(frozen=True)
class SolverCapability:
    """各フェーズのソルバー対応状況メタデータ（GET /api/health 準拠）。"""

    method: str
    label: str
    available: bool
    phase: int
    supports_cd: bool
    description: str

    def to_dict(self) -> dict[str, Any]:
        """OpenAPI SolverCapability スキーマ準拠の辞書へ変換する。"""
        return {
            "method": self.method,
            "label": self.label,
            "available": self.available,
            "phase": self.phase,
            "supports_cd": self.supports_cd,
            "description": self.description,
        }


@dataclass(frozen=True)
class SolverInput:
    """ソルバー実行に渡す入力条件。

    Phase 1 のポテンシャル流コアは無次元系（c=1, V_inf=1）で計算するため、
    無次元解自体は angle_of_attack_deg のみに依存する。
    Phase 2（XFOIL）および Phase 3（CFD）との共通インターフェースとして
    reynolds_number, mach_number 等も保持可能としている。
    """

    angle_of_attack_deg: float
    velocity: float = 15.0
    chord_length: float = 0.2
    reynolds_number: float | None = None
    mach_number: float | None = None

    @property
    def alpha_rad(self) -> float:
        """迎角 [rad] を返す。"""
        return math.radians(self.angle_of_attack_deg)


@dataclass(frozen=True)
class SolverCoefficients:
    """無次元空力係数オブジェクト。

    Phase 1 パネル法では抗力係数 cd は常時 None（0.0 への置換禁止）。
    """

    cl: float
    cl_kutta_joukowski: float
    cl_pressure_integration: float
    cd: float | None
    cd_unavailable_reason: str | None
    cm_quarter_chord: float

    def to_dict(self) -> dict[str, Any]:
        """API レスポンスの coefficients オブジェクト形式へ変換する。"""
        return {
            "cl": float(self.cl),
            "cl_kutta_joukowski": float(self.cl_kutta_joukowski),
            "cl_pressure_integration": float(self.cl_pressure_integration),
            "cd": None if self.cd is None else float(self.cd),
            "cd_unavailable_reason": self.cd_unavailable_reason,
            "cm_quarter_chord": float(self.cm_quarter_chord),
        }


@dataclass
class SurfaceDistribution:
    """翼表面コロケーション点上の無次元圧力・接線速度分布。"""

    x_c: NDArray[np.float64]
    y_c: NDArray[np.float64]
    side: list[PanelSide]
    cp: NDArray[np.float64]
    vt_ratio: NDArray[np.float64]

    def to_dict(self) -> dict[str, Any]:
        """API レスポンスの surface オブジェクト形式へ変換する。"""
        return {
            "x_c": self.x_c.tolist(),
            "y_c": self.y_c.tolist(),
            "side": list(self.side),
            "cp": self.cp.tolist(),
            "vt_ratio": self.vt_ratio.tolist(),
        }


@dataclass(frozen=True)
class SolverDiagnostics:
    """線形系健全性・クロスチェック・数値誤差の診断情報。"""

    converged: bool
    condition_number: float | None
    linear_residual_max: float | None
    te_cp_diff: float | None
    cl_discrepancy: float | None
    cl_discrepancy_relative: float | None
    cd_pressure_numerical_error: float | None
    cp_min: float | None
    cp_min_xc: float | None
    max_velocity_ratio: float | None
    compute_time_ms: float
    mass_flux_residual: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """API レスポンスの diagnostics スキーマ（厳密11キー）へ変換する。"""
        return {
            "converged": bool(self.converged),
            "condition_number": self.condition_number,
            "linear_residual_max": self.linear_residual_max,
            "te_cp_diff": self.te_cp_diff,
            "cl_discrepancy": self.cl_discrepancy,
            "cl_discrepancy_relative": self.cl_discrepancy_relative,
            "cd_pressure_numerical_error": self.cd_pressure_numerical_error,
            "cp_min": self.cp_min,
            "cp_min_xc": self.cp_min_xc,
            "max_velocity_ratio": self.max_velocity_ratio,
            "compute_time_ms": float(self.compute_time_ms),
        }


@dataclass(frozen=True)
class FailureInfo:
    """数値破綻・非収束時の失敗詳細情報。"""

    code: str
    message: str
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """API レスポンスの failure オブジェクト形式へ変換する。"""
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class RawSolverOutput:
    """BaseSolver.solve() が返す無次元ソルバー生出力。

    status == "failed" のときは不正確な描画を確実に防止するため、
    coefficients および surface は必ず None となる。
    """

    status: SolverStatus
    solver_id: str
    model_type: str
    version: str
    supports_cd: bool
    coefficients: SolverCoefficients | None
    surface: SurfaceDistribution | None
    diagnostics: SolverDiagnostics
    failure: FailureInfo | None
    sigma: NDArray[np.float64] | None = None  # 無次元吹出し強度 \hat{\sigma}_j (N,)
    gamma: float | None = None  # 無次元渦強度 \hat{\gamma}
    gamma_circulation_dimless: float | None = None  # 無次元循環 \hat{\Gamma} = \hat{\gamma}\sum S_j

    def solver_info_dict(self) -> dict[str, Any]:
        """API レスポンスの solver_info オブジェクト形式へ変換する。"""
        return {
            "method": self.solver_id,
            "model_type": self.model_type,
            "version": self.version,
            "supports_cd": bool(self.supports_cd),
        }
