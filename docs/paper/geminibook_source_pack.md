# AirFlow Lab Phase 1 — Gemini Notebook（旧 NotebookLM）投入用ソースパック

この資料は、Google の **Gemini Notebook（`https://notebook.google/`）** にアップロードし、手元の先行研究 PDF（NACA Report 460 / TR-824 / NASA TM-4074 / Hess & Smith 1967 / Drela 1989 / Babinsky 2003 等）と突き合わせて **根拠引用付きの整合性クロスチェック・査読Q&A作成・音声要約（Audio Overview）** を行うための構造化ソースデータです。

---

## 1. AirFlow Lab Phase 1 システム概要と設計原則

- **目的**: 高校生・流体力学初学者向けの 2 次元翼型周り流れ学習 Web アプリケーション。
- **計算エンジン（Phase 1）**:
  - モデル: **2 次元・定常・非圧縮・非粘性ポテンシャル流れ**（Hess-Smith 定強さ吹出し＋共通一定渦パネル法）。
  - ソルバー実装: [hess_smith.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/hess_smith.py)、[influence.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/influence.py)、[streamlines.py](file:///c:/home/AirFlowLab/backend/app/visualization/streamlines.py)。
  - 翼型幾何: NACA 0012 / 2412 / 4412 / 6412（フルコサイン離散化、閉後縁 $a_4 = -0.1036$ デフォルト／原典開後縁 $a_4 = -0.1015$ 切替対応）およびカスタム Selig/Lednicer DAT・CSV。
  - 物性推算: 理想気体状態方程式 + Sutherland 粘性則（[fluid_properties.py](file:///c:/home/AirFlowLab/backend/app/services/fluid_properties.py)）。
- **物理的誠実さと安全ガード**:
  1. 抗力係数 $C_D$ は算出不可として API 上で `cd: null` を強制し、UI では `—（算出不可）`、CSV では `# cd: N/A` としてゼロ誤表示を防ぐ。
  2. XFOIL（Phase 2）および 2D CFD（Phase 3）は未実装として UI 上 `disabled`、API 上 HTTP `501` を返す。
  3. 迎角 $|\alpha| > 10^\circ$ / $> 12^\circ$ で剥離・失速未考慮の警告を発火させ、$M \ge 0.3$ / $\ge 0.7$ で圧縮性・遷音速警告を発火させる。
  4. 解説エンジン（[explanationEngine.ts](file:///c:/home/AirFlowLab/frontend/src/utils/explanationEngine.ts)）では Babinsky (2003) に準拠して「同着仮説（Equal Transit-Time Fallacy）」を明確に否定する。

---

## 2. 主要数式と再現済み一次検証データサマリ

詳細テーブルの完全版および再現スクリプトは [AirFlow_Lab_Phase1_Validation_Paper.md](file:///c:/home/AirFlowLab/docs/paper/AirFlow_Lab_Phase1_Validation_Paper.md) と [reproduce_validation_tables.py](file:///c:/home/AirFlowLab/docs/paper/reproduce_validation_tables.py) を参照。

### 2.1 円柱厳密解（$C_p(\theta) = 1 - 4\sin^2\theta$, $\gamma=0$）
- $N = 40$: $\max|\Delta C_p| = 3.997\times 10^{-15}$, $\mathrm{RMS} = 1.311\times 10^{-15}$
- $N = 160$: $\max|\Delta C_p| = 1.421\times 10^{-14}$, $\mathrm{RMS} = 4.602\times 10^{-15}$, $C_{L,p} = 0$, $C_{D,p} = 7.63\times 10^{-17}$

### 2.2 NACA 4 桁標準翼型比較（$N=160$, 閉後縁 `a4=-0.1036`）
- **NACA 0012**: $\alpha_{L=0} = +0.000^\circ$（薄翼 `-0.000°`）、$C_{m,c/4}(0^\circ) = 0.00000$、$dC_L/d\alpha = 6.9429\,\mathrm{rad}^{-1}$、$x_{ac}/c = 0.2607$、$\alpha=5^\circ$ で $C_{L,\mathrm{KJ}} = 0.6052$。
- **NACA 2412**: $\alpha_{L=0} = -2.141^\circ$（薄翼 `-2.077°`）、$C_{m,c/4}(0^\circ) = -0.05433$（薄翼 `-0.05312`）、$dC_L/d\alpha = 6.9430\,\mathrm{rad}^{-1}$、$x_{ac}/c = 0.2614$、$\alpha=5^\circ$ で $C_{L,\mathrm{KJ}} = 0.8638$。
- **NACA 4412**: $\alpha_{L=0} = -4.267^\circ$（薄翼 `-4.154°`）、$C_{m,c/4}(0^\circ) = -0.10841$（薄翼 `-0.10624`）、$dC_L/d\alpha = 6.9431\,\mathrm{rad}^{-1}$、$x_{ac}/c = 0.2626$、$\alpha=5^\circ$ で $C_{L,\mathrm{KJ}} = 1.1215$。
- **NACA 6412**: $\alpha_{L=0} = -6.366^\circ$（薄翼 `-6.232°`）、$C_{m,c/4}(0^\circ) = -0.16199$（薄翼 `-0.15936`）、$dC_L/d\alpha = 6.9434\,\mathrm{rad}^{-1}$、$x_{ac}/c = 0.2646$、$\alpha=5^\circ$ で $C_{L,\mathrm{KJ}} = 1.3771$。

### 2.3 収束次数とダランベールのパラドックス（NACA 2412, $\alpha=5^\circ$）
- $N = 40 \to 300$ において、$C_{L,\mathrm{KJ}}$ と $C_{L,p}$ の相対差は $2.928\% \to 0.422\%$ へ減衰し、積 $N \times (\text{相対差}) \approx 1.17 \sim 1.27$、積 $N \times (\text{質量残差}) \approx 0.107\text{–}0.113$ の一次収束 $O(1/N)$ を示す。
- 圧力積分抗力誤差 $C_{D,p}$ は $-4.920\times 10^{-4} \to -1.554\times 10^{-4}$ へゼロ収束する。

---

## 3. Gemini Notebook へ同時に登録推奨する一次論文・参考資料一覧

1. Hess & Smith (1967), *Calculation of potential flow about arbitrary bodies*, Progress in Aeronautical Sciences, 8, 1–138.
2. Hess (1990), *Panel Methods in Computational Fluid Dynamics*, Annual Review of Fluid Mechanics, 22, 255–274 (`doi:10.1146/annurev.fl.22.010190.001351`).
3. Katz & Plotkin (2001), *Low-Speed Aerodynamics* (2nd ed.), Cambridge University Press.
4. Abbott & von Doenhoff (1959), *Theory of Wing Sections*, Dover (NACA Report No. 824).
5. Jacobs, Ward & Pinkerton (1933), *NACA Report No. 460*.
6. Ladson (1988), *NASA TM-4074* (NACA 0012 風洞試験データ).
7. Gregory & O'Reilly (1970), *ARC R&M No. 3726* (低 $Re$ NACA 0012 風洞試験).
8. Drela (1989), *XFOIL: An Analysis and Design System for Low Reynolds Number Airfoils*, Lecture Notes in Engineering 54 (`doi:10.1007/978-3-642-84010-4_1`).
9. Babinsky (2003), *How do wings work?*, Physics Education, 38(6), 497–503.
10. Sutherland (1893), *The viscosity of gases and molecular force*, Philosophical Magazine (`doi:10.1080/14786449308620508`).

---

## 4. Gemini Notebook での推奨クロスチェック用プロンプト例

Gemini Notebook に本ソースパックと上記 PDF 群を読み込ませた後、以下のプロンプトをそのまま入力して検証に活用できます：

1. **理論・定式化監査プロンプト**:
   > 「アップロードした Hess & Smith (1967) および Katz & Plotkin (2001) の記述を根拠として、AirFlow Lab の Kutta 条件（`V_{t,0} + V_{t,N-1} = 0`）と閉後縁係数 `-0.1036` の妥当性・制限事項を引用付きで検証してください。」
2. **風洞実験データとの差異検証プロンプト**:
   > 「Abbott & von Doenhoff (1959) および Ladson (1988) の実験データに基づき、AirFlow Lab の NACA 0012 / 2412 / 4412 における揚力傾斜 `6.943 /rad` およびゼロ揚力迎角が実験値とどの程度ずれるか、粘性境界層の観点から整理してください。」
3. **教育・誤謬防止チェックプロンプト**:
   > 「Babinsky (2003) の論文を根拠に、AirFlow Lab の 4 段階揚力解説と誤解解説が『同着仮説（Equal Transit-Time Fallacy）』を完全に排除できているか、高校生への説明として改善余地がないか指摘してください。」
4. **自作風洞実験への応用プロンプト**:
   > 「$Re = 5\times 10^4 \sim 2\times 10^5$ の小型低速風洞実験で NACA 2412 を測定する場合、Phase 1 の非粘性パネル法の結果（`CL`, `Cp`）と比較する際の注意点を Drela (1989) の層流剥離泡・遷移の知見を踏まえてまとめてください。」
5. **学会発表・査読想定 Q&A 作成プロンプト**:
   > 「AirFlow Lab Phase 1 の検証論文の内容をもとに、航空宇宙学会の発表で査読者や審査員から質問されそうな厳しい技術質問を 5 つと、本アプリの設計・数値データに基づいた誠実な回答案を作成してください。」
