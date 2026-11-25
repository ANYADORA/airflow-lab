"""BaseSolver 戦略契約・cd=None 強制・SolverRegistry・速度評価バッチカーネルの単体テスト。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.geometry import build_airfoil_mesh, generate_naca4
from app.models.solver import SolverInput
from app.solvers import (
    BaseSolver,
    PanelMethodSolver,
    SolverNotAvailableError,
    SolverRegistry,
    Su2CfdSolver,
    XfoilSolver,
    evaluate_induced_velocity_batch,
)


class TestSolverStrategyAndRegistry:
    """BaseSolver 準拠・cd=None 強制・未実装フェーズ 501 例外の検証。"""

    def test_panel_method_solver_conforms_to_base_and_forces_cd_none(self) -> None:
        solver = PanelMethodSolver()
        assert isinstance(solver, BaseSolver)
        assert solver.solver_id == "panel_method"
        assert solver.is_available() is True
        assert solver.supports_cd is False
        assert solver.phase == 1

        mesh = generate_naca4("2412", num_panels=160, closed_te=True)
        for alpha_deg in (-6.0, 0.0, 4.0, 12.0):
            res = solver.solve(mesh, SolverInput(angle_of_attack_deg=alpha_deg))
            assert res.status == "success"
            assert res.diagnostics.converged is True
            assert res.coefficients is not None
            # Phase 1 では cd はいかなる迎角でも厳密に None（0.0 ではない）
            assert res.coefficients.cd is None
            assert res.coefficients.cd_unavailable_reason is not None
            assert len(res.coefficients.cd_unavailable_reason) > 0
            assert res.failure is None

    def test_solver_registry_capabilities_and_unimplemented_errors(self) -> None:
        registry = SolverRegistry()
        caps = {c.method: c for c in registry.list_capabilities()}

        assert set(caps.keys()) == {"panel_method", "xfoil", "cfd_su2"}
        assert caps["panel_method"].available is True
        assert caps["panel_method"].supports_cd is False

        assert caps["xfoil"].available is False
        assert caps["xfoil"].supports_cd is True
        assert caps["xfoil"].phase == 2

        assert caps["cfd_su2"].available is False
        assert caps["cfd_su2"].supports_cd is True
        assert caps["cfd_su2"].phase == 3

        # 稼働中ソルバー取得（クラスメソッド風呼び出し・インスタンス呼び出し双方）
        panel_solver = SolverRegistry.get("panel_method")
        assert isinstance(panel_solver, PanelMethodSolver)

        # 未実装ソルバー要求時はモック値を返さず SolverNotAvailableError を送出
        for unavail_id in ("xfoil", "cfd_su2"):
            with pytest.raises(SolverNotAvailableError) as exc_info:
                registry.get(unavail_id)
            assert exc_info.value.code == "SOLVER_NOT_IMPLEMENTED"
            assert exc_info.value.solver_id == unavail_id

        mesh = generate_naca4("0012", num_panels=80)
        params = SolverInput(angle_of_attack_deg=2.0)
        with pytest.raises(SolverNotAvailableError):
            XfoilSolver().solve(mesh, params)
        with pytest.raises(SolverNotAvailableError):
            Su2CfdSolver().solve(mesh, params)

    def test_degenerate_mesh_returns_failed_without_crash(self) -> None:
        # 節点が全て (0, 0) に潰れた退化メッシュでもクラッシュせず status="failed" を返すこと
        x_deg = np.zeros(41, dtype=np.float64)
        y_deg = np.zeros(41, dtype=np.float64)
        deg_mesh = build_airfoil_mesh(
            x_deg,
            y_deg,
            name="Degenerate Zero Mesh",
            validate_non_degenerate=False,
        )

        solver = PanelMethodSolver()
        res = solver.solve(deg_mesh, SolverInput(angle_of_attack_deg=4.0))
        assert res.status == "failed"
        assert res.diagnostics.converged is False
        assert res.coefficients is None
        assert res.surface is None
        assert res.failure is not None

    def test_induced_velocity_batch_two_stage_singularity_guards(self) -> None:
        mesh = generate_naca4("2412", num_panels=160, closed_te=True)
        solver = PanelMethodSolver()
        alpha_deg = 6.0
        alpha_rad = math.radians(alpha_deg)
        out = solver.solve(mesh, SolverInput(angle_of_attack_deg=alpha_deg))

        assert out.status == "success"
        assert out.sigma is not None
        assert out.gamma is not None
        assert out.surface is not None

        # ガード①: パネル端節点から 1e-9 c の極近傍評価点、ガード②: パネル外側面極薄層 (eta = 1e-5)
        near_node_x = mesh.x[:-1] + 1e-9 * mesh.nx
        near_node_y = mesh.y[:-1] + 1e-9 * mesh.ny
        near_panel_x = mesh.x_c + 1e-6 * mesh.nx
        near_panel_y = mesh.y_c + 1e-6 * mesh.ny

        px = np.concatenate([near_node_x, near_panel_x, np.array([-2.0, 3.0])])
        py = np.concatenate([near_node_y, near_panel_y, np.array([0.0, 0.5])])

        u_ratio, v_ratio = evaluate_induced_velocity_batch(
            px,
            py,
            mesh,
            out.sigma,
            out.gamma,
            alpha_rad,
            out.surface.vt_ratio,
        )
        speed_ratio = np.hypot(u_ratio, v_ratio)
        cp_pts = 1.0 - speed_ratio**2

        assert np.all(np.isfinite(u_ratio))
        assert np.all(np.isfinite(v_ratio))
        assert float(np.max(speed_ratio)) <= 22.38
        assert float(np.min(cp_pts)) > -500.0
        assert float(np.max(cp_pts)) <= 1.0 + 1e-6

        # ガード②が効いている中点極近傍ではパネル接線速度と一致すること
        clamp_u = u_ratio[160:320]
        clamp_v = v_ratio[160:320]
        expected_u = out.surface.vt_ratio * mesh.tx
        expected_v = out.surface.vt_ratio * mesh.ty
        assert float(np.max(np.abs(clamp_u - expected_u))) <= 1e-12
        assert float(np.max(np.abs(clamp_v - expected_v))) <= 1e-12
