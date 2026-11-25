/**
 * 静的ホスティング（GitHub Pages 等）向けのブラウザ完結型 2D 流体解析エンジンサービス。
 *
 * FastAPI バックエンド (`GET /api/health`, `/api/airfoils`, `/api/airfoils/generate`,
 * `POST /api/analysis/run`, `GET /api/analysis/{id}`, `POST /api/analysis/compare`) と
 * 完全に同一のリクエスト検証・エラー型 (`ApiClientError`)・レスポンススキーマを提供する。
 */

import { ApiClientError } from '../services/apiClientError';
import type {
  AirfoilGenerateRequest,
  AirfoilGenerateResponse,
  AirfoilPresetListResponse,
  AnalysisRequest,
  AnalysisResponse,
  CompareDiff,
  CompareRequest,
  CompareResponse,
  HealthResponse,
  SolverCapability,
} from '../types/api';
import { computeStreamlines, computeVelocityField } from './flowAndStreamlines';
import {
  computeDimensionlessNumbers,
  evaluateAnalysisWarnings,
  resolveFluidProperties,
} from './fluidAndWarnings';
import {
  buildPresetPreviewItems,
  generateAirfoilMesh,
  meshToGeometryResult,
  roundDecimals,
  validateNumPanels,
} from './geometry';
import { solvePanelMethod } from './hessSmith';

const ENGINE_VERSION = '0.1.0';
const MAX_CACHE_ITEMS = 50;

const SOLVER_CAPABILITIES: readonly SolverCapability[] = [
  {
    method: 'panel_method',
    label: 'パネル法（2D 非粘性・非圧縮）',
    available: true,
    phase: 1,
    supports_cd: false,
    description: 'Hess-Smith 2D ポテンシャル流れパネル法。粘性抗力・失速は計算不可。',
  },
  {
    method: 'xfoil',
    label: 'XFOIL（2D 粘性境界層連成）',
    available: false,
    phase: 2,
    supports_cd: true,
    description: 'Phase 2 で実装予定（現在利用不可）。',
  },
  {
    method: 'cfd_su2',
    label: '2D CFD（SU2 / RANS）',
    available: false,
    phase: 3,
    supports_cd: true,
    description: 'Phase 3 で実装予定（現在利用不可）。',
  },
];

function validationError(
  message: string,
  code = 'VALIDATION_ERROR',
  details: Record<string, unknown> | null = null
): ApiClientError {
  return new ApiClientError(message, 422, code, details);
}

function generateUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cloneRequest(req: AnalysisRequest): AnalysisRequest {
  return JSON.parse(JSON.stringify(req)) as AnalysisRequest;
}

function validateAirfoilInputFields(
  sourceType: string,
  nacaCode: string | null,
  rawCoordinatesText: string | null
): void {
  if (sourceType !== 'naca4' && sourceType !== 'custom_dat' && sourceType !== 'custom_csv') {
    throw validationError(`未対応の翼型ソース形式です: '${sourceType}'`);
  }
  if (sourceType === 'naca4') {
    if (!nacaCode || !nacaCode.trim()) {
      throw validationError('source_type="naca4" では naca_code の指定が必須です。');
    }
  } else {
    if (!rawCoordinatesText || rawCoordinatesText.trim().length < 10) {
      throw validationError(
        `source_type="${sourceType}" では 10 文字以上の raw_coordinates_text の指定が必須です。`
      );
    }
  }
}

function validateAnalysisRequest(req: AnalysisRequest): void {
  if (!req || typeof req !== 'object') {
    throw validationError('解析リクエストが不正です。');
  }

  validateAirfoilInputFields(
    req.airfoil.source_type,
    req.airfoil.naca_code,
    req.airfoil.raw_coordinates_text
  );

  if (
    !Number.isFinite(req.angle_of_attack) ||
    req.angle_of_attack < -45.0 ||
    req.angle_of_attack > 45.0
  ) {
    throw validationError(
      '迎角 angle_of_attack は -45.0° 以上 +45.0° 以下の有限値で指定してください。',
      'VALIDATION_ERROR',
      { angle_of_attack: req.angle_of_attack }
    );
  }

  if (
    !Number.isFinite(req.velocity) ||
    req.velocity < 0.01 ||
    req.velocity > 1000.0
  ) {
    throw validationError(
      '一様流風速 velocity は 0.01 m/s 以上 1000.0 m/s 以下の有限値で指定してください。',
      'VALIDATION_ERROR',
      { velocity: req.velocity }
    );
  }

  if (
    !Number.isFinite(req.chord_length) ||
    req.chord_length < 0.0001 ||
    req.chord_length > 100.0
  ) {
    throw validationError(
      '翼弦長 chord_length は 0.0001 m 以上 100.0 m 以下の有限値で指定してください。',
      'VALIDATION_ERROR',
      { chord_length: req.chord_length }
    );
  }

  const ns = req.numerical_settings;
  validateNumPanels(ns.num_panels);

  if (!Number.isInteger(ns.grid_nx) || ns.grid_nx < 40 || ns.grid_nx > 240) {
    throw validationError(
      'grid_nx は 40 以上 240 以下の整数で指定してください。',
      'VALIDATION_ERROR',
      { grid_nx: ns.grid_nx }
    );
  }

  if (!Number.isInteger(ns.grid_ny) || ns.grid_ny < 30 || ns.grid_ny > 180) {
    throw validationError(
      'grid_ny は 30 以上 180 以下の整数で指定してください。',
      'VALIDATION_ERROR',
      { grid_ny: ns.grid_ny }
    );
  }

  const [xMin, xMax] = ns.x_range;
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
    throw validationError('x_range には有限値を指定してください。');
  }
  if (!(xMin >= -5.0 && xMin < 0.0 && xMax > 1.0 && xMax <= 5.0)) {
    throw validationError(
      'x_range は -5.0 <= x_min < 0.0 かつ 1.0 < x_max <= 5.0 の範囲で指定してください。'
    );
  }

  const [yMin, yMax] = ns.y_range;
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    throw validationError('y_range には有限値を指定してください。');
  }
  if (!(yMin >= -5.0 && yMin < 0.0 && yMax > 0.0 && yMax <= 5.0)) {
    throw validationError(
      'y_range は -5.0 <= y_min < 0.0 < y_max <= 5.0 の範囲で指定してください。'
    );
  }

  if (
    !Number.isInteger(ns.num_streamlines) ||
    ns.num_streamlines < 10 ||
    ns.num_streamlines > 60
  ) {
    throw validationError(
      'num_streamlines は 10 以上 60 以下の整数で指定してください。',
      'VALIDATION_ERROR',
      { num_streamlines: ns.num_streamlines }
    );
  }
}

export class BrowserAnalysisEngine {
  private readonly store = new Map<string, AnalysisResponse>();
  private presetCache: AirfoilPresetListResponse | null = null;

  private saveAnalysis(response: AnalysisResponse): void {
    if (this.store.has(response.analysis_id)) {
      this.store.delete(response.analysis_id);
    }
    this.store.set(response.analysis_id, response);
    while (this.store.size > MAX_CACHE_ITEMS) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  async getHealth(): Promise<HealthResponse> {
    return {
      status: 'ok',
      version: ENGINE_VERSION,
      solvers: SOLVER_CAPABILITIES.map((s) => ({ ...s })),
    };
  }

  async listAirfoils(): Promise<AirfoilPresetListResponse> {
    if (this.presetCache === null) {
      this.presetCache = { presets: buildPresetPreviewItems() };
    }
    return this.presetCache;
  }

  async generateAirfoil(req: AirfoilGenerateRequest): Promise<AirfoilGenerateResponse> {
    validateAirfoilInputFields(req.source_type, req.naca_code, req.raw_coordinates_text);
    const mesh = generateAirfoilMesh({
      sourceType: req.source_type,
      nacaCode: req.naca_code,
      rawCoordinatesText: req.raw_coordinates_text,
      name: req.name,
      numPanels: req.num_panels,
      closedTe: req.closed_te,
    });

    return {
      name: mesh.name,
      coordinates: {
        x: Array.from(mesh.x),
        y: Array.from(mesh.y),
      },
      geometry: {
        num_panels: mesh.s.length,
        max_thickness_ratio: mesh.maxThicknessRatio,
        max_camber_ratio: mesh.maxCamberRatio,
        max_camber_pos: mesh.maxCamberPos,
        is_symmetric: mesh.isSymmetric,
        is_closed_te: mesh.isClosedTe,
      },
      warnings: [...mesh.warnings],
    };
  }

  async runAnalysis(req: AnalysisRequest): Promise<AnalysisResponse> {
    const tStart = performance.now();
    validateAnalysisRequest(req);

    // 1. ソルバー解決（未実装フェーズは 501 SOLVER_NOT_IMPLEMENTED を厳格返却）
    const method = req.solver.method;
    if (method === 'xfoil' || method === 'cfd_su2') {
      const phase = method === 'xfoil' ? 2 : 3;
      throw new ApiClientError(
        `ソルバー '${method}' は Phase ${phase} で実装予定です。Phase 1 では ['panel_method'] を指定してください。`,
        501,
        'SOLVER_NOT_IMPLEMENTED',
        {
          requested_method: method,
          available_methods: ['panel_method'],
        }
      );
    }
    if (method !== 'panel_method') {
      throw validationError(`未知のソルバー識別子です: '${String(method)}'`, 'INVALID_SOLVER');
    }

    // 2. 流体物性と無次元数 (Re, M)
    const resolvedFluid = resolveFluidProperties(req.fluid_properties);
    const dimensionless = computeDimensionlessNumbers(
      req.velocity,
      req.chord_length,
      resolvedFluid
    );

    // 3. 翼型離散メッシュ生成
    const mesh = generateAirfoilMesh({
      sourceType: req.airfoil.source_type,
      nacaCode: req.airfoil.naca_code,
      rawCoordinatesText: req.airfoil.raw_coordinates_text,
      name: req.airfoil.name,
      numPanels: req.numerical_settings.num_panels,
      closedTe: req.numerical_settings.closed_te,
    });
    const airfoilGeom = meshToGeometryResult(mesh);

    // 4. Hess-Smith パネル法ソルバー実行
    const alphaRad = (req.angle_of_attack * Math.PI) / 180.0;
    const rawOut = solvePanelMethod(mesh, alphaRad, true);

    const solverInfo = {
      method: 'panel_method' as const,
      model_type: 'inviscid_incompressible_potential',
      version: ENGINE_VERSION,
      supports_cd: false,
    };

    const analysisId = generateUuidV4();
    const createdAt = new Date().toISOString();
    const echoInputs = cloneRequest(req);

    // Gate 2: 非収束・数値破綻時は流れ場・係数・表面分布をすべて null 化
    if (
      rawOut.status !== 'success' ||
      rawOut.coefficients === null ||
      rawOut.surface === null ||
      rawOut.sigma === null ||
      rawOut.gamma === null
    ) {
      const totalMs = Math.max(0.0, performance.now() - tStart);
      const failedResponse: AnalysisResponse = {
        analysis_id: analysisId,
        created_at: createdAt,
        status: 'failed',
        solver_info: solverInfo,
        inputs: echoInputs,
        resolved_fluid: resolvedFluid,
        airfoil_geometry: airfoilGeom,
        dimensionless,
        coefficients: null,
        diagnostics: {
          ...rawOut.diagnostics,
          compute_time_ms: roundDecimals(totalMs, 3),
        },
        surface: null,
        flow_field: null,
        streamlines: null,
        warnings: [...mesh.warnings],
        failure: rawOut.failure ?? {
          code: 'SOLVER_FAILED',
          message: '数値計算が収束しなかったため解析を中断しました。',
          details: null,
        },
      };
      this.saveAnalysis(failedResponse);
      return failedResponse;
    }

    // 5. 空間速度場と弧長正規化 RK4 流線計算
    const ns = req.numerical_settings;
    const flowField = computeVelocityField(
      mesh,
      rawOut.sigma,
      rawOut.gamma,
      alphaRad,
      rawOut.vtRatio,
      {
        gridNx: ns.grid_nx,
        gridNy: ns.grid_ny,
        xRange: ns.x_range,
        yRange: ns.y_range,
      }
    );

    const streamlines = computeStreamlines(
      mesh,
      rawOut.sigma,
      rawOut.gamma,
      alphaRad,
      rawOut.vtRatio,
      {
        xRange: ns.x_range,
        yRange: ns.y_range,
        numStreamlines: ns.num_streamlines,
      }
    );

    // 6. 統一警告評価
    const warnings = evaluateAnalysisWarnings({
      angleOfAttackDeg: req.angle_of_attack,
      reynoldsNumber: dimensionless.reynolds_number,
      machNumber: dimensionless.mach_number,
      coefficients: rawOut.coefficients,
      diagnostics: rawOut.diagnostics,
      geometryWarnings: mesh.warnings,
    });

    const totalMs = Math.max(0.0, performance.now() - tStart);

    const response: AnalysisResponse = {
      analysis_id: analysisId,
      created_at: createdAt,
      status: 'success',
      solver_info: solverInfo,
      inputs: echoInputs,
      resolved_fluid: resolvedFluid,
      airfoil_geometry: airfoilGeom,
      dimensionless,
      coefficients: {
        ...rawOut.coefficients,
        cd: null,
      },
      diagnostics: {
        ...rawOut.diagnostics,
        compute_time_ms: roundDecimals(totalMs, 3),
      },
      surface: rawOut.surface,
      flow_field: flowField,
      streamlines,
      warnings,
      failure: null,
    };

    this.saveAnalysis(response);
    return response;
  }

  async getAnalysis(analysisId: string): Promise<AnalysisResponse> {
    const found = this.store.get(analysisId);
    if (!found) {
      throw new ApiClientError(
        `指定された解析ID (${analysisId}) は見つかりません（メモリ上限により破棄された可能性があります）。`,
        404,
        'ANALYSIS_NOT_FOUND',
        { analysis_id: analysisId }
      );
    }
    return found;
  }

  async compareAnalyses(req: CompareRequest): Promise<CompareResponse> {
    const hasBaseId = Boolean(req.base_analysis_id);
    const hasBaseReq = Boolean(req.base_request);
    if (hasBaseId === hasBaseReq) {
      throw validationError(
        'base_analysis_id と base_request はどちらか一方のみを指定してください。'
      );
    }

    const hasTargetId = Boolean(req.target_analysis_id);
    const hasTargetReq = Boolean(req.target_request);
    if (hasTargetId === hasTargetReq) {
      throw validationError(
        'target_analysis_id と target_request はどちらか一方のみを指定してください。'
      );
    }

    const baseRes = req.base_analysis_id
      ? await this.getAnalysis(req.base_analysis_id)
      : await this.runAnalysis(req.base_request as AnalysisRequest);

    const targetRes = req.target_analysis_id
      ? await this.getAnalysis(req.target_analysis_id)
      : await this.runAnalysis(req.target_request as AnalysisRequest);

    const deltaRe =
      targetRes.dimensionless.reynolds_number - baseRes.dimensionless.reynolds_number;
    const deltaMach =
      targetRes.dimensionless.mach_number - baseRes.dimensionless.mach_number;

    let diff: CompareDiff;
    if (
      baseRes.status === 'success' &&
      targetRes.status === 'success' &&
      baseRes.coefficients !== null &&
      targetRes.coefficients !== null
    ) {
      diff = {
        delta_cl: targetRes.coefficients.cl - baseRes.coefficients.cl,
        delta_cm_quarter_chord:
          targetRes.coefficients.cm_quarter_chord -
          baseRes.coefficients.cm_quarter_chord,
        delta_cd:
          baseRes.coefficients.cd !== null && targetRes.coefficients.cd !== null
            ? targetRes.coefficients.cd - baseRes.coefficients.cd
            : null,
        delta_cp_min:
          baseRes.diagnostics.cp_min !== null && targetRes.diagnostics.cp_min !== null
            ? targetRes.diagnostics.cp_min - baseRes.diagnostics.cp_min
            : null,
        delta_reynolds_number: deltaRe,
        delta_mach_number: deltaMach,
      };
    } else {
      diff = {
        delta_cl: null,
        delta_cm_quarter_chord: null,
        delta_cd: null,
        delta_cp_min: null,
        delta_reynolds_number: deltaRe,
        delta_mach_number: deltaMach,
      };
    }

    return {
      base: baseRes,
      target: targetRes,
      diff,
    };
  }
}

export const browserAnalysisEngine = new BrowserAnalysisEngine();
