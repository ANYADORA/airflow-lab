"""VV-NUM-04, VV-NUM-05: 薄翼理論（揚力傾斜 2*pi・翼厚補正・キャンバー翼理論解）との定量比較テスト。"""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import brentq

from app.geometry import generate_naca4
from app.models.solver import SolverInput
from app.solvers import PanelMethodSolver

TWO_PI = 2.0 * math.pi


def test_vv_num_04_lift_curve_slope_thin_and_thickness_corrected_theory() -> None:
    """VV-NUM-04: NACA 0004 (2*pi 比較) および NACA 0012 (翼厚補正理論・c/4空力中心) 検証。"""
    solver = PanelMethodSolver()
    alphas_deg = np.array([-4.0, -2.0, 0.0, 2.0, 4.0], dtype=np.float64)
    alphas_rad = np.radians(alphas_deg)

    # 1. 薄対称翼 NACA 0004 (t/c = 0.04, num_panels = 200)
    mesh_0004 = generate_naca4("0004", num_panels=200, closed_te=True)
    cls_0004 = []
    for a_deg in alphas_deg:
        res = solver.solve(mesh_0004, SolverInput(angle_of_attack_deg=float(a_deg)))
        assert res.status == "success" and res.coefficients is not None
        cls_0004.append(res.coefficients.cl_kutta_joukowski)

    a0_0004 = float(np.polyfit(alphas_rad, np.asarray(cls_0004), 1)[0])
    a0_thick_0004 = TWO_PI * (1.0 + 0.77 * 0.04)  # Abbott & Von Doenhoff 翼厚一次補正

    assert abs(a0_0004 - TWO_PI) / TWO_PI <= 0.045
    assert abs(a0_0004 - a0_thick_0004) / a0_thick_0004 <= 0.015

    # 2. 標準対称翼 NACA 0012 (t/c = 0.12, num_panels = 160)
    mesh_0012 = generate_naca4("0012", num_panels=160, closed_te=True)
    cls_0012 = []
    for a_deg in alphas_deg:
        res = solver.solve(mesh_0012, SolverInput(angle_of_attack_deg=float(a_deg)))
        assert res.status == "success" and res.coefficients is not None
        cls_0012.append(res.coefficients.cl_kutta_joukowski)
        # 小迎角 |alpha| <= 4 deg で |Cm_{c/4}| <= 0.010（空力中心が 25% 弦位置近傍）
        assert abs(res.coefficients.cm_quarter_chord) <= 0.010

    a0_0012 = float(np.polyfit(alphas_rad, np.asarray(cls_0012), 1)[0])
    a0_thick_0012 = TWO_PI * (1.0 + 0.77 * 0.12)
    assert abs(a0_0012 - a0_thick_0012) / a0_thick_0012 <= 0.020


def test_vv_num_05_cambered_airfoils_zero_lift_aoa_and_quarter_chord_moment() -> None:
    """VV-NUM-05: NACA 2412 / 4412 / 6412 のゼロ揚力迎角・正揚力単調性・Cm_{c/4}(0°) 検証。"""
    solver = PanelMethodSolver()
    cases = [
        ("2412", 0.02),
        ("4412", 0.04),
        ("6412", 0.06),
    ]

    cl_at_zero_aoa: dict[str, float] = {}

    for code, m_ratio in cases:
        mesh = generate_naca4(code, num_panels=160, closed_te=True)

        # alpha = 0.0 deg 解析
        res_zero = solver.solve(mesh, SolverInput(angle_of_attack_deg=0.0))
        assert res_zero.status == "success" and res_zero.coefficients is not None

        cl_0 = res_zero.coefficients.cl_kutta_joukowski
        cm_0 = res_zero.coefficients.cm_quarter_chord
        cl_at_zero_aoa[code] = cl_0

        # Glauert 薄翼理論値 (p = 0.4): alpha_{L=0} = -103.86 * m [deg], Cm_{c/4} = -2.656 * m
        alpha_l0_thin_deg = -103.86 * m_ratio
        cm_c4_thin = -2.656 * m_ratio

        # ピッチングモーメント（頭下げ負符号 かつ 相対誤差 <= 8%）
        assert cm_0 < 0.0
        assert abs(cm_0 - cm_c4_thin) / abs(cm_c4_thin) <= 0.08

        # 迎角スイープ二分法 (Brent法) でパネル法ゼロ揚力迎角 alpha_{L=0} を探索
        def _cl_func(aoa_deg: float) -> float:
            out = solver.solve(mesh, SolverInput(angle_of_attack_deg=aoa_deg))
            assert out.status == "success" and out.coefficients is not None
            return out.coefficients.cl_kutta_joukowski

        alpha_l0_panel_deg = float(brentq(_cl_func, -12.0, 1.0, xtol=1e-9))
        assert abs(alpha_l0_panel_deg - alpha_l0_thin_deg) <= 0.25

    # キャンバー増加に対する alpha=0° 揚力の単調増加性
    assert (
        cl_at_zero_aoa["6412"]
        > cl_at_zero_aoa["4412"]
        > cl_at_zero_aoa["2412"]
        > 0.20
    )
