import React, { useState } from 'react';
import { Download, FolderOpen, Save } from 'lucide-react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import { buildSurfaceCsv, buildSurfaceCsvFilename } from '../../utils/csvExporter';
import {
  parseProjectFile,
  serializeFullResultJson,
  serializeProjectFile,
  triggerTextDownload,
} from '../../utils/jsonSerializer';

export const ExportImportPanel: React.FC = () => {
  const config = useAnalysisStore((s) => s.config);
  const result = useAnalysisStore((s) => s.result);
  const importConfig = useAnalysisStore((s) => s.importConfig);

  const [ioMessage, setIoMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const hasValidResult = Boolean(result && result.status === 'success');

  const handleDownloadCsv = () => {
    if (!result || result.status !== 'success') return;
    const csv = buildSurfaceCsv(result);
    triggerTextDownload(buildSurfaceCsvFilename(result), csv, 'text/csv;charset=utf-8');
    setIoMessage({ type: 'ok', text: '表面 Cp 分布 CSV をダウンロードしました。' });
  };

  const handleDownloadResultJson = () => {
    if (!result) return;
    const json = serializeFullResultJson(result);
    triggerTextDownload(`airflow_result_${result.analysis_id}.json`, json, 'application/json');
    setIoMessage({ type: 'ok', text: '解析結果フル JSON をダウンロードしました。' });
  };

  const handleSaveProject = () => {
    const content = serializeProjectFile(config, result);
    const code = config.airfoil.naca_code ?? 'custom';
    triggerTextDownload(
      `airflow_config_${code}_a${config.angle_of_attack.toFixed(1)}.airflow.json`,
      content,
      'application/json'
    );
    setIoMessage({ type: 'ok', text: '解析条件ファイル（.airflow.json）を保存しました。' });
  };

  const handleLoadProject: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseProjectFile(text);
      if (!parsed.ok) {
        setIoMessage({ type: 'error', text: `読込エラー: ${parsed.error}` });
        return;
      }
      importConfig(parsed.data.config);
      setIoMessage({
        type: 'ok',
        text: '解析条件を復元しました。「流れを解析する」ボタンで再解析できます。',
      });
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  return (
    <div className="io-panel" data-testid="export-import-panel">
      <h4>データ出力・条件の保存／再読込</h4>

      <div className="io-btn-grid">
        <button
          type="button"
          className="secondary-btn"
          disabled={!hasValidResult}
          onClick={handleDownloadCsv}
        >
          <Download size={14} />
          表面 Cp 分布 CSV 出力
        </button>

        <button
          type="button"
          className="secondary-btn"
          disabled={!result}
          onClick={handleDownloadResultJson}
        >
          <Download size={14} />
          解析結果フル JSON 出力
        </button>

        <button type="button" className="secondary-btn" onClick={handleSaveProject}>
          <Save size={14} />
          条件を保存 (.airflow.json)
        </button>

        <label className="secondary-btn file-label-btn">
          <FolderOpen size={14} />
          <span>条件を再読込 (.airflow.json)</span>
          <input
            type="file"
            accept=".json,.airflow.json"
            onChange={handleLoadProject}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {ioMessage && (
        <div className={`io-feedback ${ioMessage.type}`} role="status">
          {ioMessage.text}
        </div>
      )}

      <div className="future-io-slots">
        <button
          type="button"
          className="secondary-btn"
          disabled
          data-testid="exp-data-import-disabled"
        >
          風洞実験データ読込・重ね合わせ（Phase 2+ 準備中）
        </button>
        <button type="button" className="secondary-btn" disabled>
          VTK 構造格子出力 (.vts / .vtk)（Phase 3 準備中）
        </button>
      </div>
    </div>
  );
};
