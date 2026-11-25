"""翼型プリセット一覧・翼型座標生成エンドポイント（/api/airfoils）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import get_analysis_service
from app.models.api_schemas import (
    AirfoilGenerateRequest,
    AirfoilGenerateResponse,
    AirfoilPresetListResponse,
)
from app.services.analysis_service import AnalysisService

router = APIRouter(prefix="/api/airfoils", tags=["airfoils"])


@router.get(
    "",
    response_model=AirfoilPresetListResponse,
    summary="標準プリセット翼型一覧（NACA 0012 / 2412 / 4412 / 6412）を取得",
)
def list_airfoils(
    service: AnalysisService = Depends(get_analysis_service),
) -> AirfoilPresetListResponse:
    """簡易・本格モード共通の標準翼型プリセット一覧を返す。"""
    return service.list_airfoil_presets()


@router.post(
    "/generate",
    response_model=AirfoilGenerateResponse,
    summary="NACA 4桁またはカスタム DAT/CSV から翼型座標と幾何特性を生成",
)
def generate_airfoil(
    request: AirfoilGenerateRequest,
    service: AnalysisService = Depends(get_analysis_service),
) -> AirfoilGenerateResponse:
    """正規化・再パネル化済みの翼型座標と幾何特性を返す。"""
    return service.generate_airfoil(request)
