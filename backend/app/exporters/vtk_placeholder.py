"""Phase 3 構造格子 VTK（.vts / .vtk）出力用の拡張予約プレースホルダ（API_SPEC.md 3-3節）。"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.models.api_schemas import AnalysisResponse


class BaseFieldExporter(ABC):
    """空間流れ場データを外部可視化フォーマット（ParaView 等）へ変換する抽象基底クラス。"""

    format_id: str = ""
    file_extension: str = ""

    @abstractmethod
    def export(self, res: AnalysisResponse) -> str:
        """解析結果の構造格子流れ場を文字列フォーマットへ変換する。"""


class VtkStructuredGridExporter(BaseFieldExporter):
    """Phase 3（2D CFD 連携）で実装予定の VTK XML StructuredGrid (.vts) エクスポータ予約クラス。"""

    format_id = "vtk_vts"
    file_extension = ".vts"

    def export(self, res: AnalysisResponse) -> str:
        raise NotImplementedError(
            "VTK 構造格子エクスポート（.vts / .vtk）は Phase 3（2D CFD 連携）で実装予定です。"
        )


def export_vtk_structured_grid(res: AnalysisResponse) -> str:
    """Phase 3 予約の VTK 構造格子エクスポート関数（呼び出し時に NotImplementedError を送出）。"""
    return VtkStructuredGridExporter().export(res)
