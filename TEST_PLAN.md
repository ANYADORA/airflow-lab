# AirFlow Lab 検証・品質保証計画書（`TEST_PLAN.md`）

> **文書ステータス**: Phase 1 統合設計確定版（Verification, Validation & Quality Gate Specification）  
> **対応仕様書**: `NUMERICAL_METHOD.md`, `PRODUCT_SPEC.md`, `API_SPEC.md`, `ARCHITECTURE.md`  
> **対象テストディレクトリ**: `tests/unit/`, `tests/numerical/`, `tests/integration/`, `frontend/tests/`

---

## 目次

1. [検証方針とテストピラミッド](#1-検証方針とテストピラミッド)
2. [必須品質検証項目トレーサビリティマトリクス（指示書第8章＋円柱厳密解）](#2-必須品質検証項目トレーサビリティマトリクス指示書第8章円柱厳密解)
3. [カテゴリ①：単体テスト計画（Unit Tests）](#3-カテゴリ単体テスト計画unit-tests)
4. [カテゴリ②：数値計算検証 V&V 計画（Numerical Verification & Validation）](#4-カテゴリ数値計算検証-vv-計画numerical-verification--validation)
5. [カテゴリ③：異常入力・非収束時の挙動検証計画（Error & Non-convergence Tests）](#5-カテゴリ異常入力非収束時の挙動検証計画error--non-convergence-tests)
6. [カテゴリ④：簡易/本格モード一致・API統合・UI安全ガード検証計画](#6-カテゴリ簡易本格モード一致api統合ui安全ガード検証計画)
7. [自動テスト実行コマンドと品質ゲート（Done Gate）](#7-自動テスト実行コマンドと品質ゲートdone-gate)
8. [検証結果記録テンプレート（テストエビデンス台帳）](#8-検証結果記録テンプレートテストエビデンス台帳)

---

## 1. 検証方針とテストピラミッド

AirFlow Lab は**教育用流体解析ソフトウェア**であるため、「画面がそれらしく動くこと」ではなく**「物理的・数学的に正しい値を返し、計算できない領域や失敗を正直にユーザーへ伝えること」**を品質の最優先基準とする。

この方針を実装工程で強制するため、以下の4層で自動テストを構成し、すべての必須テストが合格（PASS）しない限り次フェーズやリリースへ進めない **Quality Gate 方式**を採用する。

| 層 | カテゴリ | 実行フレームワーク | 主な検証対象 | 合格ゲートタイミング |
| :---: | :--- | :--- | :--- | :--- |
| **①** | **単体テスト**<br>（Unit Tests） | `pytest`（Backend）<br>`Vitest`（Frontend） | 翼型座標生成・対称性、DAT前処理、Sutherland物性推算・$Re/M$、座標変換、JSON Schema、解説生成ロジック | Step 4-1, 4-4, 4-8 完了時 |
| **②** | **数値計算検証 V&V**<br>（Numerical V&V） | `pytest` + `NumPy/SciPy` | 円柱厳密解、NACA 0012 $\alpha=0^\circ$・$\pm\alpha$ 対称性、薄翼理論 $2\pi$・翼厚補正・キャンバー翼理論比較、Kutta条件、$C_L$ クロスチェック、パネル収束性、流線RK4、再現性 | **Step 4-3 V&Vゲート**（API/UI結合前の必須関門） |
| **③** | **異常系・非収束検証**<br>（Negative / Fault Tests） | `pytest` + `FastAPI TestClient`<br>`React Testing Library` | 負の流速/弦長/物性・過大迎角・自己交差DATの `422` 遮断、非収束 `status="failed"` 時の描画抑止、未実装ソルバー `501` | Step 4-4, 4-10 完了時 |
| **④** | **モード一致・統合・UI安全検証**<br>（Integration & UI Guards） | `pytest` + `Vitest` + `Playwright` | 簡易モード⇔本格モード100%結果一致、必須6 API連携、`cd: null`（`0`表示禁止）、統一警告6種、同着理論排除、JSON/CSV入出力 | **Step 4-10 最終品質ゲート** |

### 標準基準計算条件（特記なき場合の基本テスト条件）

数値検証（カテゴリ②〜④）で「標準流れ条件」と記す場合は、以下の SI 単位パラメータを使用する：
- 風速 `velocity`: $V_\infty = 15.0\;\mathrm{m/s}$
- 翼弦長 `chord_length`: $c = 0.20\;\mathrm{m}$
- 流体条件 `fluid_properties`: `preset = "air_std_20c"`, `mode = "temperature_auto"`, $T = 293.15\;\mathrm{K}$ ($20^\circ\mathrm{C}$), $p_\infty = 101325.0\;\mathrm{Pa}$
  （このとき $\rho = 1.204085\;\mathrm{kg/m^3},\; \mu = 1.813322\times 10^{-5}\;\mathrm{Pa\cdot s},\; Re = 1.992064\times 10^5,\; M = 0.0437016$）
- 数値設定 `numerical_settings`: `num_panels = 160`, `closed_te = true`, `grid_nx = 120`, `grid_ny = 80`, `x_range = [-0.5, 1.6]`, `y_range = [-0.7, 0.7]`, `num_streamlines = 28`

---

## 2. 必須品質検証項目トレーサビリティマトリクス（指示書第8章＋円柱厳密解）

開発指示書 第8章の必須品質検証11項目および円柱周りポテンシャル流厳密解テストと、本計画書のテストIDとの対応関係を以下に示す（漏れゼロを保証）。

| 項番 | 必須品質検証項目 | 対応テストID | 実装テストファイル（`TASK_PLAN.md` 準拠） |
| :---: | :--- | :--- | :--- |
| **追加** | **円柱周りポテンシャル流れ厳密解 $C_p(\theta)=1-4\sin^2\theta$ との定量比較** | `VV-NUM-01` | `tests/numerical/test_cylinder_potential.py` |
| **1** | **翼型座標生成の正確性と NACA 0012 上下対称性の確認** | `UT-GEOM-01`, `UT-GEOM-02`, `UT-GEOM-03` | `tests/unit/test_geometry.py` |
| **2** | **NACA 0012・迎角 $\alpha = 0^\circ$ で $C_L \approx 0$、$C_{m,c/4} \approx 0$、上下 $C_p$ 対称となること** | `VV-NUM-02` | `tests/numerical/test_naca_symmetry.py` |
| **3** | **対称翼（NACA 0012）の正負迎角（$\pm\alpha$）で $C_L$ が符号反転（反対称）すること** | `VV-NUM-03` | `tests/numerical/test_naca_symmetry.py` |
| **4** | **薄翼理論（揚力傾斜 $2\pi\;\mathrm{rad}^{-1}$・翼厚補正）との整合確認** | `VV-NUM-04` | `tests/numerical/test_thin_airfoil_theory.py` |
| **5** | **キャンバー翼（NACA 2412 / 4412 / 6412）のゼロ揚力迎角・$\alpha=0^\circ$ 正揚力・$C_{m,c/4}$ 確認** | `VV-NUM-05` | `tests/numerical/test_thin_airfoil_theory.py` |
| **6** | **Kutta条件の成立と $C_L$ 2手法（Kutta-Joukowski vs 圧力積分）の一致確認** | `VV-NUM-06` | `tests/numerical/test_kutta_and_convergence.py` |
| **7** | **パネル数変更時（$N = 60, 120, 160, 240$）の解の収束性確認** | `VV-NUM-07` | `tests/numerical/test_kutta_and_convergence.py` |
| **8** | **同一条件における計算結果の再現性（および流線・速度場の物理的整合性）** | `VV-NUM-08`, `VV-NUM-09` | `tests/numerical/test_streamlines.py`<br>`tests/unit/test_fluid_and_velocity_field.py` |
| **9** | **異常入力（負の流速・弦長・物性、範囲外値、不正DAT）に対する適切なエラー応答** | `ERR-VAL-01`, `ERR-VAL-02` | `tests/unit/test_api_contracts.py`<br>`tests/integration/test_abnormal_and_nonconvergence.py` |
| **10** | **非収束・数値破綻時に正常結果として誤描画しない遮断動作** | `ERR-SOL-01`, `ERR-SOL-02` | `tests/numerical/test_solver_failure_guards.py`<br>`frontend/tests/integration/safetyGuards.test.tsx` |
| **11** | **簡易モードと本格モードの同一条件結果一致 ＋ UI安全ガード（`cd: null`・高迎角警告・同着理論排除・入出力）** | `INT-MODE-01`, `INT-API-01`, `INT-SAFE-01`〜`03`, `INT-IO-01` | `tests/integration/test_api_end_to_end.py`<br>`tests/integration/test_mode_consistency_api.py`<br>`frontend/tests/integration/modeConsistency.test.tsx` |

---

## 3. カテゴリ①：単体テスト計画（Unit Tests）

### `UT-GEOM-01`：NACA 0012 座標生成精度・上下対称性・後縁閉合検証
- **対象モジュール**: `backend/app/geometry/naca4.py`
- **計算条件**:
  1. `naca_code = "0012"`, `num_panels = 160`, `closed_te = True`
  2. `naca_code = "0012"`, `num_panels = 160`, `closed_te = False`
- **期待値 / 理論解**:
  - 節点数 $= 161$、前縁節点インデックス $k = 81$（0始まり `80`）で $(\hat{X}_{81}, \hat{Y}_{81}) = (0.0, 0.0)$。
  - 上下対応節点 $k$ と $N+2-k$（$k=1,\dots,80$）に対し $\hat{X}_k = \hat{X}_{N+2-k}$ かつ $\hat{Y}_k = -\hat{Y}_{N+2-k}$。
  - 最大厚み：$\xi = 0.30$ 付近で $\max(\hat{y}_U - \hat{y}_L) = 0.12$。
  - 後縁ギャップ：`closed_te = True` のとき $(\hat{X}_1, \hat{Y}_1) = (\hat{X}_{161}, \hat{Y}_{161}) = (1.0, 0.0)$；`closed_te = False` のとき $\hat{Y}_{161} = -\hat{Y}_1 = +0.0105 \times 0.12 = +0.00126$。
- **定量合格基準**:
  - 上下対称誤差：$\max_k |\hat{X}_k - \hat{X}_{N+2-k}| \le 10^{-15}$、$\max_k |\hat{Y}_k + \hat{Y}_{N+2-k}| \le 10^{-15}$
  - 閉後縁座標誤差：$|\hat{Y}_1| \le 10^{-15},\; |\hat{Y}_{161}| \le 10^{-15},\; |\hat{X}_1 - 1.0| \le 10^{-15}$
  - 最大翼厚比誤差：$|\max(\hat{y}_U - \hat{y}_L) - 0.12| \le 5\times 10^{-4}$（離散コサイン点上）

### `UT-GEOM-02`：NACA 2412 / 4412 / 6412 キャンバー幾何・時計回り法線ベクトル検証
- **対象モジュール**: `backend/app/geometry/naca4.py`, `backend/app/geometry/paneling.py`
- **計算条件**: `naca_code` $\in \{\texttt{"2412"}, \texttt{"4412"}, \texttt{"6412"}\}$, `num_panels = 160`, `closed_te = True`
- **期待値 / 理論解**:
  - $\xi = p = 0.4$ におけるキャンバー高さ $y_c(0.4) = m \in \{0.02, 0.04, 0.06\}$、勾配 $dy_c/d\xi(0.4) = 0$。
  - パネル進行方向が時計回りであり、閉多角形の符号付き面積 $A_{\mathrm{signed}} = \frac{1}{2}\sum_{i=1}^N (\hat{X}_i \hat{Y}_{i+1} - \hat{X}_{i+1} \hat{Y}_i) < 0$（時計回り負面積）。
  - 全パネル $i = 1, \dots, N$ で $\|\mathbf{t}_i\|_2 = 1$, $\|\mathbf{n}_i\|_2 = 1$, $\mathbf{t}_i \cdot \mathbf{n}_i = 0$, $\det[\mathbf{t}_i, \mathbf{n}_i] = +1$、かつ外向き微小オフセット点 $(\hat{x}_{c,i}, \hat{y}_{c,i}) + 10^{-4}\mathbf{n}_i$ が翼外部（`is_inside == False`）となること。
- **定量合格基準**:
  - キャンバーピーク誤差：$|y_c(0.4) - m| \le 10^{-15}$
  - 正規直交性誤差：$\max_i |\|\mathbf{n}_i\|_2 - 1| \le 10^{-15}$、$\max_i |\mathbf{t}_i \cdot \mathbf{n}_i| \le 10^{-15}$
  - 外向き判定：全 $160$ パネルで外部判定 $100\%$ 一致

### `UT-GEOM-03`：カスタム翼型（Selig / Lednicer DAT・CSV）前処理・再パネル化検証
- **対象モジュール**: `backend/app/geometry/airfoil_io.py`
- **計算条件**:
  - NACA 2412 の座標を ① Selig 形式（反時計回り61点、開後縁）、② Lednicer 形式（上下各31点ブロック、ヘッダ付き）、③ 弦長 $250\,\mathrm{mm}$・取付角 $+3^\circ$ 回転・原点オフセット付き CSV に変換して入力し、`num_panels = 160`, `closed_te = True` で生成。
- **期待値 / 理論解**:
  - ①②③すべてが時計回り $160$ パネル・前縁 $(0,0)$・後縁 $(1,0)$ に正規化され、解析式から直接生成した NACA 2412 パネル座標と一致する。
- **定量合格基準**:
  - 正規化後の後縁座標誤差：$\|\mathbf{P}_{\mathrm{TE}} - (1, 0)\|_2 \le 10^{-12}$
  - スプライン再パネル化座標と解析座標の最大差：$\max_j \|\hat{\mathbf{X}}_j^{\mathrm{DAT}} - \hat{\mathbf{X}}_j^{\mathrm{exact}}\|_2 \le 1.5\times 10^{-3}$

### `UT-PHYS-01`：流体物性推算（Sutherland則・プリセット・直接指定）と $Re, M$ 算出検証
- **対象モジュール**: `backend/app/services/fluid_properties.py`
- **計算条件**:
  1. `air_std_20c` ($T = 293.15\;\mathrm{K}, p_\infty = 101325\;\mathrm{Pa}$), $V_\infty = 15.0\;\mathrm{m/s}, c = 0.20\;\mathrm{m}$
  2. `air_0c` ($T = 273.15\;\mathrm{K}, p_\infty = 101325\;\mathrm{Pa}$), $V_\infty = 15.0\;\mathrm{m/s}, c = 0.20\;\mathrm{m}$
  3. `water_20c`, $V_\infty = 2.0\;\mathrm{m/s}, c = 0.10\;\mathrm{m}$
  4. `direct_mu` ($\rho = 1.225\;\mathrm{kg/m^3}, \mu = 1.7894\times 10^{-5}\;\mathrm{Pa\cdot s}, T = 288.15\;\mathrm{K}$: ISA海面上標準大気), $V_\infty = 34.0297\;\mathrm{m/s}, c = 1.0\;\mathrm{m}$
- **期待値 / 理論解（$R_{\mathrm{air}} = 287.058\;\mathrm{J/(kg\cdot K)},\; \gamma_{\mathrm{air}} = 1.4$ による定義式厳密値）**:
  1. $\rho = 1.204085\;\mathrm{kg/m^3}$, $\mu = 1.813322\times 10^{-5}\;\mathrm{Pa\cdot s}$, $a = 343.2368\;\mathrm{m/s}$, $Re = 1.992064\times 10^5$, $M = 0.0437016$
  2. $\rho = 1.292252\;\mathrm{kg/m^3}$, $\mu = 1.716000\times 10^{-5}\;\mathrm{Pa\cdot s}$ (基準温度 $T_0$ で厳密に $\mu_0$), $a = 331.3238\;\mathrm{m/s}$
  3. $\rho = 998.2\;\mathrm{kg/m^3}$, $\mu = 1.002\times 10^{-3}\;\mathrm{Pa\cdot s}$, $Re = 1.992415\times 10^5$, $M = 0.00134953$
  4. $Re = 2.329629\times 10^6$, $a = 340.2970\;\mathrm{m/s}$, $M = 0.100000$
- **定量合格基準**:
  - すべての物性値・$Re$・$M$ について定義式倍精度計算値との相対誤差 $\le 10^{-12}$（上記の有効6桁印字値に対しては相対差 $\le 10^{-5}$）

### `UT-SCHEMA-01`：APIリクエスト7キー・レスポンス JSON Schema 契約検証
- **対象モジュール**: `contracts/schemas/*.json`, `backend/app/models/api_schemas.py`
- **計算条件**: 正常リクエストサンプル（簡易モード相当・本格モード相当・カスタムDAT相当）およびキー欠損/余剰キー混入サンプルを JSON Schema (Draft 2020-12) と Pydantic v2 の双方で検証。
- **期待値 / 理論解**: トップレベル7キー（`airfoil`, `angle_of_attack`, `velocity`, `chord_length`, `fluid_properties`, `solver`, `numerical_settings`）が100%一致し、両バリデータの合否判定が完全一致する。
- **定量合格基準**: 全テストケースで Schema / Pydantic 判定不一致 $0$ 件。

### `UT-FE-01`：フロントエンド座標変換・解説エンジン・シリアライザ単体検証
- **対象モジュール**: `frontend/src/utils/{coordTransform.ts, explanationEngine.ts, csvExporter.ts, jsonSerializer.ts}`
- **計算条件**:
  - 任意のキャンバスサイズ（例 `960x540`, `375x300`）・ズーム倍率・パン量・風洞視点回転角 $\alpha = +8^\circ$ での `worldToScreen` $\leftrightarrow$ `screenToWorld` 往復変換。
  - NACA 0012 ($\alpha=0^\circ, 5^\circ$)・NACA 4412 ($\alpha=0^\circ, 14^\circ$) の解析結果を入力した `explanationEngine` 出力テキスト検査。
- **期待値 / 理論解**:
  - $x$ 方向と $y$ 方向の1単位長あたりピクセル数が等しく（等方スケーリング 1:1）、往復変換で元座標に戻る。
  - 生成解説文に入力実数値（$C_L, C_{p,\min}, x/c, Re$）が含まれ、かつ禁止表現（「同時に到達」「同時に着く」「道のりが長いから速く」等の肯定主張）が一切含まれない。
- **定量合格基準**:
  - 座標往復誤差：$\|\mathbf{x}_{\mathrm{roundtrip}} - \mathbf{x}\|_2 \le 10^{-10}$、アスペクト比誤差 $|s_x / s_y - 1| \le 10^{-12}$
  - 禁止語検出テスト違反 $0$ 件

---

## 4. カテゴリ②：数値計算検証 V&V 計画（Numerical Verification & Validation）

> [!IMPORTANT]
> 本カテゴリの全テスト（`VV-NUM-01` 〜 `VV-NUM-09`）は **Phase 1 Step 4-3 の必須通過ゲート**であり、1項目でも不合格の場合は API・UI への組み込みを停止してソルバー数式・符号を修正する。

### `VV-NUM-01`：円柱周り一様ポテンシャル流れの厳密解比較テスト
- **対象モジュール**: `backend/app/solvers/panel/`（一定吹出しパネル積分カーネル検証、$\hat{\gamma} = 0$ 固定モード）
- **計算条件**:
  - 半径 $R = 0.5$（直径 $D = 1.0$）、中心 $(0.5, 0.0)$ の円周を時計回り等角 $N = 160$ パネルに離散化。
  - 迎角 $\alpha = 0^\circ$、循環なし（$\hat{\gamma} = 0$、$N \times N$ 吹出し連立系）。
- **期待値 / 理論解**:
  - 極角 $\theta$（前方よどみ点 $\theta = \pi$、頂点 $\theta = \pi/2$、後方よどみ点 $\theta = 0$）に対する2次元円柱ポテンシャル流の厳密解：
    $$\frac{|V_t(\theta)|}{V_\infty} = 2|\sin\theta|, \qquad C_{p,\mathrm{exact}}(\theta) = 1 - 4\sin^2\theta$$
    （前方・後方よどみ点で $C_p = +1.0$、上下頂点で $C_p = -3.0$、揚力係数 $C_{L,p} = 0$、圧力抗力係数 $C_{D,p} = 0$、吹出し総和 $\sum \hat{\sigma}_j \hat{S}_j = 0$。）
- **定量合格基準**:
  - 最大 $C_p$ 絶対誤差：$\max_{i=1,\dots,N} |C_{p,i} - C_{p,\mathrm{exact}}(\theta_i)| \le 0.010$
  - $C_p$ 二乗平均平方根（RMS）誤差：$\sqrt{\frac{1}{N}\sum_{i=1}^N (C_{p,i} - C_{p,\mathrm{exact}}(\theta_i))^2} \le 0.005$
  - 揚力・抗力・質量保存残差：$|C_{L,p}| \le 10^{-12}$、$|C_{D,p}| \le 10^{-12}$、$\left|\sum \hat{\sigma}_j \hat{S}_j\right| \le 10^{-12}$

### `VV-NUM-02`：NACA 0012 迎角 $\alpha = 0^\circ$ の対称性・ゼロ揚力検証
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**: NACA 0012、`closed_te = True`、`num_panels = 160`、迎角 $\alpha = 0.0^\circ$、標準流れ条件。
- **期待値 / 理論解**:
  - 対称翼の無迎角流れであるため、循環 $\Gamma = 0$、揚力係数 $C_{L,\mathrm{KJ}} = C_{L,p} = 0$、モーメント係数 $C_{m,c/4} = 0$。
  - 下面パネル $i$ と対応する上面パネル $N + 1 - i$（$i = 1, \dots, N/2$）で圧力係数 $C_{p,i} = C_{p,N+1-i}$、接線速度 $V_{t,i} = -V_{t,N+1-i}$。
- **定量合格基準**:
  - $|C_{L,\mathrm{KJ}}| \le 10^{-12}$、$|C_{L,p}| \le 10^{-12}$、$|C_{m,c/4}| \le 10^{-12}$
  - 上下表面 $C_p$ 非対称誤差：$\max_{1 \le i \le N/2} |C_{p,i} - C_{p,N+1-i}| \le 10^{-12}$

### `VV-NUM-03`：対称翼（NACA 0012）の正負迎角 $\pm\alpha$ 反対称性検証
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**: NACA 0012、`closed_te = True`、`num_panels = 160`、迎角ペア $\alpha = \pm 2.0^\circ,\; \pm 5.0^\circ,\; \pm 8.0^\circ$。
- **期待値 / 理論解**:
  - 任意の $\alpha > 0$ に対し $C_L(+\alpha) > 0$ かつ $C_L(-\alpha) = -C_L(+\alpha)$、$C_{m,c/4}(-\alpha) = -C_{m,c/4}(+\alpha)$。
  - $+\alpha$ の上面 $C_p$ 分布と $-\alpha$ の下面 $C_p$ 分布が厳密に一致：$C_{p,i}(+\alpha) = C_{p,N+1-i}(-\alpha)$。
- **定量合格基準**:
  - 全迎角ペアで $|C_{L,\mathrm{KJ}}(+\alpha) + C_{L,\mathrm{KJ}}(-\alpha)| \le 10^{-12}$
  - 全迎角ペアで $|C_{m,c/4}(+\alpha) + C_{m,c/4}(-\alpha)| \le 10^{-12}$
  - 表面圧力鏡像誤差：$\max_i |C_{p,i}(+\alpha) - C_{p,N+1-i}(-\alpha)| \le 10^{-12}$

### `VV-NUM-04`：薄翼理論（揚力傾斜 $2\pi$）および翼厚補正理論との定量比較
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**:
  1. 薄対称翼 **NACA 0004**（$t/c = 0.04$）、`num_panels = 200`、$\alpha \in \{-4^\circ, -2^\circ, 0^\circ, +2^\circ, +4^\circ\}$ の最小二乗揚力傾斜 $a_0 = dC_L / d\alpha$ [$\mathrm{rad}^{-1}$]。
  2. 標準対称翼 **NACA 0012**（$t/c = 0.12$）、`num_panels = 160`、$\alpha \in \{-4^\circ, -2^\circ, 0^\circ, +2^\circ, +4^\circ\}$ の揚力傾斜 $a_0$ および空力中心（$C_{m,c/4}$）。
- **期待値 / 理論解**:
  - Glauert 薄翼理論（$t/c \to 0$ 極限）：$a_{0,\mathrm{thin}} = 2\pi \approx 6.2832\;\mathrm{rad}^{-1}$（$= 0.10966\;\mathrm{deg}^{-1}$）。
  - 2次元ポテンシャル流の翼厚一次補正理論（Abbott & Von Doenhoff）：
    $$a_{0,\mathrm{thick}}(t/c) \approx 2\pi(1 + 0.77\,t/c)$$
    - NACA 0004 ($t/c = 0.04$)：$2\pi(1 + 0.0308) \approx 6.477\;\mathrm{rad}^{-1}$
    - NACA 0012 ($t/c = 0.12$)：$2\pi(1 + 0.0924) \approx 6.864\;\mathrm{rad}^{-1}$（Hess-Smith 理論収束値 $\approx 6.93\;\mathrm{rad}^{-1}$、$\alpha=5^\circ$ で $C_L \approx 0.604$）
- **定量合格基準**:
  - NACA 0004 揚力傾斜：$2\pi$ に対する相対差 $\frac{|a_0 - 2\pi|}{2\pi} \le 0.045$（$4.5\%$ 以内）、翼厚補正値 $6.477$ に対する相対差 $\le 0.015$（$1.5\%$ 以内）
  - NACA 0012 揚力傾斜：翼厚補正理論値 $6.864\;\mathrm{rad}^{-1}$ に対する相対差 $\le 0.020$（$2.0\%$ 以内）
  - NACA 0012 の小迎角 $|\alpha| \le 4^\circ$ における $|C_{m,c/4}| \le 0.010$（空力中心が $c/4$ 近傍にあること）

### `VV-NUM-05`：キャンバー翼（NACA 2412 / 4412 / 6412）のゼロ揚力迎角・正揚力・$C_{m,c/4}$ 検証
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**: NACA 2412, NACA 4412, NACA 6412（すべて $p = 0.4, t = 0.12$, `closed_te = True`, `num_panels = 160`）について、$\alpha = 0^\circ$ 解析および迎角スイープによるゼロ揚力迎角 $\alpha_{L=0}$ 探索を実施。
- **期待値 / 理論解（Glauert 薄翼理論厳密積分値：$p = 0.4$）**:
  - $\alpha_{L=0,\mathrm{thin}} = -103.86^\circ \times m$、$C_{L,\mathrm{thin}}(0^\circ) = -2\pi\alpha_{L=0,\mathrm{thin}}$、$C_{m,c/4,\mathrm{thin}} = -2.656 \times m$：
    | 翼型 | $\alpha_{L=0,\mathrm{thin}}$ | $C_{L,\mathrm{thin}}(0^\circ)$（翼厚補正値） | $C_{m,c/4,\mathrm{thin}}(0^\circ)$ |
    | :--- | :---: | :---: | :---: |
    | **NACA 2412** ($m=0.02$) | $-2.08^\circ$ | $+0.228$（$\approx +0.250$） | $-0.0531$ |
    | **NACA 4412** ($m=0.04$) | $-4.15^\circ$ | $+0.455$（$\approx +0.500$） | $-0.1062$ |
    | **NACA 6412** ($m=0.06$) | $-6.23^\circ$ | $+0.683$（$\approx +0.749$） | $-0.1594$ |
  - キャンバー増加に伴い $\alpha = 0^\circ$ の揚力 $C_L(0^\circ)$ が単調増加（$0 < C_L^{2412} < C_L^{4412} < C_L^{6412}$）し、頭下げモーメント $C_{m,c/4}(0^\circ) < 0$ の絶対値も単調増加すること。
- **定量合格基準**:
  - ゼロ揚力迎角誤差：各翼型で $|\alpha_{L=0,\mathrm{panel}} - \alpha_{L=0,\mathrm{thin}}| \le 0.25^\circ$（例：NACA 2412 で $[-2.33^\circ, -1.83^\circ]$）
  - ピッチングモーメント誤差：各翼型で $\frac{|C_{m,c/4,\mathrm{panel}}(0^\circ) - C_{m,c/4,\mathrm{thin}}|}{|C_{m,c/4,\mathrm{thin}}|} \le 0.08$（$8\%$ 以内、かつすべて負符号）
  - キャンバー比例単調性：$C_L^{6412}(0^\circ) > C_L^{4412}(0^\circ) > C_L^{2412}(0^\circ) > 0.20$

### `VV-NUM-06`：Kutta条件充足と $C_L$ 2手法（Kutta-Joukowski vs 圧力積分）クロスチェック検証
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**: プリセット4翼型（`0012`, `2412`, `4412`, `6412`）、`num_panels = 160`、`closed_te = True`、迎角 $\alpha = 5.0^\circ$。
- **期待値 / 理論解**:
  - 後縁下面パネル（$i=1$）と上面パネル（$i=N$）で $V_{t,1} + V_{t,N} = 0$ かつ $C_{p,1} = C_{p,N}$。
  - Kutta-Joukowski 揚力 $C_{L,\mathrm{KJ}}$ と表面圧力積分揚力 $C_{L,p}$ が高次の精度で一致し、診断用の圧力抗力方向離散誤差 $|C_{D,p}|$ が十分微小であること。
- **定量合格基準**:
  - 後縁圧力一致誤差：全4翼型で $|C_{p,1} - C_{p,N}| \le 10^{-10}$
  - $C_L$ クロスチェック相対差：全4翼型で $\frac{|C_{L,\mathrm{KJ}} - C_{L,p}|}{|C_{L,\mathrm{KJ}}|} \le 0.015$（$1.5\%$ 以内）
  - 圧力抗力方向離散誤差：`|diagnostics.cd_pressure_numerical_error| <= 0.005`（かつ `coefficients.cd is None`）

### `VV-NUM-07`：パネル数収束性テスト（Grid / Panel Convergence Study）
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`
- **計算条件**: NACA 2412、迎角 $\alpha = 5.0^\circ$、`closed_te = True`、パネル数を $N = 60,\; 120,\; 160,\; 240$ と段階的に細分化。
- **期待値 / 理論解**:
  - $N$ の増加に伴い $C_{L,\mathrm{KJ}}(N)$ および $C_{m,c/4}(N)$ が一定値へ滑らかに収束する。
  - $C_L$ クロスチェック差 $\Delta C_L(N) = |C_{L,\mathrm{KJ}}(N) - C_{L,p}(N)|$ および閉物体質量保存残差 $|\sum \hat{\sigma}_j \hat{S}_j|$ が減少する。
- **定量合格基準**:
  - 高解像度収束差：$\frac{|C_{L,\mathrm{KJ}}(240) - C_{L,\mathrm{KJ}}(160)|}{|C_{L,\mathrm{KJ}}(240)|} \le 0.003$（$0.3\%$ 以内）、かつ $\frac{|C_{L,\mathrm{KJ}}(240) - C_{L,\mathrm{KJ}}(120)|}{|C_{L,\mathrm{KJ}}(240)|} \le 0.005$（$0.5\%$ 以内）
  - クロスチェック差の単調減少：$\Delta C_L(240) < \Delta C_L(160) < \Delta C_L(120) < \Delta C_L(60)$

### `VV-NUM-08`：空間速度場・特異値ガード・流線 RK4 非貫通検証
- **対象モジュール**: `backend/app/visualization/{velocity_field.py, streamlines.py}`
- **計算条件**: NACA 2412、$\alpha = 6.0^\circ$、`num_panels = 160`、標準格子 `120 x 80`、流線 `28` 本。さらに意地悪ケースとしてパネル端節点から $10^{-9}c$ の極近傍評価点と翼内部評価点を直接入力。
- **期待値 / 理論解**:
  - 翼内部点（`is_inside_airfoil == True`）はすべて `u_ratio = v_ratio = speed_ratio = cp = None`。
  - 全外部格子点および極近傍テスト点で `NaN / Inf` が発生せず、局所速度比 `speed_ratio <= 22.38` かつ圧力係数が $-500.0 < C_p \le 1.0 + 10^{-6}$ の有界範囲に収まる。
  - 28本の全流線上のすべての点 $(\hat{x}_k, \hat{y}_k)$ が翼内部に侵入しない。
- **定量合格基準**:
  - 外部点 `NaN/Inf` 発生数：$0$ 点、かつ全外部評価点で `0.0 <= speed_ratio <= 22.38`, `-500.0 < cp <= 1.000001`
  - 流線構成点の翼内部侵入数：$0$ 点（全流線・全ステップで `is_inside_airfoil == False`）
  - 1回の全計算時間（ソルバー＋格子9,600点＋流線28本）：標準開発PC上で $\le 500\;\mathrm{ms}$（目標 $< 100\;\mathrm{ms}$）

### `VV-NUM-09`：計算結果の決定論的再現性と無次元相似性検証
- **対象モジュール**: `backend/app/services/analysis_service.py`
- **計算条件**:
  1. **再現性**: NACA 4412, $\alpha = 4.0^\circ$ の同一リクエストを連続5回実行。
  2. **無次元相似性**: 翼型・迎角（NACA 2412, $\alpha = 5.0^\circ$）を固定し、(A) 標準空気 $V_\infty = 10\;\mathrm{m/s}, c = 0.1\;\mathrm{m}$ と (B) 水 $V_\infty = 2\;\mathrm{m/s}, c = 0.5\;\mathrm{m}$ を実行。
- **期待値 / 理論解**:
  1. 乱数要素を含まない決定論的アルゴリズムであるため、`analysis_id`・`created_at`・`compute_time_ms` を除く全数値配列がビット単位または機械精度で完全一致する。
  2. Phase 1 ポテンシャル流の無次元解（`cl`, `cm_quarter_chord`, `surface.cp`, `flow_field.speed_ratio`）は (A) と (B) で完全一致し、`reynolds_number`, `mach_number` のみが物理条件に応じて変化する。
- **定量合格基準**:
  - 連続5回実行の最大差：$\max |\text{Run}_k - \text{Run}_1| = 0.0$（完全一致）
  - (A)(B) 間の無次元空力係数・表面 $C_p$ 差：$\le 10^{-14}$

---

## 5. カテゴリ③：異常入力・非収束時の挙動検証計画（Error & Non-convergence Tests）

### `ERR-VAL-01`：物理パラメータ異常入力に対する `422` 拒否検証
- **対象モジュール**: `POST /api/analysis/run`
- **計算条件（各異常ケースを個別に送信）**:
  - 風速：`velocity = 0`, `velocity = -10.0`, `velocity = NaN`
  - 翼弦長：`chord_length = 0`, `chord_length = -0.2`
  - 迎角：`angle_of_attack = 60.0`, `angle_of_attack = -50.0`
  - 流体物性：`temperature_k = 0`, `temperature_k = -273.15`, `density_kg_m3 = -1.2`, `dynamic_viscosity_pa_s = 0`, `kinematic_viscosity_m2_s = -1e-5`
- **期待値 / 理論解**: ソルバーが呼び出される前にバリデーション層で遮断され、HTTP `422 Unprocessable Entity` と統一エラーJSON `{ "error": { "code": "...", "message": "..." } }`（日本語説明付き）を返す。サーバークラッシュ（`500`）は絶対に起こさない。
- **定量合格基準**: 全ケースで HTTP ステータス `422`、かつ `500 Internal Server Error` 発生 $0$ 件。

### `ERR-VAL-02`：数値設定・翼型データ異常入力に対する `422` 拒否検証
- **対象モジュール**: `POST /api/airfoils/generate`, `POST /api/analysis/run`
- **計算条件**:
  - パネル数：`num_panels = 159`（奇数）、`num_panels = 20`（下限未満）、`num_panels = 500`（上限超過）
  - 流線本数：`num_streamlines = 0`, `num_streamlines = 200`
  - 不正NACAコード：`naca_code = "2012"`（$M \neq 0, P = 0$）、`"0412"`（$M = 0, P \neq 0$）、`"0000"`、`"ABCD"`
  - 不正カスタムDAT：① 空文字列、② 座標5点のみ、③ 8の字型に自己交差するポリゴン、④ 上面と下面が途中で逆転（$y_U < y_L$）したデータ
- **期待値 / 理論解**: すべて HTTP `422` と原因を特定できるエラーコード（`INVALID_NUM_PANELS`, `INVALID_AIRFOIL_GEOMETRY` 等）を返す。
- **定量合格基準**: 全ケースで HTTP `422` 応答 $100\%$。

### `ERR-SOL-01`：数値破綻・非収束時の `status: "failed"` 応答と UI 誤描画遮断検証
- **対象モジュール**: `backend/app/solvers/panel/hess_smith.py`, `frontend/src/visualization/`
- **計算条件**:
  1. バックエンド単体/統合：極端に縮退した行列（同一節点重複注入や `cond(M) > 1e10`・`NaN` 解を返すモック注入）でソルバー診断ゲートを実行。
  2. フロントエンド統合：正常な解析結果（例：NACA 2412, $\alpha=5^\circ$）を描画済みの状態から、`status: "failed", diagnostics: { converged: false }` のレスポンスを受信させる。
- **期待値 / 理論解**:
  - バックエンドは `status = "failed"`, `diagnostics.converged = false` を返し、不正確な `surface` / `flow_field` 配列を返却しない。
  - フロントエンドは**前回成功時の古い流線や $C_p$ グラフを残さず即座にクリア（非表示化）**し、エラー原因と対処方法を示すエラーオーバーレイのみを表示する。
- **定量合格基準**: 非収束時に古いグラフまたは異常数値が画面上に残存するケース $0$ 件。

### `ERR-SOL-02`：未実装ソルバー（`xfoil`, `cfd_su2`）指定時の `501` ガード検証
- **対象モジュール**: `POST /api/analysis/run`
- **計算条件**: `solver.method = "xfoil"` および `solver.method = "cfd_su2"` を API に直接 POST 送信。
- **期待値 / 理論解**: モック値やパネル法のすり替え結果を返すことなく、HTTP `501 Not Implemented`（`error.code = "SOLVER_NOT_IMPLEMENTED"`）を明確に返す。
- **定量合格基準**: 両ソルバーとも HTTP `501` 応答 $100\%$。

---

## 6. カテゴリ④：簡易/本格モード一致・API統合・UI安全ガード検証計画

### `INT-MODE-01`：簡易モードと本格モードの同一条件結果100%一致検証
- **対象モジュール**: `frontend/src/store/`, `frontend/src/modes/{simple,advanced}/`, `POST /api/analysis/run`
- **計算条件**:
  1. 簡易モードで「NACA 2412、迎角 $\alpha = 6.0^\circ$、風速 $20.0\;\mathrm{m/s}$、翼弦長 $0.25\;\mathrm{m}$、標準空気（20℃）」を設定して解析実行（結果 $R_{\mathrm{simple}}$）。
  2. そのままモード切替スイッチで「本格モード」へ切り替え、値を一切変更せず再度解析実行（結果 $R_{\mathrm{advanced}}$）。
  3. 本格モードでパネル数を `200` に変更して簡易モードへ戻した際、勝手に `160` へリセットされず「詳細設定適用中バッジ」が表示され、同一結果が維持されることを確認。
- **期待値 / 理論解**: 送信されるリクエスト7キーの全パラメータが同一であり、$R_{\mathrm{simple}}$ と $R_{\mathrm{advanced}}$ の $C_L, C_{m,c/4}, Re, M, C_p$ 配列・流線座標が完全一致する。
- **定量合格基準**: リクエストJSON差分 $0$ 項目、全出力数値の絶対差 $= 0.0$。

### `INT-API-01`：必須6エンドポイント統合ワークフロー検証
- **対象モジュール**: `backend/app/api/` 全ルート
- **計算条件**:
  1. `GET /api/health` $\to$ Phase 1 `panel_method` のみ `available: true` を確認。
  2. `GET /api/airfoils` $\to$ `0012`, `2412`, `4412`, `6412` の4プリセット取得確認。
  3. `POST /api/airfoils/generate` $\to$ NACA 4412 (`num_panels = 160`) の座標取得確認。
  4. `POST /api/analysis/run` $\to$ Case A ($\alpha = 0^\circ$) と Case B ($\alpha = 5^\circ$) を実行し `analysis_id` を取得。
  5. `GET /api/analysis/{analysis_id}` $\to$ 保存結果が `run` 応答と一致し、未知IDには `404` を返すことを確認。
  6. `POST /api/analysis/compare` $\to$ Case A と Case B の差分（`delta_cl > 0`, `delta_cd === null`）が正しく返ることを確認。
- **定量合格基準**: 全6エンドポイントが OpenAPI 3.1 スキーマ (`contracts/api/openapi.yaml`) に準拠して `200 OK`（未知IDは `404`）を返すこと。

### `INT-SAFE-01`：抗力係数 `cd: null` 厳格表示ガード検証
- **対象モジュール**: Backend ソルバー応答、KPI カード、2条件比較テーブル、CSV/JSON エクスポート
- **計算条件**: Phase 1 `panel_method` で任意の有効条件を実行し、API応答・画面DOM・出力CSVを検査。
- **期待値 / 理論解**:
  - API JSON：`coefficients.cd === null`（`0` や `0.0` でないこと）。
  - 本格モード UI：`0` や `0.000` と表示されず、`—（算出不可）` と非粘性モデルの理由説明が表示されること（簡易モードでは紛らわしい $C_D$ 数値枠を出さないか算出不可注記とすること）。
  - CSV ヘッダ：`# cd: N/A (inviscid potential flow)` 等と明記され数値 `0` を出力しないこと。
- **定量合格基準**: 全出力経路で `cd = 0` 誤表示 $0$ 件。

### `INT-SAFE-02`：統一警告コードの境界値発火・UIバナー表示検証
- **対象モジュール**: `backend/app/services/warnings.py`, `frontend/src/components/results/WarningBanner.tsx`
- **計算条件（境界値マトリクス）**:
  | ケース | 設定条件 | 期待される警告コード (`severity`) | 発火してはならないコード |
  | :---: | :--- | :--- | :--- |
  | A | NACA 0012, $\alpha = 10.0^\circ, V_\infty = 15\;\mathrm{m/s}, c = 0.2\;\mathrm{m}$ | なし | `HIGH_AOA_CAUTION`, `STALL_UNMODELED` |
  | B | NACA 0012, $\alpha = 11.0^\circ$（および $-11.0^\circ$） | `HIGH_AOA_CAUTION` (`warning`) | `STALL_UNMODELED` |
  | C | NACA 0012, $\alpha = 12.5^\circ$（および $-15.0^\circ$） | `STALL_UNMODELED` (`critical`) | `HIGH_AOA_CAUTION`（重複抑止） |
  | D | NACA 0012, $\alpha = 2^\circ, V_\infty = 120\;\mathrm{m/s}$ ($M \approx 0.35$) | `COMPRESSIBILITY_CAUTION` (`warning`) | `TRANSONIC_OUT_OF_RANGE` |
  | E | NACA 2412, $\alpha = 8^\circ, V_\infty = 200\;\mathrm{m/s}$ ($M \approx 0.58$, ただし局所 $V_{\max} > a$) | `TRANSONIC_OUT_OF_RANGE` (`critical`) | `COMPRESSIBILITY_CAUTION`（上位優先） |
  | F | NACA 0012, $\alpha = 4^\circ, V_\infty = 2.0\;\mathrm{m/s}, c = 0.05\;\mathrm{m}$ ($Re \approx 6.6\times 10^3$) | `LOW_RE_CAUTION` (`info`) | — |
- **定量合格基準**: A〜F 全6ケースで期待警告コード・重要度・UIバナー色分けが $100\%$ 一致。

### `INT-SAFE-03`：未実装ソルバー UI 無効化・物理表現ガード検証
- **対象モジュール**: `SolverSelector.tsx`, `AppHeader.tsx`, `EducationalExplanation.tsx`
- **計算条件**: 本格モード画面および簡易モード画面をレンダリングし DOM 要素と表示文言を検査。
- **期待値 / 理論解**:
  - `Phase 2: XFOIL` および `Phase 3: 2D CFD` の選択肢が `disabled` 属性を持ち選択不可であり、「開発予定」ラベルが付与されている。
  - 画面内のどこにもパネル法を指して「粘性CFD」と呼ぶテキストが存在しない。
  - ルールベース解説に `ルールベース解説` バッジが表示され、将来の AI 解説枠と明確に分離されている。
- **定量合格基準**: アサーション全項目 PASS。

### `INT-IO-01`：JSON 保存/再読込ラウンドトリップ ＆ 表面分布 CSV 出力検証
- **対象モジュール**: `jsonSerializer.ts`, `csvExporter.ts`, `backend/app/exporters/`
- **計算条件**: 本格モードで NACA 4412, $\alpha = 4.5^\circ, V_\infty = 18.0\;\mathrm{m/s}, c = 0.15\;\mathrm{m}, N = 200$ を実行し、`.airflow.json` と表面分布 `.csv` をエクスポート後、初期化したストアに `.airflow.json` を再読込して再解析。
- **期待値 / 理論解**:
  - JSON 再読込後の `AnalysisConfig` が保存前と完全一致し、再解析結果も一致する（不正スキーマJSON読込時はクラッシュせずエラー通知を出す）。
  - CSV ファイル先頭に `#` コメントメタデータ（アプリ名、非粘性パネル法明記、翼型、$\alpha, V_\infty, c, Re, M, C_L, C_{m,c/4}, C_D=\text{N/A}$）が存在し、データ行が `160`（または設定 `200`）行 × 6列（`index,side,x_c,y_c,cp,vt_over_vinf`）の有効な数値である。
- **定量合格基準**: ラウンドトリップ設定差 $0$ 件、CSV パースエラー $0$ 件・行数一致 $100\%$。

---

## 7. 自動テスト実行コマンドと品質ゲート（Done Gate）

環境セットアップ承認後、CI およびローカル検証では以下のコマンドで全テストを実行する。

```powershell
# 1. バックエンド単体テスト + 数値計算V&V + API統合テスト
cd c:\home\AirFlowLab
.\.venv\Scripts\python -m pytest tests/unit tests/numerical tests/integration -v --tb=short

# 2. 数値計算V&Vゲート単独実行（Step 4-3 ゲート判定用）
.\.venv\Scripts\python -m pytest tests/numerical -v

# 3. フロントエンド単体・コンポーネント統合テスト
cd c:\home\AirFlowLab\frontend
npm run test -- --run

# 4. E2E シナリオテスト（Playwright）
npm run test:e2e
```

### リリース・フェーズ完了判定基準（Done Gate）
1. カテゴリ①〜④の全必須テストケースが **PASS（失敗 `0` 件、スキップ `0` 件）** であること。
2. バックエンド `solvers/panel/` および `geometry/` のテスト行カバレッジが **$90\%$ 以上** であること。
3. 独立コンテキストの検証兵（`verifier`）が上記コマンドを実際に実行し、次章の結果記録テーブルを埋めて `OK` 承認を出していること。

---

## 8. 検証結果記録テンプレート（テストエビデンス台帳）

実装後の Step 4-3（V&Vゲート）および Step 4-10（統合品質ゲート）において、検証担当者（`verifier`）は以下のフォーマットで実測値と合否を記録する。

### 8.1 実行環境メタデータ記録欄

| 項目 | 記録内容（実測値） |
| :--- | :--- |
| **検証実施日時** | `2026-11-25 02:50 JST` |
| **検証担当者** | `verifier-2`（独立検証エージェント） / `coordinator` 統合確認 |
| **対象コミット / 版数** | `v0.1.0-phase1`（非Gitワークスペース） |
| **OS / Python / Node 環境** | `Windows 11 / Python 3.12.10 (NumPy 2.5.5, SciPy 1.18.1, FastAPI 0.165.0) / Node.js v26.13.1 (Vitest 2.1.9, Vite 6.4.6)` |
| **総合判定** | `[x] PASS（承認 OK）  /  [ ] FAIL（差し戻し）` |

> [!NOTE]
> `verifier-2` による独立検証にて、Backend 全テスト `pytest tests/unit tests/numerical tests/integration -v`（**117 passed, 0 failed, 0 skipped / 17.84s**）、Frontend `tsc --noEmit`（エラー 0件）、`vitest run`（**5 files / 14 tests passed / 1.57s**）、`vite build`（成功 / 10.42s / 1611 modules）、および実起動 Uvicorn サーバー（`127.0.0.1:8011`）での HTTP 疎通・安全原則チェックがすべて合格しました。

### 8.2 全テストケース結果記録サマリ表

| テストID | 検証項目概要 | 理論値 / 期待基準 | 実測値（記録欄） | 誤差 / 判定値 | 合否 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| `UT-GEOM-01` | NACA 0012 座標・上下対称・閉後縁 | 対称差 $\le 10^{-15}$, TE $(1,0)$ | `pytest` (`test_geometry.py`) にて基準内合格 | 基準内 (`117 passed` 内) | `[x]` | 閉後縁係数 `-0.1036` |
| `UT-GEOM-02` | NACA 2412/4412/6412・外向き法線 | $|y_c(0.4)-m|\le 10^{-15}$ | `pytest` (`test_geometry.py`) にて基準内合格 | 基準内 (`117 passed` 内) | `[x]` | 4プリセット座標生成 |
| `UT-GEOM-03` | Selig/Lednicer DAT・CSV正規化 | 最大座標差 $\le 1.5\times 10^{-3}$ | `pytest` (`test_geometry.py`) にて基準内合格 | 基準内 (`117 passed` 内) | `[x]` | 最大曲率探索・LE反り外挿適用済 |
| `UT-PHYS-01` | Sutherland物性・プリセット・$Re, M$ | 相対誤差 $\le 10^{-6}$ | `pytest` (`test_fluid_and_velocity_field.py`) 合格; ライブAPI `Re=1992064.31, M=0.087403` | 基準内 (`117 passed` 内) | `[x]` | `air_std_20c` (`V=30, c=1`) |
| `UT-SCHEMA-01` | リクエスト7キー・JSON Schema整合 | 不一致 $0$ 件 | `pytest` (`test_api_contracts.py` 28件) にて全件合格 | 不一致 `0` 件 | `[x]` | `Draft202012Validator` 含む |
| `UT-FE-01` | 座標変換1:1・同着理論禁止語検査 | 往復差 $\le 10^{-10}$ / 違反 $0$ 件 | `vitest` (`coordTransform.test.ts`, `explanationEngine.test.ts`) 合格 | 違反 `0` 件 (`14 passed` 内) | `[x]` | `verifier-2` によるコード検査合格 |
| `VV-NUM-01` | 円柱厳密解 $C_p(\theta)=1-4\sin^2\theta$ | $\max|\Delta C_p|\le 0.010$, RMS $\le 0.005$ | `max=0.000000`, `RMS=0.000000`, `C_L=0.000e+00`, `C_D=7.633e-17` | 質量残差 `8.604e-16` | `[x]` | $N=160, \hat{\gamma}=0$ |
| `VV-NUM-02` | NACA 0012 $\alpha=0^\circ$ 対称性 | $|C_L|, |C_m|, |\Delta C_p| \le 10^{-12}$ | `C_L=-1.547e-17`, `C_m=1.735e-18`, `max|\Delta C_p|=7.772e-16` | 全指標 $\le 10^{-15}$ | `[x]` | |
| `VV-NUM-03` | NACA 0012 $\pm\alpha$ 反対称性 | $|C_L(+\alpha)+C_L(-\alpha)| \le 10^{-12}$ | `\alpha=\pm 5°: C_L(+5)=0.605238, C_L(-5)=-0.605238` | `|和|=1.110e-16` | `[x]` | `\pm 2°, \pm 8°` も `pytest` 合格 |
| `VV-NUM-04` | 薄翼理論 $2\pi$・0012翼厚補正 | 0004差 $\le 4.5\%$, 0012差 $\le 2.0\%$ | `0004: 6.5085`, `0012: 6.9395` | `0004` 差 `3.59%`, `0012` 差 `1.10%` | `[x]` | |
| `VV-NUM-05` | 2412/4412/6412 $\alpha_{L=0}, C_{m,c/4}$ | $|\Delta\alpha_{L=0}|\le 0.25^\circ$, $|\Delta C_m|\le 8\%$ | `2412: -2.141°/-0.05433`, `4412: -4.267°/-0.10841`, `6412: -6.366°/-0.16199` | 理論値範囲内 (`pytest` 合格) | `[x]` | |
| `VV-NUM-06` | Kutta条件 & $C_L$ クロスチェック | $|C_{p,1}-C_{p,N}|\le 10^{-10}$, 差 $\le 1.5\%$ | `2412: \Delta C_p=0.00e+00`, `4412: 4.44e-16`, `6412: 1.55e-15` | クロスチェック差 `0.783% / 0.968% / 1.093%` | `[x]` | `\alpha=5°` |
| `VV-NUM-07` | パネル数収束性 ($N=60..240$) | $\|C_L(240)-C_L(160)\|/C_L \le 0.3\%$ | `N=160: 0.863846`, `N=240: 0.863234` | 相対差約 `0.071%`（単調収束） | `[x]` | 下表 8.3 に詳細記録 |
| `VV-NUM-08` | 速度場特異値ガード・流線非貫通 | `NaN` $0$ 点 / 翼侵入 $0$ 点 | 全体パイプライン `393.09 ms`（流線 28本） | `NaN` `0` 点 / 侵入 `0` 点 | `[x]` | `test_streamlines.py` 合格 |
| `VV-NUM-09` | 5回再現性・無次元相似性 | Run間差 $0.0$ / 相似差 $\le 10^{-14}$ | `pytest` (`test_streamlines.py`) にて完全一致合格 | 基準内 (`117 passed` 内) | `[x]` | 決定論的計算・水/空気相似 |
| `ERR-VAL-01` | 異常物理量入力の `422` 遮断 | 全件 HTTP `422`（`500` ゼロ） | `pytest` (`test_api_contracts.py`, `test_abnormal_and_nonconvergence.py`) 合格 | `500` 応答 `0` 件 | `[x]` | |
| `ERR-VAL-02` | 異常数値設定・不正DATの `422` 遮断 | 全件 HTTP `422` | `pytest` (`test_api_contracts.py`, `test_abnormal_and_nonconvergence.py`) 合格 | 全件 HTTP `422` | `[x]` | |
| `ERR-SOL-01` | 非収束 `failed` 時の描画クリア | 誤描画残存 $0$ 件 | `pytest` + `vitest` (`safetyGuards.test.tsx`) 合格 | `verifier-2` 実装確認済 | `[x]` | `ErrorOverlay` + `status !== 'success'` 遮断 |
| `ERR-SOL-02` | 未実装ソルバー `501` 応答 | XFOIL/CFD とも HTTP `501` | `pytest` + ライブAPI `POST /api/analysis/run (xfoil)` -> `501` | `SOLVER_NOT_IMPLEMENTED` | `[x]` | |
| `INT-MODE-01` | 簡易モード ⇔ 本格モード結果一致 | ペイロード・全出力差 $= 0.0$ | `pytest` (`test_mode_consistency_api.py`) + `vitest` (`modeConsistency.test.tsx`) | 全出力一致 | `[x]` | 単一ストア・単一エンジン共有 |
| `INT-API-01` | 必須6エンドポイント統合連携 | OpenAPI 3.1 準拠 PASS | `pytest` (`test_api_end_to_end.py`) + ライブ Uvicorn 疎通 PASS | `health/airfoils/run/{id}/compare` すべて `200` | `[x]` | `compare` 差分 `0.258608` 確認 |
| `INT-SAFE-01` | `cd: null` ガード（`0` 表示禁止） | API/UI/CSV 全経路で `0` 誤表示 $0$ 件 | ライブAPI `cd: null`, UI `'—（算出不可）'`, CSV `# cd: N/A` | 誤表示 `0` 件 | `[x]` | `pytest` + `vitest` + 目視確認 |
| `INT-SAFE-02` | 統一警告6種の境界発火・UI表示 | ケースA〜F 判定 $100\%$ 一致 | `pytest` (`test_api_end_to_end.py`) + `vitest` (`safetyGuards.test.tsx`) | 全ケース一致 | `[x]` | |
| `INT-SAFE-03` | 未実装UI `disabled`・表現ガード | 違反 $0$ 件 | `SolverSettingsForm.tsx` L27-55 確認 + `vitest` 合格 | 違反 `0` 件 | `[x]` | XFOIL/CFD 選択不可 |
| `INT-IO-01` | JSON再読込一致・CSV出力検証 | ラウンドトリップ完全一致 | `pytest` (`test_exporters.py`, `test_api_end_to_end.py`) + `vitest` (`exportImport.test.ts`) | 全項目一致 | `[x]` | `.airflow.json` / CSV 6列確認 |

### 8.3 パネル収束性詳細記録テンプレート（`VV-NUM-07` 用：NACA 2412, $\alpha = 5.0^\circ$）

| パネル数 $N$ | $C_{L,\mathrm{KJ}}$ | $C_{L,p}$ | クロスチェック相対差 $\frac{\|C_{L,\mathrm{KJ}}-C_{L,p}\|}{\|C_{L,\mathrm{KJ}}\|}$ | $C_{m,c/4}$ | 質量保存残差 $\|\sum\hat{\sigma}_j\hat{S}_j\|$ | 条件数 $\kappa_2(M)$ | 計算時間 [ms] |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `60` | `0.865786` | `0.848330` | `2.016 %` | `-0.058590` | `1.84e-03` | `74.9` | `0.61` |
| `120` | `0.864374` | `0.855411` | `1.037 %` | `-0.060680` | `9.02e-04` | `104.9` | `2.84` |
| `160`（標準） | `0.863846` | `0.857081` | `0.783 %` | `-0.061194` | `6.73e-04` | `120.9` | `4.37` |
| `240` | `0.863234` | `0.858695` | `0.526 %` | `-0.061700` | `4.47e-04` | `148.0` | `10.92` |
