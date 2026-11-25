# AirFlow Lab

**高校生・流体力学初学者向けの教育重視 2次元翼型流体解析 Web アプリケーション**

> **最重要方針**
> **「結果を見せるソフト」ではなく、「結果を理解できるソフト」を開発する。**
> 初心者でも扱いやすく、物理的に正確で、計算手法の前提条件と適用限界を正直に示すことを最優先とする。

---

## 1. プロジェクト概要

**AirFlow Lab** は、2次元翼型（NACA 4桁翼型およびカスタム翼型）周りの空気の流れをブラウザ上で解析・可視化し、条件を変えながら空力特性と流体力学の原理を直感的に学べる統合学習環境です。

- **簡易モード（Simple Mode）**: 高校生・初学者が専門用語に迷わず、翼型・迎角・風速・翼弦長を変えて流れ場・圧力分布・揚力の仕組みを学べるモード。
- **本格モード（Advanced Mode）**: 流体物性・数値計算設定（パネル数等）・翼型座標読込・収束診断・2条件比較・JSON/CSV入出力を備えた詳細学習・研究補助モード。
- **単一エンジン共有設計**: 両モードは完全に同一のバックエンド計算エンジンと状態モデルを共有し、同一条件に対して常に100%一致する解析結果を返します。

### 段階的ソルバー開発方針

| フェーズ | 対象物理モデル・ソルバー | 算出可能な空力係数 | 状態 |
| :--- | :--- | :--- | :--- |
| **Phase 1（初期版）** | 2次元・非圧縮・非粘性ポテンシャル流れ（**Hess-Smith パネル法**） | $C_p$ 分布, $C_L$, $C_{m,c/4}$（**$C_D$ は算出不可：`null`**） | **実装・検証完了** |
| **Phase 2（将来拡張）** | 粘性・非粘性強連成解析（**XFOIL 連携**） | $C_p$, $C_L$, $C_D$, $C_{m,c/4}$, 境界層遷移・剥離指標 | 計画段階（環境・GPLライセンス調査後） |
| **Phase 3（将来構想）** | 2次元粘性CFD（**SU2 等**） | 速度・圧力場, $C_L$, $C_D$, $C_m$, 収束履歴 | 将来構想（初期版対象外） |

---

## 2. 絶対に守る7つの計算・表示原則

1. **パネル法を「粘性CFD」と呼ばない**（常時 `2D 非粘性ポテンシャル流れ（パネル法）` と明記する）。
2. **パネル法だけで失速（ストール）を正確に予測できるように見せない**（高迎角 $|\alpha| > 10^\circ$ で剥離注意、$|\alpha| > 12^\circ$ で失速未考慮の強い警告を表示する）。
3. **粘性抗力が計算できない段階では $C_D$ を適当に表示しない**（Phase 1 では `cd: null` とし、`0` や離散化誤差残差を表示せず「算出不可」と理由を明示する）。
4. **解析結果には使用した計算手法を必ず表示する**（画面ヘッダー・結果カード・出力JSON/CSVすべてに記録する）。
5. **計算条件・適用範囲・限界を表示する**（非圧縮近似範囲 $M < 0.3$、低レイノルズ数注意 $Re < 5\times 10^4$ 等を自動判定・表示する）。
6. **収束しなかった計算結果を正常な結果として表示しない**（異常値・悪条件・非収束時は `status: "failed"` とし、グラフ・流れ場描画を遮断する）。
7. **数値計算の結果と解説（ルールベース解説／将来のAI解説）を明確に区別する**（また、誤った「同着理論」は一切使用しない）。

---

## 3. 初期設計ドキュメント一覧（実装開始前成果物）

開発指示書 第7章・第10章に基づき、Phase 1 実装開始前に確定した正式設計資料およびAPI契約スキーマです。

### 設計仕様書（6文書）
1. [**PRODUCT_SPEC.md**](./PRODUCT_SPEC.md) — **製品仕様書**
   簡易モード（必須14項目）・本格モード（全18項目＋拡張枠）、3ペインUI構成、Canvas 2D / Plotly.js 可視化仕様、学習解説ロジック、JSON/CSV入出力仕様。
2. [**ARCHITECTURE.md**](./ARCHITECTURE.md) — **システム構成書**
   React + TypeScript + FastAPI 全体アーキテクチャ、単一状態共有設計、`BaseSolver` Strategyパターン、非収束遮断パイプライン、ディレクトリ構成と段階的拡張設計。
3. [**NUMERICAL_METHOD.md**](./NUMERICAL_METHOD.md) — **数値計算法設計書**
   NACA 4桁・カスタムDAT前処理、Hess-Smithパネル法の厳密定式化（分岐切断フリー影響係数・線形Kutta条件）、$C_p / C_L / C_{m,c/4}$ 算出、Sutherland則、弧長正規化RK4流線積分。
4. [**API_SPEC.md**](./API_SPEC.md) — **API仕様書**
   必須6エンドポイント、解析リクエスト7キー・レスポンス構造、SI単位系、統一エラーコード・警告コード体系、エクスポート仕様。
5. [**TEST_PLAN.md**](./TEST_PLAN.md) — **検証・品質保証計画書**
   円柱厳密解比較、NACA 0012 対称性、薄翼理論比較、Kutta条件・$C_L$ クロスチェック、パネル数収束性、異常入力・非収束遮断、簡易/本格モード一致検証（全25テストケース）。
6. [**TASK_PLAN.md**](./TASK_PLAN.md) — **開発タスク・担当分担計画書**
   Windows 11 環境構築手順（事前承認ゲート付き）、Phase 1 実装 10ステップの順序、Carbon / Neon / 司令塔 / Verifier の役割と排他的ファイル所有権マップ、完了判定ゲート。

### API・データ契約スキーマ（Single Source of Truth）
- [**contracts/api/openapi.yaml**](./contracts/api/openapi.yaml) — OpenAPI 3.1.0 仕様定義（全6エンドポイント）
- [**contracts/schemas/analysis_request.schema.json**](./contracts/schemas/analysis_request.schema.json) — 解析実行リクエスト JSON Schema (Draft 2020-12)
- [**contracts/schemas/analysis_response.schema.json**](./contracts/schemas/analysis_response.schema.json) — 解析実行レスポンス JSON Schema (Draft 2020-12)

---

## 4. リポジトリ基本構成（予定を含む全体構造）

```text
AirFlowLab/
├── README.md                  # プロジェクト概要・設計文書インデックス（本書）
├── PRODUCT_SPEC.md            # 1. 製品仕様書
├── ARCHITECTURE.md            # 2. システム構成書
├── NUMERICAL_METHOD.md        # 3. 数値計算法の設計
├── API_SPEC.md                # 4. API仕様書
├── TEST_PLAN.md               # 5. 検証計画書
├── TASK_PLAN.md               # 6. 開発タスク・担当分担計画
├── contracts/
│   ├── api/
│   │   └── openapi.yaml       # OpenAPI 3.1.0 契約定義
│   └── schemas/
│       ├── analysis_request.schema.json
│       └── analysis_response.schema.json
├── frontend/                  # 実装済み（React + TypeScript + Vite + Plotly.js + Canvas 2D）
├── backend/                   # 実装済み（Python + FastAPI + NumPy/SciPy Hess-Smith パネル法）
├── tests/                     # unit / numerical / integration テスト群
├── start_airflow_lab.ps1      # 開発サーバー起動スクリプト（Backend: 8000 / Frontend: 5173）
└── docs/                      # 詳細技術解説・ユーザーガイド格納先
```

---

## 5. ローカル実行・テスト手順（`D:\home\geminiファイル\airflowlab_env` 利用）

本環境では、Python・仮想環境・Node.js・`node_modules` の実体を `D:\home\geminiファイル\airflowlab_env\` 配下に配置し、ワークスペース内の `.venv` および `frontend\node_modules` は NTFS Junction で接続しています。

### 開発サーバーの起動
- 統合起動スクリプト: `.\start_airflow_lab.ps1`（`c:\home\AirFlowLab` で実行）
- バックエンド単体: `& "D:\home\geminiファイル\airflowlab_env\venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`（`backend/` 配下または `PYTHONPATH=c:\home\AirFlowLab\backend`）
- フロントエンド単体: `& "D:\home\geminiファイル\airflowlab_env\node\node.exe" .\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173`（`frontend/` 配下）

### テスト・ビルド実行
- バックエンド全テスト: `& "D:\home\geminiファイル\airflowlab_env\venv\Scripts\python.exe" -m pytest tests/unit tests/numerical tests/integration -v`
- フロントエンド型検査・テスト・ビルド（`frontend/` 配下）:
  - `& "D:\home\geminiファイル\airflowlab_env\node\node.exe" .\node_modules\typescript\bin\tsc --noEmit`
  - `& "D:\home\geminiファイル\airflowlab_env\node\node.exe" .\node_modules\vitest\vitest.mjs run`
  - `& "D:\home\geminiファイル\airflowlab_env\node\node.exe" .\node_modules\vite\bin\vite.js build`

---

## 6. 開発進行ルール

- **事前承認確認**: Python / Node.js / Git やパッケージの導入、破壊的ファイル操作の前には必ずユーザーの承認を得る。
- **ファイル所有権の分離**: 並列作業時は `TASK_PLAN.md` の排他的ファイル所有権マップに従い、同一ファイルの複数エージェント同時編集を禁止する。
- **段階的品質ゲート**: `TEST_PLAN.md` に定める数値検証・統合検証を通過するまで次段階へ進まず、未実装機能を完成扱いにしない。
