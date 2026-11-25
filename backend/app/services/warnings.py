"""物理モデルの適用限界・数値クロスチェック・幾何前処理の統一警告評価モジュール（全8種）。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from app.models.airfoil import GeometryWarning
from app.models.api_schemas import WarningCode, WarningItem
from app.models.solver import SolverCoefficients, SolverDiagnostics

# 警告発火閾値（NUMERICAL_METHOD.md 8.3節 / API_SPEC.md 1-5節）
AOA_CAUTION_DEG = 10.0
AOA_STALL_CRITICAL_DEG = 12.0
MACH_COMPRESSIBLE_CAUTION = 0.3
MACH_TRANSONIC_CRITICAL = 0.7
LOW_RE_THRESHOLD = 5.0e4
CL_SMALL_LIFT_BOUNDARY = 0.2
CL_REL_DIFF_WARN = 0.05
CL_ABS_DIFF_WARN = 0.01


def convert_geometry_warnings(
    geometry_warnings: Sequence[GeometryWarning] | None,
) -> list[WarningItem]:
    """幾何生成・DAT前処理で発生した GeometryWarning を API 契約 WarningItem へ変換する。"""
    if not geometry_warnings:
        return []
    return [
        WarningItem(
            code=cast(WarningCode, gw.code),
            severity=gw.severity,
            title=gw.title,
            message=gw.message,
        )
        for gw in geometry_warnings
    ]


def evaluate_analysis_warnings(
    *,
    angle_of_attack_deg: float,
    reynolds_number: float,
    mach_number: float,
    coefficients: SolverCoefficients | None = None,
    diagnostics: SolverDiagnostics | None = None,
    geometry_warnings: Sequence[GeometryWarning] | None = None,
) -> list[WarningItem]:
    """解析条件・無次元数・ソルバー診断値から統一警告リスト（最大8種定義）を評価する。

    迎角警告（HIGH_AOA_CAUTION vs STALL_UNMODELED）および圧縮性警告
    （COMPRESSIBILITY_CAUTION vs TRANSONIC_OUT_OF_RANGE）は、上位の critical が
    発火した際には同系統の下位 warning を重複発火させない。
    """
    items: list[WarningItem] = convert_geometry_warnings(geometry_warnings)

    # 1. 迎角（剥離・失速未モデル化）警告判定
    abs_aoa = abs(float(angle_of_attack_deg))
    if abs_aoa > AOA_STALL_CRITICAL_DEG:
        items.append(
            WarningItem(
                code="STALL_UNMODELED",
                severity="critical",
                title="失速（ストール）未考慮の強い警告",
                message=(
                    f"設定迎角（{angle_of_attack_deg:+.1f}°）は大迎角域にあり、実際の翼では境界層が大きく"
                    "剥離して失速（揚力の急減・抗力の急増）が生じる可能性が高い領域です。"
                    "非粘性パネル法は流れの剥離・失速を計算できないため、表示される CL は現実の流れより過大評価されています。"
                ),
            )
        )
    elif abs_aoa > AOA_CAUTION_DEG:
        items.append(
            WarningItem(
                code="HIGH_AOA_CAUTION",
                severity="warning",
                title="高迎角・剥離開始域の注意",
                message=(
                    f"設定迎角（{angle_of_attack_deg:+.1f}°）では、実際の翼上面後縁側から境界層の剥離が始まり"
                    "揚力の伸びが鈍化する傾向があります。パネル法は非粘性モデルのため剥離を考慮していません。"
                ),
            )
        )

    # 2. マッハ数（圧縮性・遷音速衝撃波）警告判定
    max_vel_ratio = (
        float(diagnostics.max_velocity_ratio)
        if (diagnostics is not None and diagnostics.max_velocity_ratio is not None)
        else 1.0
    )
    local_max_mach = float(mach_number) * max_vel_ratio

    if mach_number >= MACH_TRANSONIC_CRITICAL or local_max_mach >= 1.0:
        items.append(
            WarningItem(
                code="TRANSONIC_OUT_OF_RANGE",
                severity="critical",
                title="遷音速・衝撃波領域（非圧縮モデルの適用範囲外）",
                message=(
                    f"一様流マッハ数 M = {mach_number:.3f}（翼面局所最大マッハ数推定 {local_max_mach:.3f}）が"
                    "音速域に達しています。衝撃波や造波抗力が発生するため、非圧縮ポテンシャル流パネル法の適用範囲外です。"
                ),
            )
        )
    elif mach_number >= MACH_COMPRESSIBLE_CAUTION:
        items.append(
            WarningItem(
                code="COMPRESSIBILITY_CAUTION",
                severity="warning",
                title="空気の圧縮性影響に関する注意",
                message=(
                    f"マッハ数 M = {mach_number:.3f} が 0.3 以上のため、空気の密度変化（圧縮性）が無視できなくなります。"
                    "非圧縮近似による負圧ピークや揚力係数に数%以上の誤差が生じる可能性があります。"
                ),
            )
        )

    # 3. 低レイノルズ数案内
    if reynolds_number < LOW_RE_THRESHOLD:
        items.append(
            WarningItem(
                code="LOW_RE_CAUTION",
                severity="info",
                title="低レイノルズ数域（粘性影響大）の案内",
                message=(
                    f"レイノルズ数 Re = {reynolds_number:.2e} は 5.0×10^4 未満の低 Re 領域です。"
                    "小型模型や昆虫スケールでは粘性境界層が厚く層流剥離泡や早期剥離が起きやすいため、"
                    "理想流体（非粘性）の計算結果と実測値の差が大きくなります。"
                ),
            )
        )

    # 4. Kutta-Joukowski CL と表面圧力積分 CL_p のクロスチェック警告
    if (
        coefficients is not None
        and diagnostics is not None
        and diagnostics.converged
        and diagnostics.cl_discrepancy is not None
    ):
        abs_cl = abs(float(coefficients.cl_kutta_joukowski))
        disc = float(diagnostics.cl_discrepancy)
        is_warn = (
            (abs_cl >= CL_SMALL_LIFT_BOUNDARY and (disc / abs_cl) > CL_REL_DIFF_WARN)
            or (abs_cl < CL_SMALL_LIFT_BOUNDARY and disc > CL_ABS_DIFF_WARN)
        )
        if is_warn:
            items.append(
                WarningItem(
                    code="CL_CROSSCHECK_WARN",
                    severity="warning",
                    title="揚力係数クロスチェック差の拡大",
                    message=(
                        f"循環から算出した CL ({coefficients.cl_kutta_joukowski:.4f}) と"
                        f"表面圧力積分から算出した CL ({coefficients.cl_pressure_integration:.4f}) の差"
                        f"（ΔCL = {disc:.4f}）が大きくなっています。本格モードでパネル数（num_panels）を増やすことを推奨します。"
                    ),
                )
            )

    return items
