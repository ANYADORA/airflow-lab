"""VV-NUM-06, VV-NUM-07: Kutta条件・CL 2手法クロスチェックおよびパネル数収束性検証テスト。"""

from __future__ import annotations

import numpy as np
import pytest

from app.geometry import generate_naca4
from app.models.solver import SolverInput
from app.solvers import PanelMethodSolver


@pytest.mark.parametrize("code", ["0012", "2412", "4412", "6412"])
def test_vv_num_06_kutta_condition_and_cl_crosscheck(code: str) -> None:
    """VV-NUM-06: プリセット4翼型 (N=160, alpha=5°) の後縁圧力一致と CL クロスチェック検証。"""
    mesh = generate_naca4(code, num_panels=160, closed_te=True)
    solver = PanelMethodSolver()
    res = solver.solve(mesh, SolverInput(angle_of_attack_deg=5.0))

    assert res.status == "success"
    assert res.coefficients is not None
    assert res.surface is not None

    # 1. 後縁上下パネル (i=0 と i=N-1) の Kutta 条件成立確認
    te_vt_sum = abs(float(res.surface.vt_ratio[0] + res.surface.vt_ratio[-1]))
    te_cp_diff = abs(float(res.surface.cp[0] - res.surface.cp[-1]))
    assert te_vt_sum <= 1e-10
    assert te_cp_diff <= 1e-10
    assert res.diagnostics.te_cp_diff is not None
    assert res.diagnostics.te_cp_diff <= 1e-10

    # 2. Kutta-Joukowski CL と表面圧力積分 CL_p の相対差 <= 1.5%
    cl_kj = res.coefficients.cl_kutta_joukowski
    cl_p = res.coefficients.cl_pressure_integration
    rel_diff = abs(cl_kj - cl_p) / abs(cl_kj)
    assert rel_diff <= 0.015

    # 3. 圧力抗力方向の数値誤差が十分微小 (<= 0.005) かつ cd は厳密に None
    assert res.coefficients.cd is None
    assert res.diagnostics.cd_pressure_numerical_error is not None
    assert abs(res.diagnostics.cd_pressure_numerical_error) <= 0.005


def test_vv_num_07_panel_count_convergence_and_determinism() -> None:
    """VV-NUM-07: NACA 2412 (alpha=5°) のパネル数細分化 (N=60, 120, 160, 240) 収束性検証。"""
    solver = PanelMethodSolver()
    panel_counts = [60, 120, 160, 240]

    cl_kj_by_n: dict[int, float] = {}
    cl_disc_by_n: dict[int, float] = {}

    for n_panels in panel_counts:
        mesh = generate_naca4("2412", num_panels=n_panels, closed_te=True)
        res = solver.solve(mesh, SolverInput(angle_of_attack_deg=5.0))
        assert res.status == "success"
        assert res.coefficients is not None
        assert res.diagnostics.cl_discrepancy is not None

        cl_kj_by_n[n_panels] = res.coefficients.cl_kutta_joukowski
        cl_disc_by_n[n_panels] = res.diagnostics.cl_discrepancy

    # 高解像度収束差基準: |CL(240)-CL(160)|/|CL(240)| <= 0.3%, |CL(240)-CL(120)|/|CL(240)| <= 0.5%
    cl_ref = cl_kj_by_n[240]
    rel_diff_160 = abs(cl_ref - cl_kj_by_n[160]) / abs(cl_ref)
    rel_diff_120 = abs(cl_ref - cl_kj_by_n[120]) / abs(cl_ref)
    assert rel_diff_160 <= 0.003
    assert rel_diff_120 <= 0.005

    # クロスチェック差 Delta_CL(N) の単調減少
    assert (
        cl_disc_by_n[240]
        < cl_disc_by_n[160]
        < cl_disc_by_n[120]
        < cl_disc_by_n[60]
    )

    # 同一入力に対する決定論的再現性確認（連続実行で差 0.0）
    mesh_rep = generate_naca4("4412", num_panels=160, closed_te=True)
    run1 = solver.solve(mesh_rep, SolverInput(angle_of_attack_deg=4.0))
    run2 = solver.solve(mesh_rep, SolverInput(angle_of_attack_deg=4.0))
    assert run1.coefficients is not None and run2.coefficients is not None
    assert run1.surface is not None and run2.surface is not None
    assert abs(run1.coefficients.cl - run2.coefficients.cl) == 0.0
    assert float(np.max(np.abs(run1.surface.cp - run2.surface.cp))) == 0.0
