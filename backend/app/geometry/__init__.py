"""翼型幾何生成・DAT/CSV前処理・時計回りパネル離散化パッケージ。"""

from __future__ import annotations

from typing import Literal

from app.geometry.airfoil_io import load_airfoil_from_text, parse_custom_airfoil
from app.geometry.naca4 import (
    evaluate_naca4_camber,
    evaluate_naca4_half_thickness,
    generate_naca4,
    parse_naca4_code,
)
from app.geometry.paneling import (
    DEFAULT_NUM_PANELS,
    MAX_NUM_PANELS,
    MIN_NUM_PANELS,
    build_airfoil_mesh,
    generate_cosine_xi,
    has_non_adjacent_self_intersection,
    min_distance_to_panels,
    point_in_polygon,
    validate_num_panels,
)
from app.models.airfoil import AirfoilGeometryError, AirfoilMesh


def generate_airfoil_mesh(
    source_type: Literal["naca4", "custom_dat", "custom_csv"],
    *,
    naca_code: str | None = None,
    raw_coordinates_text: str | None = None,
    name: str | None = None,
    num_panels: int = DEFAULT_NUM_PANELS,
    closed_te: bool = True,
) -> AirfoilMesh:
    """API リクエストの source_type に応じて統一的に AirfoilMesh を生成する。"""
    if source_type == "naca4":
        if not naca_code:
            raise AirfoilGeometryError(
                "source_type='naca4' の場合は naca_code の指定が必須です。"
            )
        return generate_naca4(
            naca_code=naca_code,
            num_panels=num_panels,
            closed_te=closed_te,
            name=name,
        )
    if source_type in ("custom_dat", "custom_csv"):
        if not raw_coordinates_text:
            raise AirfoilGeometryError(
                f"source_type='{source_type}' の場合は raw_coordinates_text の指定が必須です。"
            )
        return parse_custom_airfoil(
            raw_coordinates_text=raw_coordinates_text,
            num_panels=num_panels,
            closed_te=closed_te,
            name=name,
        )
    raise AirfoilGeometryError(f"未対応の翼型ソース種別です: '{source_type}'")


__all__ = [
    "AirfoilGeometryError",
    "AirfoilMesh",
    "DEFAULT_NUM_PANELS",
    "MAX_NUM_PANELS",
    "MIN_NUM_PANELS",
    "build_airfoil_mesh",
    "evaluate_naca4_camber",
    "evaluate_naca4_half_thickness",
    "generate_airfoil_mesh",
    "generate_cosine_xi",
    "generate_naca4",
    "has_non_adjacent_self_intersection",
    "load_airfoil_from_text",
    "min_distance_to_panels",
    "parse_custom_airfoil",
    "parse_naca4_code",
    "point_in_polygon",
    "validate_num_panels",
]
