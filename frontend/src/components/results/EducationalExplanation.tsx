import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import type { AnalysisResponse } from '../../types/api';
import { generateRuleBasedExplanation } from '../../utils/explanationEngine';

interface EducationalExplanationProps {
  result: AnalysisResponse | null;
}

export const EducationalExplanation: React.FC<EducationalExplanationProps> = ({ result }) => {
  const [showMisconception, setShowMisconception] = useState(false);

  const explanation = useMemo(() => {
    if (!result || result.status !== 'success') return null;
    return generateRuleBasedExplanation(result);
  }, [result]);

  if (!explanation) {
    return (
      <section className="panel-card explanation-card" aria-label="学習解説">
        <div className="explanation-header">
          <BookOpen size={16} />
          <span className="rule-badge" data-testid="rule-based-badge">
            ルールベース解説（計算結果に基づく定式生成）
          </span>
        </div>
        <p className="empty-panel-note">
          解析を実行すると、計算された実数値（CL・Cp,min・最大速度比・Re）と結びつけた物理解説がここに表示されます。
        </p>
      </section>
    );
  }

  return (
    <section className="panel-card explanation-card" data-testid="educational-explanation">
      <div className="explanation-header">
        <BookOpen size={16} />
        <span className="rule-badge" data-testid="rule-based-badge">
          {explanation.sourceBadge}
        </span>
      </div>

      <div className="explanation-blocks">
        {explanation.blocks.map((block) => (
          <article key={block.id} className="explanation-block">
            <h4>{block.title}</h4>
            {block.paragraphs.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
            {block.bullets && (
              <ul>
                {block.bullets.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <div className="misconception-box">
        <button
          type="button"
          className="misconception-toggle"
          onClick={() => setShowMisconception((v) => !v)}
          aria-expanded={showMisconception}
        >
          {showMisconception ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{explanation.misconception.title}</span>
        </button>

        {showMisconception && (
          <div className="misconception-content">
            <div className="misconception-label">{explanation.misconception.misconceptionLabel}</div>
            {explanation.misconception.correctionParagraphs.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
            <div className="try-it-box">
              <strong>アプリで確かめてみよう：</strong>
              <ol>
                {explanation.misconception.tryItSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
