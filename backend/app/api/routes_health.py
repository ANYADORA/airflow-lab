"""ヘルスチェックエンドポイント（GET /api/health）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import get_analysis_service
from app.models.api_schemas import HealthResponse
from app.services.analysis_service import AnalysisService

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="APIヘルスチェックおよびソルバー利用可否確認")
def get_health(
    service: AnalysisService = Depends(get_analysis_service),
) -> HealthResponse:
    """サーバー稼働状態と各フェーズのソルバー能力一覧を返す。"""
    return service.get_health()
