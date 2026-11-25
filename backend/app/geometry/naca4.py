"""NACA 4桁翼型（0012 / 2412 / 4412 / 6412 および任意4桁コード）の解析座標生成。"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from app.geometry.paneling import (
    DEFAULT_NUM_PANELS,
    build_airfoil_mesh,
    generate_cosine_xi,
    validate_num_panels,
)
from app.models.airfoil import AirfoilGeometryError, AirfoilMesh, PanelSide


def parse_naca4_code(naca_code: str) -> tuple[float, float, float]:
    """NACA 4桁コード 'MPXX' を検証し、(m, p, t) の無次元パラメータ組を返す。

    バリデーション規則（NUMERICAL_METHOD.md 4.1節）:
    - 4文字すべてが半角数字 ('0'..'9') であること
    - 最大翼厚 XX は 01..40 の範囲であること
    - M == 0（対称翼）のときは P == 0 でなければならない（'0412' 等はエラー）
    - M != 0（キャンバー翼）のときは 1 <= P <= 9 でなければならない（'2012' 等はエラー）
    """
    if not isinstance(naca_code, str) or len(naca_code) != 4 or not naca_code.isdigit():
        raise AirfoilGeometryError(
            f"NACA 4桁コード '{naca_code}' が不正です。4桁の半角数字で指定してください。",
            code="INVALID_AIRFOIL_GEOMETRY",
            details={"naca_code": naca_code},
        )

    m_digit = int(naca_code[0])
    p_digit = int(naca_code[1])
    t_digits = int(naca_code[2:4])

    if t_digits < 1 or t_digits > 40:
        raise AirfoilGeometryError(
            f"NACA コード '{naca_code}' の翼厚比 XX={t_digits:02d} は許容範囲（01〜40%）外です。",
            code="INVALID_AIRFOIL_GEOMETRY",
            details={"naca_code": naca_code, "thickness_percent": t_digits},
        )

    if m_digit == 0 and p_digit != 0:
        raise AirfoilGeometryError(
            f"対称翼（M=0）では最大キャンバー位置 P も 0 でなければなりません（入力: '{naca_code}'）。",
            code="INVALID_AIRFOIL_GEOMETRY",
            details={"naca_code": naca_code},
        )

    if m_digit != 0 and (p_digit < 1 or p_digit > 9):
        raise AirfoilGeometryError(
            f"キャンバー翼（M>0）では最大キャンバー位置 P は 1〜9 で指定してください（入力: '{naca_code}'）。",
            code="INVALID_AIRFOIL_GEOMETRY",
            details={"naca_code": naca_code},
        )

    m = m_digit / 100.0
    p = p_digit / 10.0
    t = t_digits / 100.0
    return m, p, t


def evaluate_naca4_camber(
    naca_code: str,
    xi: ArrayLike,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """指定された弦方向パラメータ xi in [0, 1] における平均キャンバー高さ y_c と勾配 dy_c/dxi を返す。"""
    m, p, _ = parse_naca4_code(naca_code)
    xi_arr = np.asarray(xi, dtype=np.float64)

    if m == 0.0:
        return np.zeros_like(xi_arr), np.zeros_like(xi_arr)

    yc = np.where(
        xi_arr < p,
        (m / (p**2)) * (2.0 * p * xi_arr - xi_arr**2),
        (m / ((1.0 - p) ** 2)) * ((1.0 - 2.0 * p) + 2.0 * p * xi_arr - xi_arr**2),
    )
    dyc_dxi = np.where(
        xi_arr < p,
        (2.0 * m / (p**2)) * (p - xi_arr),
        (2.0 * m / ((1.0 - p) ** 2)) * (p - xi_arr),
    )
    yc = np.where((xi_arr == 0.0) | (xi_arr == 1.0), 0.0, yc)
    return np.asarray(yc, dtype=np.float64), np.asarray(dyc_dxi, dtype=np.float64)


def evaluate_naca4_half_thickness(
    t: float,
    xi: ArrayLike,
    *,
    closed_te: bool = True,
) -> NDArray[np.float64]:
    """NACA 4桁翼型の半厚み分布 y_t(xi) を算出する。

    closed_te=True のときは修正第4次係数 a4 = -0.1036（y_t(1)=0.0000 閉後縁）、
    closed_te=False のときは NACA 原典係数 a4 = -0.1015（y_t(1)=+0.0105*t 開後縁）を用いる。
    """
    xi_arr = np.asarray(xi, dtype=np.float64)
    a4 = -0.1036 if closed_te else -0.1015
    yt = (
        5.0
        * t
        * (
            0.2969 * np.sqrt(np.maximum(xi_arr, 0.0))
            - 0.1260 * xi_arr
            - 0.3516 * xi_arr**2
            + 0.2843 * xi_arr**3
            + a4 * xi_arr**4
        )
    )
    yt = np.asarray(yt, dtype=np.float64)
    yt = np.where(xi_arr == 0.0, 0.0, yt)
    if closed_te:
        yt = np.where(xi_arr == 1.0, 0.0, yt)
    return yt


def generate_naca4(
    naca_code: str,
    num_panels: int = DEFAULT_NUM_PANELS,
    *,
    closed_te: bool = True,
    name: str | None = None,
) -> AirfoilMesh:
    """NACA 4桁翼型の Full-cosine 時計回りパネルメッシュを生成する。"""
    m, p, t = parse_naca4_code(naca_code)
    validate_num_panels(num_panels)

    xi = generate_cosine_xi(num_panels)  # 長さ N/2 + 1: 0.0 -> 1.0
    yt = evaluate_naca4_half_thickness(t, xi, closed_te=closed_te)

    if m == 0.0:
        # 対称翼：法線回転角 theta = 0 のため上下節点が機械精度レベルで完全鏡像になる
        x_u = xi.copy()
        y_u = yt.copy()
        x_l = xi.copy()
        y_l = -yt.copy()
    else:
        yc, dyc_dxi = evaluate_naca4_camber(naca_code, xi)
        theta = np.arctan(dyc_dxi)
        sin_t = np.sin(theta)
        cos_t = np.cos(theta)

        x_u = xi - yt * sin_t
        y_u = yc + yt * cos_t
        x_l = xi + yt * sin_t
        y_l = yc - yt * cos_t

        x_u[0], y_u[0] = 0.0, 0.0
        x_l[0], y_l[0] = 0.0, 0.0
        if closed_te:
            x_u[-1], y_u[-1] = 1.0, 0.0
            x_l[-1], y_l[-1] = 1.0, 0.0

    # 時計回り連結：下面後縁 (k=N/2) -> 前縁 (k=0) -> 上面後縁 (k=N/2)
    x_nodes = np.concatenate([x_l[:0:-1], [0.0], x_u[1:]])
    y_nodes = np.concatenate([y_l[:0:-1], [0.0], y_u[1:]])

    n_half = num_panels // 2
    side: list[PanelSide] = ["lower"] * n_half + ["upper"] * n_half
    display_name = name.strip() if (name and name.strip()) else f"NACA {naca_code}"

    return build_airfoil_mesh(
        x_nodes,
        y_nodes,
        name=display_name,
        max_thickness_ratio=t,
        max_camber_ratio=m,
        max_camber_pos=p if m > 0.0 else 0.0,
        is_symmetric=(m == 0.0),
        is_closed_te=closed_te,
        side=side,
        warnings=[],
    )
