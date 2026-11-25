import React, { useState } from 'react';
import { Upload } from 'lucide-react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import type { AirfoilSourceType } from '../../types/api';

export const AirfoilCoordinatePanel: React.FC = () => {
  const config = useAnalysisStore((s) => s.config);
  const generatedAirfoil = useAnalysisStore((s) => s.generatedAirfoil);
  const airfoilPreviewError = useAnalysisStore((s) => s.airfoilPreviewError);
  const setAirfoil = useAnalysisStore((s) => s.setAirfoil);
  const previewAirfoilGeometry = useAnalysisStore((s) => s.previewAirfoilGeometry);

  const [showCoordTable, setShowCoordTable] = useState(false);

  const handleSourceChange = (sourceType: AirfoilSourceType) => {
    if (sourceType === 'naca4') {
      setAirfoil({
        source_type: 'naca4',
        naca_code: config.airfoil.naca_code ?? '2412',
        name: `NACA ${config.airfoil.naca_code ?? '2412'}`,
        raw_coordinates_text: null,
      });
    } else {
      setAirfoil({
        source_type: sourceType,
        naca_code: null,
        name: config.airfoil.name ?? 'Custom Airfoil',
        raw_coordinates_text: config.airfoil.raw_coordinates_text ?? '',
      });
    }
  };

  const handleFileUpload: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setAirfoil({
        source_type: isCsv ? 'custom_csv' : 'custom_dat',
        naca_code: null,
        name: file.name.replace(/\.(dat|csv)$/i, ''),
        raw_coordinates_text: text,
      });
    };
    reader.readAsText(file, 'utf-8');
  };

  const handlePreviewClick = async () => {
    await previewAirfoilGeometry();
    setShowCoordTable(true);
  };

  return (
    <div className="adv-subpanel">
      <div className="field-row">
        <label htmlFor="adv-airfoil-source">入力形式</label>
        <select
          id="adv-airfoil-source"
          className="select-input"
          value={config.airfoil.source_type}
          onChange={(e) => handleSourceChange(e.target.value as AirfoilSourceType)}
        >
          <option value="naca4">NACA 4桁コード</option>
          <option value="custom_dat">カスタム DAT（Selig / Lednicer）</option>
          <option value="custom_csv">カスタム CSV</option>
        </select>
      </div>

      {config.airfoil.source_type === 'naca4' ? (
        <div className="field-row">
          <label htmlFor="adv-naca-code">NACA 4桁コード</label>
          <input
            id="adv-naca-code"
            type="text"
            className="text-input"
            maxLength={4}
            value={config.airfoil.naca_code ?? ''}
            onChange={(e) => {
              const code = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
              setAirfoil({
                source_type: 'naca4',
                naca_code: code,
                name: code.length === 4 ? `NACA ${code}` : 'NACA',
                raw_coordinates_text: null,
              });
            }}
            placeholder="例: 2412"
          />
        </div>
      ) : (
        <div className="custom-dat-box">
          <div className="field-row">
            <label htmlFor="adv-custom-name">翼型表示名</label>
            <input
              id="adv-custom-name"
              type="text"
              className="text-input"
              value={config.airfoil.name ?? ''}
              onChange={(e) =>
                setAirfoil({
                  ...config.airfoil,
                  name: e.target.value,
                })
              }
            />
          </div>

          <label className="file-upload-btn">
            <Upload size={14} />
            <span>DAT / CSV ファイルを読込</span>
            <input
              type="file"
              accept=".dat,.csv,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>

          <textarea
            className="dat-textarea"
            rows={5}
            placeholder="Selig / Lednicer 形式または CSV の座標テキストを貼り付け..."
            value={config.airfoil.raw_coordinates_text ?? ''}
            onChange={(e) =>
              setAirfoil({
                ...config.airfoil,
                raw_coordinates_text: e.target.value,
              })
            }
          />
        </div>
      )}

      <div className="action-row-inline">
        <button type="button" className="secondary-btn" onClick={() => void handlePreviewClick()}>
          座標テーブルを確認
        </button>
        <button
          type="button"
          className="secondary-btn"
          disabled
          title="将来のアップデートで制御点・キャンバー編集に対応予定（Phase 2 予定）"
          data-testid="coord-edit-disabled-btn"
        >
          座標編集（準備中）
        </button>
      </div>

      {airfoilPreviewError && (
        <div className="inline-error-msg" role="alert">
          {airfoilPreviewError}
        </div>
      )}

      {showCoordTable && generatedAirfoil && (
        <div className="coord-preview-box">
          <div className="coord-meta-grid">
            <span>名称: {generatedAirfoil.name}</span>
            <span>パネル数: {generatedAirfoil.geometry.num_panels}</span>
            <span>最大翼厚: {(generatedAirfoil.geometry.max_thickness_ratio * 100).toFixed(2)}%</span>
            <span>最大反り: {(generatedAirfoil.geometry.max_camber_ratio * 100).toFixed(2)}%</span>
            <span>対称翼: {generatedAirfoil.geometry.is_symmetric ? 'はい' : 'いいえ'}</span>
            <span>閉後縁: {generatedAirfoil.geometry.is_closed_te ? '閉' : '開'}</span>
          </div>
          <div className="coord-table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>i</th>
                  <th>x/c</th>
                  <th>y/c</th>
                </tr>
              </thead>
              <tbody>
                {generatedAirfoil.coordinates.x.map((xVal, idx) => (
                  <tr key={idx}>
                    <td>{idx}</td>
                    <td>{xVal.toFixed(5)}</td>
                    <td>{generatedAirfoil.coordinates.y[idx].toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
