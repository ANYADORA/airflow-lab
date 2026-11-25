"""Hess-Smith 2D パネル法の分岐切断フリー影響係数行列および空間点群速度評価カーネル。"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import ArrayLike, NDArray

from app.models.airfoil import AirfoilMesh

TWO_PI = 2.0 * math.pi
ENDPOINT_REG_EPS = 1e-6  # ガード①: パネル端点対数特異点の正則化係数
NEAR_PANEL_ETA_EPS = 1e-3  # ガード②: 外側極薄層での表面接線速度クランプ閾値係数


def compute_panel_influence_matrices(
    mesh: AirfoilMesh,
) -> tuple[
    NDArray[np.float64],
    NDArray[np.float64],
    NDArray[np.float64],
    NDArray[np.float64],
]:
    """全コロケーション点間の法線・接線影響係数行列 (A_n, A_t, B_n, B_t) をベクトル化計算する。

    NUMERICAL_METHOD.md 第5章に準拠:
    - 分岐切断ジャンプを防ぐ単一 atan2 公式:
        beta = atan2(eta * S_j, xi * (xi - S_j) + eta^2)
        Lambda = 0.5 * ln(r2^2 / r1^2)
    - 自己パネル外側極限 (i == j):
        A_n[i, i] = +0.5, A_t[i, i] = 0.0, B_n[i, i] = 0.0, B_t[i, i] = +0.5
    - コーシー・リーマン共役関係:
        B_n = -A_t, B_t = +A_n
    """
    n_panels = mesh.num_panels

    # 評価点 i (N, 1) とパネル始点 j (1, N) の相対ベクトル
    dx_ij = mesh.x_c[:, None] - mesh.x[:-1][None, :]
    dy_ij = mesh.y_c[:, None] - mesh.y[:-1][None, :]

    # 第 j パネル局所座標 (xi, eta)
    tx_j = mesh.tx[None, :]
    ty_j = mesh.ty[None, :]
    s_j = mesh.s[None, :]

    xi = dx_ij * tx_j + dy_ij * ty_j
    eta = -dx_ij * ty_j + dy_ij * tx_j

    r1_sq = xi * xi + eta * eta
    xims = xi - s_j
    r2_sq = xims * xims + eta * eta

    with np.errstate(divide="ignore", invalid="ignore"):
        lam = 0.5 * np.log(r2_sq / r1_sq)
        beta = np.arctan2(eta * s_j, xi * xims + eta * eta)

    # 単位吹出しパネル j の局所誘起速度 (u_s, v_s)
    u_s = -lam / TWO_PI
    v_s = beta / TWO_PI

    # 角度差 Delta_phi_ij = phi_i - phi_j の三角関数（加法定理により ±pi 境界でも連続）
    cos_dphi = mesh.tx[:, None] * tx_j + mesh.ty[:, None] * ty_j
    sin_dphi = mesh.ty[:, None] * tx_j - mesh.tx[:, None] * ty_j

    a_n = -u_s * sin_dphi + v_s * cos_dphi
    a_t = u_s * cos_dphi + v_s * sin_dphi

    # 自己パネル対角項 (i == j) の解析的外側面極限を設定（ゼロ長退化パネルは除外して異常検出へ委ねる）
    diag = np.arange(n_panels)
    valid_diag = mesh.s > 1e-14
    a_n[diag[valid_diag], diag[valid_diag]] = 0.5
    a_t[diag[valid_diag], diag[valid_diag]] = 0.0

    # 時計回り単位渦パネルの影響係数（共役関係により対角・非対角とも厳密成立）
    b_n = -a_t
    b_t = a_n.copy()

    return a_n, a_t, b_n, b_t


def evaluate_induced_velocity_batch(
    px: ArrayLike,
    py: ArrayLike,
    mesh: AirfoilMesh,
    sigma: NDArray[np.float64],
    gamma: float,
    alpha_rad: float,
    vt_ratio: NDArray[np.float64] | None = None,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """空間評価点群 (px, py) における無次元合成流速 (u/V_inf, v/V_inf) を一括計算する。

    Step 4（空間速度場コンター・ベクトル格子）および Step 5（弧長正規化 RK4 流線積分）共通カーネル。
    NUMERICAL_METHOD.md 9.1節の2段階特異値ガードを実装:
    1. ガード①（パネル端点対数特異点の正則化）:
       r_k^2 <- max(r_k^2, (1e-6 * S_j)^2)
    2. ガード②（パネル外側面極近傍での表面速度クランプ）:
       0 <= xi <= S_j かつ 0 <= eta < 1e-3 * S_mean の点では (V_{t,j}/V_inf) * t_j へ置換。
    """
    px_arr = np.asarray(px, dtype=np.float64)
    py_arr = np.asarray(py, dtype=np.float64)
    orig_shape = np.broadcast_shapes(px_arr.shape, py_arr.shape)

    px_flat = np.broadcast_to(px_arr, orig_shape).ravel()
    py_flat = np.broadcast_to(py_arr, orig_shape).ravel()
    n_pts = len(px_flat)

    u_out = np.empty(n_pts, dtype=np.float64)
    v_out = np.empty(n_pts, dtype=np.float64)
    if n_pts == 0:
        return u_out.reshape(orig_shape), v_out.reshape(orig_shape)

    sigma_row = np.asarray(sigma, dtype=np.float64)[None, :]
    gamma_val = float(gamma)
    u_inf = math.cos(alpha_rad)
    v_inf = math.sin(alpha_rad)

    x_j = mesh.x[:-1][None, :]
    y_j = mesh.y[:-1][None, :]
    tx_j = mesh.tx[None, :]
    ty_j = mesh.ty[None, :]
    s_j = mesh.s[None, :]

    s_mean = float(np.mean(mesh.s)) if mesh.num_panels > 0 else 0.0
    eta_clamp_thresh = NEAR_PANEL_ETA_EPS * s_mean
    r_min_sq = np.maximum((ENDPOINT_REG_EPS * s_j) ** 2, 1e-30)

    chunk_size = 4096
    for start in range(0, n_pts, chunk_size):
        end = min(start + chunk_size, n_pts)
        qx = px_flat[start:end, None]
        qy = py_flat[start:end, None]

        dx = qx - x_j
        dy = qy - y_j
        xi = dx * tx_j + dy * ty_j
        eta = -dx * ty_j + dy * tx_j

        xims = xi - s_j
        # ガード①: パネル両端節点の対数特異点を下限クランプで正則化
        r1_sq = np.maximum(xi * xi + eta * eta, r_min_sq)
        r2_sq = np.maximum(xims * xims + eta * eta, r_min_sq)

        lam = 0.5 * np.log(r2_sq / r1_sq)
        beta = np.arctan2(eta * s_j, xi * xims + eta * eta)

        # 局所誘起速度 (吹出し + 時計回り渦)
        u_loc = (-lam * sigma_row + beta * gamma_val) / TWO_PI
        v_loc = (beta * sigma_row + lam * gamma_val) / TWO_PI

        # 全体座標系への変換とパネル総和 + 一様流
        u_chunk = u_inf + np.sum(u_loc * tx_j - v_loc * ty_j, axis=1)
        v_chunk = v_inf + np.sum(u_loc * ty_j + v_loc * tx_j, axis=1)

        # ガード②: パネル外側面極近傍 (0 <= xi <= S_j かつ 0 <= eta < 1e-3 * S_mean) のクランプ
        if vt_ratio is not None and eta_clamp_thresh > 0.0:
            near_mask = (xi >= 0.0) & (xi <= s_j) & (eta >= 0.0) & (eta < eta_clamp_thresh)
            has_near = np.any(near_mask, axis=1)
            if np.any(has_near):
                eta_masked = np.where(near_mask, eta, np.inf)
                nearest_panel = np.argmin(eta_masked, axis=1)
                idx_local = np.nonzero(has_near)[0]
                j_sel = nearest_panel[idx_local]
                u_chunk[idx_local] = vt_ratio[j_sel] * mesh.tx[j_sel]
                v_chunk[idx_local] = vt_ratio[j_sel] * mesh.ty[j_sel]

        u_out[start:end] = u_chunk
        v_out[start:end] = v_chunk

    return u_out.reshape(orig_shape), v_out.reshape(orig_shape)
