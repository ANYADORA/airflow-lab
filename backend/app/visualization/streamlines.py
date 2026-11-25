"""弧長正規化4次ルンゲ・クッタ法（Arc-length Normalized RK4）による高速ベクトル化流線積分モジュール。"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from app.geometry.paneling import min_distance_to_panels, point_in_polygon
from app.models.airfoil import AirfoilMesh
from app.models.api_schemas import StreamlinePolyline
from app.solvers.panel.influence import evaluate_induced_velocity_batch

NEAR_AIRFOIL_DIST = 0.08
STEP_NEAR = 0.004
STEP_FAR = 0.015
WALL_COLLISION_DIST = 1.5e-3
STAGNATION_SPEED_TOL = 1.0e-3
DOMAIN_EXIT_MARGIN = 0.05
STREAMLINE_ROUND_DECIMALS = 6


def _generate_rake_seed_points(
    alpha_rad: float,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    num_streamlines: int,
) -> NDArray[np.float64]:
    """翼弦中心 (0.5, 0) を通る仮想レイク線分から流入境界へ逆投影したシード点群を生成する。"""
    x_min, x_max = float(x_range[0]), float(x_range[1])
    y_min, y_max = float(y_range[0]), float(y_range[1])

    cos_a = math.cos(alpha_rad)
    sin_a = math.sin(alpha_rad)

    half_span = min(0.7, max(abs(y_min), abs(y_max)))
    etas = np.linspace(-half_span, half_span, int(num_streamlines), dtype=np.float64)

    xr = 0.5 - etas * sin_a
    yr = etas * cos_a

    if abs(cos_a) > 1e-12:
        tau_x = (xr - x_min) / cos_a if cos_a > 0.0 else (xr - x_max) / cos_a
        tau_x = np.where(tau_x >= 0.0, tau_x, np.inf)
    else:
        tau_x = np.full_like(etas, np.inf)

    if sin_a > 1e-12:
        tau_y = (yr - y_min) / sin_a
        tau_y = np.where(tau_y >= 0.0, tau_y, np.inf)
    elif sin_a < -1e-12:
        tau_y = (yr - y_max) / sin_a
        tau_y = np.where(tau_y >= 0.0, tau_y, np.inf)
    else:
        tau_y = np.full_like(etas, np.inf)

    tau = np.minimum(tau_x, tau_y)
    tau = np.where(np.isfinite(tau), tau, 0.0)

    seed_x = np.clip(xr - tau * cos_a, x_min, x_max)
    seed_y = np.clip(yr - tau * sin_a, y_min, y_max)
    return np.column_stack([seed_x, seed_y])


def compute_streamlines(
    mesh: AirfoilMesh,
    sigma: NDArray[np.float64],
    gamma: float,
    alpha_rad: float,
    vt_ratio: NDArray[np.float64] | None,
    *,
    x_range: tuple[float, float] = (-0.5, 1.6),
    y_range: tuple[float, float] = (-0.7, 0.7),
    num_streamlines: int = 28,
    max_steps: int = 800,
) -> list[StreamlinePolyline]:
    """完全ベクトル化弧長正規化 RK4 により num_streamlines 本の流線ポリラインを高速計算する。

    4つの停止条件（NUMERICAL_METHOD.md 9.2-(4)）:
    1. 計算領域外への流出: x > x_max, x < x_min - 0.05, y < y_min - 0.05, y > y_max + 0.05
    2. 翼内部侵入または翼面極近傍衝突 (d_min < 1.5e-3): 衝突直前の点 x_n までを保持して終了
    3. よどみ点到達: ||V||_2 < 1e-3
    4. 最大ステップ数到達: n >= max_steps (= 800)
    """
    x_min, x_max = float(x_range[0]), float(x_range[1])
    y_min, y_max = float(y_range[0]), float(y_range[1])

    seeds = _generate_rake_seed_points(alpha_rad, x_range, y_range, num_streamlines)
    n_lines = len(seeds)
    max_s = int(max_steps)

    # 事前確保した連続 NumPy バッファで Python ループオーバーヘッドを排除
    traj_x = np.empty((n_lines, max_s + 1), dtype=np.float64)
    traj_y = np.empty((n_lines, max_s + 1), dtype=np.float64)
    lengths = np.zeros(n_lines, dtype=np.int32)

    seed_inside = np.asarray(
        point_in_polygon(seeds[:, 0], seeds[:, 1], mesh.x, mesh.y),
        dtype=np.bool_,
    )
    curr_dmin = np.asarray(
        min_distance_to_panels(seeds[:, 0], seeds[:, 1], mesh),
        dtype=np.float64,
    )
    active = (~seed_inside) & (curr_dmin >= WALL_COLLISION_DIST)

    curr_pos = seeds.copy()
    traj_x[active, 0] = curr_pos[active, 0]
    traj_y[active, 0] = curr_pos[active, 1]
    lengths[active] = 1

    # RK4 内部で毎回再作成しないようパネル幾何配列を事前キャッシュ
    x1_p = mesh.x[:-1][None, :]
    y1_p = mesh.y[:-1][None, :]
    dx_p = mesh.dx[None, :]
    dy_p = mesh.dy[None, :]
    s_sq_p = np.maximum(mesh.s[None, :] ** 2, 1e-30)

    def _fast_dmin(pts_xy: NDArray[np.float64]) -> NDArray[np.float64]:
        qx = pts_xy[:, 0:1]
        qy = pts_xy[:, 1:2]
        t_proj = np.clip(((qx - x1_p) * dx_p + (qy - y1_p) * dy_p) / s_sq_p, 0.0, 1.0)
        dist_sq = (qx - (x1_p + t_proj * dx_p)) ** 2 + (qy - (y1_p + t_proj * dy_p)) ** 2
        return np.sqrt(np.min(dist_sq, axis=1))

    def _eval_unit_dir(
        pts_xy: NDArray[np.float64],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        u_v, v_v = evaluate_induced_velocity_batch(
            pts_xy[:, 0],
            pts_xy[:, 1],
            mesh,
            sigma,
            gamma,
            alpha_rad,
            vt_ratio,
        )
        spd = np.hypot(u_v, v_v)
        inv_spd = 1.0 / np.maximum(spd, 1e-12)
        dir_xy = np.column_stack([u_v * inv_spd, v_v * inv_spd])
        return dir_xy, spd

    for _step in range(max_s):
        act_indices = np.nonzero(active)[0]
        if len(act_indices) == 0:
            break

        pos_a = curr_pos[act_indices]
        dmin_a = curr_dmin[act_indices]

        # 停止条件③: よどみ点判定
        k1, spd1 = _eval_unit_dir(pos_a)
        valid_speed = np.isfinite(spd1) & (spd1 >= STAGNATION_SPEED_TOL)
        if not np.all(valid_speed):
            active[act_indices[~valid_speed]] = False
            act_indices = act_indices[valid_speed]
            if len(act_indices) == 0:
                break
            pos_a = pos_a[valid_speed]
            dmin_a = dmin_a[valid_speed]
            k1 = k1[valid_speed]

        # 適応弧長ステップ幅 ds
        ds = np.where(dmin_a < NEAR_AIRFOIL_DIST, STEP_NEAR, STEP_FAR)[:, None]

        # 4段 RK4 バッチ評価
        k2, spd2 = _eval_unit_dir(pos_a + 0.5 * ds * k1)
        k3, spd3 = _eval_unit_dir(pos_a + 0.5 * ds * k2)
        k4, spd4 = _eval_unit_dir(pos_a + ds * k3)

        next_pos = pos_a + (ds / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

        substep_finite = (
            np.all(np.isfinite(next_pos), axis=1)
            & (spd2 >= 1e-6)
            & (spd3 >= 1e-6)
            & (spd4 >= 1e-6)
        )

        dmin_next = _fast_dmin(next_pos)

        # 翼外接矩形近傍にある候補のみ内部判定を実行（遠方点での不要なポリゴン交差判定を省略）
        near_box = (
            (next_pos[:, 0] >= -0.05)
            & (next_pos[:, 0] <= 1.05)
            & (np.abs(next_pos[:, 1]) <= 0.35)
        )
        inside_next = np.zeros(len(act_indices), dtype=np.bool_)
        inside_mid = np.zeros(len(act_indices), dtype=np.bool_)
        if np.any(near_box):
            mid_sub = 0.5 * (pos_a[near_box] + next_pos[near_box])
            inside_next[near_box] = np.asarray(
                point_in_polygon(next_pos[near_box, 0], next_pos[near_box, 1], mesh.x, mesh.y),
                dtype=np.bool_,
            )
            inside_mid[near_box] = np.asarray(
                point_in_polygon(mid_sub[:, 0], mid_sub[:, 1], mesh.x, mesh.y),
                dtype=np.bool_,
            )

        # 停止条件②: 翼内部侵入または極近傍衝突 (d_min < 1.5e-3)
        hit_airfoil = (~substep_finite) | inside_next | inside_mid | (dmin_next < WALL_COLLISION_DIST)
        if np.any(hit_airfoil):
            active[act_indices[hit_airfoil]] = False

        keep_local = ~hit_airfoil
        if not np.any(keep_local):
            continue

        kept_idx = act_indices[keep_local]
        kept_pos = next_pos[keep_local]
        kept_dmin = dmin_next[keep_local]

        cols = lengths[kept_idx]
        traj_x[kept_idx, cols] = kept_pos[:, 0]
        traj_y[kept_idx, cols] = kept_pos[:, 1]
        lengths[kept_idx] = cols + 1
        curr_pos[kept_idx] = kept_pos
        curr_dmin[kept_idx] = kept_dmin

        # 停止条件①: 計算領域外への流出
        exited = (
            (kept_pos[:, 0] > x_max)
            | (kept_pos[:, 0] < x_min - DOMAIN_EXIT_MARGIN)
            | (kept_pos[:, 1] < y_min - DOMAIN_EXIT_MARGIN)
            | (kept_pos[:, 1] > y_max + DOMAIN_EXIT_MARGIN)
        )
        if np.any(exited):
            active[kept_idx[exited]] = False

    # 最終出力時に一括で小数6桁丸めを実施（d_min >= 1.5e-3 >> 5e-7 のため丸め後も非貫通保証）
    polylines: list[StreamlinePolyline] = []
    for i in range(n_lines):
        n_pts = int(lengths[i])
        if n_pts >= 2:
            xs = np.round(traj_x[i, :n_pts], STREAMLINE_ROUND_DECIMALS)
            ys = np.round(traj_y[i, :n_pts], STREAMLINE_ROUND_DECIMALS)
            xs[xs == 0.0] = 0.0
            ys[ys == 0.0] = 0.0
            polylines.append(
                StreamlinePolyline(
                    x=xs.tolist(),
                    y=ys.tolist(),
                )
            )

    return polylines
