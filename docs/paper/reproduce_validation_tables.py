r"""AirFlow Lab Phase 1 簡易論文・整合性チェック用 再現検証スクリプト。

先行研究（Hess & Smith 1967, Glauert 1926 / Anderson 2017, Abbott & von Doenhoff 1959,
Jacobs et al. 1933, NASA TMR, Sutherland 1893）との数値・理論比較テーブルをすべて再現出力します。

実行方法:
  & "D:\home\geminiファイル\airflowlab_env\venv\Scripts\python.exe" "c:\home\AirFlowLab\docs\paper\reproduce_validation_tables.py"
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

# どのディレクトリから実行しても backend/app をインポートできるようにパスを追加
PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.geometry.naca4 import evaluate_naca4_camber, generate_naca4  # noqa: E402
from app.models.api_schemas import FluidPropertiesInput  # noqa: E402
from app.models.solver import SolverInput  # noqa: E402
from app.services.fluid_properties import resolve_fluid_properties  # noqa: E402
from app.solvers.panel import PanelMethodSolver, solve_source_only_cylinder  # noqa: E402


def solve_panel(solver: PanelMethodSolver, code: str, *, num_panels: int, aoa_deg: float, closed_te: bool = True):
    """指定 NACA 4桁翼型・パネル数・迎角で Hess-Smith パネル法を実行するヘルパー。"""
    mesh = generate_naca4(code, num_panels=num_panels, closed_te=closed_te)
    params = SolverInput(angle_of_attack_deg=aoa_deg, velocity=30.0, chord_length=1.0)
    return solver.solve(mesh, params)


def find_zero_lift_aoa(solver: PanelMethodSolver, code: str, *, num_panels: int = 160, closed_te: bool = True) -> float:
    """二分法を用いてパネル法上のゼロ揚力迎角 alpha_{L=0} [deg] を求める。"""
    mesh = generate_naca4(code, num_panels=num_panels, closed_te=closed_te)
    lo, hi = -12.0, 4.0
    for _ in range(45):
        mid = 0.5 * (lo + hi)
        res = solver.solve(mesh, SolverInput(angle_of_attack_deg=mid, velocity=30.0, chord_length=1.0))
        assert res.coefficients is not None
        if res.coefficients.cl_kutta_joukowski > 0.0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def compute_thin_airfoil_theory(code: str) -> tuple[float, float, float]:
    """Glauert の薄翼理論（フーリエ級数展開）により理論値を数値積分で求める。

    公式:
      alpha_{L=0} = -(1/pi) * integral_0^pi (dy_c/dx) * (cos(theta) - 1) d(theta)
      A_1 = (2/pi) * integral_0^pi (dy_c/dx) * cos(theta) d(theta)
      A_2 = (2/pi) * integral_0^pi (dy_c/dx) * cos(2*theta) d(theta)
      C_{m,c/4} = -(pi/4) * (A_1 - A_2)

    Returns
    -------
    alpha_l0_deg : float
        ゼロ揚力迎角 [deg]（正キャンバー翼では負）。
    cl_zero_aoa : float
        迎角 0 deg における理論揚力係数 2*pi*(0 - alpha_{L=0})。
    cm_c4 : float
        1/4弦点周り理論ピッチングモーメント係数。
    """
    theta = np.linspace(1.0e-7, math.pi - 1.0e-7, 40001)
    xi = 0.5 * (1.0 - np.cos(theta))
    _, dyc_dxi = evaluate_naca4_camber(code, xi)

    alpha_l0_rad = -(1.0 / math.pi) * float(np.trapezoid(dyc_dxi * (np.cos(theta) - 1.0), theta))
    a1 = (2.0 / math.pi) * float(np.trapezoid(dyc_dxi * np.cos(theta), theta))
    a2 = (2.0 / math.pi) * float(np.trapezoid(dyc_dxi * np.cos(2.0 * theta), theta))
    cm_c4 = -(math.pi / 4.0) * (a1 - a2)
    cl_0 = 2.0 * math.pi * (-alpha_l0_rad)
    return math.degrees(alpha_l0_rad), cl_0, cm_c4


def print_table_1_cylinder() -> None:
    """表1: 円柱ポテンシャル流れ厳密解 Cp(theta) = 1 - 4*sin^2(theta) 検証（N=40..320）。"""
    print("=" * 96)
    print("表1: 円柱ポテンシャル流れ厳密解 Cp(theta) = 1 - 4*sin^2(theta) との比較 (alpha=0 deg, gamma=0)")
    print("-" * 96)
    print(f"{'N':>5} | {'max|ΔCp|':>12} | {'RMS(ΔCp)':>12} | {'CL,p':>12} | {'CD,p':>12} | {'質量保存残差':>14}")
    print("-" * 96)
    for n_panels in (40, 80, 160, 320):
        out, mesh, theta = solve_source_only_cylinder(num_panels=n_panels, alpha_deg=0.0)
        assert out.surface is not None and out.coefficients is not None and out.sigma is not None
        cp_exact = 1.0 - 4.0 * (np.sin(theta) ** 2)
        cp_err = np.abs(out.surface.cp - cp_exact)
        max_err = float(np.max(cp_err))
        rms_err = float(np.sqrt(np.mean((out.surface.cp - cp_exact) ** 2)))
        cl_p = out.coefficients.cl_pressure_integration
        cd_p = out.diagnostics.cd_pressure_numerical_error or 0.0
        mass_res = float(np.abs(np.sum(out.sigma * mesh.s)))
        print(f"{n_panels:5d} | {max_err:12.6e} | {rms_err:12.6e} | {cl_p:+12.3e} | {cd_p:+12.3e} | {mass_res:14.3e}")
    print()


def print_table_2_naca_family(solver: PanelMethodSolver) -> None:
    """表2: NACA 0012 / 2412 / 4412 / 6412 の薄翼理論・パネル法比較（N=160, closed_te=True）。"""
    print("=" * 108)
    print("表2: NACA 4桁標準翼型群の理論・パネル法 空力特性比較 (N=160, closed_te=True)")
    print("-" * 108)
    print("2A) ゼロ揚力迎角・揚力傾斜・モーメント係数・空力中心位置:")
    print(
        f"{'翼型':>9} | {'αL=0(薄翼)':>11} | {'αL=0(パネル)':>12} | {'dCL/da[/rad]':>12} | "
        f"{'Cm(薄翼)':>10} | {'Cm(0°)':>10} | {'Cm(5°)':>10} | {'x_ac/c':>8}"
    )
    print("-" * 108)
    for code in ("0012", "2412", "4412", "6412"):
        r0 = solve_panel(solver, code, num_panels=160, aoa_deg=0.0)
        r2 = solve_panel(solver, code, num_panels=160, aoa_deg=2.0)
        rm2 = solve_panel(solver, code, num_panels=160, aoa_deg=-2.0)
        r5 = solve_panel(solver, code, num_panels=160, aoa_deg=5.0)
        assert r0.coefficients and r2.coefficients and rm2.coefficients and r5.coefficients

        al0_panel = find_zero_lift_aoa(solver, code, num_panels=160, closed_te=True)
        al0_thin, _, cm_thin = compute_thin_airfoil_theory(code)
        slope_rad = (r2.coefficients.cl_kutta_joukowski - rm2.coefficients.cl_kutta_joukowski) / math.radians(4.0)
        dcm_dcl = (r5.coefficients.cm_quarter_chord - r0.coefficients.cm_quarter_chord) / (
            r5.coefficients.cl_kutta_joukowski - r0.coefficients.cl_kutta_joukowski
        )
        x_ac = 0.25 - dcm_dcl
        print(
            f"NACA {code} | {al0_thin:+10.3f}° | {al0_panel:+11.3f}° | {slope_rad:12.4f} | "
            f"{cm_thin:+10.5f} | {r0.coefficients.cm_quarter_chord:+10.5f} | "
            f"{r5.coefficients.cm_quarter_chord:+10.5f} | {x_ac:8.4f}"
        )

    print("\n2B) 各迎角（0°, 5°, 10°, 15°）における揚力係数 CL(KJ) と負圧ピーク Cp,min:")
    print(f"{'翼型':>9} | {'α=0° CL (Cp,min)':>20} | {'α=5° CL (Cp,min)':>20} | {'α=10° CL (Cp,min)':>21} | {'α=15° CL (Cp,min)':>21}")
    print("-" * 108)
    for code in ("0012", "2412", "4412", "6412"):
        cells: list[str] = []
        for aoa in (0.0, 5.0, 10.0, 15.0):
            r = solve_panel(solver, code, num_panels=160, aoa_deg=aoa)
            assert r.coefficients is not None and r.diagnostics.cp_min is not None
            cells.append(f"{r.coefficients.cl_kutta_joukowski:6.4f} ({r.diagnostics.cp_min:+7.3f})")
        print(f"NACA {code} | {cells[0]:>20} | {cells[1]:>20} | {cells[2]:>21} | {cells[3]:>21}")
    print()


def print_table_3_thickness_effect(solver: PanelMethodSolver) -> None:
    """表3: 対称翼厚比 t/c と揚力傾斜 dCL/da の比較（N=160, alpha=+-2 deg）。"""
    print("=" * 96)
    print("表3: 有限翼厚比 t/c による揚力傾斜の増加（対称翼 NACA 00XX, N=160）")
    print("-" * 96)
    print(f"{'翼型':>9} | {'t/c':>6} | {'パネル法 dCL/dα [/rad]':>22} | {'2π(1+0.77 t/c) [/rad]':>22} | {'対近似式差':>11} | {'対2π比':>9}")
    print("-" * 96)
    for code, tc in (("0004", 0.04), ("0009", 0.09), ("0012", 0.12), ("0018", 0.18), ("0024", 0.24)):
        r2 = solve_panel(solver, code, num_panels=160, aoa_deg=2.0)
        rm2 = solve_panel(solver, code, num_panels=160, aoa_deg=-2.0)
        assert r2.coefficients and rm2.coefficients
        slope = (r2.coefficients.cl_kutta_joukowski - rm2.coefficients.cl_kutta_joukowski) / math.radians(4.0)
        approx = 2.0 * math.pi * (1.0 + 0.77 * tc)
        rel_approx = (slope - approx) / approx * 100.0
        ratio_2pi = slope / (2.0 * math.pi)
        print(f"NACA {code} | {tc:6.2f} | {slope:22.4f} | {approx:22.4f} | {rel_approx:+10.2f}% | {ratio_2pi:9.4f}")
    print()


def print_table_4_te_definition(solver: PanelMethodSolver) -> None:
    """表4: 閉後縁 (a4=-0.1036, NASA TMR) と原典開後縁 (a4=-0.1015, Jacobs 1933) の比較。"""
    print("=" * 102)
    print("表4: 後縁形状定義（閉後縁 a4=-0.1036 vs 原典開後縁 a4=-0.1015）の比較 (α=5°, N=160)")
    print("-" * 102)
    print(f"{'翼型':>9} | {'後縁仕様':>16} | {'CL,KJ':>9} | {'CL,p':>9} | {'Cm,c/4':>9} | {'|ΔCp,TE|':>10} | {'質量残差':>10} | {'κ2(M)':>8}")
    print("-" * 102)
    for code in ("0012", "2412"):
        for closed, label in ((True, "閉後縁(-0.1036)"), (False, "開後縁(-0.1015)")):
            r = solve_panel(solver, code, num_panels=160, aoa_deg=5.0, closed_te=closed)
            assert r.coefficients is not None
            print(
                f"NACA {code} | {label:>16} | {r.coefficients.cl_kutta_joukowski:9.6f} | "
                f"{r.coefficients.cl_pressure_integration:9.6f} | {r.coefficients.cm_quarter_chord:+9.6f} | "
                f"{(r.diagnostics.te_cp_diff or 0.0):10.3e} | "
                f"{(r.diagnostics.mass_flux_residual or 0.0):10.3e} | "
                f"{(r.diagnostics.condition_number or 0.0):8.1f}"
            )
    print()


def print_table_5_convergence_and_dalembert(solver: PanelMethodSolver) -> None:
    """表5: パネル数収束性とダランベールのパラドックス確認（NACA 2412, α=5°）。"""
    print("=" * 128)
    print("表5: パネル数収束性・一次精度 O(1/N) スケーリング・ダランベール圧力抗力誤差 (NACA 2412, α=5°)")
    print("-" * 128)
    print(
        f"{'N':>4} | {'CL,KJ':>9} | {'CL,p':>9} | {'|ΔCL|/CL':>10} | {'N×|ΔCL|/CL':>11} | "
        f"{'CD,p(数値誤差)':>14} | {'Cm,c/4':>9} | {'質量残差':>10} | {'N×質量残差':>11} | {'κ2(M)':>7} | {'ms':>6}"
    )
    print("-" * 128)
    for n_panels in (40, 60, 80, 120, 160, 240, 300):
        r = solve_panel(solver, "2412", num_panels=n_panels, aoa_deg=5.0)
        assert r.coefficients is not None
        mass = r.diagnostics.mass_flux_residual or 0.0
        rel = r.diagnostics.cl_discrepancy_relative or 0.0
        print(
            f"{n_panels:4d} | {r.coefficients.cl_kutta_joukowski:9.6f} | {r.coefficients.cl_pressure_integration:9.6f} | "
            f"{rel * 100.0:9.3f}% | {n_panels * rel:11.4f} | "
            f"{(r.diagnostics.cd_pressure_numerical_error or 0.0):+14.3e} | "
            f"{r.coefficients.cm_quarter_chord:+9.6f} | {mass:10.3e} | {n_panels * mass:11.5f} | "
            f"{(r.diagnostics.condition_number or 0.0):7.1f} | {r.diagnostics.compute_time_ms:6.2f}"
        )
    print()


def print_table_6_fluid_properties() -> None:
    """表6: ISA 標準大気（15℃）・標準空気（0℃/20℃）・水（20℃）の物性値検証。"""
    print("=" * 96)
    print("表6: Sutherland の粘性式・理想気体状態方程式・音速のベンチマーク比較")
    print("-" * 96)
    cases = [
        ("ISA 標準大気 (15℃, 1 atm)", FluidPropertiesInput(preset="custom", mode="temperature_auto", temperature_k=288.15, static_pressure_pa=101325.0)),
        ("AirFlow Lab 標準空気 (20℃)", FluidPropertiesInput(preset="air_std_20c")),
        ("AirFlow Lab 標準空気 (0℃)", FluidPropertiesInput(preset="air_0c", temperature_k=273.15)),
        ("AirFlow Lab 標準水 (20℃)", FluidPropertiesInput(preset="water_20c")),
    ]
    print(f"{'条件':>28} | {'ρ [kg/m³]':>11} | {'μ [Pa·s]':>12} | {'ν [m²/s]':>12} | {'音速 a [m/s]':>12}")
    print("-" * 96)
    for label, inp in cases:
        res = resolve_fluid_properties(inp)
        print(
            f"{label:>28} | {res.density_kg_m3:11.5f} | {res.dynamic_viscosity_pa_s:12.5e} | "
            f"{res.kinematic_viscosity_m2_s:12.5e} | {res.speed_of_sound_mps:12.3f}"
        )
    print()


def export_plot_data(solver: PanelMethodSolver) -> None:
    """表の数値から LaTeX (pgfplots) グラフ描画用の .dat ファイル群を生成する。"""
    data_dir = Path(__file__).resolve().parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # 1. NACA 0012 / 2412 / 4412 / 6412 の揚力曲線 CL(alpha)
    alphas = (-4.0, -2.0, 0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0)
    cl_lines = ["alpha cl0012 cl2412 cl4412 cl6412 cl_thin"]
    for aoa in alphas:
        row_vals = []
        for code in ("0012", "2412", "4412", "6412"):
            r = solve_panel(solver, code, num_panels=160, aoa_deg=aoa, closed_te=True)
            assert r.coefficients is not None
            row_vals.append(f"{r.coefficients.cl_kutta_joukowski:.6f}")
        cl_thin = 2.0 * math.pi * math.radians(aoa)
        cl_lines.append(f"{aoa:.1f} {' '.join(row_vals)} {cl_thin:.6f}")
    (data_dir / "cl_alpha.dat").write_text("\n".join(cl_lines) + "\n", encoding="utf-8")

    # 2. NACA 2412 (alpha=5 deg, N=160) の上下面 Cp 分布
    r2412 = solve_panel(solver, "2412", num_panels=160, aoa_deg=5.0, closed_te=True)
    assert r2412.surface is not None
    for target_side, fname in (("upper", "cp_naca2412_a5_upper.dat"), ("lower", "cp_naca2412_a5_lower.dat")):
        pts = [
            (float(xc), float(cp))
            for xc, side, cp in zip(r2412.surface.x_c, r2412.surface.side, r2412.surface.cp)
            if side == target_side
        ]
        pts.sort(key=lambda item: item[0])
        cp_lines = ["xc cp neg_cp"] + [f"{xc:.6f} {cp:.6f} {-cp:.6f}" for xc, cp in pts]
        (data_dir / fname).write_text("\n".join(cp_lines) + "\n", encoding="utf-8")

    # 3. パネル数収束性データ (NACA 2412, alpha=5 deg)
    conv_lines = ["N rel_cl mass_res abs_cdp ref_inv_n"]
    for n_panels in (40, 60, 80, 120, 160, 240, 300):
        r = solve_panel(solver, "2412", num_panels=n_panels, aoa_deg=5.0, closed_te=True)
        rel_cl = r.diagnostics.cl_discrepancy_relative or 0.0
        mass_res = r.diagnostics.mass_flux_residual or 0.0
        abs_cdp = abs(r.diagnostics.cd_pressure_numerical_error or 0.0)
        ref_inv_n = 1.25 / float(n_panels)
        conv_lines.append(
            f"{n_panels} {rel_cl:.8e} {mass_res:.8e} {abs_cdp:.8e} {ref_inv_n:.8e}"
        )
    (data_dir / "convergence_naca2412.dat").write_text("\n".join(conv_lines) + "\n", encoding="utf-8")
    print(f"グラフ用データを出力しました: {data_dir}")


def main() -> None:
    """全6テーブルの再現検証とグラフ用データ出力を順番に実行する。"""
    solver = PanelMethodSolver()
    print_table_1_cylinder()
    print_table_2_naca_family(solver)
    print_table_3_thickness_effect(solver)
    print_table_4_te_definition(solver)
    print_table_5_convergence_and_dalembert(solver)
    print_table_6_fluid_properties()
    export_plot_data(solver)


if __name__ == "__main__":
    main()
