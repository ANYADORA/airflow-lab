"""VV-NUM-02, VV-NUM-03: NACA 0012 迎角0°対称性および正負迎角 ±alpha 反対称性検証テスト。"""

from __future__ import annotations

import numpy as np
import pytest

from app.geometry import generate_naca4
from app.models.solver import SolverInput
from app.solvers import PanelMethodSolver


def test_vv_num_02_naca0012_zero_aoa_symmetry_and_zero_lift() -> None:
    """VV-NUM-02: NACA 0012, alpha=0.0 deg で CL=0, Cm=0, 上下 Cp 完全対称。"""
    mesh = generate_naca4("0012", num_panels=160, closed_te=True)
    solver = PanelMethodSolver()
    res = solver.solve(mesh, SolverInput(angle_of_attack_deg=0.0))

    assert res.status == "success"
    assert res.coefficients is not None
    assert res.surface is not None

    assert abs(res.coefficients.cl_kutta_joukowski) <= 1e-12
    assert abs(res.coefficients.cl_pressure_integration) <= 1e-12
    assert abs(res.coefficients.cm_quarter_chord) <= 1e-12

    # 下面パネル i (0..79) と対応する上面パネル N-1-i (159..80) の比較
    cp = res.surface.cp
    vt = res.surface.vt_ratio
    cp_asym_err = float(np.max(np.abs(cp[:80] - cp[159:79:-1])))
    vt_antisym_err = float(np.max(np.abs(vt[:80] + vt[159:79:-1])))

    assert cp_asym_err <= 1e-12
    assert vt_antisym_err <= 1e-12


@pytest.mark.parametrize("alpha_deg", [2.0, 5.0, 8.0])
def test_vv_num_03_naca0012_plus_minus_alpha_antisymmetry(alpha_deg: float) -> None:
    """VV-NUM-03: NACA 0012 の正負迎角ペア (±2°, ±5°, ±8°) での反対称性・鏡像圧力分布。"""
    mesh = generate_naca4("0012", num_panels=160, closed_te=True)
    solver = PanelMethodSolver()

    res_pos = solver.solve(mesh, SolverInput(angle_of_attack_deg=+alpha_deg))
    res_neg = solver.solve(mesh, SolverInput(angle_of_attack_deg=-alpha_deg))

    assert res_pos.status == "success" and res_pos.coefficients is not None
    assert res_neg.status == "success" and res_neg.coefficients is not None
    assert res_pos.surface is not None and res_neg.surface is not None

    cl_pos = res_pos.coefficients.cl_kutta_joukowski
    cl_neg = res_neg.coefficients.cl_kutta_joukowski
    cm_pos = res_pos.coefficients.cm_quarter_chord
    cm_neg = res_neg.coefficients.cm_quarter_chord

    assert cl_pos > 0.0
    assert abs(cl_pos + cl_neg) <= 1e-12
    assert abs(cm_pos + cm_neg) <= 1e-12

    # +alpha のパネル i と -alpha のパネル N-1-i で表面 Cp が一致
    cp_mirror_err = float(np.max(np.abs(res_pos.surface.cp - res_neg.surface.cp[::-1])))
    assert cp_mirror_err <= 1e-12
