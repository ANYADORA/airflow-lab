import React from 'react';
import { Sparkles } from 'lucide-react';

export const AiExplanationPlaceholder: React.FC = () => {
  return (
    <section
      className="panel-card ai-placeholder-card"
      aria-label="AI 補助解説（将来機能）"
      data-testid="ai-explanation-placeholder"
    >
      <div className="ai-placeholder-header">
        <Sparkles size={16} />
        <span className="ai-badge">AI 補助解説（Phase 2+ 開発予定・準備中）</span>
      </div>
      <p className="ai-placeholder-text">
        将来のアップデートで、LLM による対話的な補助解説（免責注記付き）をルールベース解説とは別枠で提供する予定です。
        Phase 1 では計算値に基づく決定論的なルールベース解説のみを表示しています。
      </p>
    </section>
  );
};
