"""UT-PHYS-01・空間速度場格子・統一警告8種・LRUストアの単体テスト。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.geometry import generate_naca4, parse_custom_airfoil
from app.models.api_schemas import (
    AnalysisRequest,
    FluidPropertiesInput,
)
from app.models.solver import SolverCoefficients, SolverDiagnostics, SolverInput
from app.services import (
    AnalysisNotFoundError,
    AnalysisService,
    FluidPropertiesError,
    InMemoryAnalysisStore,
    compute_dimensionless_numbers,
    evaluate_analysis_warnings,
    resolve_fluid_properties,
)
from app.solvers import PanelMethodSolver
from app.visualization import compute_velocity_field

R_AIR = 287.058
GAMMA_AIR = 1.4
MU0 = 1.716e-5
T0 = 273.15
S_SUTH = 110.4


class TestUtPhys01FluidProperties:
    """UT-PHYS-01: Sutherland則・プリセット・直接指定と Re, M 算出検証。"""

    def test_case1_air_std_20c(self) -> None:
        t_k = 293.15
        p_pa = 101325.0
        v_inf = 15.0
        chord = 0.20

        fluid = resolve_fluid_properties(
            FluidPropertiesInput(
                preset="air_std_20c",
                mode="temperature_auto",
                temperature_k=t_k,
                static_pressure_pa=p_pa,
            )
        )
        dim = compute_dimensionless_numbers(v_inf, chord, fluid)

        # 定義式による倍精度理論値
        rho_exact = p_pa / (R_AIR * t_k)
        mu_exact = MU0 * ((t_k / T0) ** 1.5) * ((T0 + S_SUTH) / (t_k + S_SUTH))
        a_exact = math.sqrt(GAMMA_AIR * R_AIR * t_k)
        re_exact = rho_exact * v_inf * chord / mu_exact
        m_exact = v_inf / a_exact

        assert abs(fluid.density_kg_m3 - rho_exact) / rho_exact <= 1e-12
        assert abs(fluid.dynamic_viscosity_pa_s - mu_exact) / mu_exact <= 1e-12
        assert abs(fluid.speed_of_sound_mps - a_exact) / a_exact <= 1e-12
        assert abs(dim.reynolds_number - re_exact) / re_exact <= 1e-12
        assert abs(dim.mach_number - m_exact) / m_exact <= 1e-12

        # TEST_PLAN.md 印字6桁基準値との相対差 <= 1e-5
        assert abs(fluid.density_kg_m3 - 1.204085) / 1.204085 <= 1e-5
        assert abs(fluid.dynamic_viscosity_pa_s - 1.813322e-5) / 1.813322e-5 <= 1e-5
        assert abs(fluid.speed_of_sound_mps - 343.2368) / 343.2368 <= 1e-5
        assert abs(dim.reynolds_number - 1.992064e5) / 1.992064e5 <= 1e-5
        assert abs(dim.mach_number - 0.0437016) / 0.0437016 <= 1e-5

    def test_case2_air_0c_exact_reference_viscosity(self) -> None:
        t_k = 273.15
        p_pa = 101325.0
        fluid = resolve_fluid_properties(
            FluidPropertiesInput(
                preset="air_0c",
                mode="temperature_auto",
                temperature_k=t_k,
                static_pressure_pa=p_pa,
            )
        )
        dim = compute_dimensionless_numbers(15.0, 0.20, fluid)

        rho_exact = p_pa / (R_AIR * t_k)
        a_exact = math.sqrt(GAMMA_AIR * R_AIR * t_k)
        assert abs(fluid.dynamic_viscosity_pa_s - MU0) / MU0 <= 1e-12
        assert abs(fluid.density_kg_m3 - rho_exact) / rho_exact <= 1e-12
        assert abs(fluid.speed_of_sound_mps - a_exact) / a_exact <= 1e-12
        assert abs(fluid.density_kg_m3 - 1.292252) / 1.292252 <= 1e-5
        assert abs(fluid.speed_of_sound_mps - 331.3238) / 331.3238 <= 1e-5
        assert dim.reynolds_number > 0.0

    def test_case3_water_20c_overrides_mode(self) -> None:
        # preset="water_20c" は mode に関わらず水物性定数が最優先されること
        fluid = resolve_fluid_properties(
            FluidPropertiesInput(
                preset="water_20c",
                mode="direct_mu",
                temperature_k=310.0,
                density_kg_m3=1.2,
                dynamic_viscosity_pa_s=1.8e-5,
            )
        )
        dim = compute_dimensionless_numbers(2.0, 0.10, fluid)

        re_exact = 998.2 * 2.0 * 0.10 / 1.002e-3
        m_exact = 2.0 / 1482.0
        assert abs(fluid.density_kg_m3 - 998.2) / 998.2 <= 1e-12
        assert abs(fluid.dynamic_viscosity_pa_s - 1.002e-3) / 1.002e-3 <= 1e-12
        assert abs(fluid.speed_of_sound_mps - 1482.0) / 1482.0 <= 1e-12
        assert abs(dim.reynolds_number - re_exact) / re_exact <= 1e-12
        assert abs(dim.mach_number - m_exact) / m_exact <= 1e-12
        assert abs(dim.reynolds_number - 1.992415e5) / 1.992415e5 <= 1e-5
        assert abs(dim.mach_number - 0.00134953) / 0.00134953 <= 1e-5

    def test_case4_direct_mu_and_direct_nu_and_high_density_guard(self) -> None:
        rho = 1.225
        mu = 1.7894e-5
        t_k = 288.15
        v_inf = 34.0297
        chord = 1.0

        fluid_mu = resolve_fluid_properties(
            FluidPropertiesInput(
                preset="custom",
                mode="direct_mu",
                temperature_k=t_k,
                density_kg_m3=rho,
                dynamic_viscosity_pa_s=mu,
            )
        )
        dim_mu = compute_dimensionless_numbers(v_inf, chord, fluid_mu)

        a_exact = math.sqrt(GAMMA_AIR * R_AIR * t_k)
        re_exact = rho * v_inf * chord / mu
        m_exact = v_inf / a_exact

        assert abs(dim_mu.reynolds_number - re_exact) / re_exact <= 1e-12
        assert abs(fluid_mu.speed_of_sound_mps - a_exact) / a_exact <= 1e-12
        assert abs(dim_mu.mach_number - m_exact) / m_exact <= 1e-12
        assert abs(dim_mu.reynolds_number - 2.329629e6) / 2.329629e6 <= 1e-5
        assert abs(fluid_mu.speed_of_sound_mps - 340.2970) / 340.2970 <= 1e-5
        assert abs(dim_mu.mach_number - 0.100000) / 0.100000 <= 1e-5

        # direct_nu でも同一の nu = mu / rho を与えれば完全一致すること
        fluid_nu = resolve_fluid_properties(
            FluidPropertiesInput(
                preset="custom",
                mode="direct_nu",
                temperature_k=t_k,
                density_kg_m3=rho,
                kinematic_viscosity_m2_s=mu / rho,
            )
        )
        assert abs(fluid_nu.dynamic_viscosity_pa_s - mu) / mu <= 1e-12

        # 高密度液体相当 (rho > 10) で speed_of_sound_mps 未指定は拒否されること
        high_rho_obj = FluidPropertiesInput.model_construct(
            preset="custom",
            mode="direct_mu",
            temperature_k=293.15,
            static_pressure_pa=101325.0,
            density_kg_m3=850.0,
            dynamic_viscosity_pa_s=2.0e-3,
            kinematic_viscosity_m2_s=None,
            speed_of_sound_mps=None,
        )
        with pytest.raises(FluidPropertiesError):
            resolve_fluid_properties(high_rho_obj)


class TestVelocityFieldAndMasking:
    """空間速度場格子 [grid_ny][grid_nx] 形状・翼内部 null マスク・有界性の検証。"""

    def test_grid_shape_inside_null_mask_and_exterior_bounds(self) -> None:
        mesh = generate_naca4("2412", num_panels=160, closed_te=True)
        solver = PanelMethodSolver()
        alpha_rad = math.radians(5.0)
        out = solver.solve(mesh, SolverInput(angle_of_attack_deg=5.0))
        assert out.status == "success" and out.sigma is not None and out.gamma is not None
        assert out.surface is not None

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

        assert len(field.x_grid) == 120
        assert len(field.y_grid) == 80
        assert field.x_grid == sorted(field.x_grid)
        assert field.y_grid == sorted(field.y_grid)

        for arr2d in (
            field.u_ratio,
            field.v_ratio,
            field.speed_ratio,
            field.cp,
            field.is_inside_airfoil,
        ):
            assert len(arr2d) == 80
            assert all(len(row) == 120 for row in arr2d)

        inside_count = 0
        exterior_count = 0
        for j in range(80):
            for i in range(120):
                if field.is_inside_airfoil[j][i]:
                    inside_count += 1
                    assert field.u_ratio[j][i] is None
                    assert field.v_ratio[j][i] is None
                    assert field.speed_ratio[j][i] is None
                    assert field.cp[j][i] is None
                else:
                    exterior_count += 1
                    u_v = field.u_ratio[j][i]
                    v_v = field.v_ratio[j][i]
                    spd = field.speed_ratio[j][i]
                    cp_v = field.cp[j][i]
                    assert u_v is not None and math.isfinite(u_v)
                    assert v_v is not None and math.isfinite(v_v)
                    assert spd is not None and 0.0 <= spd <= 22.38
                    assert cp_v is not None and -500.0 < cp_v <= 1.000001

        assert inside_count > 0
        assert exterior_count > 0


class TestUnifiedWarningsAndStore:
    """INT-SAFE-02 境界値マトリクス（全8種警告コード）および LRU ストアの検証。"""

    def _run_case(
        self,
        *,
        naca: str = "0012",
        aoa: float = 0.0,
        vel: float = 15.0,
        chord: float = 0.2,
    ) -> list[str]:
        svc = AnalysisService()
        req = AnalysisRequest.model_validate(
            {
                "airfoil": {"source_type": "naca4", "naca_code": naca},
                "angle_of_attack": aoa,
                "velocity": vel,
                "chord_length": chord,
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
                    "grid_nx": 60,
                    "grid_ny": 40,
                    "x_range": [-0.5, 1.6],
                    "y_range": [-0.7, 0.7],
                    "num_streamlines": 16,
                },
            }
        )
        res = svc.run_analysis(req)
        return [w.code for w in res.warnings]

    def test_warning_boundary_matrix_cases_a_to_f(self) -> None:
        # Case A: alpha = 10.0 deg -> 警告なし
        codes_a = self._run_case(naca="0012", aoa=10.0, vel=15.0, chord=0.2)
        assert "HIGH_AOA_CAUTION" not in codes_a
        assert "STALL_UNMODELED" not in codes_a

        # Case B: alpha = ±11.0 deg -> HIGH_AOA_CAUTION のみ
        for aoa_b in (11.0, -11.0):
            codes_b = self._run_case(naca="0012", aoa=aoa_b)
            assert "HIGH_AOA_CAUTION" in codes_b
            assert "STALL_UNMODELED" not in codes_b

        # Case C: alpha = +12.5, -15.0 deg -> STALL_UNMODELED のみ（重複抑止）
        for aoa_c in (12.5, -15.0):
            codes_c = self._run_case(naca="0012", aoa=aoa_c)
            assert "STALL_UNMODELED" in codes_c
            assert "HIGH_AOA_CAUTION" not in codes_c

        # Case D: V = 120 m/s (M ≈ 0.35), alpha = 2 deg -> COMPRESSIBILITY_CAUTION のみ
        codes_d = self._run_case(naca="0012", aoa=2.0, vel=120.0, chord=0.2)
        assert "COMPRESSIBILITY_CAUTION" in codes_d
        assert "TRANSONIC_OUT_OF_RANGE" not in codes_d

        # Case E: NACA 2412, alpha = 8 deg, V = 200 m/s (M ≈ 0.58, V_max > a) -> TRANSONIC_OUT_OF_RANGE（上位優先）
        codes_e = self._run_case(naca="2412", aoa=8.0, vel=200.0, chord=0.2)
        assert "TRANSONIC_OUT_OF_RANGE" in codes_e
        assert "COMPRESSIBILITY_CAUTION" not in codes_e

        # Case F: V = 2.0 m/s, c = 0.05 m (Re ≈ 6.6e3 < 5e4) -> LOW_RE_CAUTION
        codes_f = self._run_case(naca="0012", aoa=4.0, vel=2.0, chord=0.05)
        assert "LOW_RE_CAUTION" in codes_f

    def test_cl_crosscheck_and_geometry_warnings_propagation(self) -> None:
        # 1. CL_CROSSCHECK_WARN: |CL| >= 0.2 で相対差 > 5%、|CL| < 0.2 で絶対差 > 0.01
        w_large_lift = evaluate_analysis_warnings(
            angle_of_attack_deg=4.0,
            reynolds_number=2.0e5,
            mach_number=0.05,
            coefficients=SolverCoefficients(
                cl=0.50,
                cl_kutta_joukowski=0.50,
                cl_pressure_integration=0.47,
                cd=None,
                cd_unavailable_reason="N/A",
                cm_quarter_chord=-0.05,
            ),
            diagnostics=SolverDiagnostics(
                converged=True,
                condition_number=200.0,
                linear_residual_max=1e-14,
                te_cp_diff=1e-13,
                cl_discrepancy=0.03,  # 6% > 5%
                cl_discrepancy_relative=0.06,
                cd_pressure_numerical_error=0.0005,
                cp_min=-1.2,
                cp_min_xc=0.05,
                max_velocity_ratio=1.48,
                compute_time_ms=5.0,
            ),
        )
        assert any(w.code == "CL_CROSSCHECK_WARN" for w in w_large_lift)

        w_small_lift = evaluate_analysis_warnings(
            angle_of_attack_deg=0.5,
            reynolds_number=2.0e5,
            mach_number=0.05,
            coefficients=SolverCoefficients(
                cl=0.10,
                cl_kutta_joukowski=0.10,
                cl_pressure_integration=0.085,
                cd=None,
                cd_unavailable_reason="N/A",
                cm_quarter_chord=0.0,
            ),
            diagnostics=SolverDiagnostics(
                converged=True,
                condition_number=200.0,
                linear_residual_max=1e-14,
                te_cp_diff=1e-13,
                cl_discrepancy=0.015,  # > 0.01
                cl_discrepancy_relative=0.15,
                cd_pressure_numerical_error=0.0002,
                cp_min=-0.5,
                cp_min_xc=0.1,
                max_velocity_ratio=1.22,
                compute_time_ms=5.0,
            ),
        )
        assert any(w.code == "CL_CROSSCHECK_WARN" for w in w_small_lift)

        # 2. CUSTOM_AIRFOIL_NORMALIZED & OPEN_TE_CLOSED_AUTO の引き継ぎ確認
        src_open = generate_naca4("2412", num_panels=60, closed_te=False)
        scaled_x = src_open.x[::-1] * 2.0
        scaled_y = src_open.y[::-1] * 2.0
        dat_txt = "\n".join(f"{xv:.6f} {yv:.6f}" for xv, yv in zip(scaled_x, scaled_y))
        custom_mesh = parse_custom_airfoil(dat_txt, num_panels=80, closed_te=True)
        merged = evaluate_analysis_warnings(
            angle_of_attack_deg=2.0,
            reynolds_number=2.0e5,
            mach_number=0.05,
            geometry_warnings=custom_mesh.warnings,
        )
        merged_codes = {w.code for w in merged}
        assert "CUSTOM_AIRFOIL_NORMALIZED" in merged_codes
        assert "OPEN_TE_CLOSED_AUTO" in merged_codes

    def test_in_memory_analysis_store_lru_eviction(self) -> None:
        store = InMemoryAnalysisStore(max_items=2)
        svc = AnalysisService(store=store)
        base_payload = {
            "airfoil": {"source_type": "naca4", "naca_code": "0012"},
            "angle_of_attack": 2.0,
            "velocity": 15.0,
            "chord_length": 0.2,
            "fluid_properties": {"preset": "air_std_20c", "mode": "temperature_auto", "temperature_k": 293.15},
            "solver": {"method": "panel_method"},
            "numerical_settings": {
                "num_panels": 60,
                "closed_te": True,
                "grid_nx": 40,
                "grid_ny": 30,
                "x_range": [-0.5, 1.6],
                "y_range": [-0.7, 0.7],
                "num_streamlines": 10,
            },
        }
        r1 = svc.run_analysis(AnalysisRequest.model_validate(base_payload))
        r2 = svc.run_analysis(AnalysisRequest.model_validate(base_payload))
        # r1 にアクセスして最新化 -> r3 保存時に r2 が LRU 破棄されること
        _ = svc.get_analysis(r1.analysis_id)
        r3 = svc.run_analysis(AnalysisRequest.model_validate(base_payload))

        assert store.exists(r1.analysis_id) is True
        assert store.exists(r3.analysis_id) is True
        assert store.exists(r2.analysis_id) is False
        with pytest.raises(AnalysisNotFoundError):
            svc.get_analysis(r2.analysis_id)
