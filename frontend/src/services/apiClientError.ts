/**
 * API クライアント共通のエラー型。
 *
 * ブラウザ内計算エンジン (`browserAnalysisEngine`) と HTTP クライアント (`apiClient`) の
 * 双方から循環参照なしで import できるよう独立モジュールとして切り出している。
 */
export class ApiClientError extends Error {
  public readonly status: number | null;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number | null,
    code = 'API_ERROR',
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
