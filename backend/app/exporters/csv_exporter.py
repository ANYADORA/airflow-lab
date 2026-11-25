"""表面圧力・接線速度分布のメタデータヘッダ付き CSV エクスポータ（API_SPEC.md 3-2節準拠）。"""

from __future__ import annotations

from app import __version__
from app.models.api_schemas import AnalysisResponse


def export_surface_csv(res: AnalysisResponse) -> str:
    """収束済み AnalysisResponse から風洞実験比較用の表面分布 CSV 文字列（UTF-8 / LF）を生成する。

    先頭に `#` コメント形式で物理モデル（非粘性ポテンシャル流明記）、計算条件、物性・動圧、
    無次元数、主要空力係数を記録し、`cd` が None の場合は `0` を出力せず `# cd: N/A` と明記する。
    データ列は `index,side,x_c,y_c,cp,vt_over_vinf` の6列固定。
    """
    if res.status != "success" or res.surface is None or res.coefficients is None:
        raise ValueError(
            "非収束または失敗した解析結果（status != 'success'）からは表面分布 CSV を出力できません。"
        )

    airfoil_name = (
        res.airfoil_geometry.name
        if res.airfoil_geometry is not None
        else (res.inputs.airfoil.name or res.inputs.airfoil.naca_code or "Custom Airfoil")
    )
    rho = res.resolved_fluid.density_kg_m3
    v_inf = res.inputs.velocity
    q_dyn = 0.5 * rho * (v_inf**2)
    num_panels = len(res.surface.x_c)

    cd_text = (
        "N/A"
        if res.coefficients.cd is None
        else f"{res.coefficients.cd:.6f}"
    )

    lines: list[str] = [
        f"# app: AirFlow Lab {__version__}",
        f"# solver_method: {res.solver_info.method}",
        "# physical_model: 2D inviscid incompressible potential flow (Hess-Smith panel method)",
        "# note: Viscous drag and stall are NOT modeled; CD is unavailable (N/A).",
        f"# airfoil: {airfoil_name}",
        f"# angle_of_attack_deg: {res.inputs.angle_of_attack}",
        f"# velocity_mps: {v_inf}",
        f"# chord_length_m: {res.inputs.chord_length}",
        f"# density_kg_m3: {rho:.6f}",
        f"# static_pressure_pa: {res.resolved_fluid.static_pressure_pa:.1f}",
        f"# dynamic_pressure_pa: {q_dyn:.4f}",
        f"# reynolds_number: {res.dimensionless.reynolds_number:.1f}",
        f"# mach_number: {res.dimensionless.mach_number:.6f}",
        f"# num_panels: {num_panels}",
        f"# cl_kutta_joukowski: {res.coefficients.cl_kutta_joukowski:.6f}",
        f"# cl_pressure_integration: {res.coefficients.cl_pressure_integration:.6f}",
        f"# cm_quarter_chord: {res.coefficients.cm_quarter_chord:.6f}",
        f"# cd: {cd_text}",
        "index,side,x_c,y_c,cp,vt_over_vinf",
    ]

    surf = res.surface
    for idx in range(num_panels):
        lines.append(
            f"{idx},{surf.side[idx]},"
            f"{surf.x_c[idx]:.6f},{surf.y_c[idx]:.6f},"
            f"{surf.cp[idx]:.6f},{surf.vt_ratio[idx]:.6f}"
        )

    return "\n".join(lines) + "\n"
