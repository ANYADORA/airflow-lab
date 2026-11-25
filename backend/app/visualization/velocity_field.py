"""空間構造格子上の速度場・圧力場一括計算モジュール（翼内部マスク・2段階特異値ガード付き）。"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from app.geometry.paneling import point_in_polygon
from app.models.airfoil import AirfoilMesh
from app.models.api_schemas import FlowFieldData
from app.solvers.panel.influence import evaluate_induced_velocity_batch

FIELD_ROUND_DECIMALS = 6


def _to_nullable_2d_list(
    values_2d: NDArray[np.float64],
    inside_mask: NDArray[np.bool_],
) -> list[list[float | None]]:
    """[grid_ny, grid_nx] 数値配列の内部マスク位置を None に置換した2次元リストへ変換する。"""
    rounded = np.round(values_2d, FIELD_ROUND_DECIMALS)
    rounded[rounded == 0.0] = 0.0
    obj_arr: NDArray[np.object_] = rounded.astype(object)
    obj_arr[inside_mask] = None
    result: list[list[float | None]] = obj_arr.tolist()
    return result


def compute_velocity_field(
    mesh: AirfoilMesh,
    sigma: NDArray[np.float64],
    gamma: float,
    alpha_rad: float,
    vt_ratio: NDArray[np.float64] | None,
    *,
    grid_nx: int = 120,
    grid_ny: int = 80,
    x_range: tuple[float, float] = (-0.5, 1.6),
    y_range: tuple[float, float] = (-0.7, 0.7),
) -> FlowFieldData:
    """空間構造格子 [grid_ny][grid_nx] 上の無次元速度比・圧力係数・翼内部マスクを計算する。

    NUMERICAL_METHOD.md 9.1節および API_SPEC.md に準拠:
    - 配列形状はすべて [grid_ny][grid_nx]（外側添字が y_grid 昇順、内側添字が x_grid 昇順）。
    - 翼内部点（is_inside_airfoil == True）では人工内部流を隠蔽するため、
      u_ratio, v_ratio, speed_ratio, cp をすべて None とする。
    - 外部点は 2段階特異値ガード付きの evaluate_induced_velocity_batch で一括評価する。
    """
    x_grid_np = np.linspace(float(x_range[0]), float(x_range[1]), int(grid_nx), dtype=np.float64)
    y_grid_np = np.linspace(float(y_range[0]), float(y_range[1]), int(grid_ny), dtype=np.float64)

    # indexing="xy" により xx, yy ともに shape = (grid_ny, grid_nx) となる
    xx, yy = np.meshgrid(x_grid_np, y_grid_np, indexing="xy")

    inside_raw = point_in_polygon(xx, yy, mesh.x, mesh.y)
    inside_mask = np.asarray(inside_raw, dtype=np.bool_)
    ext_mask = ~inside_mask

    u_grid = np.zeros_like(xx)
    v_grid = np.zeros_like(xx)
    speed_grid = np.zeros_like(xx)
    cp_grid = np.zeros_like(xx)

    if np.any(ext_mask):
        u_ext, v_ext = evaluate_induced_velocity_batch(
            xx[ext_mask],
            yy[ext_mask],
            mesh,
            sigma,
            gamma,
            alpha_rad,
            vt_ratio,
        )
        speed_ext = np.hypot(u_ext, v_ext)
        cp_ext = 1.0 - speed_ext * speed_ext

        u_grid[ext_mask] = u_ext
        v_grid[ext_mask] = v_ext
        speed_grid[ext_mask] = speed_ext
        cp_grid[ext_mask] = cp_ext

    x_grid_clean = np.round(x_grid_np, FIELD_ROUND_DECIMALS)
    y_grid_clean = np.round(y_grid_np, FIELD_ROUND_DECIMALS)
    x_grid_clean[x_grid_clean == 0.0] = 0.0
    y_grid_clean[y_grid_clean == 0.0] = 0.0

    is_inside_list: list[list[bool]] = inside_mask.tolist()

    return FlowFieldData(
        x_grid=x_grid_clean.tolist(),
        y_grid=y_grid_clean.tolist(),
        u_ratio=_to_nullable_2d_list(u_grid, inside_mask),
        v_ratio=_to_nullable_2d_list(v_grid, inside_mask),
        speed_ratio=_to_nullable_2d_list(speed_grid, inside_mask),
        cp=_to_nullable_2d_list(cp_grid, inside_mask),
        is_inside_airfoil=is_inside_list,
    )
