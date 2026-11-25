"""翼型幾何構造および前処理に関するドメインデータモデル。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray

WarningSeverity = Literal["info", "warning", "critical"]
PanelSide = Literal["lower", "upper"]


class AirfoilGeometryError(ValueError):
    """翼型コード不正・座標点数不足・自己交差・パネル数不正などを表す検証例外。"""

    def __init__(
        self,
        message: str,
        *,
        code: str = "INVALID_AIRFOIL_GEOMETRY",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass(frozen=True)
class GeometryWarning:
    """翼型前処理（正規化・後縁閉合など）で発生した情報警告。"""

    code: str
    severity: WarningSeverity
    title: str
    message: str

    def to_dict(self) -> dict[str, str]:
        """APIレスポンスの WarningItem 辞書へ変換する。"""
        return {
            "code": self.code,
            "severity": self.severity,
            "title": self.title,
            "message": self.message,
        }


@dataclass
class AirfoilMesh:
    """無次元系（弦長 c=1, 前縁=(0,0), 後縁=(1,0)）の時計回りパネル離散化メッシュ。

    節点進行方向は必ず時計回り：
        下面後縁 (1,0) -> 前縁 (0,0) -> 上面後縁 (1,0)
    単位法線ベクトル n = (-sin(phi), cos(phi)) は常に翼外部向き（det[t, n] = +1）。
    """

    x: NDArray[np.float64]  # 節点 x 座標 (N+1,)
    y: NDArray[np.float64]  # 節点 y 座標 (N+1,)
    x_c: NDArray[np.float64]  # コロケーション点（パネル中点）x 座標 (N,)
    y_c: NDArray[np.float64]  # コロケーション点（パネル中点）y 座標 (N,)
    dx: NDArray[np.float64]  # パネル差分 X_{i+1} - X_i (N,)
    dy: NDArray[np.float64]  # パネル差分 Y_{i+1} - Y_i (N,)
    s: NDArray[np.float64]  # 無次元パネル長 S_i (N,)
    phi: NDArray[np.float64]  # パネル傾き角 atan2(dy, dx) [rad] (N,)
    tx: NDArray[np.float64]  # 単位接線ベクトル x 成分 cos(phi) (N,)
    ty: NDArray[np.float64]  # 単位接線ベクトル y 成分 sin(phi) (N,)
    nx: NDArray[np.float64]  # 単位外向き法線ベクトル x 成分 -sin(phi) (N,)
    ny: NDArray[np.float64]  # 単位外向き法線ベクトル y 成分 +cos(phi) (N,)
    side: list[PanelSide]  # 各パネルの上下区分 ("lower" / "upper") 長さ N
    te_gap: float  # 無次元後縁開口長（閉後縁では 0.0）
    max_thickness_ratio: float  # 最大翼厚比 t/c
    max_camber_ratio: float  # 最大キャンバー比 m/c
    max_camber_pos: float  # 最大キャンバー弦方向位置 x/c
    is_symmetric: bool  # 上下対称翼フラグ
    is_closed_te: bool  # 後縁閉合フラグ
    warnings: list[GeometryWarning] = field(default_factory=list)
    name: str = "Airfoil"

    @property
    def num_panels(self) -> int:
        """パネル総数 N を返す。"""
        return int(len(self.s))

    @property
    def num_nodes(self) -> int:
        """節点総数 N+1 を返す。"""
        return int(len(self.x))

    @property
    def signed_area(self) -> float:
        """閉ポリゴンとしての符号付き面積（時計回り進行では負値）を返す。"""
        poly_x = self.x
        poly_y = self.y
        if poly_x[0] != poly_x[-1] or poly_y[0] != poly_y[-1]:
            poly_x = np.append(poly_x, poly_x[0])
            poly_y = np.append(poly_y, poly_y[0])
        return float(0.5 * np.sum(poly_x[:-1] * poly_y[1:] - poly_x[1:] * poly_y[:-1]))

    def to_geometry_dict(self) -> dict[str, Any]:
        """API レスポンスの airfoil_geometry オブジェクト形式へ変換する。"""
        return {
            "name": self.name,
            "x": self.x.tolist(),
            "y": self.y.tolist(),
            "num_panels": self.num_panels,
            "max_thickness_ratio": float(self.max_thickness_ratio),
            "max_camber_ratio": float(self.max_camber_ratio),
            "max_camber_pos": float(self.max_camber_pos),
            "is_symmetric": bool(self.is_symmetric),
            "is_closed_te": bool(self.is_closed_te),
        }


@dataclass(frozen=True)
class AirfoilPresetSpec:
    """標準プリセット翼型（GET /api/airfoils 用）のメタデータ定義。"""

    id: str
    name: str
    naca_code: str
    is_symmetric: bool
    max_thickness_ratio: float
    max_camber_ratio: float
    max_camber_pos: float
    description: str


STANDARD_AIRFOIL_PRESETS: tuple[AirfoilPresetSpec, ...] = (
    AirfoilPresetSpec(
        id="naca0012",
        name="NACA 0012",
        naca_code="0012",
        is_symmetric=True,
        max_thickness_ratio=0.12,
        max_camber_ratio=0.0,
        max_camber_pos=0.0,
        description="代表的な対称翼型（厚さ12%）。迎角0°で揚力0となり、対称性の学習に最適。",
    ),
    AirfoilPresetSpec(
        id="naca2412",
        name="NACA 2412",
        naca_code="2412",
        is_symmetric=False,
        max_thickness_ratio=0.12,
        max_camber_ratio=0.02,
        max_camber_pos=0.4,
        description="軽航空機で広く使われる標準キャンバー翼（最大反り2%、位置40%、厚さ12%）。",
    ),
    AirfoilPresetSpec(
        id="naca4412",
        name="NACA 4412",
        naca_code="4412",
        is_symmetric=False,
        max_thickness_ratio=0.12,
        max_camber_ratio=0.04,
        max_camber_pos=0.4,
        description="中程度のキャンバーを持つ実用翼型（最大反り4%、位置40%、厚さ12%）。迎角0°でも明確な正揚力を発生。",
    ),
    AirfoilPresetSpec(
        id="naca6412",
        name="NACA 6412",
        naca_code="6412",
        is_symmetric=False,
        max_thickness_ratio=0.12,
        max_camber_ratio=0.06,
        max_camber_pos=0.4,
        description="強いキャンバーを持つ高揚力翼型（最大反り6%、位置40%、厚さ12%）。キャンバー効果の比較に最適。",
    ),
)
