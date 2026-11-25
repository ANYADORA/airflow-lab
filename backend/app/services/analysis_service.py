"""2D翼型流れ解析オーケストレーション・プリセット提供・2条件比較サービス。"""

from __future__ import annotations

from datetime import datetime, timezone
import math
import time
from typing import cast
from uuid import UUID, uuid4

import numpy as np

from app import __version__
from app.geometry import generate_airfoil_mesh, generate_naca4
from app.models.airfoil import STANDARD_AIRFOIL_PRESETS
from app.models.api_schemas import (
    AerodynamicCoefficients,
    AirfoilGenerateRequest,
    AirfoilGenerateResponse,
    AirfoilGeometryResult,
    AirfoilGeometrySummary,
    AirfoilPresetItem,
    AirfoilPresetListResponse,
    AnalysisDiagnostics,
    AnalysisRequest,
    AnalysisResponse,
    CompareDiff,
    CompareRequest,
    CompareResponse,
    FailureInfoSchema,
    HealthResponse,
    PreviewCoords,
    SolverCapabilitySchema,
    SolverInfo,
    SolverMethod,
    SurfaceDistributionSchema,
)
from app.models.solver import SolverInput
from app.services.analysis_store import AnalysisNotFoundError, InMemoryAnalysisStore
from app.services.fluid_properties import (
    compute_dimensionless_numbers,
    resolve_fluid_properties,
)
from app.services.warnings import (
    convert_geometry_warnings,
    evaluate_analysis_warnings,
)
from app.solvers.base import SolverRegistry
from app.visualization import compute_streamlines, compute_velocity_field


class AnalysisService:
    """FastAPI ルーターから呼び出される解析業務ロジック統括サービス。"""

    def __init__(
        self,
        store: InMemoryAnalysisStore | None = None,
        solver_registry: SolverRegistry | None = None,
    ) -> None:
        self._store = store if store is not None else InMemoryAnalysisStore(max_items=50)
        self._registry = (
            solver_registry if solver_registry is not None else SolverRegistry()
        )

    @property
    def store(self) -> InMemoryAnalysisStore:
        """解析結果インメモリストアを返す。"""
        return self._store

    def get_health(self) -> HealthResponse:
        """GET /api/health 用の稼働状態・フェーズ別ソルバー一覧を返す。"""
        caps = [
            SolverCapabilitySchema(
                method=cast(SolverMethod, cap.method),
                label=cap.label,
                available=cap.available,
                phase=cast(int, cap.phase),  # type: ignore[arg-type]
                supports_cd=cap.supports_cd,
                description=cap.description,
            )
            for cap in self._registry.list_capabilities()
        ]
        return HealthResponse(
            status="ok",
            version=__version__,
            solvers=caps,
        )

    def list_airfoil_presets(self) -> AirfoilPresetListResponse:
        """GET /api/airfoils 用の標準4翼型プリセット（0012 / 2412 / 4412 / 6412）を返す。"""
        items: list[AirfoilPresetItem] = []
        for spec in STANDARD_AIRFOIL_PRESETS:
            preview_mesh = generate_naca4(spec.naca_code, num_panels=80, closed_te=True)
            px = np.round(preview_mesh.x, 6)
            py = np.round(preview_mesh.y, 6)
            px[px == 0.0] = 0.0
            py[py == 0.0] = 0.0
            items.append(
                AirfoilPresetItem(
                    id=spec.id,
                    name=spec.name,
                    naca_code=spec.naca_code,
                    is_symmetric=spec.is_symmetric,
                    max_thickness_ratio=spec.max_thickness_ratio,
                    max_camber_ratio=spec.max_camber_ratio,
                    max_camber_pos=spec.max_camber_pos,
                    description=spec.description,
                    preview_coords=PreviewCoords(
                        x=px.tolist(),
                        y=py.tolist(),
                    ),
                )
            )
        return AirfoilPresetListResponse(presets=items)

    def generate_airfoil(self, req: AirfoilGenerateRequest) -> AirfoilGenerateResponse:
        """POST /api/airfoils/generate 用の翼型座標・幾何特性・前処理警告を生成する。"""
        mesh = generate_airfoil_mesh(
            source_type=req.source_type,
            naca_code=req.naca_code,
            raw_coordinates_text=req.raw_coordinates_text,
            name=req.name,
            num_panels=req.num_panels,
            closed_te=req.closed_te,
        )
        return AirfoilGenerateResponse(
            name=mesh.name,
            coordinates=PreviewCoords(
                x=mesh.x.tolist(),
                y=mesh.y.tolist(),
            ),
            geometry=AirfoilGeometrySummary(
                num_panels=mesh.num_panels,
                max_thickness_ratio=mesh.max_thickness_ratio,
                max_camber_ratio=mesh.max_camber_ratio,
                max_camber_pos=mesh.max_camber_pos,
                is_symmetric=mesh.is_symmetric,
                is_closed_te=mesh.is_closed_te,
            ),
            warnings=convert_geometry_warnings(mesh.warnings),
        )

    def run_analysis(self, req: AnalysisRequest) -> AnalysisResponse:
        """POST /api/analysis/run 用の完全解析パイプラインを実行し、結果をストアへ保存して返す。"""
        t_start = time.perf_counter()

        # 1. ソルバー解決（未実装 xfoil / cfd_su2 指定時は SolverNotAvailableError -> 501）
        solver = self._registry.get(req.solver.method)

        # 2. 流体物性と無次元数 (Re, M) の算出
        resolved_fluid = resolve_fluid_properties(req.fluid_properties)
        dimensionless = compute_dimensionless_numbers(
            req.velocity,
            req.chord_length,
            resolved_fluid,
        )

        # 3. 翼型離散メッシュの生成（不正コード・自己交差時は AirfoilGeometryError -> 422）
        mesh = generate_airfoil_mesh(
            source_type=req.airfoil.source_type,
            naca_code=req.airfoil.naca_code,
            raw_coordinates_text=req.airfoil.raw_coordinates_text,
            name=req.airfoil.name,
            num_panels=req.numerical_settings.num_panels,
            closed_te=req.numerical_settings.closed_te,
        )
        airfoil_geom = AirfoilGeometryResult(**mesh.to_geometry_dict())

        # 4. 無次元ソルバーの実行
        raw_out = solver.solve(
            mesh,
            SolverInput(
                angle_of_attack_deg=req.angle_of_attack,
                velocity=req.velocity,
                chord_length=req.chord_length,
                reynolds_number=dimensionless.reynolds_number,
                mach_number=dimensionless.mach_number,
            ),
        )

        solver_info = SolverInfo(
            method=cast(SolverMethod, raw_out.solver_id),
            model_type=raw_out.model_type,
            version=raw_out.version,
            supports_cd=raw_out.supports_cd,
        )

        analysis_id = uuid4()
        created_at = datetime.now(timezone.utc)
        echo_inputs = req.model_copy(deep=True)

        # Gate 2: 非収束・数値破綻時は流れ場を生成せず null 化して返却（誤描画の完全遮断）
        if (
            raw_out.status != "success"
            or raw_out.coefficients is None
            or raw_out.surface is None
            or raw_out.sigma is None
            or raw_out.gamma is None
        ):
            total_ms = max(0.0, (time.perf_counter() - t_start) * 1000.0)
            diag_dict = raw_out.diagnostics.to_dict()
            diag_dict["compute_time_ms"] = round(total_ms, 3)

            fail_obj = (
                FailureInfoSchema(**raw_out.failure.to_dict())
                if raw_out.failure is not None
                else FailureInfoSchema(
                    code="SOLVER_FAILED",
                    message="数値計算が収束しなかったため解析を中断しました。",
                    details=None,
                )
            )
            failed_response = AnalysisResponse(
                analysis_id=analysis_id,
                created_at=created_at,
                status="failed",
                solver_info=solver_info,
                inputs=echo_inputs,
                resolved_fluid=resolved_fluid,
                airfoil_geometry=airfoil_geom,
                dimensionless=dimensionless,
                coefficients=None,
                diagnostics=AnalysisDiagnostics(**diag_dict),
                surface=None,
                flow_field=None,
                streamlines=None,
                warnings=convert_geometry_warnings(mesh.warnings),
                failure=fail_obj,
            )
            self._store.save(failed_response)
            return failed_response

        # 5. 空間速度場格子および弧長正規化 RK4 流線の計算
        alpha_rad = math.radians(req.angle_of_attack)
        num_cfg = req.numerical_settings

        flow_field = compute_velocity_field(
            mesh,
            raw_out.sigma,
            raw_out.gamma,
            alpha_rad,
            raw_out.surface.vt_ratio,
            grid_nx=num_cfg.grid_nx,
            grid_ny=num_cfg.grid_ny,
            x_range=num_cfg.x_range,
            y_range=num_cfg.y_range,
        )

        streamlines = compute_streamlines(
            mesh,
            raw_out.sigma,
            raw_out.gamma,
            alpha_rad,
            raw_out.surface.vt_ratio,
            x_range=num_cfg.x_range,
            y_range=num_cfg.y_range,
            num_streamlines=num_cfg.num_streamlines,
        )

        # 6. Gate 3: 適用限界・クロスチェック統一警告の評価
        warnings = evaluate_analysis_warnings(
            angle_of_attack_deg=req.angle_of_attack,
            reynolds_number=dimensionless.reynolds_number,
            mach_number=dimensionless.mach_number,
            coefficients=raw_out.coefficients,
            diagnostics=raw_out.diagnostics,
            geometry_warnings=mesh.warnings,
        )

        total_ms = max(0.0, (time.perf_counter() - t_start) * 1000.0)
        diag_dict = raw_out.diagnostics.to_dict()
        diag_dict["compute_time_ms"] = round(total_ms, 3)

        # Phase 1 では cd=None を厳格保持
        coeff_schema = AerodynamicCoefficients(
            cl=raw_out.coefficients.cl,
            cl_kutta_joukowski=raw_out.coefficients.cl_kutta_joukowski,
            cl_pressure_integration=raw_out.coefficients.cl_pressure_integration,
            cd=None if not solver.supports_cd else raw_out.coefficients.cd,
            cd_unavailable_reason=raw_out.coefficients.cd_unavailable_reason,
            cm_quarter_chord=raw_out.coefficients.cm_quarter_chord,
        )

        surface_schema = SurfaceDistributionSchema(
            x_c=raw_out.surface.x_c.tolist(),
            y_c=raw_out.surface.y_c.tolist(),
            side=list(raw_out.surface.side),
            cp=raw_out.surface.cp.tolist(),
            vt_ratio=raw_out.surface.vt_ratio.tolist(),
        )

        response = AnalysisResponse(
            analysis_id=analysis_id,
            created_at=created_at,
            status="success",
            solver_info=solver_info,
            inputs=echo_inputs,
            resolved_fluid=resolved_fluid,
            airfoil_geometry=airfoil_geom,
            dimensionless=dimensionless,
            coefficients=coeff_schema,
            diagnostics=AnalysisDiagnostics(**diag_dict),
            surface=surface_schema,
            flow_field=flow_field,
            streamlines=streamlines,
            warnings=warnings,
            failure=None,
        )
        self._store.save(response)
        return response

    def get_analysis(self, analysis_id: str | UUID) -> AnalysisResponse:
        """GET /api/analysis/{analysis_id} 用の保存済み解析結果取得（未存在時 AnalysisNotFoundError -> 404）。"""
        found = self._store.get(analysis_id)
        if found is None:
            raise AnalysisNotFoundError(analysis_id)
        return found

    def compare_analyses(self, req: CompareRequest) -> CompareResponse:
        """POST /api/analysis/compare 用の2条件（base vs target）解析・KPI差分算出。"""
        if req.base_analysis_id is not None:
            base_res = self.get_analysis(req.base_analysis_id)
        else:
            assert req.base_request is not None
            base_res = self.run_analysis(req.base_request)

        if req.target_analysis_id is not None:
            target_res = self.get_analysis(req.target_analysis_id)
        else:
            assert req.target_request is not None
            target_res = self.run_analysis(req.target_request)

        delta_re = (
            target_res.dimensionless.reynolds_number
            - base_res.dimensionless.reynolds_number
        )
        delta_mach = (
            target_res.dimensionless.mach_number
            - base_res.dimensionless.mach_number
        )

        if (
            base_res.status == "success"
            and target_res.status == "success"
            and base_res.coefficients is not None
            and target_res.coefficients is not None
        ):
            delta_cl: float | None = (
                target_res.coefficients.cl - base_res.coefficients.cl
            )
            delta_cm: float | None = (
                target_res.coefficients.cm_quarter_chord
                - base_res.coefficients.cm_quarter_chord
            )
            if (
                base_res.coefficients.cd is not None
                and target_res.coefficients.cd is not None
            ):
                delta_cd: float | None = (
                    target_res.coefficients.cd - base_res.coefficients.cd
                )
            else:
                delta_cd = None

            if (
                base_res.diagnostics.cp_min is not None
                and target_res.diagnostics.cp_min is not None
            ):
                delta_cp_min: float | None = (
                    target_res.diagnostics.cp_min - base_res.diagnostics.cp_min
                )
            else:
                delta_cp_min = None
        else:
            delta_cl = None
            delta_cm = None
            delta_cd = None
            delta_cp_min = None

        return CompareResponse(
            base=base_res,
            target=target_res,
            diff=CompareDiff(
                delta_cl=delta_cl,
                delta_cm_quarter_chord=delta_cm,
                delta_cd=delta_cd,
                delta_cp_min=delta_cp_min,
                delta_reynolds_number=delta_re,
                delta_mach_number=delta_mach,
            ),
        )


_default_service_instance: AnalysisService | None = None


def get_default_analysis_service() -> AnalysisService:
    """プロセス内で共有されるデフォルト AnalysisService インスタンスを返す。"""
    global _default_service_instance
    if _default_service_instance is None:
        _default_service_instance = AnalysisService()
    return _default_service_instance
