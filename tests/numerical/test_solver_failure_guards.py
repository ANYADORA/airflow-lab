"""ERR-SOL-01: 数値破綻・条件数悪化・NaN注入・退化座標に対する Gate 2 遮断（status='failed'）検証。"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
import pytest
import scipy.linalg

from app.geometry import build_airfoil_mesh, generate_naca4
from app.models.solver import RawSolverOutput, SolverInput
from app.solvers import PanelMethodSolver


def _assert_clean_failed_output(res: RawSolverOutput, expected_code: str | None = None) -> None:
    """非収束・破綻時に不正確な係数を一切残さず failed 構造を返すことを検証する。"""
    assert res.status == "failed"
    assert res.diagnostics.converged is False
    assert res.coefficients is None
    assert res.surface is None
    assert res.sigma is None
    assert res.gamma is None
    assert res.failure is not None
    if expected_code is not None:
        assert res.failure.code == expected_code


def test_err_sol_01_ill_conditioned_matrix_detected(monkeypatch: pytest.MonkeyPatch) -> None:
    """条件数が 1e10 以上の悪条件行列となった場合に status='failed' として遮断されること。"""
    mesh = generate_naca4("0012", num_panels=80, closed_te=True)
    solver = PanelMethodSolver()

    monkeypatch.setattr(np.linalg, "cond", lambda _m: 4.8e12)
    res = solver.solve(mesh, SolverInput(angle_of_attack_deg=4.0))
    _assert_clean_failed_output(res, expected_code="ILL_CONDITIONED_MATRIX")
    assert res.diagnostics.condition_number == pytest.approx(4.8e12)


def test_err_sol_01_overlapping_panels_real_ill_conditioning() -> None:
    """実計算で上下表面がほぼ完全に重なった擬似ゼロ厚メッシュが Gate 2 で確実に遮断されること。"""
    base = generate_naca4("0012", num_panels=60, closed_te=True)
    # 上下面が完全に重なる y=0 平板メッシュ（同一コロケーション点ペアが生じるため特異/悪条件となる）
    flat_y = np.zeros_like(base.x)
    flat_mesh = build_airfoil_mesh(
        base.x,
        flat_y,
        name="Zero Thickness Overlapping Mesh",
        validate_non_degenerate=False,
    )

    solver = PanelMethodSolver()
    res = solver.solve(flat_mesh, SolverInput(angle_of_attack_deg=5.0))
    _assert_clean_failed_output(res)
    assert res.failure is not None
    assert res.failure.code in {
        "NON_FINITE_MATRIX",
        "ILL_CONDITIONED_MATRIX",
        "SINGULAR_MATRIX",
    }


def test_err_sol_01_nan_and_inf_solution_injection_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """線形ソルバー解に NaN または Inf が混入した場合に NON_FINITE_SOLUTION で遮断されること。"""
    mesh = generate_naca4("2412", num_panels=80, closed_te=True)
    solver = PanelMethodSolver()

    def _mock_nan_solve(
        matrix: NDArray[np.float64],
        rhs: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        bad = np.zeros(len(rhs), dtype=np.float64)
        bad[0] = np.nan
        return bad

    monkeypatch.setattr(
        "app.solvers.panel.hess_smith._solve_linear_system",
        _mock_nan_solve,
    )
    res_nan = solver.solve(mesh, SolverInput(angle_of_attack_deg=3.0))
    _assert_clean_failed_output(res_nan, expected_code="NON_FINITE_SOLUTION")

    def _mock_inf_solve(
        matrix: NDArray[np.float64],
        rhs: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        bad = np.zeros(len(rhs), dtype=np.float64)
        bad[-1] = np.inf
        return bad

    monkeypatch.setattr(
        "app.solvers.panel.hess_smith._solve_linear_system",
        _mock_inf_solve,
    )
    res_inf = solver.solve(mesh, SolverInput(angle_of_attack_deg=3.0))
    _assert_clean_failed_output(res_inf, expected_code="NON_FINITE_SOLUTION")


def test_err_sol_01_singular_linalg_error_and_large_residual_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LinAlgError（特異行列例外）および残差超過解の両方がクラッシュせず failed を返すこと。"""
    mesh = generate_naca4("2412", num_panels=80, closed_te=True)
    solver = PanelMethodSolver()

    def _mock_singular(
        matrix: NDArray[np.float64],
        rhs: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        raise scipy.linalg.LinAlgError("Matrix is singular.")

    monkeypatch.setattr(
        "app.solvers.panel.hess_smith._solve_linear_system",
        _mock_singular,
    )
    res_sing = solver.solve(mesh, SolverInput(angle_of_attack_deg=4.0))
    _assert_clean_failed_output(res_sing, expected_code="SINGULAR_MATRIX")

    # ゼロベクトルを返させて線形残差 ||Mq - b||_inf >= 1e-8 違反を発火させる
    monkeypatch.setattr(
        "app.solvers.panel.hess_smith._solve_linear_system",
        lambda _m, rhs: np.zeros_like(rhs),
    )
    res_res = solver.solve(mesh, SolverInput(angle_of_attack_deg=4.0))
    _assert_clean_failed_output(res_res, expected_code="LINEAR_RESIDUAL_EXCEEDED")


def test_err_sol_01_degenerate_duplicate_and_nan_coordinates_blocked() -> None:
    """重複節点（ゼロ長パネル）や NaN 座標を含む退化メッシュに対して DEGENERATE_GEOMETRY を返すこと。"""
    base = generate_naca4("0012", num_panels=60, closed_te=True)
    solver = PanelMethodSolver()

    # 1. 隣接節点が完全に同一（ゼロ長パネル混入）
    dup_x = base.x.copy()
    dup_y = base.y.copy()
    dup_x[15] = dup_x[14]
    dup_y[15] = dup_y[14]
    dup_mesh = build_airfoil_mesh(dup_x, dup_y, validate_non_degenerate=False)
    res_dup = solver.solve(dup_mesh, SolverInput(angle_of_attack_deg=2.0))
    _assert_clean_failed_output(res_dup, expected_code="DEGENERATE_GEOMETRY")

    # 2. 節点座標に NaN が混入
    nan_x = base.x.copy()
    nan_x[20] = np.nan
    nan_mesh = build_airfoil_mesh(nan_x, base.y, validate_non_degenerate=False)
    res_nan_coord = solver.solve(nan_mesh, SolverInput(angle_of_attack_deg=2.0))
    _assert_clean_failed_output(res_nan_coord, expected_code="DEGENERATE_GEOMETRY")
