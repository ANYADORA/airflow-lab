"""流れ解析実行・結果取得・2条件比較エンドポイント（/api/analysis）。"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api import get_analysis_service
from app.models.api_schemas import (
    AnalysisRequest,
    AnalysisResponse,
    CompareRequest,
    CompareResponse,
)
from app.services.analysis_service import AnalysisService

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post(
    "/run",
    response_model=AnalysisResponse,
    summary="2次元翼型周りの流れ解析を実行（簡易・本格モード共通）",
)
def run_analysis(
    request: AnalysisRequest,
    service: AnalysisService = Depends(get_analysis_service),
) -> AnalysisResponse:
    """必須7キーのリクエストに基づき解析を実行し、結果と診断・警告を返す。"""
    return service.run_analysis(request)


@router.get(
    "/{analysis_id}",
    response_model=AnalysisResponse,
    summary="保存済みの解析結果を analysis_id で取得",
)
def get_analysis(
    analysis_id: UUID,
    service: AnalysisService = Depends(get_analysis_service),
) -> AnalysisResponse:
    """インメモリキャッシュから指定IDの解析結果を取得する。"""
    return service.get_analysis(analysis_id)


@router.post(
    "/compare",
    response_model=CompareResponse,
    summary="2条件（Case A / Case B）の解析結果比較と差分算出",
)
def compare_analyses(
    request: CompareRequest,
    service: AnalysisService = Depends(get_analysis_service),
) -> CompareResponse:
    """2条件の解析結果および主要 KPI 差分（target - base）を返す。"""
    return service.compare_analyses(request)
