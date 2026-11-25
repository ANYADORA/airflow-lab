# AirFlow Lab API 仕様書（API_SPEC.md）

> **文書バージョン**: 1.0（Phase 1 実装開始前 統合設計確定版）  
> **Single Source of Truth**: [`contracts/api/openapi.yaml`](file:///c:/home/AirFlowLab/contracts/api/openapi.yaml)、[`contracts/schemas/analysis_request.schema.json`](file:///c:/home/AirFlowLab/contracts/schemas/analysis_request.schema.json)、[`contracts/schemas/analysis_response.schema.json`](file:///c:/home/AirFlowLab/contracts/schemas/analysis_response.schema.json)  
> **最終更新**: 2026-11-24

---

## 1. 共通通信規約

### 1-1. 基本仕様
- **ベースパス**: `/api`
- **データ形式**: `application/json; charset=utf-8`
- **文字コード**: UTF-8
- **モード非依存原則**: 簡易モードと本格モードは完全に同一のエンドポイントおよび JSON スキーマを使用する。

### 1-2. 単位系規約（SI 単位統一）

| 物理量 | フィールド名例 | 単位 | 備考 |
| :--- | :--- | :--- | :--- |
| 迎角 $\alpha$ | `angle_of_attack` | `deg` | 角度のみ度数法（deg）を使用 |
| 一様流風速 $V_\infty$ | `velocity` | `m/s` | 正の実数 |
| 翼弦長 $c$ | `chord_length` | `m` | 正の実数 |
| 温度 $T$ | `temperature_k` | `K` | 絶対温度（20℃ = `293.15 K`） |
| 静圧 $p_\infty$ | `static_pressure_pa` | `Pa` | 標準大気圧 = `101325.0 Pa` |
| 密度 $\rho$ | `density_kg_m3` | `kg/m^3` | 正の実数 |
| 粘性係数 $\mu$ | `dynamic_viscosity_pa_s` | `Pa·s` | 正の実数 |
| 動粘性係数 $\nu$ | `kinematic_viscosity_m2_s` | `m^2/s` | 正の実数 |
| 音速 $a$ | `speed_of_sound_mps` | `m/s` | 正の実数 |
| 座標・流れ場座標 | `x_c`, `y_c`, `x_grid`, `y_grid` | 無次元 ($x/c, y/c$) | 前縁 $(0, 0)$、後縁 $(1, 0)$ |
| 空力係数・無次元数 | `cl`, `cd`, `cm_quarter_chord`, `cp`, `reynolds_number`, `mach_number` | 無次元 | $C_{m,c/4}$ は頭上げ（Nose-up）正 |

### 1-3. HTTP ステータスコード

| ステータスコード | 意味 | 主な発生条件 |
| :---: | :--- | :--- |
| `200 OK` | 成功 | 正常応答（※数値的非収束・破綻による `status: "failed"` も解析診断レスポンスとして `200` で返却し、UI側で描画を遮断する） |
| `400 Bad Request` | リクエスト不正 | JSON パース失敗、構文不正 |
| `404 Not Found` | リソース未存在 | 指定された `analysis_id` が存在しない |
| `422 Unprocessable Entity` | バリデーションエラー | 範囲外の数値（$V_\infty \le 0$、奇数パネル数、$|\alpha| > 45^\circ$）、不正な NACA コード、自己交差 DAT 座標 |
| `501 Not Implemented` | 未実装機能 | Phase 2/3 予定のソルバー（`xfoil`, `cfd_su2`）を指定した場合 |
| `500 Internal Server Error` | サーバー内部エラー | 予期しない例外 |

### 1-4. 統一エラーレスポンス形式（`4xx` / `5xx` 共通）

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "num_panels は 40 以上 300 以下の偶数で指定してください。",
    "details": {
      "field": "numerical_settings.num_panels",
      "value": 155
    }
  }
}
```

### 1-5. 統一警告コード（`warnings[]`）

| `code` | `severity` | 発火条件 | 教育的メッセージ概要 |
| :--- | :---: | :--- | :--- |
| `HIGH_AOA_CAUTION` | `warning` | $10^\circ < |\alpha| \le 12^\circ$ | 剥離開始域の注意。実際の翼では後縁側から剥離が始まり、パネル法の $C_L$ は過大評価の傾向。 |
| `STALL_UNMODELED` | `critical` | $|\alpha| > 12^\circ$ | 失速（ストール）未考慮の強い警告。パネル法は失速を予測できないため、現実の流れと大きく異なる。 |
| `COMPRESSIBILITY_CAUTION` | `warning` | $0.3 \le M < 0.7$ | 圧縮性の影響が増大する速度域。非圧縮近似の誤差が大きくなる。 |
| `TRANSONIC_OUT_OF_RANGE` | `critical` | $M \ge 0.7$ または $V_{\max} \ge a$ | 遷音速・衝撃波領域のため、非圧縮パネル法の適用範囲外。 |
| `LOW_RE_CAUTION` | `info` | $Re < 5 \times 10^4$ | 低レイノルズ数域のため、層流剥離泡などの粘性影響が強く理想流体解との差が大きくなる。 |
| `CL_CROSSCHECK_WARN` | `warning` | `cl_discrepancy` 相対差 $> 5\%$（小揚力 $|C_L| < 0.2$ 時は絶対差 $> 0.01$） | Kutta-Joukowski 法と表面圧力積分法の $C_L$ 差が大きい。パネル数の増加を推奨。 |
| `CUSTOM_AIRFOIL_NORMALIZED` | `info` | カスタム DAT/CSV の弦長または取付角を正規化補正した場合 | 前縁 $(0,0)$・後縁 $(1,0)$ への正規化時に適用した元弦長 $c_{\mathrm{raw}}$ と回転補正角 $\psi_0$ [deg] を案内。 |
| `OPEN_TE_CLOSED_AUTO` | `info` | カスタム DAT/CSV の開後縁（$|\Delta\hat{y}_{\mathrm{TE}}| > 10^{-5}$）を `closed_te=true` で線形ブレンド閉合した場合 | パネル法の数値安定性のため後縁ギャップを滑らかに閉合した旨を案内。 |

---

## 2. 必須 6 エンドポイント詳細仕様

### 2-1. `GET /api/health`
API サーバーの稼働状態と、各フェーズのソルバー利用可否を返す。

#### レスポンス（`200 OK`）
```json
{
  "status": "ok",
  "version": "0.1.0",
  "solvers": [
    {
      "method": "panel_method",
      "label": "パネル法（2D 非粘性・非圧縮）",
      "available": true,
      "phase": 1,
      "supports_cd": false,
      "description": "Hess-Smith 2D ポテンシャル流れパネル法。粘性抗力・失速は計算不可。"
    },
    {
      "method": "xfoil",
      "label": "XFOIL（2D 粘性境界層連成）",
      "available": false,
      "phase": 2,
      "supports_cd": true,
      "description": "Phase 2 で実装予定（現在利用不可）。"
    },
    {
      "method": "cfd_su2",
      "label": "2D CFD（SU2 / RANS）",
      "available": false,
      "phase": 3,
      "supports_cd": true,
      "description": "Phase 3 で実装予定（現在利用不可）。"
    }
  ]
}
```

---

### 2-2. `GET /api/airfoils`
簡易モードおよび本格モードで利用可能な標準プリセット翼型（NACA 0012 / 2412 / 4412 / 6412）の一覧とプレビュー座標を返す。

#### レスポンス（`200 OK`）
```json
{
  "presets": [
    {
      "id": "naca0012",
      "name": "NACA 0012",
      "naca_code": "0012",
      "is_symmetric": true,
      "max_thickness_ratio": 0.12,
      "max_camber_ratio": 0.0,
      "max_camber_pos": 0.0,
      "description": "代表的な対称翼型（厚さ12%）。迎角0°で揚力0となり、対称性の学習に最適。",
      "preview_coords": {
        "x": [1.0, 0.95, 0.5, 0.0, 0.5, 0.95, 1.0],
        "y": [0.0, -0.008, -0.053, 0.0, 0.053, 0.008, 0.0]
      }
    },
    {
      "id": "naca2412",
      "name": "NACA 2412",
      "naca_code": "2412",
      "is_symmetric": false,
      "max_thickness_ratio": 0.12,
      "max_camber_ratio": 0.02,
      "max_camber_pos": 0.4,
      "description": "軽航空機で広く使われる標準キャンバー翼（最大反り2%、位置40%、厚さ12%）。",
      "preview_coords": {
        "x": [1.0, 0.5, 0.0, 0.5, 1.0],
        "y": [0.0, -0.034, 0.0, 0.072, 0.0]
      }
    }
  ]
}
```
※実際には `naca0012`, `naca2412`, `naca4412`, `naca6412` の 4 件を返却する。

---

### 2-3. `POST /api/airfoils/generate`
NACA 4桁コードまたはカスタム DAT/CSV テキストから、正規化・再パネル化済みの翼型座標および幾何特性を生成して返す（本格モードの座標プレビュー・テーブル表示・DAT 検証用）。

#### リクエストボディ

| フィールド | 型 | 必須 | デフォルト | 制約・説明 |
| :--- | :--- | :---: | :---: | :--- |
| `source_type` | `string` | 必須 | — | `"naca4"` \| `"custom_dat"` \| `"custom_csv"` |
| `naca_code` | `string \| null` | 条件付必須 | `null` | `source_type="naca4"` 時必須。4桁数字 `^[0-9]{4}$` |
| `name` | `string \| null` | 任意 | `null` | 任意表示名（カスタム翼型用） |
| `raw_coordinates_text` | `string \| null` | 条件付必須 | `null` | `custom_dat` / `custom_csv` 時必須。Selig/Lednicer 形式テキスト |
| `num_panels` | `integer` | 任意 | `160` | `40`〜`300` の偶数（`multipleOf: 2`） |
| `closed_te` | `boolean` | 任意 | `true` | `true`: 閉後縁 ($a_4=-0.1036$)、`false`: 開後縁 ($a_4=-0.1015$) |

#### レスポンス（`200 OK`）
```json
{
  "name": "NACA 2412",
  "coordinates": {
    "x": [1.0, 0.9996, 0.9984, 0.0, 0.9984, 0.9996, 1.0],
    "y": [0.0, -0.0001, -0.0003, 0.0, 0.0005, 0.0002, 0.0]
  },
  "geometry": {
    "num_panels": 160,
    "max_thickness_ratio": 0.1200,
    "max_camber_ratio": 0.0200,
    "max_camber_pos": 0.4000,
    "is_symmetric": false,
    "is_closed_te": true
  },
  "warnings": []
}
```
※自己交差・点数不足・パース不能な DAT/CSV が入力された場合は `422 Unprocessable Entity`（統一エラー形式）を返す。

---

### 2-4. `POST /api/analysis/run`
2次元翼型周りの流れ解析を実行し、空力係数・診断情報・表面 $C_p$ 分布・空間流れ場・流線・警告を返す中核エンドポイント。

#### リクエストボディ（必須 7 キー完全準拠）

| トップレベルキー | 型 | 必須 | 説明 |
| :--- | :--- | :---: | :--- |
| `airfoil` | `object` | 必須 | 翼型指定（`source_type`, `naca_code?`, `name?`, `raw_coordinates_text?`） |
| `angle_of_attack` | `number` | 必須 | 迎角 $\alpha$ [deg]。範囲 `[-45.0, 45.0]` |
| `velocity` | `number` | 必須 | 一様流風速 $V_\infty$ [m/s]。範囲 `[0.01, 1000.0]` |
| `chord_length` | `number` | 必須 | 翼弦長 $c$ [m]。範囲 `[0.0001, 100.0]` |
| `fluid_properties` | `object` | 必須 | 流体物性設定（`preset?`［`"water_20c"` は最優先］, `mode`, `temperature_k`［`50.0`〜`2000.0`］, `static_pressure_pa?`, `density_kg_m3?`, `dynamic_viscosity_pa_s?`, `kinematic_viscosity_m2_s?`, `speed_of_sound_mps?`［直接入力で $\rho > 10$ の液体相当時は必須］） |
| `solver` | `object` | 必須 | 計算手法指定（`method`: `"panel_method"` \| `"xfoil"` \| `"cfd_su2"`） |
| `numerical_settings` | `object` | 必須 | 数値設定（`num_panels`［`40`〜`300` 偶数］, `closed_te`, `grid_nx`［`40`〜`240`］, `grid_ny`［`30`〜`180`］, `x_range` / `y_range`［`[-5.0, 5.0]` 内］, `num_streamlines`［`10`〜`60`］） |

##### リクエストサンプル
```json
{
  "airfoil": {
    "source_type": "naca4",
    "naca_code": "2412",
    "name": "NACA 2412",
    "raw_coordinates_text": null
  },
  "angle_of_attack": 4.0,
  "velocity": 15.0,
  "chord_length": 0.2,
  "fluid_properties": {
    "preset": "air_std_20c",
    "mode": "temperature_auto",
    "temperature_k": 293.15,
    "static_pressure_pa": 101325.0,
    "density_kg_m3": null,
    "dynamic_viscosity_pa_s": null,
    "kinematic_viscosity_m2_s": null,
    "speed_of_sound_mps": null
  },
  "solver": {
    "method": "panel_method"
  },
  "numerical_settings": {
    "num_panels": 160,
    "closed_te": true,
    "grid_nx": 120,
    "grid_ny": 80,
    "x_range": [-0.5, 1.6],
    "y_range": [-0.7, 0.7],
    "num_streamlines": 28
  }
}
```

#### レスポンスフィールド定義（`200 OK`）

| フィールド | 型 | 必須 | `null` 条件・説明 |
| :--- | :--- | :---: | :--- |
| `analysis_id` | `string` (UUID) | 必須 | 解析結果の一意 ID（`GET /api/analysis/{id}` および `compare` で参照） |
| `created_at` | `string` (ISO 8601) | 必須 | 解析完了日時（UTC） |
| `status` | `string` | 必須 | `"success"` \| `"failed"` |
| `solver_info` | `object` | 必須 | `{ method, model_type, version, supports_cd }` |
| `inputs` | `object` | 必須 | 正規化後の実行時リクエスト（7キーのエコーバック） |
| `resolved_fluid` | `object` | 必須 | 実際に $Re, M$ 算出に使用した確定 SI 物性値（$\rho, \mu, \nu, T, p_\infty, a$） |
| `airfoil_geometry` | `object \| null` | 必須 | 生成済み翼型座標と幾何特性（形状生成失敗時のみ `null`） |
| `dimensionless` | `object` | 必須 | `{ reynolds_number, mach_number }` |
| `coefficients` | `object \| null` | 必須 | `status="failed"` 時は `null`。`cd` は Phase 1 で**常時 `null`**、`cd_unavailable_reason` に理由文字列を必須返却。 |
| `diagnostics` | `object` | 必須 | `converged`, `condition_number`, `linear_residual_max`, `te_cp_diff`, `cl_discrepancy`, `cl_discrepancy_relative`, `cd_pressure_numerical_error`, `cp_min`, `cp_min_xc`, `max_velocity_ratio`, `compute_time_ms` |
| `surface` | `object \| null` | 必須 | `status="failed"` 時は `null`。`x_c[]`, `y_c[]`, `side[]` (`"upper"`/`"lower"`), `cp[]`, `vt_ratio[]` |
| `flow_field` | `object \| null` | 必須 | `status="failed"` 時は `null`。`x_grid[]` (長さ `grid_nx` 昇順), `y_grid[]` (長さ `grid_ny` 昇順), および **2次元配列形状 `[grid_ny][grid_nx]`（外側添字が `y_grid`、内側添字が `x_grid`）** の `u_ratio[][]`, `v_ratio[][]`, `speed_ratio[][]`, `cp[][]`（翼内部セルは `null`）, `is_inside_airfoil[][]` |
| `streamlines` | `array \| null` | 必須 | `status="failed"` 時は `null`。`[{ x: number[], y: number[] }, ...]` |
| `warnings` | `array` | 必須 | 適用限界警告の配列（該当なしは `[]`） |
| `failure` | `object \| null` | 必須 | `status="success"` 時は `null`、`status="failed"` 時は `{ code, message, details }` |

##### 正常時レスポンスサンプル（`status: "success"`）
```json
{
  "analysis_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-11-24T12:10:00Z",
  "status": "success",
  "solver_info": {
    "method": "panel_method",
    "model_type": "inviscid_incompressible_potential",
    "version": "0.1.0",
    "supports_cd": false
  },
  "inputs": {
    "airfoil": {
      "source_type": "naca4",
      "naca_code": "2412",
      "name": "NACA 2412",
      "raw_coordinates_text": null
    },
    "angle_of_attack": 4.0,
    "velocity": 15.0,
    "chord_length": 0.2,
    "fluid_properties": {
      "preset": "air_std_20c",
      "mode": "temperature_auto",
      "temperature_k": 293.15,
      "static_pressure_pa": 101325.0,
      "density_kg_m3": null,
      "dynamic_viscosity_pa_s": null,
      "kinematic_viscosity_m2_s": null,
      "speed_of_sound_mps": null
    },
    "solver": {
      "method": "panel_method"
    },
    "numerical_settings": {
      "num_panels": 160,
      "closed_te": true,
      "grid_nx": 120,
      "grid_ny": 80,
      "x_range": [-0.5, 1.6],
      "y_range": [-0.7, 0.7],
      "num_streamlines": 28
    }
  },
  "resolved_fluid": {
    "density_kg_m3": 1.204085,
    "dynamic_viscosity_pa_s": 1.813322e-5,
    "kinematic_viscosity_m2_s": 1.505975e-5,
    "temperature_k": 293.15,
    "static_pressure_pa": 101325.0,
    "speed_of_sound_mps": 343.2368
  },
  "airfoil_geometry": {
    "name": "NACA 2412",
    "x": [1.0, 0.9996, 0.0, 0.9996, 1.0],
    "y": [0.0, -0.0001, 0.0, 0.0002, 0.0],
    "num_panels": 160,
    "max_thickness_ratio": 0.12,
    "max_camber_ratio": 0.02,
    "max_camber_pos": 0.4,
    "is_symmetric": false,
    "is_closed_te": true
  },
  "dimensionless": {
    "reynolds_number": 199206.4,
    "mach_number": 0.043702
  },
  "coefficients": {
    "cl": 0.7284,
    "cl_kutta_joukowski": 0.7284,
    "cl_pressure_integration": 0.7261,
    "cd": null,
    "cd_unavailable_reason": "非粘性ポテンシャル流れ（パネル法）では粘性抗力・剥離抗力を算出できません（Phase 2 XFOIL で対応予定）。",
    "cm_quarter_chord": -0.0531
  },
  "diagnostics": {
    "converged": true,
    "condition_number": 384.2,
    "linear_residual_max": 1.4e-14,
    "te_cp_diff": 2.1e-13,
    "cl_discrepancy": 0.0023,
    "cl_discrepancy_relative": 0.00316,
    "cd_pressure_numerical_error": 0.0004,
    "cp_min": -1.502,
    "cp_min_xc": 0.042,
    "max_velocity_ratio": 1.582,
    "compute_time_ms": 38.4
  },
  "surface": {
    "x_c": [0.9998, 0.5000, 0.0002, 0.5000, 0.9998],
    "y_c": [-0.00005, -0.0342, 0.0011, 0.0721, 0.00008],
    "side": ["lower", "lower", "upper", "upper", "upper"],
    "cp": [0.21, 0.14, 0.98, -0.62, 0.21],
    "vt_ratio": [-0.89, -0.93, 0.14, 1.27, 0.89]
  },
  "flow_field": {
    "x_grid": [-0.5, 0.55, 1.6],
    "y_grid": [-0.7, 0.7],
    "u_ratio": [[0.99, 1.02, 1.00], [1.01, 1.05, 1.00]],
    "v_ratio": [[0.06, 0.02, 0.05], [0.06, -0.03, 0.05]],
    "speed_ratio": [[0.992, 1.020, 1.001], [1.012, 1.050, 1.001]],
    "cp": [[0.016, -0.041, -0.002], [-0.024, -0.103, -0.002]],
    "is_inside_airfoil": [[false, false, false], [false, false, false]]
  },
  "streamlines": [
    {
      "x": [-0.5, -0.2, 0.1, 0.5, 1.0, 1.6],
      "y": [0.2, 0.22, 0.28, 0.31, 0.26, 0.24]
    }
  ],
  "warnings": [],
  "failure": null
}
```

##### 非収束・数値破綻時レスポンスサンプル（`status: "failed"`）
係数行列の条件数過大（`cond(M) > 1e10`）、線形残差超過（`> 1e-8`）、`NaN`/`Inf` 発生、または非物理的圧力発散（$\min C_p \le -500$ または $\max C_p > 1.0 + 10^{-6}$）が検出された場合、不正確なグラフ描画を防ぐため `coefficients`, `surface`, `flow_field`, `streamlines` をすべて `null` として返却する。

```json
{
  "analysis_id": "660e8400-e29b-41d4-a716-446655440099",
  "created_at": "2026-11-24T12:12:00Z",
  "status": "failed",
  "solver_info": {
    "method": "panel_method",
    "model_type": "inviscid_incompressible_potential",
    "version": "0.1.0",
    "supports_cd": false
  },
  "inputs": {
    "airfoil": {
      "source_type": "custom_dat",
      "naca_code": null,
      "name": "Degenerate Airfoil",
      "raw_coordinates_text": "..."
    },
    "angle_of_attack": 4.0,
    "velocity": 15.0,
    "chord_length": 0.2,
    "fluid_properties": {
      "preset": "air_std_20c",
      "mode": "temperature_auto",
      "temperature_k": 293.15,
      "static_pressure_pa": 101325.0,
      "density_kg_m3": null,
      "dynamic_viscosity_pa_s": null,
      "kinematic_viscosity_m2_s": null,
      "speed_of_sound_mps": null
    },
    "solver": {
      "method": "panel_method"
    },
    "numerical_settings": {
      "num_panels": 160,
      "closed_te": true,
      "grid_nx": 120,
      "grid_ny": 80,
      "x_range": [-0.5, 1.6],
      "y_range": [-0.7, 0.7],
      "num_streamlines": 28
    }
  },
  "resolved_fluid": {
    "density_kg_m3": 1.2041,
    "dynamic_viscosity_pa_s": 1.813e-5,
    "kinematic_viscosity_m2_s": 1.5057e-5,
    "temperature_k": 293.15,
    "static_pressure_pa": 101325.0,
    "speed_of_sound_mps": 343.21
  },
  "airfoil_geometry": null,
  "dimensionless": {
    "reynolds_number": 199206.4,
    "mach_number": 0.043702
  },
  "coefficients": null,
  "diagnostics": {
    "converged": false,
    "condition_number": 4.8e12,
    "linear_residual_max": 2.3e-3,
    "te_cp_diff": null,
    "cl_discrepancy": null,
    "cl_discrepancy_relative": null,
    "cd_pressure_numerical_error": null,
    "cp_min": null,
    "cp_min_xc": null,
    "max_velocity_ratio": null,
    "compute_time_ms": 14.2
  },
  "surface": null,
  "flow_field": null,
  "streamlines": null,
  "warnings": [],
  "failure": {
    "code": "ILL_CONDITIONED_MATRIX",
    "message": "パネル法の連立一次方程式の条件数が許容上限（1e10）を超えたため、解析を中断しました。後縁付近の座標重複や極端に薄い翼型になっていないか確認してください。",
    "details": {
      "condition_number": 4.8e12,
      "threshold": 1.0e10
    }
  }
}
```

##### 未実装ソルバー指定時レスポンス（`501 Not Implemented`）
`solver.method` に `"xfoil"` または `"cfd_su2"` を指定した場合：
```json
{
  "error": {
    "code": "SOLVER_NOT_IMPLEMENTED",
    "message": "ソルバー 'xfoil' は Phase 2 で実装予定です。Phase 1 では 'panel_method' を指定してください。",
    "details": {
      "requested_method": "xfoil",
      "available_methods": ["panel_method"]
    }
  }
}
```

---

### 2-5. `GET /api/analysis/{analysis_id}`
過去に実行し LRU インメモリキャッシュストア（標準最大保持 `50` 件）に保持されている解析結果を ID 指定で取得する。

- **パスパラメータ**: `analysis_id`（UUID 文字列、必須）
- **成功レスポンス（`200 OK`）**: `POST /api/analysis/run` と完全に同一のスキーマ。
- **未存在時（`404 Not Found`）**:
```json
{
  "error": {
    "code": "ANALYSIS_NOT_FOUND",
    "message": "指定された analysis_id の解析結果が見つかりません。",
    "details": {
      "analysis_id": "00000000-0000-0000-0000-000000000000"
    }
  }
}
```

---

### 2-6. `POST /api/analysis/compare`
2つの解析条件（Case A: `base` と Case B: `target`）を比較し、両方の解析結果および主要 KPI の差分（`target - base`）を返す。既存の `analysis_id` 参照または新規 `AnalysisRequest` 実行のどちらでも（混在も可）指定可能。

#### リクエストボディ
- `base` の指定: `base_analysis_id` または `base_request` のいずれか一方を必須指定。
- `target` の指定: `target_analysis_id` または `target_request` のいずれか一方を必須指定。

```json
{
  "base_analysis_id": "550e8400-e29b-41d4-a716-446655440000",
  "target_request": {
    "airfoil": { "source_type": "naca4", "naca_code": "4412", "name": "NACA 4412", "raw_coordinates_text": null },
    "angle_of_attack": 4.0,
    "velocity": 15.0,
    "chord_length": 0.2,
    "fluid_properties": {
      "preset": "air_std_20c",
      "mode": "temperature_auto",
      "temperature_k": 293.15,
      "static_pressure_pa": 101325.0
    },
    "solver": { "method": "panel_method" },
    "numerical_settings": {
      "num_panels": 160,
      "closed_te": true,
      "grid_nx": 120,
      "grid_ny": 80,
      "x_range": [-0.5, 1.6],
      "y_range": [-0.7, 0.7],
      "num_streamlines": 28
    }
  }
}
```

#### レスポンス（`200 OK`）
```json
{
  "base": { "...": "AnalysisResponse (Case A)" },
  "target": { "...": "AnalysisResponse (Case B)" },
  "diff": {
    "delta_cl": 0.2381,
    "delta_cm_quarter_chord": -0.0512,
    "delta_cd": null,
    "delta_cp_min": -0.341,
    "delta_reynolds_number": 0.0,
    "delta_mach_number": 0.0
  }
}
```
※`base` または `target` のいずれかが `status: "failed"` の場合、対応する `delta_cl`, `delta_cm_quarter_chord`, `delta_cp_min` は `null` とする。`delta_cd` は Phase 1 では常時 `null`。

---

## 3. エクスポート・保存／再読込フォーマット仕様

### 3-1. 解析条件保存・再読込 JSON（`*.airflow.json`）

```json
{
  "schema_version": "1.0",
  "app": "AirFlow Lab",
  "exported_at": "2026-11-24T12:15:00Z",
  "config": {
    "airfoil": {
      "source_type": "naca4",
      "naca_code": "2412",
      "name": "NACA 2412",
      "raw_coordinates_text": null
    },
    "angle_of_attack": 4.0,
    "velocity": 15.0,
    "chord_length": 0.2,
    "fluid_properties": {
      "preset": "air_std_20c",
      "mode": "temperature_auto",
      "temperature_k": 293.15,
      "static_pressure_pa": 101325.0,
      "density_kg_m3": null,
      "dynamic_viscosity_pa_s": null,
      "kinematic_viscosity_m2_s": null,
      "speed_of_sound_mps": null
    },
    "solver": {
      "method": "panel_method"
    },
    "numerical_settings": {
      "num_panels": 160,
      "closed_te": true,
      "grid_nx": 120,
      "grid_ny": 80,
      "x_range": [-0.5, 1.6],
      "y_range": [-0.7, 0.7],
      "num_streamlines": 28
    }
  },
  "summary": {
    "solver_model": "inviscid_incompressible_potential",
    "cl": 0.7284,
    "cm_quarter_chord": -0.0531,
    "cd": null,
    "reynolds_number": 199206.4,
    "mach_number": 0.043702
  }
}
```
- **再読込検証ルール**: `schema_version === "1.0"` および `config` が `analysis_request.schema.json` に適合することを検証し、不適合時はエラー通知して現在の UI 状態を破壊しない。

### 3-2. 表面圧力分布 CSV エクスポート（`airflow_surface_<airfoil>_a<alpha>.csv`）
- **文字コード**: UTF-8（BOM なし、改行 LF）
- **メタデータコメントヘッダ**: 先頭に `#` 行で物理モデル（非粘性明記）、計算条件、物性・動圧、主要係数を記載する。
- **データ列**: `index,side,x_c,y_c,cp,vt_over_vinf`（6列固定）

```csv
# app: AirFlow Lab 0.1.0
# solver_method: panel_method
# physical_model: 2D inviscid incompressible potential flow (Hess-Smith panel method)
# note: Viscous drag and stall are NOT modeled; CD is unavailable (N/A).
# airfoil: NACA 2412
# angle_of_attack_deg: 4.0
# velocity_mps: 15.0
# chord_length_m: 0.2
# density_kg_m3: 1.204085
# static_pressure_pa: 101325.0
# dynamic_pressure_pa: 135.4596
# reynolds_number: 199206.4
# mach_number: 0.043702
# num_panels: 160
# cl_kutta_joukowski: 0.7284
# cl_pressure_integration: 0.7261
# cm_quarter_chord: -0.0531
# cd: N/A
index,side,x_c,y_c,cp,vt_over_vinf
0,lower,0.999808,-0.000041,0.210412,-0.888588
1,lower,0.998273,-0.000289,0.198310,-0.895371
```
- **風洞実験データとの互換性**: `x_c` と `cp` を標準列名とし、将来 Phase 2+ で実験データ CSV をインポートする際も同一列名で直接重ね合わせ比較できる。

### 3-3. 将来 VTK 拡張方針（Phase 3 予約）
- バックエンドの `exporters/` 層に `export_vtk_structured_grid()` の拡張点を確保し、Phase 3 では `flow_field` 構造格子を `.vts`（VTK XML StructuredGrid）またはレガシー `.vtk` 形式でエクスポート可能とする。
