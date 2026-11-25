"""ドメインモデルパッケージ公開インターフェース。"""

from app.models.airfoil import (
    STANDARD_AIRFOIL_PRESETS,
    AirfoilGeometryError,
    AirfoilMesh,
    AirfoilPresetSpec,
    GeometryWarning,
    PanelSide,
    WarningSeverity,
)
from app.models.solver import (
    PHASE1_CD_UNAVAILABLE_REASON,
    FailureInfo,
    RawSolverOutput,
    SolverCapability,
    SolverCoefficients,
    SolverDiagnostics,
    SolverInput,
    SolverStatus,
    SurfaceDistribution,
)

__all__ = [
    "AirfoilGeometryError",
    "AirfoilMesh",
    "AirfoilPresetSpec",
    "FailureInfo",
    "GeometryWarning",
    "PHASE1_CD_UNAVAILABLE_REASON",
    "PanelSide",
    "RawSolverOutput",
    "STANDARD_AIRFOIL_PRESETS",
    "SolverCapability",
    "SolverCoefficients",
    "SolverDiagnostics",
    "SolverInput",
    "SolverStatus",
    "SurfaceDistribution",
    "WarningSeverity",
]
