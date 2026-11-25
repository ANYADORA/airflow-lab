"""VV-NUM-08, VV-NUM-09: 空間速度場・流線 RK4 非貫通検証および決定論的再現性・無次元相似性テスト。"""

from __future__ import annotations

import math
import time

import numpy as np
import pytest

from app.geometry import generate_naca4, point_in_polygon
from app.models.api_schemas import AnalysisRequest
from app.models.solver import SolverInput
from app.services import AnalysisService
from app.solvers import PanelMethodSolver, evaluate_induced_velocity_batch
from app.visualization import compute_streamlines, compute_velocity_field


def test_vv_num_08_velocity_field_guards_and_streamlines_non_penetration() -> None:
    """VV-NUM-08: NACA 2412 (alpha=6°, N=160, 120x80, 流線28本) の特異値ガード・翼内部非貫通・計算時間検証。"""
    t0 = time.perf_counter()

    mesh = generate_naca4("2412", num_panels=160, closed_te=True)
    solver = PanelMethodSolver()
    alpha_deg = 6.0
    alpha_rad = math.radians(alpha_deg)

    out = solver.solve(mesh, SolverInput(angle_of_attack_deg=alpha_deg))
    assert out.status == "success"
    assert out.sigma is not None and out.gamma is not None and out.surface is not None

    field = compute_velocity_field(
        mesh,
        out.sigma,
        out.gamma,
        alpha_rad,
        out.surface.vt_ratio,
        grid_nx=120,
        grid_ny=80,
        x_range=(-0.5, 1.6),
        y_range=(-0.7, 0.7),
    )

    lines = compute_streamlines(
        mesh,
        out.sigma,
        out.gamma,
        alpha_rad,
        out.surface.vt_ratio,
        x_range=(-0.5, 1.6),
        y_range=(-0.7, 0.7),
        num_streamlines=28,
        max_steps=800,
    )

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert elapsed_ms <= 500.0, f"計算時間が基準 500ms を超過: {elapsed_ms:.2f} ms"

    # 1. 全外部格子点の NaN/Inf ゼロ かつ 速度・Cp 有界性検証、内部点の完全 None 化検証
    for j in range(80):
        for i in range(120):
            if field.is_inside_airfoil[j][i]:
                assert field.u_ratio[j][i] is None
                assert field.v_ratio[j][i] is None
                assert field.speed_ratio[j][i] is None
                assert field.cp[j][i] is None
            else:
                spd = field.speed_ratio[j][i]
                cp_v = field.cp[j][i]
                assert spd is not None and math.isfinite(spd)
                assert cp_v is not None and math.isfinite(cp_v)
                assert 0.0 <= spd <= 22.38
                assert -500.0 < cp_v <= 1.000001

    # 2. 意地悪テスト点: パネル端節点から 1e-9 c の極近傍評価点でも発散しないこと
    adv_px = mesh.x + np.concatenate([mesh.nx, [mesh.nx[-1]]]) * 1e-9
    adv_py = mesh.y + np.concatenate([mesh.ny, [mesh.ny[-1]]]) * 1e-9
    u_adv, v_adv = evaluate_induced_velocity_batch(
        adv_px,
        adv_py,
        mesh,
        out.sigma,
        out.gamma,
        alpha_rad,
        out.surface.vt_ratio,
    )
    spd_adv = np.hypot(u_adv, v_adv)
    cp_adv = 1.0 - spd_adv**2
    assert np.all(np.isfinite(spd_adv))
    assert float(np.max(spd_adv)) <= 22.38
    assert float(np.min(cp_adv)) > -500.0
    assert float(np.max(cp_adv)) <= 1.000001

    # 3. 28本の全流線上の全構成点が翼内部に1点たりとも侵入していないこと
    assert len(lines) == 28
    for sl in lines:
        assert len(sl.x) >= 2
        inside_pts = np.asarray(
            point_in_polygon(sl.x, sl.y, mesh.x, mesh.y),
            dtype=np.bool_,
        )
        assert int(np.count_nonzero(inside_pts)) == 0


@pytest.mark.parametrize(
    ("code", "alpha_deg", "closed_te"),
    [
        ("0012", -5.0, True),
        ("0012", 0.0, True),
        ("4412", 10.0, True),
        ("2412", 5.0, False),
    ],
)
def test_streamlines_non_penetration_across_airfoils_and_aoas(
    code: str,
    alpha_deg: float,
    closed_te: bool,
) -> None:
    """Done Gate 5 補足: 対称翼・高キャンバー翼・開後縁翼・複数迎角での流線非貫通確認。"""
    mesh = generate_naca4(code, num_panels=160, closed_te=closed_te)
    solver = PanelMethodSolver()
    out = solver.solve(mesh, SolverInput(angle_of_attack_deg=alpha_deg))
    assert out.status == "success" and out.sigma is not None and out.gamma is not None
    assert out.surface is not None

    lines = compute_streamlines(
        mesh,
        out.sigma,
        out.gamma,
        math.radians(alpha_deg),
        out.surface.vt_ratio,
        num_streamlines=28,
    )
    assert len(lines) > 0
    for sl in lines:
        inside_pts = np.asarray(
            point_in_polygon(sl.x, sl.y, mesh.x, mesh.y),
            dtype=np.bool_,
        )
        assert int(np.count_nonzero(inside_pts)) == 0


def test_vv_num_09_deterministic_reproducibility_and_dimensionless_similarity() -> None:
    """VV-NUM-09: 連続5回実行の完全一致 (差 0.0) と空気・水間の無次元相似性 (差 <= 1e-14) 検証。"""
    svc = AnalysisService()

    # 1. 決定論的再現性: NACA 4412, alpha = 4.0 deg を連続5回実行
    req_rep = AnalysisRequest.model_validate(
        {
            "airfoil": {"source_type": "naca4", "naca_code": "4412"},
            "angle_of_attack": 4.0,
            "velocity": 15.0,
            "chord_length": 0.2,
            "fluid_properties": {
                "preset": "air_std_20c",
                "mode": "temperature_auto",
                "temperature_k": 293.15,
                "static_pressure_pa": 101325.0,
            },
            "solver": {"method": "panel_method"},
            "numerical_settings": {
                "num_panels": 160,
                "closed_te": True,
                "grid_nx": 120,
                "grid_ny": 80,
                "x_range": [-0.5, 1.6],
                "y_range": [-0.7, 0.7],
                "num_streamlines": 28,
            },
        }
    )

    runs = [svc.run_analysis(req_rep) for _ in range(5)]
    ref = runs[0]
    assert ref.coefficients is not None and ref.surface is not None
    assert ref.flow_field is not None and ref.streamlines is not None

    for k in range(1, 5):
        rk = runs[k]
        assert rk.coefficients is not None and rk.surface is not None
        assert rk.flow_field is not None and rk.streamlines is not None

        assert abs(rk.coefficients.cl - ref.coefficients.cl) == 0.0
        assert abs(rk.coefficients.cm_quarter_chord - ref.coefficients.cm_quarter_chord) == 0.0
        assert rk.surface.cp == ref.surface.cp
        assert rk.flow_field.speed_ratio == ref.flow_field.speed_ratio
        assert rk.streamlines == ref.streamlines

    # 2. 無次元相似性: NACA 2412, alpha = 5.0 deg で (A) 標準空気 V=10, c=0.1 vs (B) 水 V=2, c=0.5
    req_air = AnalysisRequest.model_validate(
        {
            "airfoil": {"source_type": "naca4", "naca_code": "2412"},
            "angle_of_attack": 5.0,
            "velocity": 10.0,
            "chord_length": 0.1,
            "fluid_properties": {
                "preset": "air_std_20c",
                "mode": "temperature_auto",
                "temperature_k": 293.15,
                "static_pressure_pa": 101325.0,
            },
            "solver": {"method": "panel_method"},
            "numerical_settings": {
                "num_panels": 160,
                "closed_te": True,
                "grid_nx": 120,
                "grid_ny": 80,
                "x_range": [-0.5, 1.6],
                "y_range": [-0.7, 0.7],
                "num_streamlines": 28,
            },
        }
    )
    req_water = AnalysisRequest.model_validate(
        {
            "airfoil": {"source_type": "naca4", "naca_code": "2412"},
            "angle_of_attack": 5.0,
            "velocity": 2.0,
            "chord_length": 0.5,
            "fluid_properties": {
                "preset": "water_20c",
                "mode": "temperature_auto",
                "temperature_k": 293.15,
                "static_pressure_pa": 101325.0,
            },
            "solver": {"method": "panel_method"},
            "numerical_settings": {
                "num_panels": 160,
                "closed_te": True,
                "grid_nx": 120,
                "grid_ny": 80,
                "x_range": [-0.5, 1.6],
                "y_range": [-0.7, 0.7],
                "num_streamlines": 28,
            },
        }
    )

    res_air = svc.run_analysis(req_air)
    res_water = svc.run_analysis(req_water)

    assert res_air.coefficients is not None and res_water.coefficients is not None
    assert res_air.surface is not None and res_water.surface is not None
    assert res_air.flow_field is not None and res_water.flow_field is not None

    # 無次元ポテンシャル流解は完全一致
    assert abs(res_air.coefficients.cl - res_water.coefficients.cl) <= 1e-14
    assert (
        abs(res_air.coefficients.cm_quarter_chord - res_water.coefficients.cm_quarter_chord)
        <= 1e-14
    )
    cp_diff = np.max(np.abs(np.asarray(res_air.surface.cp) - np.asarray(res_water.surface.cp)))
    assert float(cp_diff) <= 1e-14
    assert res_air.flow_field.speed_ratio == res_water.flow_field.speed_ratio

    # Re と Mach は物理条件の違いを反映して明確に変化する
    assert res_air.dimensionless.reynolds_number != res_water.dimensionless.reynolds_number
    assert res_air.dimensionless.mach_number != res_water.dimensionless.mach_number
