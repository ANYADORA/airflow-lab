"""VV-NUM-01: 円柱周り一様ポテンシャル流れの厳密解 Cp(theta) = 1 - 4*sin^2(theta) 比較テスト。"""

from __future__ import annotations

import numpy as np

from app.solvers.panel import solve_source_only_cylinder


def test_vv_num_01_circular_cylinder_potential_flow_exact_comparison() -> None:
    """半径 R=0.5, 中心 (0.5, 0.0), N=160, alpha=0 deg, gamma=0 での厳密解比較。"""
    output, mesh, theta_colloc = solve_source_only_cylinder(
        num_panels=160,
        alpha_deg=0.0,
        radius=0.5,
        center_x=0.5,
        center_y=0.0,
    )

    assert output.status == "success"
    assert output.diagnostics.converged is True
    assert output.surface is not None
    assert output.coefficients is not None
    assert output.sigma is not None

    # 理論厳密解: |Vt/Vinf| = 2|sin(theta)|, Cp(theta) = 1 - 4*sin^2(theta)
    cp_exact = 1.0 - 4.0 * (np.sin(theta_colloc) ** 2)
    cp_num = output.surface.cp

    cp_abs_errors = np.abs(cp_num - cp_exact)
    max_cp_err = float(np.max(cp_abs_errors))
    rms_cp_err = float(np.sqrt(np.mean((cp_num - cp_exact) ** 2)))

    # TEST_PLAN.md VV-NUM-01 定量合格基準
    assert max_cp_err <= 0.010, f"最大 Cp 誤差超過: {max_cp_err:.6f} > 0.010"
    assert rms_cp_err <= 0.005, f"Cp RMS 誤差超過: {rms_cp_err:.6f} > 0.005"

    # 揚力・圧力抗力・吹出し総和（質量保存残差） <= 1e-12
    cl_p = output.coefficients.cl_pressure_integration
    cd_p = output.diagnostics.cd_pressure_numerical_error
    mass_flux_res = float(np.abs(np.sum(output.sigma * mesh.s)))

    assert cd_p is not None
    assert abs(cl_p) <= 1e-12
    assert abs(cd_p) <= 1e-12
    assert mass_flux_res <= 1e-12
