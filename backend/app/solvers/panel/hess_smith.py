"""Hess-Smith 2D 一定吹出し＋共通一定渦パネル法ソルバー本体および Gate 2 健全性検査。"""

from __future__ import annotations

import math
import time

import numpy as np
from numpy.typing import NDArray
import scipy.linalg

from app.geometry.paneling import build_airfoil_mesh
from app.models.airfoil import AirfoilMesh, PanelSide
from app.models.solver import (
    PHASE1_CD_UNAVAILABLE_REASON,
    FailureInfo,
    RawSolverOutput,
    SolverCoefficients,
    SolverDiagnostics,
    SolverInput,
    SurfaceDistribution,
)
from app.solvers.base import BaseSolver
from app.solvers.panel.influence import compute_panel_influence_matrices

# Gate 2 数値健全性閾値（NUMERICAL_METHOD.md 10.2節）
MAX_CONDITION_NUMBER = 1.0e10
MAX_LINEAR_RESIDUAL = 1.0e-8
BASE_MASS_FLUX_TOL = 0.05
MAX_TE_CP_DIFF = 1.0e-5
MIN_ALLOWED_CP = -500.0
MAX_ALLOWED_CP = 1.0 + 1.0e-6


def _solve_linear_system(
    matrix: NDArray[np.float64],
    rhs: NDArray[np.float64],
) -> NDArray[np.float64]:
    """密行列連立一次方程式 M q = b をピボット選択付き LU 分解で解く。"""
    return np.asarray(scipy.linalg.solve(matrix, rhs), dtype=np.float64)


def _make_failed_output(
    *,
    solver: BaseSolver,
    code: str,
    message: str,
    compute_time_ms: float,
    details: dict[str, float | int | str] | None = None,
    condition_number: float | None = None,
    linear_residual_max: float | None = None,
    te_cp_diff: float | None = None,
    mass_flux_residual: float | None = None,
    cp_min: float | None = None,
    cp_min_xc: float | None = None,
    max_velocity_ratio: float | None = None,
) -> RawSolverOutput:
    """Gate 2 遮断時の安全な failed 出力を構築する（coefficients/surface は必ず None）。"""
    safe_cond = (
        float(condition_number)
        if (condition_number is not None and math.isfinite(condition_number))
        else None
    )
    safe_res = (
        float(linear_residual_max)
        if (linear_residual_max is not None and math.isfinite(linear_residual_max))
        else None
    )
    return RawSolverOutput(
        status="failed",
        solver_id=solver.solver_id,
        model_type=solver.model_type,
        version=solver.version,
        supports_cd=solver.supports_cd,
        coefficients=None,
        surface=None,
        diagnostics=SolverDiagnostics(
            converged=False,
            condition_number=safe_cond,
            linear_residual_max=safe_res,
            te_cp_diff=te_cp_diff,
            cl_discrepancy=None,
            cl_discrepancy_relative=None,
            cd_pressure_numerical_error=None,
            cp_min=cp_min,
            cp_min_xc=cp_min_xc,
            max_velocity_ratio=max_velocity_ratio,
            compute_time_ms=float(compute_time_ms),
            mass_flux_residual=mass_flux_residual,
        ),
        failure=FailureInfo(
            code=code,
            message=message,
            details=details,
        ),
        sigma=None,
        gamma=None,
        gamma_circulation_dimless=None,
    )


class PanelMethodSolver(BaseSolver):
    """Phase 1 標準ソルバー：Hess-Smith 2D 非粘性・非圧縮ポテンシャル流れパネル法。"""

    solver_id = "panel_method"
    label = "パネル法（2D 非粘性・非圧縮）"
    model_type = "inviscid_incompressible_potential"
    version = "0.1.0"
    phase = 1
    available = True
    supports_cd = False
    description = "Hess-Smith 2D ポテンシャル流れパネル法。粘性抗力・失速は計算不可。"

    def solve(self, mesh: AirfoilMesh, params: SolverInput) -> RawSolverOutput:
        """(N+1)x(N+1) Hess-Smith 線形系（非貫通境界条件 + Kutta 条件）を解き、Gate 2 検査を行う。"""
        return self._solve_internal(mesh, params, enforce_kutta=True)

    def solve_zero_circulation(
        self,
        mesh: AirfoilMesh,
        params: SolverInput,
    ) -> RawSolverOutput:
        """循環 gamma=0 固定の NxN 一定吹出しパネル法を解く（円柱厳密解検証 VV-NUM-01 用）。"""
        return self._solve_internal(mesh, params, enforce_kutta=False)

    def _solve_internal(
        self,
        mesh: AirfoilMesh,
        params: SolverInput,
        *,
        enforce_kutta: bool,
    ) -> RawSolverOutput:
        t0 = time.perf_counter()
        n_panels = mesh.num_panels

        # 事前幾何ガード（退化メッシュが直接渡された場合も例外クラッシュせず failed を返す）
        if (
            n_panels < 4
            or not (np.all(np.isfinite(mesh.x)) and np.all(np.isfinite(mesh.y)))
            or not np.all(np.isfinite(mesh.s))
            or np.any(mesh.s <= 1e-14)
        ):
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="DEGENERATE_GEOMETRY",
                message="ゼロ長パネルまたは非有限座標を含む退化メッシュのため、パネル法解析を中断しました。",
                compute_time_ms=elapsed,
                details={"num_panels": int(n_panels), "min_panel_length": float(np.min(mesh.s)) if n_panels > 0 else 0.0},
            )

        alpha_rad = params.alpha_rad
        if not math.isfinite(alpha_rad):
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="NON_FINITE_INPUT",
                message="迎角に非有限値（NaN/Inf）が指定されたため解析を中断しました。",
                compute_time_ms=elapsed,
            )

        # 1. 影響係数行列の構築
        a_n, a_t, b_n, b_t = compute_panel_influence_matrices(mesh)

        # 2. 線形系 M q = rhs の組み立て
        if enforce_kutta:
            matrix = np.empty((n_panels + 1, n_panels + 1), dtype=np.float64)
            rhs = np.empty(n_panels + 1, dtype=np.float64)

            # 第 0 .. N-1 行: 非貫通境界条件 V_i . n_i = 0
            matrix[:n_panels, :n_panels] = a_n
            matrix[:n_panels, n_panels] = np.sum(b_n, axis=1)
            rhs[:n_panels] = -np.sin(alpha_rad - mesh.phi)

            # 第 N 行: 線形 Kutta 条件 V_{t,0} + V_{t,N-1} = 0
            matrix[n_panels, :n_panels] = a_t[0, :] + a_t[n_panels - 1, :]
            matrix[n_panels, n_panels] = float(
                np.sum(b_t[0, :] + b_t[n_panels - 1, :])
            )
            rhs[n_panels] = -(
                math.cos(alpha_rad - float(mesh.phi[0]))
                + math.cos(alpha_rad - float(mesh.phi[n_panels - 1]))
            )
        else:
            # 吹出しのみモード（gamma = 0 固定、NxN 系）
            matrix = a_n.copy()
            rhs = -np.sin(alpha_rad - mesh.phi)

        # Gate 2-(1a): 行列・右辺の有限値検査
        if not (np.all(np.isfinite(matrix)) and np.all(np.isfinite(rhs))):
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="NON_FINITE_MATRIX",
                message="影響係数行列に NaN または Inf が発生したため（重複パネル等）、解析を中断しました。",
                compute_time_ms=elapsed,
            )

        # Gate 2-(2): 行列条件数の検査 cond(M) < 1e10
        try:
            cond_num = float(np.linalg.cond(matrix))
        except np.linalg.LinAlgError:
            cond_num = math.inf

        if not math.isfinite(cond_num) or cond_num >= MAX_CONDITION_NUMBER:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="ILL_CONDITIONED_MATRIX",
                message=(
                    f"パネル法の連立一次方程式の条件数が許容上限（{MAX_CONDITION_NUMBER:.0e}）を超えたため、"
                    "解析を中断しました。後縁付近の座標重複や極端に薄い翼型になっていないか確認してください。"
                ),
                compute_time_ms=elapsed,
                condition_number=cond_num,
                details={
                    "condition_number": cond_num if math.isfinite(cond_num) else "inf",
                    "threshold": MAX_CONDITION_NUMBER,
                },
            )

        # 3. 線形方程式の求解
        try:
            q_sol = _solve_linear_system(matrix, rhs)
        except (scipy.linalg.LinAlgError, ValueError) as exc:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="SINGULAR_MATRIX",
                message=f"パネル法の連立一次方程式が特異行列となったため求解できませんでした: {exc}",
                compute_time_ms=elapsed,
                condition_number=cond_num,
            )

        # Gate 2-(1b): 解ベクトルの有限値検査
        if not np.all(np.isfinite(q_sol)):
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="NON_FINITE_SOLUTION",
                message="連立一次方程式の解ベクトルに NaN または Inf が検出されたため解析を中断しました。",
                compute_time_ms=elapsed,
                condition_number=cond_num,
            )

        # Gate 2-(3): 線形系残差ノルム検査 ||Mq - b||_inf < 1e-8
        linear_residual_max = float(np.max(np.abs(matrix @ q_sol - rhs)))
        if not math.isfinite(linear_residual_max) or linear_residual_max >= MAX_LINEAR_RESIDUAL:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="LINEAR_RESIDUAL_EXCEEDED",
                message=(
                    f"連立一次方程式の残差ノルム（{linear_residual_max:.3e}）が許容上限"
                    f"（{MAX_LINEAR_RESIDUAL:.0e}）を超過しました。"
                ),
                compute_time_ms=elapsed,
                condition_number=cond_num,
                linear_residual_max=linear_residual_max,
                details={
                    "linear_residual_max": linear_residual_max,
                    "threshold": MAX_LINEAR_RESIDUAL,
                },
            )

        if enforce_kutta:
            sigma = q_sol[:n_panels].copy()
            gamma = float(q_sol[n_panels])
        else:
            sigma = q_sol[:n_panels].copy()
            gamma = 0.0

        # 4. 表面接線速度比・圧力係数・空力係数の算出
        vt_ratio = (
            np.cos(alpha_rad - mesh.phi)
            + (a_t @ sigma)
            + np.sum(b_t, axis=1) * gamma
        )
        cp = 1.0 - vt_ratio * vt_ratio

        total_perimeter = float(np.sum(mesh.s))
        gamma_circ_dimless = gamma * total_perimeter
        cl_kj = 2.0 * gamma_circ_dimless

        # 表面圧力積分による空気力係数 (C_X, C_Y) -> C_{L,p}, C_{D,p}, C_{m,c/4}
        dcx = -cp * mesh.nx * mesh.s
        dcy = -cp * mesh.ny * mesh.s
        cx = float(np.sum(dcx))
        cy = float(np.sum(dcy))

        sin_a = math.sin(alpha_rad)
        cos_a = math.cos(alpha_rad)
        cl_p = -cx * sin_a + cy * cos_a
        cd_p_num_err = cx * cos_a + cy * sin_a

        # 1/4弦点 (0.25, 0.0) 周りピッチングモーメント係数（頭上げ Nose-up を正）
        cm_c4 = float(-np.sum((mesh.x_c - 0.25) * dcy - mesh.y_c * dcx))

        # Gate 2-(1c): 表面物理量・係数の有限値検査
        if not (
            np.all(np.isfinite(vt_ratio))
            and np.all(np.isfinite(cp))
            and math.isfinite(cl_kj)
            and math.isfinite(cl_p)
            and math.isfinite(cm_c4)
        ):
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="NON_FINITE_SOLUTION",
                message="表面圧力分布または空力係数に NaN / Inf が発生したため解析を中断しました。",
                compute_time_ms=elapsed,
                condition_number=cond_num,
                linear_residual_max=linear_residual_max,
            )

        mass_flux_residual = float(np.abs(np.sum(sigma * mesh.s)))
        mass_flux_limit = BASE_MASS_FLUX_TOL + 2.0 * abs(float(mesh.te_gap))
        te_cp_diff = float(np.abs(cp[0] - cp[-1]))

        idx_cp_min = int(np.argmin(cp))
        cp_min = float(cp[idx_cp_min])
        cp_max = float(np.max(cp))
        cp_min_xc = float(mesh.x_c[idx_cp_min])
        max_vel_ratio = float(np.max(np.abs(vt_ratio)))

        # Gate 2-(4): 吹出し総和（閉物体質量保存）検査
        if mass_flux_residual >= mass_flux_limit:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="MASS_CONSERVATION_VIOLATED",
                message=(
                    f"吹出し強度の総和残差（{mass_flux_residual:.4f}）が許容上限"
                    f"（{mass_flux_limit:.4f}）を超過しました。"
                ),
                compute_time_ms=elapsed,
                condition_number=cond_num,
                linear_residual_max=linear_residual_max,
                te_cp_diff=te_cp_diff,
                mass_flux_residual=mass_flux_residual,
                details={
                    "mass_flux_residual": mass_flux_residual,
                    "threshold": mass_flux_limit,
                },
            )

        # Gate 2-(5): Kutta 条件充足検査（enforce_kutta=True 時）
        if enforce_kutta and te_cp_diff >= MAX_TE_CP_DIFF:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="KUTTA_CONDITION_VIOLATED",
                message=(
                    f"後縁上下パネルの圧力係数差（{te_cp_diff:.3e}）が許容上限"
                    f"（{MAX_TE_CP_DIFF:.0e}）を超過しました。"
                ),
                compute_time_ms=elapsed,
                condition_number=cond_num,
                linear_residual_max=linear_residual_max,
                te_cp_diff=te_cp_diff,
                mass_flux_residual=mass_flux_residual,
                details={"te_cp_diff": te_cp_diff, "threshold": MAX_TE_CP_DIFF},
            )

        # Gate 2-(6): 表面圧力係数 Cp の有界性検査 (-500 < Cp <= 1.0 + 1e-6)
        if cp_min <= MIN_ALLOWED_CP or cp_max > MAX_ALLOWED_CP:
            elapsed = (time.perf_counter() - t0) * 1000.0
            return _make_failed_output(
                solver=self,
                code="UNPHYSICAL_PRESSURE_COEFFICIENT",
                message=(
                    f"非物理的な表面圧力係数（min Cp = {cp_min:.3f}, max Cp = {cp_max:.6f}）が"
                    "検出されたため描画を遮断しました。"
                ),
                compute_time_ms=elapsed,
                condition_number=cond_num,
                linear_residual_max=linear_residual_max,
                te_cp_diff=te_cp_diff,
                mass_flux_residual=mass_flux_residual,
                cp_min=cp_min,
                cp_min_xc=cp_min_xc,
                max_velocity_ratio=max_vel_ratio,
                details={
                    "cp_min": cp_min,
                    "cp_max": cp_max,
                    "min_allowed_cp": MIN_ALLOWED_CP,
                    "max_allowed_cp": MAX_ALLOWED_CP,
                },
            )

        cl_discrepancy = float(abs(cl_kj - cl_p))
        cl_discrepancy_rel = (
            float(cl_discrepancy / abs(cl_kj)) if abs(cl_kj) > 1e-12 else 0.0
        )
        elapsed = (time.perf_counter() - t0) * 1000.0

        # Phase 1 では抗力係数 cd = None をハードコード強制（0.0 や cd_p_num_err の代入を厳禁）
        coefficients = SolverCoefficients(
            cl=cl_kj,
            cl_kutta_joukowski=cl_kj,
            cl_pressure_integration=cl_p,
            cd=None,
            cd_unavailable_reason=PHASE1_CD_UNAVAILABLE_REASON,
            cm_quarter_chord=cm_c4,
        )

        surface = SurfaceDistribution(
            x_c=mesh.x_c.copy(),
            y_c=mesh.y_c.copy(),
            side=list(mesh.side),
            cp=cp,
            vt_ratio=vt_ratio,
        )

        diagnostics = SolverDiagnostics(
            converged=True,
            condition_number=cond_num,
            linear_residual_max=linear_residual_max,
            te_cp_diff=te_cp_diff,
            cl_discrepancy=cl_discrepancy,
            cl_discrepancy_relative=cl_discrepancy_rel,
            cd_pressure_numerical_error=cd_p_num_err,
            cp_min=cp_min,
            cp_min_xc=cp_min_xc,
            max_velocity_ratio=max_vel_ratio,
            compute_time_ms=elapsed,
            mass_flux_residual=mass_flux_residual,
        )

        return RawSolverOutput(
            status="success",
            solver_id=self.solver_id,
            model_type=self.model_type,
            version=self.version,
            supports_cd=self.supports_cd,
            coefficients=coefficients,
            surface=surface,
            diagnostics=diagnostics,
            failure=None,
            sigma=sigma,
            gamma=gamma,
            gamma_circulation_dimless=gamma_circ_dimless,
        )


def build_circular_cylinder_mesh(
    num_panels: int = 160,
    *,
    radius: float = 0.5,
    center_x: float = 0.5,
    center_y: float = 0.0,
) -> tuple[AirfoilMesh, NDArray[np.float64]]:
    """円柱周り一様ポテンシャル流れ厳密解検証（VV-NUM-01）用の時計回り等角パネルメッシュを構築する。

    後方よどみ点 (center_x + R, center_y) [theta = 0] を始点・終点とし、
    時計回りに theta_k = -2*pi*k/N (k = 0..N) で等角分割する。
    上下対称性・前後対称性を機械精度で厳密保持する。

    Returns
    -------
    mesh : AirfoilMesh
        時計回り N パネルの円柱メッシュ。
    theta_colloc : NDArray[np.float64]
        各コロケーション点の中心極角 theta_i [rad]（長さ N）。
    """
    if num_panels < 8 or num_panels % 2 != 0:
        raise ValueError("円柱検証メッシュの num_panels は8以上の偶数で指定してください。")

    n_half = num_panels // 2
    k_half = np.arange(n_half + 1, dtype=np.float64)
    theta_lower = -(np.pi * k_half) / float(n_half)  # 0 -> -pi (下半分: 後縁 -> 前縁)

    x_lo = center_x + radius * np.cos(theta_lower)
    y_lo = center_y + radius * np.sin(theta_lower)
    y_lo[0] = center_y
    y_lo[-1] = center_y

    # 上半分は下半分の完全鏡像（-pi -> 0: 前縁 -> 後縁）として機械精度対称性を保証
    x_up = x_lo[::-1].copy()
    y_up = (2.0 * center_y - y_lo[::-1]).copy()

    x_nodes = np.concatenate([x_lo[:-1], x_up])
    y_nodes = np.concatenate([y_lo[:-1], y_up])

    side: list[PanelSide] = ["lower"] * n_half + ["upper"] * n_half
    mesh = build_airfoil_mesh(
        x_nodes,
        y_nodes,
        name=f"Circular Cylinder (N={num_panels})",
        max_thickness_ratio=2.0 * radius,
        max_camber_ratio=0.0,
        max_camber_pos=0.0,
        is_symmetric=True,
        is_closed_te=True,
        side=side,
    )

    theta_colloc = np.arctan2(mesh.y_c - center_y, mesh.x_c - center_x)
    return mesh, theta_colloc


def solve_source_only_cylinder(
    num_panels: int = 160,
    alpha_deg: float = 0.0,
    *,
    radius: float = 0.5,
    center_x: float = 0.5,
    center_y: float = 0.0,
) -> tuple[RawSolverOutput, AirfoilMesh, NDArray[np.float64]]:
    """円柱周り一様ポテンシャル流れ（循環 gamma=0、NxN 一定吹出し系）を解いて返す（VV-NUM-01 用）。"""
    mesh, theta_colloc = build_circular_cylinder_mesh(
        num_panels=num_panels,
        radius=radius,
        center_x=center_x,
        center_y=center_y,
    )
    solver = PanelMethodSolver()
    output = solver.solve_zero_circulation(
        mesh,
        SolverInput(angle_of_attack_deg=alpha_deg),
    )
    return output, mesh, theta_colloc
