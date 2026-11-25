"""AirFlow Lab FastAPI アプリケーションのエントリポイント。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from app.api.routes_airfoils import router as airfoils_router
from app.api.routes_analysis import router as analysis_router
from app.api.routes_health import router as health_router
from app.models.airfoil import AirfoilGeometryError
from app.services.analysis_store import AnalysisNotFoundError
from app.services.fluid_properties import FluidPropertiesError
from app.solvers.base import SolverNotAvailableError


def _build_error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """統一エラーJSON形式 { "error": { "code", "message", "details" } } を生成する。"""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details,
            }
        },
    )


def _format_validation_errors(errors: list[Any]) -> tuple[str, str, dict[str, Any]]:
    """Pydantic / FastAPI バリデーションエラーから適切なエラーコードと日本語メッセージを構築する。"""
    sanitized: list[dict[str, Any]] = []
    first_loc = ""
    first_msg = "入力パラメータが仕様の範囲外または不正な形式です。"

    for idx, err in enumerate(errors):
        loc_parts = [str(p) for p in err.get("loc", ())]
        loc_str = ".".join(loc_parts)
        msg = str(err.get("msg", ""))
        err_type = str(err.get("type", ""))
        if idx == 0:
            first_loc = loc_str
            if msg:
                first_msg = f"入力検証エラー（{loc_str}）: {msg}" if loc_str else msg
        sanitized.append(
            {
                "loc": loc_parts,
                "msg": msg,
                "type": err_type,
            }
        )

    code = "VALIDATION_ERROR"
    if "num_panels" in first_loc:
        code = "INVALID_NUM_PANELS"
    elif "num_streamlines" in first_loc:
        code = "INVALID_NUM_STREAMLINES"
    elif "x_range" in first_loc or "y_range" in first_loc:
        code = "INVALID_DOMAIN_RANGE"
    elif "angle_of_attack" in first_loc:
        code = "AOA_OUT_OF_ALLOWED_RANGE"
    elif "velocity" in first_loc:
        code = "INVALID_FLOW_CONDITION"
    elif "chord_length" in first_loc:
        code = "INVALID_CHORD_LENGTH"
    elif "fluid_properties" in first_loc:
        code = "INVALID_FLUID_PROPERTIES"
    elif "airfoil" in first_loc or "naca_code" in first_loc or "raw_coordinates_text" in first_loc:
        code = "INVALID_AIRFOIL_GEOMETRY"

    return code, first_msg, {"errors": sanitized}


def create_app() -> FastAPI:
    """FastAPI アプリケーションを生成して設定・ルーター・例外ハンドラを登録する。"""
    application = FastAPI(
        title="AirFlow Lab API",
        version="0.1.0",
        description=(
            "教育用 2次元翼型流体解析ソフトウェア AirFlow Lab の REST API。"
            "Phase 1 では 2D 非粘性・非圧縮ポテンシャル流れ（Hess-Smith パネル法）を提供する。"
        ),
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        code, message, details = _format_validation_errors(list(exc.errors()))
        return _build_error_response(422, code, message, details)

    @application.exception_handler(PydanticValidationError)
    async def handle_pydantic_validation_error(
        _request: Request,
        exc: PydanticValidationError,
    ) -> JSONResponse:
        code, message, details = _format_validation_errors(list(exc.errors()))
        return _build_error_response(422, code, message, details)

    @application.exception_handler(AirfoilGeometryError)
    async def handle_airfoil_geometry_error(
        _request: Request,
        exc: AirfoilGeometryError,
    ) -> JSONResponse:
        return _build_error_response(
            422,
            getattr(exc, "code", "INVALID_AIRFOIL_GEOMETRY"),
            getattr(exc, "message", str(exc)),
            getattr(exc, "details", None),
        )

    @application.exception_handler(FluidPropertiesError)
    async def handle_fluid_properties_error(
        _request: Request,
        exc: FluidPropertiesError,
    ) -> JSONResponse:
        return _build_error_response(
            422,
            getattr(exc, "code", "INVALID_FLUID_PROPERTIES"),
            getattr(exc, "message", str(exc)),
            getattr(exc, "details", None),
        )

    @application.exception_handler(SolverNotAvailableError)
    async def handle_solver_not_available_error(
        _request: Request,
        exc: SolverNotAvailableError,
    ) -> JSONResponse:
        return _build_error_response(
            501,
            getattr(exc, "code", "SOLVER_NOT_IMPLEMENTED"),
            getattr(exc, "message", str(exc)),
            getattr(exc, "details", None),
        )

    @application.exception_handler(AnalysisNotFoundError)
    async def handle_analysis_not_found_error(
        _request: Request,
        exc: AnalysisNotFoundError,
    ) -> JSONResponse:
        return _build_error_response(
            404,
            getattr(exc, "code", "ANALYSIS_NOT_FOUND"),
            getattr(exc, "message", str(exc)),
            getattr(exc, "details", None),
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_error(
        _request: Request,
        _exc: Exception,
    ) -> JSONResponse:
        return _build_error_response(
            500,
            "INTERNAL_SERVER_ERROR",
            "サーバー内部で予期しないエラーが発生しました。",
            None,
        )

    application.include_router(health_router)
    application.include_router(airfoils_router)
    application.include_router(analysis_router)

    return application


app = create_app()
