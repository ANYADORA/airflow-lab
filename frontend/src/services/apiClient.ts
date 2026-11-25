/**
 * FastAPI バックエンド（必須6エンドポイント）との通信クライアント。
 * `VITE_SOLVER_MODE=browser` 指定時はブラウザ内 Hess-Smith 計算エンジンへ委譲する。
 */

import { browserAnalysisEngine } from '../engine/browserAnalysisEngine';
import type {
  AirfoilGenerateRequest,
  AirfoilGenerateResponse,
  AirfoilPresetListResponse,
  AnalysisRequest,
  AnalysisResponse,
  CompareRequest,
  CompareResponse,
  ErrorResponse,
  HealthResponse,
} from '../types/api';
import { ApiClientError } from './apiClientError';

export { ApiClientError };

export const IS_BROWSER_ENGINE = import.meta.env.VITE_SOLVER_MODE === 'browser';

const API_BASE = '/api';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    throw new ApiClientError(
      'バックエンド API サーバーへ接続できません。サーバーが起動しているか確認してください。',
      null,
      'NETWORK_ERROR',
      err instanceof Error ? { cause: err.message } : null
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 非JSON応答時
  }

  if (!response.ok) {
    const errBody = body as Partial<ErrorResponse> | null;
    const code = errBody?.error?.code ?? `HTTP_${response.status}`;
    const message =
      errBody?.error?.message ??
      `API リクエストが失敗しました（HTTP ${response.status}）。`;
    const details = errBody?.error?.details ?? null;
    throw new ApiClientError(message, response.status, code, details);
  }

  return body as T;
}

export const apiClient = {
  getHealth(): Promise<HealthResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.getHealth();
    }
    return requestJson<HealthResponse>('/health', { method: 'GET' });
  },

  listAirfoils(): Promise<AirfoilPresetListResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.listAirfoils();
    }
    return requestJson<AirfoilPresetListResponse>('/airfoils', { method: 'GET' });
  },

  generateAirfoil(payload: AirfoilGenerateRequest): Promise<AirfoilGenerateResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.generateAirfoil(payload);
    }
    return requestJson<AirfoilGenerateResponse>('/airfoils/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  runAnalysis(payload: AnalysisRequest): Promise<AnalysisResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.runAnalysis(payload);
    }
    return requestJson<AnalysisResponse>('/analysis/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getAnalysis(analysisId: string): Promise<AnalysisResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.getAnalysis(analysisId);
    }
    return requestJson<AnalysisResponse>(`/analysis/${encodeURIComponent(analysisId)}`, {
      method: 'GET',
    });
  },

  compareAnalyses(payload: CompareRequest): Promise<CompareResponse> {
    if (IS_BROWSER_ENGINE) {
      return browserAnalysisEngine.compareAnalyses(payload);
    }
    return requestJson<CompareResponse>('/analysis/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
