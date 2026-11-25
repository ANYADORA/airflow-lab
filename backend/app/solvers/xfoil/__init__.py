"""Phase 2 実装予定の XFOIL（粘性・非粘性連成解析）アダプタ予約スタブ。"""

from __future__ import annotations

from app.models.airfoil import AirfoilMesh
from app.models.solver import RawSolverOutput, SolverInput
from app.solvers.base import BaseSolver, SolverNotAvailableError


class XfoilSolver(BaseSolver):
    """Phase 2 で統合予定の XFOIL 2D 境界層連成ソルバースタブ。

    Phase 1 ではダミー値やパネル法結果のすり替えを行わず、
    available=False, supports_cd=True として登録し、呼び出し時に
    SolverNotAvailableError（HTTP 501 対応）を送出する。
    """

    solver_id = "xfoil"
    label = "XFOIL（2D 粘性境界層連成）"
    model_type = "viscous_inviscid_coupled_ibl"
    version = "0.1.0"
    phase = 2
    available = False
    supports_cd = True
    description = "Phase 2 で実装予定（現在利用不可）。"

    def solve(self, mesh: AirfoilMesh, params: SolverInput) -> RawSolverOutput:
        raise SolverNotAvailableError(
            self.solver_id,
            phase=self.phase,
            available_methods=["panel_method"],
        )


__all__ = ["XfoilSolver"]
