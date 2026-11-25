/**
 * 将来拡張用 AI 補助解説サービス契約（Phase 2+ 予約）。
 *
 * 【重要】Phase 1 ではダミー解説を一切生成せず、未実装であることを明示する。
 * ルールベース解説（utils/explanationEngine.ts）とは明確に分離する。
 */

import type { AnalysisResponse } from '../types/api';

export interface AiExplanationRequest {
  analysis: AnalysisResponse;
  userQuestion?: string;
}

export interface AiExplanationResponse {
  available: false;
  label: string;
  disclaimer: string;
  message: string;
}

export interface AiExplanationService {
  readonly isAvailable: boolean;
  requestExplanation(req: AiExplanationRequest): Promise<AiExplanationResponse>;
}

export const aiExplanationService: AiExplanationService = {
  isAvailable: false,
  async requestExplanation(_req: AiExplanationRequest): Promise<AiExplanationResponse> {
    return {
      available: false,
      label: 'AI 補助解説（Phase 2+ 開発予定・準備中）',
      disclaimer:
        '将来の LLM 連携時には「AI生成（補助説明・誤りを含む可能性あり）」の免責注記付きで提供されます。',
      message:
        'Phase 1 ではルールベース解説のみ提供しています。AI 補助解説機能は現在準備中です。',
    };
  },
};
