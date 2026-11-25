"""ソルバー抽象基底クラス（Strategyパターン）・未実装例外・SolverRegistry。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.models.airfoil import AirfoilMesh
from app.models.solver import RawSolverOutput, SolverCapability, SolverInput


class SolverNotAvailableError(RuntimeError):
    """未実装フェーズのソルバー（xfoil, cfd_su2 等）が要求された際の例外（API 501 対応）。"""

    def __init__(
        self,
        solver_id: str,
        *,
        phase: int = 2,
        available_methods: list[str] | None = None,
        message: str | None = None,
    ) -> None:
        avail = available_methods if available_methods is not None else ["panel_method"]
        msg = message or (
            f"ソルバー '{solver_id}' は Phase {phase} で実装予定です。"
            f"Phase 1 では {avail} を指定してください。"
        )
        super().__init__(msg)
        self.code = "SOLVER_NOT_IMPLEMENTED"
        self.solver_id = solver_id
        self.phase = phase
        self.available_methods = avail
        self.message = msg
        self.details: dict[str, Any] = {
            "requested_method": solver_id,
            "available_methods": avail,
        }


class BaseSolver(ABC):
    """全フェーズの2次元流体解析ソルバーが実装すべき抽象基底クラス。"""

    solver_id: str = ""
    label: str = ""
    model_type: str = ""
    version: str = "0.1.0"
    phase: int = 1
    available: bool = False
    supports_cd: bool = False
    description: str = ""

    def is_available(self) -> bool:
        """現在のフェーズでこのソルバーが実行可能かどうかを返す。"""
        return bool(self.available)

    def get_capability(self) -> SolverCapability:
        """GET /api/health 用のソルバー能力宣言オブジェクトを返す。"""
        return SolverCapability(
            method=self.solver_id,
            label=self.label,
            available=bool(self.available),
            phase=int(self.phase),
            supports_cd=bool(self.supports_cd),
            description=self.description,
        )

    @abstractmethod
    def solve(self, mesh: AirfoilMesh, params: SolverInput) -> RawSolverOutput:
        """無次元翼型メッシュと解析条件から空力係数・表面分布・診断値を算出する。"""


class Su2CfdSolver(BaseSolver):
    """Phase 3 実装予定の 2D 粘性・圧縮性 CFD（SU2 / RANS）予約スタブ。"""

    solver_id = "cfd_su2"
    label = "2D CFD（SU2 / RANS）"
    model_type = "compressible_rans_2d"
    version = "0.1.0"
    phase = 3
    available = False
    supports_cd = True
    description = "Phase 3 で実装予定（現在利用不可）。"

    def solve(self, mesh: AirfoilMesh, params: SolverInput) -> RawSolverOutput:
        raise SolverNotAvailableError(
            self.solver_id,
            phase=self.phase,
            available_methods=["panel_method"],
        )


class _HybridMethod:
    """クラス呼び出し（SolverRegistry.get(...)）とインスタンス呼び出しの両方を透過的に扱う記述子。"""

    def __init__(self, func: Any) -> None:
        self._func = func

    def __get__(self, instance: SolverRegistry | None, owner: type[SolverRegistry]) -> Any:
        target = instance if instance is not None else owner._get_default_instance()
        return self._func.__get__(target, owner)


class SolverRegistry:
    """Phase 1〜3 のソルバー群を管理・解決するレジストリ。

    - "panel_method": available=True, supports_cd=False（Phase 1 稼働）
    - "xfoil":        available=False, supports_cd=True（Phase 2 予約 -> SolverNotAvailableError）
    - "cfd_su2":      available=False, supports_cd=True（Phase 3 予約 -> SolverNotAvailableError）
    """

    _default_instance: SolverRegistry | None = None

    def __init__(self, solvers: list[BaseSolver] | None = None) -> None:
        self._solvers: dict[str, BaseSolver] = {}
        if solvers is None:
            from app.solvers.panel.hess_smith import PanelMethodSolver
            from app.solvers.xfoil import XfoilSolver

            default_list: list[BaseSolver] = [
                PanelMethodSolver(),
                XfoilSolver(),
                Su2CfdSolver(),
            ]
            for solver in default_list:
                self.register(solver)
        else:
            for solver in solvers:
                self.register(solver)

    @classmethod
    def _get_default_instance(cls) -> SolverRegistry:
        if cls._default_instance is None:
            cls._default_instance = cls()
        return cls._default_instance

    def register(self, solver: BaseSolver) -> None:
        """ソルバーインスタンスを登録する。"""
        self._solvers[solver.solver_id] = solver

    @_HybridMethod
    def get_registered(self, method: str) -> BaseSolver:
        """available フラグに関わらず登録済みソルバーインスタンスを取得する（メタデータ参照用）。"""
        if method not in self._solvers:
            raise ValueError(f"未知のソルバー識別子です: '{method}'")
        return self._solvers[method]

    @_HybridMethod
    def list_available_methods(self) -> list[str]:
        """現在実行可能なソルバー識別子一覧を返す。"""
        return [m for m, s in self._solvers.items() if s.is_available()]

    @_HybridMethod
    def list_capabilities(self) -> list[SolverCapability]:
        """全登録ソルバーの SolverCapability 一覧を返す（GET /api/health 用）。"""
        return [s.get_capability() for s in self._solvers.values()]

    @_HybridMethod
    def get(self, method: str) -> BaseSolver:
        """実行可能なソルバーを取得する。未実装フェーズのソルバー指定時は SolverNotAvailableError を送出する。"""
        if method not in self._solvers:
            raise ValueError(f"未知のソルバー識別子です: '{method}'")
        solver = self._solvers[method]
        if not solver.is_available():
            raise SolverNotAvailableError(
                solver.solver_id,
                phase=solver.phase,
                available_methods=self.list_available_methods(),
            )
        return solver


default_solver_registry = SolverRegistry._get_default_instance
