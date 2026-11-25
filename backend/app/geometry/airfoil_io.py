"""カスタム翼型（Selig / Lednicer 形式 DAT・CSV）のパーサ・正規化・閉合・再パネル化モジュール。"""

from __future__ import annotations

import math
import re

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import CubicSpline
from scipy.optimize import brentq, minimize_scalar

from app.geometry.paneling import (
    DEFAULT_NUM_PANELS,
    build_airfoil_mesh,
    generate_cosine_xi,
    has_non_adjacent_self_intersection,
    validate_num_panels,
)
from app.models.airfoil import (
    AirfoilGeometryError,
    AirfoilMesh,
    GeometryWarning,
    PanelSide,
)

MIN_RAW_POINTS = 12
DUPLICATE_POINT_TOL = 1e-9
NORMALIZATION_WARN_TOL = 1e-4
OPEN_TE_GAP_TOL = 1e-5


def _parse_coordinate_blocks(
    raw_text: str,
) -> tuple[list[NDArray[np.float64]], str | None]:
    """DAT / CSV テキストから数値座標ブロックのリストと推定ヘッダ名を抽出する。

    UTF-8 文字列および CRLF / LF / CR 改行すべてに対応する。
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise AirfoilGeometryError("翼型座標データが空です。")

    normalized_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized_text.split("\n")

    blocks: list[list[tuple[float, float]]] = []
    current_block: list[tuple[float, float]] = []
    detected_header_name: str | None = None
    seen_any_numeric = False

    for line_no, raw_line in enumerate(lines, start=1):
        stripped = raw_line.strip()
        if not stripped:
            if current_block:
                blocks.append(current_block)
                current_block = []
            continue

        # コメント行（#, ;, !, %）はスキップ
        if stripped[0] in ("#", ";", "!", "%"):
            continue

        # カンマ区切りまたは空白区切りでトークン分割
        tokens = [tok for tok in re.split(r"[,\s]+", stripped) if tok]
        if len(tokens) == 2:
            try:
                x_val = float(tokens[0])
                y_val = float(tokens[1])
            except ValueError:
                x_val = None
                y_val = None

            if x_val is not None and y_val is not None:
                if not (math.isfinite(x_val) and math.isfinite(y_val)):
                    raise AirfoilGeometryError(
                        f"{line_no}行目に非有限値（NaN/Inf）が含まれています。",
                        details={"line": line_no, "content": stripped},
                    )
                current_block.append((x_val, y_val))
                seen_any_numeric = True
                continue

        # 先頭付近の非数値行は翼型名または CSV 列名（x,y 等）として扱う
        if not seen_any_numeric:
            lower_line = stripped.lower().replace(" ", "")
            if lower_line not in ("x,y", "x/c,y/c", "xc,yc") and detected_header_name is None:
                detected_header_name = stripped
            continue

        # 数値ブロックの途中に解釈不能な不正行が混入していた場合はエラー
        raise AirfoilGeometryError(
            f"{line_no}行目の座標データを2列の数値として解釈できません: '{stripped}'",
            details={"line": line_no, "content": stripped},
        )

    if current_block:
        blocks.append(current_block)

    if not blocks:
        raise AirfoilGeometryError("有効な2次元座標データが含まれていません。")

    # Lednicer 形式の先頭点数行（例: "31. 31." や "61 61"）の検出と除去
    # mm 単位の CSV（例: 弦長 250mm）の1点目を誤削除しないよう厳密条件で判定する
    first_blk = blocks[0]
    total_pts = sum(len(b) for b in blocks)
    if len(first_blk) >= 1 and total_pts >= MIN_RAW_POINTS + 1:
        v1, v2 = first_blk[0]
        is_int_pair = (
            v1 >= 6.0
            and v2 >= 6.0
            and abs(v1 - round(v1)) < 1e-6
            and abs(v2 - round(v2)) < 1e-6
        )
        if is_int_pair:
            expected_rem = int(round(v1)) + int(round(v2))
            actual_rem = total_pts - 1
            rem_coords = [pt for pt in first_blk[1:]] + [
                pt for blk in blocks[1:] for pt in blk
            ]
            max_abs_rem = max(max(abs(px), abs(py)) for px, py in rem_coords)
            if abs(actual_rem - expected_rem) <= 2 and max_abs_rem <= 5.0:
                if len(first_blk) == 1:
                    blocks = blocks[1:]
                else:
                    blocks[0] = first_blk[1:]

    np_blocks = [np.asarray(blk, dtype=np.float64) for blk in blocks if len(blk) > 0]
    total_valid = sum(len(b) for b in np_blocks)
    if total_valid < MIN_RAW_POINTS:
        raise AirfoilGeometryError(
            f"有効な座標点数が不足しています（入力: {total_valid}点、最低 {MIN_RAW_POINTS}点必要）。",
            details={"num_points": total_valid, "min_required": MIN_RAW_POINTS},
        )

    return np_blocks, detected_header_name


def _remove_consecutive_duplicates(
    pts: NDArray[np.float64],
    tol: float = DUPLICATE_POINT_TOL,
) -> NDArray[np.float64]:
    """隣接2点間距離が tol 未満の重複点を除去する（始点と終点の一致は保持）。"""
    if len(pts) <= 1:
        return pts.copy()
    diffs = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    keep = np.concatenate([[True], diffs >= tol])
    return pts[keep]


def _convert_to_clockwise_contour(blocks: list[NDArray[np.float64]]) -> NDArray[np.float64]:
    """Selig 形式・Lednicer 形式・既存時計回り形式を自動判別し、時計回り一筆書き点列へ統一する。"""
    all_pts = np.vstack(blocks)
    span = float(
        max(
            np.ptp(all_pts[:, 0]),
            np.ptp(all_pts[:, 1]),
        )
    )
    if span <= 1e-9:
        raise AirfoilGeometryError("翼型座標の空間広がりがゼロ（全点ほぼ同一）です。")

    # 1. Lednicer 2ブロック形式の判定（空行区切り、または単一ブロック内の大ジャンプ）
    candidate_pair: tuple[NDArray[np.float64], NDArray[np.float64]] | None = None
    if len(blocks) == 2 and len(blocks[0]) >= 6 and len(blocks[1]) >= 6:
        b1, b2 = blocks[0], blocks[1]
        start_dist = float(np.hypot(*(b1[0] - b2[0])))
        end_dist = float(np.hypot(*(b1[-1] - b2[-1])))
        v1 = b1[-1] - b1[0]
        v2 = b2[-1] - b2[0]
        if (
            start_dist <= 0.12 * span
            and end_dist <= 0.15 * span
            and float(np.dot(v1, v2)) > 0.25 * (span**2)
        ):
            candidate_pair = (b1, b2)
    elif len(blocks) == 1:
        single = blocks[0]
        jumps = np.hypot(np.diff(single[:, 0]), np.diff(single[:, 1]))
        large_jumps = np.nonzero(jumps > 0.45 * span)[0]
        if len(large_jumps) == 1:
            split_idx = int(large_jumps[0]) + 1
            b1 = single[:split_idx]
            b2 = single[split_idx:]
            if len(b1) >= 6 and len(b2) >= 6:
                start_dist = float(np.hypot(*(b1[0] - b2[0])))
                end_dist = float(np.hypot(*(b1[-1] - b2[-1])))
                v1 = b1[-1] - b1[0]
                v2 = b2[-1] - b2[0]
                if (
                    start_dist <= 0.12 * span
                    and end_dist <= 0.15 * span
                    and float(np.dot(v1, v2)) > 0.25 * (span**2)
                ):
                    candidate_pair = (b1, b2)

    if candidate_pair is not None:
        b1, b2 = candidate_pair
        p_le_est = 0.5 * (b1[0] + b2[0])
        p_te_est = 0.5 * (b1[-1] + b2[-1])
        c_vec = p_te_est - p_le_est
        c_len = float(np.hypot(c_vec[0], c_vec[1]))
        if c_len <= 1e-9:
            raise AirfoilGeometryError("Lednicer 形式の前縁と後縁が一致しています。")
        # 弦ベクトルに対する左向き法線（上面側正）で上下ブロックを識別
        n_up = np.array([-c_vec[1] / c_len, c_vec[0] / c_len], dtype=np.float64)
        h1 = float(np.mean((b1 - p_le_est) @ n_up))
        h2 = float(np.mean((b2 - p_le_est) @ n_up))
        if abs(h1 - h2) <= 1e-7 * span:
            raise AirfoilGeometryError("Lednicer 形式の上面ブロックと下面ブロックが重なっています。")
        upper_blk, lower_blk = (b1, b2) if h1 > h2 else (b2, b1)
        # 時計回り：下面後縁 -> 前縁 -> 上面後縁
        cw_pts = np.vstack([lower_blk[::-1], upper_blk[1:]])
        cw_pts = _remove_consecutive_duplicates(cw_pts)
        if len(cw_pts) < MIN_RAW_POINTS:
            raise AirfoilGeometryError("重複点除去後の有効座標点数が12点未満です。")
        if has_non_adjacent_self_intersection(
            cw_pts[:, 0], cw_pts[:, 1], treat_endpoints_connected=True
        ):
            raise AirfoilGeometryError("翼型輪郭に自己交差が検出されました。")
        return cw_pts

    # 2. 一筆書き形式（Selig 反時計回り または 既存時計回り）
    pts = _remove_consecutive_duplicates(all_pts)
    if len(pts) < MIN_RAW_POINTS:
        raise AirfoilGeometryError("重複点除去後の有効座標点数が12点未満です。")

    # 8の字型ポリゴン等の自己交差を面積判定前に検出する
    if has_non_adjacent_self_intersection(
        pts[:, 0], pts[:, 1], treat_endpoints_connected=True
    ):
        raise AirfoilGeometryError("翼型輪郭に自己交差が検出されました。")

    # 閉多角形の符号付き面積（反時計回り Selig なら正、時計回りなら負）
    closed_x = np.append(pts[:, 0], pts[0, 0])
    closed_y = np.append(pts[:, 1], pts[0, 1])
    signed_area = 0.5 * float(
        np.sum(closed_x[:-1] * closed_y[1:] - closed_x[1:] * closed_y[:-1])
    )
    if abs(signed_area) <= 1e-8 * (span**2):
        raise AirfoilGeometryError("翼型輪郭の囲む面積がほぼゼロ（退化形状）です。")

    if signed_area > 0.0:
        # Selig 形式（反時計回り）-> リバースして時計回りへ統一
        pts = pts[::-1].copy()

    return pts


def _compute_arc_length(pts: NDArray[np.float64]) -> NDArray[np.float64]:
    """折れ線点列の累積弧長パラメータ s を返す。"""
    seg_lens = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    return np.concatenate([[0.0], np.cumsum(seg_lens)])


def _locate_leading_edge_on_spline(
    cs: CubicSpline,
    s_nodes: NDArray[np.float64],
    pts: NDArray[np.float64],
    p_te: NDArray[np.float64],
) -> tuple[float, NDArray[np.float64]]:
    """弧長3次スプライン上で幾何学的前縁（最大曲率点）を精密特定する。"""
    s_total = float(s_nodes[-1])
    dists_sq = np.sum((pts - p_te[None, :]) ** 2, axis=1)
    idx_far = int(np.argmax(dists_sq))
    lo_idx = max(0, idx_far - 2)
    hi_idx = min(len(s_nodes) - 1, idx_far + 2)

    res = minimize_scalar(
        lambda sv: -float(np.sum((cs(sv) - p_te) ** 2)),
        bounds=(float(s_nodes[lo_idx]), float(s_nodes[hi_idx])),
        method="bounded",
        options={"xatol": 1e-13},
    )
    s_le_dist = float(res.x)

    # 最遠点近傍 [s_dist - 0.03*S, s_dist + 0.03*S] でスプライン曲率 kappa(s) を最大化して前縁を精密特定
    ds_win = 0.03 * s_total
    s_lo = max(0.0, s_le_dist - ds_win)
    s_hi = min(s_total, s_le_dist + ds_win)

    def _neg_curvature(sv: float) -> float:
        d1 = np.asarray(cs(sv, 1), dtype=np.float64)
        d2 = np.asarray(cs(sv, 2), dtype=np.float64)
        speed_sq = float(d1[0] * d1[0] + d1[1] * d1[1])
        if speed_sq <= 1e-24:
            return 0.0
        cross = abs(float(d1[0] * d2[1] - d1[1] * d2[0]))
        return -(cross / (speed_sq ** 1.5))

    # 局所極値取りこぼし防止のため密グリッド初期点周りで精密化
    s_grid = np.linspace(s_lo, s_hi, 121)
    k_vals = np.array([_neg_curvature(float(sv)) for sv in s_grid], dtype=np.float64)
    idx_k = int(np.argmin(k_vals))
    b_lo = float(s_grid[max(0, idx_k - 2)])
    b_hi = float(s_grid[min(len(s_grid) - 1, idx_k + 2)])
    res_curv = minimize_scalar(
        _neg_curvature,
        bounds=(b_lo, b_hi),
        method="bounded",
        options={"xatol": 1e-13},
    )
    s_le = float(res_curv.x)
    return s_le, np.asarray(cs(s_le), dtype=np.float64)


def parse_custom_airfoil(
    raw_coordinates_text: str,
    num_panels: int = DEFAULT_NUM_PANELS,
    *,
    closed_te: bool = True,
    name: str | None = None,
) -> AirfoilMesh:
    """Selig / Lednicer 形式 DAT または CSV テキストを前処理・再パネル化して AirfoilMesh を返す。

    処理パイプライン（NUMERICAL_METHOD.md 4.2節）:
    1. ヘッダ/コメント/Lednicer点数行除去・形式判別・時計回り統一・重複点除去
    2. 弧長3次スプラインによる前縁特定・平行移動・回転・単位弦長正規化（CUSTOM_AIRFOIL_NORMALIZED 警告）
    3. closed_te=True かつ開後縁 (>1e-5) 時の弦方向線形ブレンド閉合（OPEN_TE_CLOSED_AUTO 警告）
    4. Full-cosine 3次スプライン再パネル化
    5. 上下表面非逆転・非隣接パネル自己交差チェック
    """
    validate_num_panels(num_panels)
    blocks, header_name = _parse_coordinate_blocks(raw_coordinates_text)
    cw_pts = _convert_to_clockwise_contour(blocks)

    warnings: list[GeometryWarning] = []

    # Step 2: 弧長3次スプラインによる前縁特定と単位弦長正規化
    s_raw = _compute_arc_length(cw_pts)
    cs_raw = CubicSpline(s_raw, cw_pts, axis=0, bc_type="not-a-knot")
    p_te_raw = 0.5 * (cw_pts[0] + cw_pts[-1])
    _, p_le_raw = _locate_leading_edge_on_spline(cs_raw, s_raw, cw_pts, p_te_raw)

    chord_vec = p_te_raw - p_le_raw
    c_raw = float(np.hypot(chord_vec[0], chord_vec[1]))
    if c_raw <= 1e-9:
        raise AirfoilGeometryError("翼弦長がゼロまたは極小のため正規化できません。")

    psi_0 = math.atan2(chord_vec[1], chord_vec[0])
    psi_0_deg = math.degrees(psi_0)
    cos_p, sin_p = math.cos(psi_0), math.sin(psi_0)

    rel = cw_pts - p_le_raw[None, :]
    x_norm = (rel[:, 0] * cos_p + rel[:, 1] * sin_p) / c_raw
    y_norm = (-rel[:, 0] * sin_p + rel[:, 1] * cos_p) / c_raw
    norm_pts = np.column_stack([x_norm, y_norm])

    le_offset_ratio = float(np.hypot(p_le_raw[0], p_le_raw[1])) / c_raw
    if (
        abs(c_raw - 1.0) > NORMALIZATION_WARN_TOL
        or abs(psi_0) > NORMALIZATION_WARN_TOL
        or le_offset_ratio > 1e-3
    ):
        warnings.append(
            GeometryWarning(
                code="CUSTOM_AIRFOIL_NORMALIZED",
                severity="info",
                title="カスタム翼型の正規化補正を適用しました",
                message=(
                    f"前縁を (0, 0)、後縁を (1, 0) へ正規化しました"
                    f"（元弦長 c_raw = {c_raw:.6g}、回転補正角 psi_0 = {psi_0_deg:+.4f} deg）。"
                ),
            )
        )

    # 正規化後の前縁位置インデックス（スプライン再構築用）
    s_norm = _compute_arc_length(norm_pts)
    cs_norm_pre = CubicSpline(s_norm, norm_pts, axis=0, bc_type="not-a-knot")
    res_le = minimize_scalar(
        lambda sv: float(np.sum(cs_norm_pre(sv) ** 2)),
        bounds=(0.0, float(s_norm[-1])),
        method="bounded",
        options={"xatol": 1e-13},
    )
    s_le_norm = float(res_le.x)

    # Step 3: 後縁閉合処理（Linear Trailing-Edge Blending）
    dx_te = float(norm_pts[-1, 0] - norm_pts[0, 0])
    dy_te = float(norm_pts[-1, 1] - norm_pts[0, 1])
    te_gap_initial = math.hypot(dx_te, dy_te)

    if closed_te:
        if abs(dy_te) > OPEN_TE_GAP_TOL or te_gap_initial > OPEN_TE_GAP_TOL:
            lower_mask = s_norm <= s_le_norm
            upper_mask = ~lower_mask

            x0_lo = max(float(norm_pts[0, 0]), 0.5)
            x0_up = max(float(norm_pts[-1, 0]), 0.5)
            w_lo = np.clip(norm_pts[lower_mask, 0] / x0_lo, 0.0, 1.0)
            w_up = np.clip(norm_pts[upper_mask, 0] / x0_up, 0.0, 1.0)

            norm_pts[lower_mask, 0] += 0.5 * dx_te * w_lo
            norm_pts[lower_mask, 1] += 0.5 * dy_te * w_lo
            norm_pts[upper_mask, 0] -= 0.5 * dx_te * w_up
            norm_pts[upper_mask, 1] -= 0.5 * dy_te * w_up

            norm_pts[0] = [1.0, 0.0]
            norm_pts[-1] = [1.0, 0.0]
            warnings.append(
                GeometryWarning(
                    code="OPEN_TE_CLOSED_AUTO",
                    severity="info",
                    title="開後縁を線形ブレンドで自動閉合しました",
                    message=(
                        f"パネル法の数値安定性確保のため、後縁ギャップ（|Δy_TE| = {abs(dy_te):.5f}）を "
                        "弦方向線形ブレンドにより (1, 0) へ滑らかに閉合しました。"
                    ),
                )
            )
        else:
            norm_pts[0] = [1.0, 0.0]
            norm_pts[-1] = [1.0, 0.0]

    # Step 4: 弧長3次スプライン構成と Full-cosine 再パネル化
    norm_pts = _remove_consecutive_duplicates(norm_pts)
    s_final = _compute_arc_length(norm_pts)
    cs_final = CubicSpline(s_final, norm_pts, axis=0, bc_type="not-a-knot")

    res_le_final = minimize_scalar(
        lambda sv: float(np.sum(cs_final(sv) ** 2)),
        bounds=(0.0, float(s_final[-1])),
        method="bounded",
        options={"xatol": 1e-13},
    )
    s_le = float(res_le_final.x)
    s_total = float(s_final[-1])
    if s_le <= 1e-6 or (s_total - s_le) <= 1e-6:
        raise AirfoilGeometryError("前縁位置が端点に偏っており上下表面へ分割できません。")

    # 細密サンプリングによる上下表面評価・上下非逆転チェック・キャンバー推定
    # 弧長サンプリング自体もコサイン分布にして前縁高曲率部の線形補間誤差を抑える
    t_cos_dense = 0.5 * (1.0 - np.cos(np.linspace(0.0, math.pi, 1001)))
    s_lo_grid = s_le + t_cos_dense * (0.0 - s_le)  # LE(0) -> TE(1)
    s_up_grid = s_le + t_cos_dense * (s_total - s_le)  # LE(0) -> TE(1)
    pts_lo_grid = cs_final(s_lo_grid)
    pts_up_grid = cs_final(s_up_grid)

    lo_idx_sort = np.argsort(pts_lo_grid[:, 0])
    up_idx_sort = np.argsort(pts_up_grid[:, 0])
    # 前縁極近傍（xi_1 ~ 3.85e-4）のキャンバー補間精度を保つためコサイン分布を使用
    x_eval = 0.5 * (1.0 - np.cos(np.linspace(0.0, math.pi, 501)))
    x_eval[0] = 0.0
    x_eval[-1] = 1.0
    y_lo_eval = np.interp(x_eval, pts_lo_grid[lo_idx_sort, 0], pts_lo_grid[lo_idx_sort, 1])
    y_up_eval = np.interp(x_eval, pts_up_grid[up_idx_sort, 0], pts_up_grid[up_idx_sort, 1])

    # 内部弦位置 (0.01 <= x/c <= 0.99) における上下表面逆転チェック
    interior_mask = (x_eval >= 0.01) & (x_eval <= 0.99)
    if np.any(y_up_eval[interior_mask] <= y_lo_eval[interior_mask] + 1e-6):
        raise AirfoilGeometryError(
            "翼型内部において上面座標と下面座標が交差または上下逆転しています。"
        )

    thickness_dist = y_up_eval - y_lo_eval
    camber_raw = 0.5 * (y_up_eval + y_lo_eval)
    # キャンバー翼の前縁円傾斜による x->0 付近の見かけ中点偏りを除去するため、[0.02, 0.25] の2次近似を外挿ブレンド
    fit_mask = (x_eval >= 0.02) & (x_eval <= 0.25)
    if np.count_nonzero(fit_mask) >= 4:
        xf = x_eval[fit_mask]
        yf = camber_raw[fit_mask]
        design = np.column_stack([xf, xf * xf])
        c1, c2 = np.linalg.lstsq(design, yf, rcond=None)[0]
        w_blend = np.clip((x_eval - 0.02) / 0.03, 0.0, 1.0)
        camber_dist = (1.0 - w_blend) * (c1 * x_eval + c2 * (x_eval * x_eval)) + w_blend * camber_raw
    else:
        camber_dist = camber_raw
    camber_slope = np.gradient(camber_dist, x_eval)

    max_thickness_ratio = float(np.max(thickness_dist))
    idx_max_cam = int(np.argmax(np.abs(camber_dist)))
    if float(np.max(np.abs(camber_dist))) < 1e-4:
        is_symmetric = True
        max_camber_ratio = 0.0
        max_camber_pos = 0.0
    else:
        is_symmetric = False
        max_camber_ratio = float(camber_dist[idx_max_cam])
        max_camber_pos = float(x_eval[idx_max_cam])

    # Full-cosine パラメータ xi_k に対応するキャンバー法線断面との交点を弧長上でサンプリング
    xi_cos = generate_cosine_xi(num_panels)  # 長さ N/2 + 1: 0 -> 1
    n_half = num_panels // 2

    def _sample_branch(
        s_start: float,
        s_end: float,
        pt_te_end: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        sampled = np.empty((n_half + 1, 2), dtype=np.float64)
        sampled[0] = [0.0, 0.0]
        sampled[-1] = pt_te_end

        for k in range(1, n_half):
            xi_k = float(xi_cos[k])
            yc_k = float(np.interp(xi_k, x_eval, camber_dist))
            dyc_k = float(np.interp(xi_k, x_eval, camber_slope))
            theta_k = math.atan(dyc_k)
            ct, st = math.cos(theta_k), math.sin(theta_k)

            def _proj_func(sv: float) -> float:
                px_s, py_s = cs_final(sv)
                return float((px_s - xi_k) * ct + (py_s - yc_k) * st)

            s_lo_b = min(s_start, s_end)
            s_hi_b = max(s_start, s_end)
            fa = _proj_func(s_lo_b)
            fb = _proj_func(s_hi_b)
            if s_hi_b - s_lo_b > 1e-14 and fa * fb <= 0.0:
                s_k = float(brentq(_proj_func, s_lo_b, s_hi_b, xtol=1e-13))
            else:
                # 特殊強キャンバー形状等のフォールバック：弧長内分
                s_k = s_start + xi_k * (s_end - s_start)
            sampled[k] = cs_final(s_k)
        return sampled

    te_lower_pt = np.array([1.0, 0.0]) if closed_te else norm_pts[0].copy()
    te_upper_pt = np.array([1.0, 0.0]) if closed_te else norm_pts[-1].copy()

    lower_branch = _sample_branch(s_le, 0.0, te_lower_pt)  # index 0=LE -> N/2=TE_lower
    upper_branch = _sample_branch(s_le, s_total, te_upper_pt)  # index 0=LE -> N/2=TE_upper

    # 時計回り節点列：下面後縁 -> 前縁 -> 上面後縁
    x_nodes = np.concatenate([lower_branch[:0:-1, 0], [0.0], upper_branch[1:, 0]])
    y_nodes = np.concatenate([lower_branch[:0:-1, 1], [0.0], upper_branch[1:, 1]])

    # Step 5: 再パネル化後の非隣接線分自己交差チェック
    if has_non_adjacent_self_intersection(
        x_nodes, y_nodes, treat_endpoints_connected=True
    ):
        raise AirfoilGeometryError("再パネル化後の翼型パネル列に自己交差が検出されました。")

    side: list[PanelSide] = ["lower"] * n_half + ["upper"] * n_half
    resolved_name = (
        name.strip()
        if (name and name.strip())
        else (header_name if header_name else "Custom Airfoil")
    )
    actual_closed = bool(
        closed_te or math.hypot(x_nodes[-1] - x_nodes[0], y_nodes[-1] - y_nodes[0]) <= OPEN_TE_GAP_TOL
    )

    return build_airfoil_mesh(
        x_nodes,
        y_nodes,
        name=resolved_name,
        max_thickness_ratio=max_thickness_ratio,
        max_camber_ratio=max_camber_ratio,
        max_camber_pos=max_camber_pos,
        is_symmetric=is_symmetric,
        is_closed_te=actual_closed,
        side=side,
        warnings=warnings,
    )


# 外部モジュール（services / tests）からの利用互換エイリアス
load_airfoil_from_text = parse_custom_airfoil
