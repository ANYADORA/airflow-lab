"""FastAPI ルーターおよび共通サービス依存性定義。"""

from __future__ import annotations

from functools import lru_cache

from app.services.analysis_service import AnalysisService


@lru_cache(maxsize=1)
def get_analysis_service() -> AnalysisService:
    """アプリケーション共有の AnalysisService シングルトンを返す。"""
    return AnalysisService()
