import React from 'react';
import { AlertOctagon } from 'lucide-react';
import type { FailureInfo } from '../../types/api';
import type { ApiErrorBanner } from '../../types/ui';

interface ErrorOverlayProps {
  apiError: ApiErrorBanner | null;
  failure: FailureInfo | null;
}

export const ErrorOverlay: React.FC<ErrorOverlayProps> = ({ apiError, failure }) => {
  if (!apiError && !failure) return null;

  const code = apiError?.code ?? failure?.code ?? 'ANALYSIS_FAILED';
  const message =
    apiError?.message ??
    failure?.message ??
    '数値計算が収束しなかったため、安全のため結果の描画を中断しました。';
  const details = apiError?.details ?? failure?.details ?? null;

  return (
    <div className="error-overlay" role="alert" data-testid="error-overlay">
      <div className="error-overlay-header">
        <AlertOctagon size={24} />
        <div>
          <h3>解析結果を描画できません（{code}）</h3>
          <p className="error-overlay-sub">
            不正確な数値や非収束データを正常結果として表示しないため、前回の流れ場・グラフをクリアしました。
          </p>
        </div>
      </div>

      <p className="error-overlay-message">{message}</p>

      <div className="error-overlay-hints">
        <strong>対処のヒント：</strong>
        <ul>
          <li>入力値（風速・翼弦長・迎角・パネル数の偶数範囲）が有効範囲内か確認してください。</li>
          <li>カスタム DAT/CSV 翼型の場合、後縁付近の座標重複や自己交差がないか確認してください。</li>
          <li>パネル数を標準値（160）または 120〜200 に変更して再実行してください。</li>
        </ul>
      </div>

      {details && (
        <pre className="error-overlay-details">{JSON.stringify(details, null, 2)}</pre>
      )}
    </div>
  );
};
