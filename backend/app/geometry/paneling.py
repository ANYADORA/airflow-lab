"""時計回りパネル離散化メッシュ構築および翼内部判定・距離計算ユーティリティ。"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

from app.models.airfoil import (
    AirfoilGeometryError,
    AirfoilMesh,
    GeometryWarning,
    PanelSide,
)

MIN_NUM_PANELS = 40
MAX_NUM_PANELS = 300
DEFAULT_NUM_PANELS = 160


def validate_num_panels(num_panels: int) -> int:
    """パネル数 N が許容範囲（40..300 の偶数）であることを検証する。"""
    if isinstance(num_panels, bool) or not isinstance(num_panels, int):
        raise AirfoilGeometryError(
            "num_panels は整数で指定してください。",
            code="INVALID_NUM_PANELS",
            details={"num_panels": num_panels},
        )
    if (
        num_panels < MIN_NUM_PANELS
        or num_panels > MAX_NUM_PANELS
        or num_panels % 2 != 0
    ):
        raise AirfoilGeometryError(
            f"num_panels は {MIN_NUM_PANELS} 以上 {MAX_NUM_PANELS} 以下の偶数で指定してください。",
            code="INVALID_NUM_PANELS",
            details={"num_panels": num_panels},
        )
    return num_panels


def generate_cosine_xi(num_panels: int = DEFAULT_NUM_PANELS) -> NDArray[np.float64]:
    """片面 N/2 パネル用の Full-cosine 弦方向パラメータ列 xi in [0, 1] を生成する。

    xi_0 = 0.0（前縁）から xi_{N/2} = 1.0（後縁）までの長さ N/2 + 1 の配列を返す。
    """
    validate_num_panels(num_panels)
    n_half = num_panels // 2
    k = np.arange(n_half + 1, dtype=np.float64)
    beta = (np.pi * k) / float(n_half)
    xi = 0.5 * (1.0 - np.cos(beta))
    xi[0] = 0.0
    xi[-1] = 1.0
    return xi


def build_airfoil_mesh(
    x: ArrayLike,
    y: ArrayLike,
    *,
    name: str = "Airfoil",
    max_thickness_ratio: float = 0.0,
    max_camber_ratio: float = 0.0,
    max_camber_pos: float = 0.0,
    is_symmetric: bool = False,
    is_closed_te: bool = True,
    side: list[PanelSide] | None = None,
    warnings: list[GeometryWarning] | None = None,
    validate_non_degenerate: bool = True,
) -> AirfoilMesh:
    """時計回り節点座標列 (x, y) から AirfoilMesh を構築する。

    Parameters
    ----------
    x, y : ArrayLike
        時計回り順（下面後縁 -> 前縁 -> 上面後縁）の無次元節点列（長さ N+1）。
    validate_non_degenerate : bool
        True の場合、ゼロ長パネルや符号付き面積の向き（時計回り＝負面積）を検査する。
        ソルバーの異常メッシュ耐性テスト等で意図的に退化メッシュを作る場合は False を指定可能。
    """
    x_arr = np.asarray(x, dtype=np.float64).copy()
    y_arr = np.asarray(y, dtype=np.float64).copy()

    if x_arr.ndim != 1 or y_arr.ndim != 1 or len(x_arr) != len(y_arr):
        raise AirfoilGeometryError("節点座標 x, y は同じ長さの1次元配列である必要があります。")

    n_nodes = len(x_arr)
    if n_nodes < 3:
        raise AirfoilGeometryError("パネルメッシュの構築には最低3個以上の節点が必要です。")

    # IEEE 754 の -0.0 による atan2(±0.0, -dx) の ±pi 符号揺れを防ぐため 0.0 を正規化
    x_arr[x_arr == 0.0] = 0.0
    y_arr[y_arr == 0.0] = 0.0

    n_panels = n_nodes - 1
    dx = x_arr[1:] - x_arr[:-1]
    dy = y_arr[1:] - y_arr[:-1]
    dx[dx == 0.0] = 0.0
    dy[dy == 0.0] = 0.0
    s = np.hypot(dx, dy)

    if validate_non_degenerate:
        if not (np.all(np.isfinite(x_arr)) and np.all(np.isfinite(y_arr))):
            raise AirfoilGeometryError("節点座標に NaN または Inf が含まれています。")
        if np.any(s <= 1e-13):
            raise AirfoilGeometryError("長さゼロ（重複節点）の退化パネルが含まれています。")

    phi = np.arctan2(dy, dx)
    tx = np.cos(phi)
    ty = np.sin(phi)
    # 翼外部へ向かう単位外向き法線ベクトル（det[t, n] = cos^2(phi) + sin^2(phi) = +1）
    nx = -ty
    ny = tx

    x_c = 0.5 * (x_arr[:-1] + x_arr[1:])
    y_c = 0.5 * (y_arr[:-1] + y_arr[1:])
    x_c[x_c == 0.0] = 0.0
    y_c[y_c == 0.0] = 0.0

    if side is None:
        n_half = n_panels // 2
        panel_side: list[PanelSide] = [
            "lower" if idx < n_half else "upper" for idx in range(n_panels)
        ]
    else:
        if len(side) != n_panels:
            raise AirfoilGeometryError("side リストの長さがパネル数と一致しません。")
        panel_side = list(side)

    te_gap = float(np.hypot(x_arr[-1] - x_arr[0], y_arr[-1] - y_arr[0]))
    if is_closed_te and te_gap < 1e-14:
        te_gap = 0.0

    mesh = AirfoilMesh(
        x=x_arr,
        y=y_arr,
        x_c=x_c,
        y_c=y_c,
        dx=dx,
        dy=dy,
        s=s,
        phi=phi,
        tx=tx,
        ty=ty,
        nx=nx,
        ny=ny,
        side=panel_side,
        te_gap=te_gap,
        max_thickness_ratio=float(max_thickness_ratio),
        max_camber_ratio=float(max_camber_ratio),
        max_camber_pos=float(max_camber_pos),
        is_symmetric=bool(is_symmetric),
        is_closed_te=bool(is_closed_te),
        warnings=list(warnings) if warnings is not None else [],
        name=name,
    )

    if validate_non_degenerate and mesh.signed_area >= -1e-10:
        raise AirfoilGeometryError(
            "パネル節点列が時計回り閉曲線をなしていないか、面積が退化しています。"
        )

    return mesh


def has_non_adjacent_self_intersection(
    poly_x: ArrayLike,
    poly_y: ArrayLike,
    *,
    treat_endpoints_connected: bool = True,
) -> bool:
    """折れ線または閉ポリゴンの非隣接線分同士が自己交差しているか判定する。"""
    x = np.asarray(poly_x, dtype=np.float64)
    y = np.asarray(poly_y, dtype=np.float64)
    n_seg = len(x) - 1
    if n_seg < 4:
        return False

    x1 = x[:-1]
    y1 = y[:-1]
    x2 = x[1:]
    y2 = y[1:]

    min_x = np.minimum(x1, x2)
    max_x = np.maximum(x1, x2)
    min_y = np.minimum(y1, y2)
    max_y = np.maximum(y1, y2)

    eps = 1e-12
    for i in range(n_seg - 2):
        j_end = n_seg - 1 if (i == 0 and treat_endpoints_connected) else n_seg
        if i + 2 >= j_end:
            continue

        js = slice(i + 2, j_end)
        # バウンディングボックスによる高速フィルタリング
        bbox_overlap = (
            (max_x[i] >= min_x[js] - eps)
            & (max_x[js] >= min_x[i] - eps)
            & (max_y[i] >= min_y[js] - eps)
            & (max_y[js] >= min_y[i] - eps)
        )
        if not np.any(bbox_overlap):
            continue

        cand_indices = np.nonzero(bbox_overlap)[0] + (i + 2)
        ax, ay = x1[i], y1[i]
        bx, by = x2[i], y2[i]
        abx, aby = bx - ax, by - ay

        for j in cand_indices:
            cx, cy = x1[j], y1[j]
            dx_seg, dy_seg = x2[j], y2[j]
            cdx, cdy = dx_seg - cx, dy_seg - cy

            # 2次元外積による線分交差判定
            d1 = abx * (cy - ay) - aby * (cx - ax)
            d2 = abx * (dy_seg - ay) - aby * (dx_seg - ax)
            d3 = cdx * (ay - cy) - cdy * (ax - cx)
            d4 = cdx * (by - cy) - cdy * (bx - cx)

            if ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and (
                (d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps)
            ):
                return True

            # 同一直線上で重なっている場合（Collinear overlap）
            if (
                abs(d1) <= eps
                and abs(d2) <= eps
                and abs(d3) <= eps
                and abs(d4) <= eps
            ):
                if (
                    max(min_x[i], min_x[j]) <= min(max_x[i], max_x[j]) + eps
                    and max(min_y[i], min_y[j]) <= min(max_y[i], max_y[j]) + eps
                ):
                    return True

    return False


def point_in_polygon(
    px: ArrayLike,
    py: ArrayLike,
    poly_x: ArrayLike,
    poly_y: ArrayLike,
) -> NDArray[np.bool_] | bool:
    """点または座標配列 (px, py) が多角形 (poly_x, poly_y) の内部にあるか判定する。

    開後縁（closed_te=False）等で始点と終点が離れている場合も、
    自動的に始終点を線分で閉じた閉ポリゴンとして Ray-casting 判定を行う。
    スカラー入力時は bool、配列入力時は px と同一 shape の bool NDArray を返す。
    """
    px_arr = np.asarray(px, dtype=np.float64)
    py_arr = np.asarray(py, dtype=np.float64)
    is_scalar = px_arr.ndim == 0 and py_arr.ndim == 0

    orig_shape = np.broadcast_shapes(px_arr.shape, py_arr.shape)
    px_flat = np.broadcast_to(px_arr, orig_shape).ravel()
    py_flat = np.broadcast_to(py_arr, orig_shape).ravel()

    vx = np.asarray(poly_x, dtype=np.float64)
    vy = np.asarray(poly_y, dtype=np.float64)
    if len(vx) < 3:
        result_empty = np.zeros(px_flat.shape, dtype=np.bool_)
        return bool(result_empty[0]) if is_scalar else result_empty.reshape(orig_shape)

    # 始点と終点が一致していなければ閉ポリゴン化する
    if vx[0] != vx[-1] or vy[0] != vy[-1]:
        vx = np.append(vx, vx[0])
        vy = np.append(vy, vy[0])

    x1 = vx[:-1]
    y1 = vy[:-1]
    x2 = vx[1:]
    y2 = vy[1:]

    # ポリゴン外接矩形で事前絞り込みして高速化
    xmin, xmax = float(np.min(vx)), float(np.max(vx))
    ymin, ymax = float(np.min(vy)), float(np.max(vy))
    in_bbox = (
        (px_flat >= xmin)
        & (px_flat <= xmax)
        & (py_flat >= ymin)
        & (py_flat <= ymax)
    )

    inside_flat = np.zeros(px_flat.shape, dtype=np.bool_)
    active_idx = np.nonzero(in_bbox)[0]

    if len(active_idx) > 0:
        dy_edge = y2 - y1
        dx_edge = x2 - x1
        chunk_size = 4096
        for start in range(0, len(active_idx), chunk_size):
            sub_idx = active_idx[start : start + chunk_size]
            qx = px_flat[sub_idx, None]
            qy = py_flat[sub_idx, None]

            cond_y = (y1[None, :] > qy) != (y2[None, :] > qy)
            safe_dy = np.where(cond_y, dy_edge[None, :], 1.0)
            x_inter = x1[None, :] + (qy - y1[None, :]) * dx_edge[None, :] / safe_dy
            crossings = cond_y & (qx < x_inter)
            inside_flat[sub_idx] = (np.count_nonzero(crossings, axis=1) % 2) == 1

    if is_scalar:
        return bool(inside_flat[0])
    return inside_flat.reshape(orig_shape)


def min_distance_to_panels(
    px: ArrayLike,
    py: ArrayLike,
    mesh: AirfoilMesh,
) -> NDArray[np.float64] | float:
    """評価点 (px, py) から全パネル線分への最短ユークリッド距離 d_min を計算する。"""
    px_arr = np.asarray(px, dtype=np.float64)
    py_arr = np.asarray(py, dtype=np.float64)
    is_scalar = px_arr.ndim == 0 and py_arr.ndim == 0

    orig_shape = np.broadcast_shapes(px_arr.shape, py_arr.shape)
    px_flat = np.broadcast_to(px_arr, orig_shape).ravel()
    py_flat = np.broadcast_to(py_arr, orig_shape).ravel()

    dmin_flat = np.empty(px_flat.shape, dtype=np.float64)
    if len(px_flat) == 0:
        return dmin_flat.reshape(orig_shape)

    x1 = mesh.x[:-1][None, :]
    y1 = mesh.y[:-1][None, :]
    dx = mesh.dx[None, :]
    dy = mesh.dy[None, :]
    s_sq = np.maximum(mesh.s[None, :] ** 2, 1e-30)

    chunk_size = 4096
    for start in range(0, len(px_flat), chunk_size):
        qx = px_flat[start : start + chunk_size, None]
        qy = py_flat[start : start + chunk_size, None]
        t_proj = np.clip(((qx - x1) * dx + (qy - y1) * dy) / s_sq, 0.0, 1.0)
        proj_x = x1 + t_proj * dx
        proj_y = y1 + t_proj * dy
        dist_sq = (qx - proj_x) ** 2 + (qy - proj_y) ** 2
        dmin_flat[start : start + chunk_size] = np.sqrt(np.min(dist_sq, axis=1))

    if is_scalar:
        return float(dmin_flat[0])
    return dmin_flat.reshape(orig_shape)
