# AirFlow Lab（Phase 1）における2次元ポテンシャル流れパネル法の理論・数値・教育的整合性検証

**Verification and Literature Validation of the 2D Potential-Flow Panel Method in AirFlow Lab (Phase 1)**

- **対象システム**: AirFlow Lab `v0.1.0`（Phase 1: Hess-Smith 2D パネル法エンジン・Web教育UI）
- **作成日**: 2026年11月26日
- **再現検証スクリプト**: [reproduce_validation_tables.py](file:///c:/home/AirFlowLab/docs/paper/reproduce_validation_tables.py)

---

## 要旨（Abstract）

本稿では、流体力学初学者および高校生向けの Web ベース 2 次元翼型解析ソフトウェア **AirFlow Lab（Phase 1）** について、航空宇宙工学・計算流体力学（CFD）・物理教育学の先行研究および一次学術文献を基準とした整合性監査（Code-to-Theory Audit）と定量的な検証・妥当性確認（Verification and Validation: V&V）を実施した。本ソフトウェアのコアソルバーは、Hess & Smith (1967) の定強さ吹出し・共通一定渦パネル法、Jacobs ら (1933) および NASA Turbulence Modeling Resource (TMR) に基づく NACA 4 桁翼型座標生成、Sutherland (1893) の粘性式、ならびに Babinsky (2003) による「同着仮説」誤謬の排除を取り入れた決定論的解説エンジンから構成される。

数値検証の結果、円柱ポテンシャル流れの厳密解に対しては $\max|\Delta C_p| \le 2.58\times 10^{-14}$（$N=40\text{–}320$）の機械精度レベルの一致を示した。NACA 0012 / 2412 / 4412 / 6412（$N=160$）のゼロ揚力迎角 $\alpha_{L=0}$ および $1/4$ 弦点ピッチングモーメント係数 $C_{m,c/4}$ は、Glauert の薄翼理論（Anderson 2017）とそれぞれ $0.14^\circ$ 以内・$2.3\%$ 以内（$1.6\text{–}2.3\%$）で整合し、かつ Abbott & von Doenhoff (1959) の風洞実験データに対して粘性境界層排除厚の不在（粘性デキャンバー効果の欠如）に起因する定性的・定量的関係（風洞実測より高めの揚力傾斜・やや大きい $|\alpha_{L=0}|$ および $|C_{m,c/4}|$）が物理法則どおりに再現された。パネル数 $N=40\text{–}300$ においては理論どおりの一次収束 $O(1/N)$ とダランベールのパラドックス（$C_{D,p} \to 0$）が確認され、非粘性モデルの限界（`cd: null` 強制および失速・圧縮性警告）が設計・実装の両面で厳密に貫徹されていることが実証された。

**キーワード**: パネル法（Panel Method）, Hess-Smith 法, NACA 4 桁翼型, 物理教育（Physics Education）, V&V（Verification and Validation）, 薄翼理論

---

## 1. 序論（Introduction）

高校生や理工系初学者が翼型周りの流体力学を学ぶ際、「定常な流れが翼周りを通過するとき、なぜ揚力が生まれるのか」「迎角・キャンバー・レイノルズ数を変えると圧力分布や流線はどう変化するのか」を数式と可視化の両面から直感的に結び付ける学習環境が求められる。この分野の先駆的な教育用ツールとして、NASA Glenn Research Center の Tom Benson により開発された **FoilSim** が挙げられ、スライダー操作と仮想風洞の可視化を通じて探究型学習に高い教育的効果をもたらしてきた（Benson / NASA GRC）。

一方で、初等教育や一般向け解説書においては「翼の上面は下面より距離が長いため、前縁で上下に分かれた流体粒子は後縁で同時に合流しなければならない」とする**同着仮説（Equal Transit-Time Fallacy）**が長年にわたり流布しており、物理教育学の観点からも明確な誤解として批判されている（Babinsky, 2003）。さらに、実務向け解析コードの多くは、数値モデルが非粘性（ポテンシャル流）であるにもかかわらず見かけ上の数値誤差抗力を表示したり、失速迎角域の過大評価に対して十分な物理的警告を出さなかったりする課題を抱えている。

**AirFlow Lab（Phase 1）** は、単一の Hess-Smith 2 次元ポテンシャル流計算エンジン（Python / FastAPI / NumPy / SciPy）を「簡易モード」と「本格モード」で共有しつつ、「計算可能な物理量と不可能な物理量を峻別し、モデルの適用限界と物理法則を正直に示す」ことを最優先方針として設計・実装された。本稿の目的は、以下の 2 点を学術的根拠に基づいて検証することである。

1. **理論・コード整合性監査**: 実装されている翼型生成式、パネル影響係数行列、Kutta 条件、物性推算式、安全ガード、および解説ロジックが先行文献の定式化と矛盾なく一致しているか。
2. **数値検証・文献データ比較（V&V）**: 厳密解、薄翼理論、および Abbott & von Doenhoff (1959) をはじめとする風洞実験・標準ベンチマーク資料との比較により、Phase 1 の計算精度と適用限界を定量的に明確化する。

---

## 2. 理論モデルおよび実装コードとの整合性チェック

AirFlow Lab（Phase 1）の実装コードと標準的な空気力学・数値流体力学の一次文献との対応関係を精査した。

### 2.1 翼型幾何形状と後縁定義

NACA 4 桁翼型 `MPXX`（最大キャンバー比 $m=M/100$、最大キャンバー位置 $p=P/10$、最大翼厚比 $t=XX/100$）の幾何定義は Jacobs, Ward & Pinkerton (1933) の NACA Report No. 460 に基づき、[naca4.py](file:///c:/home/AirFlowLab/backend/app/geometry/naca4.py) に実装されている。

- **平均キャンバー線 $y_c(\xi)$ と法線配置**: $\xi \in [0, 1]$ に対する 2 次区分多項式および法線角 $\theta = \arctan(dy_c/d\xi)$ による上下座標オフセット $(x_u, y_u), (x_l, y_l)$ は NACA 原典および Abbott & von Doenhoff (1959) の標準式と厳密に一致している（[naca4.py L64-155](file:///c:/home/AirFlowLab/backend/app/geometry/naca4.py#L64-L155)）。
- **閉後縁修正 vs 原典開後縁**: 原典（Jacobs et al., 1933）の厚み分布における 4 次項係数 $a_4 = -0.1015$ は後縁 $\xi=1$ において有限厚さ $y_t(1) = +0.0105 t$（開後縁）を残す。これに対し、NASA Langley Turbulence Modeling Resource（TMR）等の近代的な CFD・パネル法検証ベンチマークでは閉後縁（$y_t(1) = 0$）を得るために $a_4 = -0.1036$ が標準採用されている。実装はデフォルトを閉後縁 `closed_te=True`（$a_4 = -0.1036$）としつつ、`closed_te=False`（$a_4 = -0.1015$）も明示的に選択可能であり、文献との整合性は完全である（[naca4.py L89-117](file:///c:/home/AirFlowLab/backend/app/geometry/naca4.py#L89-L117)）。

### 2.2 Hess-Smith 2D パネル法ソルバー

ポテンシャル流コアは Hess & Smith (1967)、Hess (1990)、および Katz & Plotkin (2001) の定式化に準拠し、[influence.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/influence.py) と [hess_smith.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/hess_smith.py) に実装されている。

- **パネル離散化と座標順序**: フルコサイン分布による前縁・後縁節点密度の集中化、および「下面後縁 $\to$ 前縁 $\to$ 上面後縁」の時計回り配置により、全パネルの外向き単位法線ベクトルが幾何学的に統一されている。
- **分岐切断フリーの影響係数と対角極限**: 吹出しパネルの接線・法線誘起速度において `np.arctan2(eta * s_j, xi * (xi - s_j) + eta^2)` を単一呼び出しで使用し、角度差 $\Delta\phi_{ij}$ への三角関数加法定理と合わせることで $\pm\pi$ 分岐切断ジャンプを回避している（[influence.py L54-67](file:///c:/home/AirFlowLab/backend/app/solvers/panel/influence.py#L54-L67)）。自己パネル（$i=j$）の外側極限は $(A_{n,ii}, A_{t,ii}) = (+0.5, 0.0)$、渦影響係数は Cauchy-Riemann の共役関係 $B_n = -A_t, B_t = +A_n$ により導かれており、Katz & Plotkin (2001) Chapter 10–11 の厳密式と一致する。
- **非貫通条件と Kutta 条件**: $N$ 本の各コロケーション点における法線速度ゼロ条件と、後縁上下隣接パネル（第 $0$ 番および第 $N-1$ 番）に対する線形 Kutta 条件 $V_{t,0} + V_{t,N-1} = 0$ からなる $(N+1)\times(N+1)$ 密行列系をピボット選択付き LU 分解（`scipy.linalg.solve`）で解いている（[hess_smith.py L166-225](file:///c:/home/AirFlowLab/backend/app/solvers/panel/hess_smith.py#L166-L225)）。
- **空力係数とGate 2数値健全性検査**: 循環 $\Gamma = \gamma \sum S_j$ による Kutta-Joukowski 揚力係数 $C_{L,\mathrm{KJ}} = 2\hat{\Gamma}$ と表面圧力積分 $C_{L,p}$ のクロスチェック、$1/4$ 弦点 $(0.25, 0)$ 周りモーメント係数（頭上げ Nose-up を正）に加え、条件数（$\kappa_2(M) < 10^{10}$）・線形残差（$< 10^{-8}$）・吹出し質量保存残差・後縁圧力連続性（$|\Delta C_{p,\mathrm{TE}}| < 10^{-5}$）・$C_p$ 有界性の 6 段階の健全性ゲート（Gate 2）により数値破綻時の誤描画を遮断している。

### 2.3 流体物性モデルと無次元相似則

レイノルズ数 $Re$ およびマッハ数 $M$ の算出に用いる空気・水物性モジュール（[fluid_properties.py](file:///c:/home/AirFlowLab/backend/app/services/fluid_properties.py)）は以下の物理法則と整合する。

- **乾燥空気（`temperature_auto`）**: 乾燥空気の気体定数 $R = 287.058\,\mathrm{J/(kg\cdot K)}$、比熱比 $\gamma = 1.4$ を用いた理想気体状態方程式 $\rho = p_\infty/(RT)$ および音速 $a = \sqrt{\gamma RT}$ を実装している。粘性係数は Sutherland (1893) の 3 定数式 $\mu(T) = \mu_0 (T/T_0)^{3/2} (T_0 + S)/(T + S)$（$\mu_0 = 1.716\times 10^{-5}\,\mathrm{Pa\cdot s}$, $T_0 = 273.15\,\mathrm{K}$, $S = 110.4\,\mathrm{K}$）を実装しており、標準大気表の標準定数と一致する。
- **高密度流体誤適用防止ガード**: [api_schemas.py L214-224](file:///c:/home/AirFlowLab/backend/app/models/api_schemas.py#L214-L224) において、`preset='custom'` で液体相当の高密度（$\rho > 10\,\mathrm{kg/m}^3$）を指定しながら音速 `speed_of_sound_mps` が未入力の場合は、空気音速式を誤って適用することを防ぐため HTTP `422` バリデーションで遮断している。

### 2.4 ダランベールのパラドックスと教育・安全ガード

- **抗力係数 `cd: null` の厳密強制**: 非粘性・非圧縮の定常ポテンシャル流れでは理論上あらゆる閉物体に対する圧力抗力はゼロ（ダランベールのパラドックス; Anderson, 2017）であり、離散化誤差として残る数値値 $C_{D,p}$ を「抗力」と誤認させない設計が不可欠である。コード上では `cd=None` をハードコード強制し（[hess_smith.py L398-404](file:///c:/home/AirFlowLab/backend/app/solvers/panel/hess_smith.py#L398-L404)）、フロントエンド UI（[KpiCards.tsx L74-78](file:///c:/home/AirFlowLab/frontend/src/components/results/KpiCards.tsx#L74-L78)）でも `0` ではなく `—（算出不可）` と表示している。また Phase 2（XFOIL; Drela, 1989）および Phase 3（CFD）は [SolverSettingsForm.tsx L27-55](file:///c:/home/AirFlowLab/frontend/src/modes/advanced/SolverSettingsForm.tsx#L27-L55) で明示的に `disabled` とされている。
- **同着仮説の排除と正統 4 段階揚力解説**: [explanationEngine.ts L89-95, L159-170](file:///c:/home/AirFlowLab/frontend/src/utils/explanationEngine.ts#L89-L95) は、Babinsky (2003) の指摘に完全準拠して同着仮説を誤りとして明示的に否定し、「① クッタの条件と循環 $\to$ ② 流線の曲率と圧力勾配 $\to$ ③ ベルヌーイの定理 $\to$ ④ 圧力差の合力と反作用」の 4 段階の物理連鎖と計算値（$C_L, C_{p,\min}, |V|_{\max}/V_\infty$）を直接連動させて解説している。

### 2.5 整合性チェック総合マトリクス

| 監査領域 | 照合した一次文献・標準仕様 | 該当実装箇所 | 整合判定 | 監査所見 |
| :--- | :--- | :--- | :---: | :--- |
| NACA 4 桁座標・閉後縁 | Jacobs et al. (1933) / NASA TMR | [naca4.py](file:///c:/home/AirFlowLab/backend/app/geometry/naca4.py) | **整合** | 原典 `-0.1015` と閉後縁 `-0.1036` を切替可能 |
| パネル影響係数・共役関係 | Hess & Smith (1967) / Katz & Plotkin (2001) | [influence.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/influence.py) | **整合** | 単一 `atan2` で分岐切断ジャンプなし。自己極限 $\pm 0.5$ 厳密 |
| 線形系・Kutta 条件・Gate 2 | Hess (1990) / Katz & Plotkin (2001) | [hess_smith.py](file:///c:/home/AirFlowLab/backend/app/solvers/panel/hess_smith.py) | **整合** | $V_{t,0}+V_{t,N-1}=0$ および 6 種の数値健全性検査 |
| 流線追跡（RK4 弧長積分） | 数値常微分方程式・非貫通境界保護 | [streamlines.py](file:///c:/home/AirFlowLab/backend/app/visualization/streamlines.py) | **整合** | 停滞点・翼侵入ガード付きの弧長正規化 RK4 |
| 流体物性・Sutherland 則 | Sutherland (1893) / ISA 標準大気 | [fluid_properties.py](file:///c:/home/AirFlowLab/backend/app/services/fluid_properties.py) | **整合** | 液体指定時の音速未入力遮断も完備 |
| 適用限界・警告閾値 | Anderson (2017) / Drela (1989) | [warnings.py](file:///c:/home/AirFlowLab/backend/app/services/warnings.py) | **概ね整合** | 局所 Mach 推定に非圧縮近似の課題あり（4.1 節参照） |
| 教育的解説・誤謬排除 | Babinsky (2003) / Benson (FoilSim) | [explanationEngine.ts](file:///c:/home/AirFlowLab/frontend/src/utils/explanationEngine.ts) | **整合** | 同着仮説を明示否定。低迎角粘性差の追記余地あり（4.2 節） |

---

## 3. 数値検証（Verification）および先行研究との妥当性確認（Validation）

すべての検証数値は [reproduce_validation_tables.py](file:///c:/home/AirFlowLab/docs/paper/reproduce_validation_tables.py) を実行して得た一次実測値である。

### 3.1 円柱ポテンシャル流れの厳密解検証

循環なし（$\gamma=0$）・一様流中（$\alpha=0^\circ$）の円柱周りポテンシャル流れに対する表面圧力係数の厳密解は $C_p(\theta) = 1 - 4\sin^2\theta$（Anderson, 2017）である。等角時計回りパネルメッシュに対する検証結果を表 1 に示す。

| パネル数 $N$ | $\max\|\Delta C_p\|$ | $\mathrm{RMS}(\Delta C_p)$ | $C_{L,p}$ | $C_{D,p}$ | 質量保存残差 $\|\sum\hat{\sigma}_j\hat{S}_j\|$ |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 40 | `3.996803e-15` | `1.310698e-15` | `-5.117e-17` | `+2.906e-16` | `1.180e-16` |
| 80 | `6.661338e-15` | `2.432852e-15` | `-9.075e-17` | `-7.516e-16` | `2.776e-17` |
| 160 | `1.421085e-14` | `4.601645e-15` | `+0.000e+00` | `+7.633e-17` | `8.604e-16` |
| 320 | `2.575717e-14` | `7.994873e-15` | `-4.441e-16` | `-8.327e-17` | `2.220e-16` |

$N=40\text{–}320$ の全ケースで倍精度浮動小数点数の丸め誤差水準（$10^{-15}\text{–}10^{-14}$）で厳密解と一致した。定強さパネル法であっても、円柱上の等角対称配置ではフーリエ基本モード $\cos\theta$ に対する離散影響行列の固有対称性（超収束性）により離散化誤差が厳密に相殺されること、およびコード上の影響係数・圧力積分式に符号誤りや係数漏れがないことが裏付けられる。

### 3.2 NACA 4 桁標準翼型群の三者比較（薄翼理論 vs パネル法 vs 風洞実験）

Glauert の薄翼理論（Anderson, 2017）によれば、翼弦線上のキャンバー勾配 $dy_c/dx$ を $\xi = \frac{1}{2}(1 - \cos\theta)$ で置換したフーリエ係数を用いて、ゼロ揚力迎角および $1/4$ 弦点モーメント係数は次式で与えられる。

$$\alpha_{L=0,\mathrm{thin}} = -\frac{1}{\pi}\int_0^\pi \frac{dy_c}{dx}(\cos\theta - 1)\,d\theta,\qquad C_{m,c/4,\mathrm{thin}} = -\frac{\pi}{4}(A_1 - A_2)$$

AirFlow Lab 標準 4 翼型（$N=160$, 閉後縁）におけるパネル法実測値、薄翼理論値、ならびに Abbott & von Doenhoff (1959) の風洞実験代表範囲を表 2 にまとめる。

| 翼型 | $\alpha_{L=0}$ (薄翼理論) | $\alpha_{L=0}$ (パネル法) | $\alpha_{L=0}$ (風洞実験, Abbott & von Doenhoff) | $C_{m,c/4}$ (薄翼理論) | $C_{m,c/4}(0^\circ)$ (パネル法) | $C_{m,c/4}$ (風洞実験) | $dC_L/d\alpha$ (パネル法) [$/\mathrm{rad}$] | 空力中心 $x_{ac}/c$ |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **NACA 0012** | `-0.000°` | `+0.000°` | $0^\circ$ | `-0.00000` | `+0.00000` | $0$ | `6.9429` | `0.2607` |
| **NACA 2412** | `-2.077°` | `-2.141°` | 約 $-2.0^\circ$ | `-0.05312` | `-0.05433` | 約 $-0.043 \sim -0.050$ | `6.9430` | `0.2614` |
| **NACA 4412** | `-4.154°` | `-4.267°` | 約 $-3.7^\circ \sim -4.0^\circ$ | `-0.10624` | `-0.10841` | 約 $-0.090 \sim -0.100$ | `6.9431` | `0.2626` |
| **NACA 6412** | `-6.232°` | `-6.366°` | 約 $-6.1^\circ \sim -6.2^\circ$ | `-0.15936` | `-0.16199` | 約 $-0.13 \sim -0.14$ | `6.9434` | `0.2646` |

この比較から、以下の 3 つの重要な流体力学的整合性が確認できる。

1. **薄翼理論との整合**: 最大キャンバー比（$0\%, 2\%, 4\%, 6\%$）に比例して $\alpha_{L=0}$ が負方向へ、$C_{m,c/4}$ が頭下げ（負）方向へ線形に拡大する傾向が理論どおりに再現された。パネル法で $|\alpha_{L=0}|$ および $|C_{m,c/4}|$ が薄翼理論より $2\text{–}3\%$ 大きいのは $12\%$ の有限翼厚による流線曲率強調効果である。
2. **空力中心の後方シフト**: 薄翼理論の $x_{ac}/c = 0.25$ に対し、有限翼厚 $12\%$ のパネル法では $x_{ac}/c \approx 0.261\text{–}0.265$ となり、古典的ポテンシャル流理論の知見（Katz & Plotkin, 2001）と一致する。
3. **風洞実験データとの物理的関係（粘性デキャンバー効果）**: Abbott & von Doenhoff (1959)、Ladson (1988)、および Gregory & O'Reilly (1970) の風洞実験では、線形域の揚力傾斜はおおむね $0.090\text{–}0.105\,\mathrm{deg}^{-1}$（$5.2\text{–}6.0\,\mathrm{rad}^{-1}$）であり、$|\alpha_{L=0}|$ や $|C_{m,c/4}|$ も非粘性理論値よりやや小さい。これは翼面後縁へ向けて成長する粘性境界層が上面側の見かけの反りを減少させる「粘性デキャンバー効果（viscous decambering）」によるものであり、非粘性パネル法が $6.943\,\mathrm{rad}^{-1}$ を与えることは計算誤差ではなく**物理モデルの本質的性質**である。

### 3.3 有限翼厚効果および後縁形状定義の影響

最大翼厚比 $t/c$ の異なる対称翼 NACA 0004〜0024（$N=160$）に対して $\alpha = \pm 2^\circ$ から線形揚力傾斜を求め、古典的ポテンシャル流における翼厚補正近似式 $2\pi(1 + 0.77\,t/c)$ と比較した結果を表 3 に示す。

| 翼型 | 翼厚比 $t/c$ | パネル法 $dC_L/d\alpha$ [$/\mathrm{rad}$] | $2\pi(1+0.77\,t/c)$ [$/\mathrm{rad}$] | 近似式との相対差 | 対 $2\pi$ 比 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **NACA 0004** | `0.04` | `6.5163` | `6.4767` | `+0.61%` | `1.0371` |
| **NACA 0009** | `0.09` | `6.7823` | `6.7186` | `+0.95%` | `1.0794` |
| **NACA 0012** | `0.12` | `6.9429` | `6.8638` | `+1.15%` | `1.1050` |
| **NACA 0018** | `0.18` | `7.2664` | `7.1540` | `+1.57%` | `1.1565` |
| **NACA 0024** | `0.24` | `7.5929` | `7.4443` | `+2.00%` | `1.2085` |

全翼厚域で理論的近似式と $+0.61\% \sim +2.00\%$ 以内で一致し、NACA 0012 の揚力傾斜が薄翼理論 $2\pi$ より $+10.5\%$ 高くなる理由を定量的に説明する。また、$\alpha=5^\circ, N=160$ で閉後縁（`a4=-0.1036`）と原典開後縁（`a4=-0.1015`）を比較した結果（表 4）、閉後縁の方が質量保存残差を NACA 2412 で約 1/4（`6.733e-4` vs `2.602e-3`）に抑制でき、後縁特異性制御に優れることが確認された（$C_{L,\mathrm{KJ}}$ の差は約 $1.0\%$ 程度）。

| 翼型 | 後縁仕様 | $C_{L,\mathrm{KJ}}$ | $C_{L,p}$ | $C_{m,c/4}$ | $\|\Delta C_{p,\mathrm{TE}}\|$ | 質量保存残差 | 条件数 $\kappa_2(M)$ |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| NACA 0012 | 閉後縁 (`-0.1036`) | `0.605238` | `0.602487` | `-0.006480` | `6.661e-16` | `1.200e-03` | `120.8` |
| NACA 0012 | 開後縁 (`-0.1015`) | `0.598694` | `0.597504` | `-0.006336` | `3.331e-16` | `3.131e-03` | `106.8` |
| NACA 2412 | 閉後縁 (`-0.1036`) | `0.863846` | `0.857081` | `-0.061194` | `0.000e+00` | `6.733e-04` | `120.9` |
| NACA 2412 | 開後縁 (`-0.1015`) | `0.855080` | `0.850351` | `-0.060992` | `3.331e-16` | `2.602e-03` | `107.0` |

### 3.4 パネル数収束性・一次精度スケーリングおよびダランベールのパラドックス

NACA 2412（$\alpha=5^\circ$）について $N=40\text{–}300$ でパネル数収束性を測定した結果を表 5 に示す。

| $N$ | $C_{L,\mathrm{KJ}}$ | $C_{L,p}$ | 相対差 $\frac{\|C_{L,\mathrm{KJ}}-C_{L,p}\|}{\|C_{L,\mathrm{KJ}}\|}$ | $N \times \text{相対差}$ | $C_{D,p}$ (数値誤差) | 質量残差 | $N \times \text{質量残差}$ | $\kappa_2(M)$ | 計算時間 [ms] |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 40 | `0.866274` | `0.840909` | `2.928%` | `1.1712` | `-4.920e-04` | `2.816e-03` | `0.11264` | `62.0` | `0.41` |
| 60 | `0.865786` | `0.848330` | `2.016%` | `1.2097` | `-5.082e-04` | `1.838e-03` | `0.11031` | `74.9` | `0.67` |
| 80 | `0.865208` | `0.851939` | `1.534%` | `1.2269` | `-4.507e-04` | `1.365e-03` | `0.10919` | `86.0` | `0.88` |
| 120 | `0.864374` | `0.855411` | `1.037%` | `1.2443` | `-3.431e-04` | `9.016e-04` | `0.10819` | `104.9` | `3.09` |
| 160 | `0.863846` | `0.857081` | `0.783%` | `1.2530` | `-2.721e-04` | `6.733e-04` | `0.10772` | `120.9` | `4.42` |
| 240 | `0.863234` | `0.858695` | `0.526%` | `1.2619` | `-1.907e-04` | `4.470e-04` | `0.10728` | `148.0` | `10.89` |
| 300 | `0.862963` | `0.859323` | `0.422%` | `1.2655` | `-1.554e-04` | `3.570e-04` | `0.10711` | `165.4` | `18.90` |

$N \times (\text{相対差}) \approx 1.2$、$N \times (\text{質量残差}) \approx 0.107$ と一定値に漸近しており、定強さ吹出し・共通渦パネル法の理論収束次数である**一次収束 $O(1/N)$**（Katz & Plotkin, 2001）が明確に立証された。また、圧力積分による見かけの抗力係数 $C_{D,p}$ は $N$ の増大とともに単調にゼロへ近づく純粋な離散化数値誤差（符号も負になり得る非物理量）であり、Phase 1 で `cd: null` を強制する設計判断が正しいことが確認できる。既定値 $N=160$ における解法時間は `4.42 ms` であり、ブラウザでの対話的学習に十分な応答性を備える。

### 3.5 高迎角域の限界と警告閾値の妥当性

$\alpha = 15^\circ$（$N=160$）において、パネル法は NACA 0012 で $C_L = 1.7973$（$C_{p,\min} = -12.859$）、NACA 2412 で $2.0481$、NACA 4412 で $2.2979$、NACA 6412 で $2.5458$ を出力する。これに対し Abbott & von Doenhoff (1959) の標準風洞データでは、これら 12% 厚 NACA 翼型の失速迎角 $\alpha_{\text{stall}}$ は約 $14^\circ\text{–}16^\circ$、最大揚力係数 $C_{l,\max}$ はそれぞれ 2412 で $1.5\text{–}1.6$、4412 で $1.6\text{–}1.7$、6412 で $1.68\text{–}1.8$ 程度である。したがって、剥離・失速を伴う $|\alpha| > 10^\circ\text{–}12^\circ$ で [warnings.py](file:///c:/home/AirFlowLab/backend/app/services/warnings.py) が段階的に `HIGH_AOA_CAUTION` と `STALL_UNMODELED` を発火させ、`explanationEngine.ts` でも「実際の流れより過大評価」と注記する仕様は物理的・教育的に適切である。

### 3.6 ISA 標準大気・流体物性値の検証

| 条件 | $\rho\ [\mathrm{kg/m^3}]$ | $\mu\ [\mathrm{Pa\cdot s}]$ | $\nu\ [\mathrm{m^2/s}]$ | 音速 $a\ [\mathrm{m/s}]$ |
| :--- | :---: | :---: | :---: | :---: |
| ISA 標準大気 ($15^\circ\mathrm{C}$, $1\,\mathrm{atm}$) | `1.22498` | `1.78930e-05` | `1.46068e-05` | `340.297` |
| AirFlow Lab 標準空気 ($20^\circ\mathrm{C}$) | `1.20408` | `1.81332e-05` | `1.50598e-05` | `343.237` |
| AirFlow Lab 標準空気 ($0^\circ\mathrm{C}$) | `1.29225` | `1.71600e-05` | `1.32792e-05` | `331.321` |
| AirFlow Lab 標準水 ($20^\circ\mathrm{C}$) | `998.20000` | `1.00200e-03` | `1.00381e-06` | `1482.000` |

ISA 標準大気（$15^\circ\mathrm{C}$）の標準参照値（$\rho = 1.225\,\mathrm{kg/m^3}$, $\mu = 1.7894\times 10^{-5}\,\mathrm{Pa\cdot s}$, $a = 340.294\,\mathrm{m/s}$）と $0.006\%$ 以内で一致している。

---

## 4. 整合性監査で抽出された制約と今後の改善課題（Discussion & Future Work）

1. **局所マッハ数推定の非圧縮近似性**: [warnings.py L91](file:///c:/home/AirFlowLab/backend/app/services/warnings.py#L91) では翼面局所最大マッハ数の目安を `mach_number * max_velocity_ratio` と定義している。これは低亜音速域の保守的な警戒線としては有用であるが、圧縮性効果による負圧ピーク増大（Prandtl-Glauert 則や Karman-Tsien 則）を含まない。高亜音速境界（$M_\infty > 0.3$）の厳密な判定には等エントロピー臨界圧力係数 $C_{p,\mathrm{cr}}(M_\infty)$ に基づく判定式の導入が望ましい。
2. **低迎角線形域における粘性排除厚差の教育説明補強**: 現在の教育解説は高迎角（$|\alpha| > 10^\circ$）の失速差異を強調している。今後、自作風洞等での低迎角実験データとの比較機能を統合する際には、「非粘性パネル法は有限翼厚効果を含む一方で境界層排除厚（粘性デキャンバー）を無視するため、低迎角域でも揚力傾斜が薄翼理論 $2\pi$ より約 $+10.5\%$ 大きく、実測値よりおおむね $15\text{–}30\%$ 程度高く出得る」旨をルールベース解説へ追記することが望ましい。
3. **低レイノルズ数域での層流剥離泡と Phase 2 XFOIL 連成**: 現在の `LOW_RE_CAUTION` 閾値は $Re < 5\times 10^4$ であるが、小型模型風洞（$Re \approx 5\times 10^4 \sim 5\times 10^5$）でも層流剥離泡や境界層遷移が支配的となる（Drela, 1989）。Phase 2 での XFOIL（連成粘性・遷移ソルバー）実装により初めて粘性抗力 $C_D$ と低 $Re$ 性能予測が可能となる。
4. **パネル離散化次数（$O(1/N)$ vs $O(1/N^2)$）**: 現在の定強さパネル法は教育用途の速度（約 $4.4\,\mathrm{ms}$）に優れるが、高曲率前縁部や薄翼のさらなる高精度化には、将来的に線形渦強さ分布（$O(1/N^2)$ 精度）への拡張も選択肢となる。

---

## 5. 結論（Conclusion）

先行学術文献と基準実験データに対する多角的な検証の結果、AirFlow Lab（Phase 1）の計算コア・座標生成・物性モデル・物理安全ガード・教育的解説エンジンは、2 次元ポテンシャル流れの理論体系と極めて高い整合性を有していることが確認された。特に「計算できる範囲の数値精度（円柱厳密解 $10^{-14}$、薄翼・有限翼厚理論との一致、$O(1/N)$ 収束）」と「計算できない物理（粘性抗力 `cd: null`、失速・圧縮性警告、同着仮説の排除）に対する誠実な限界表示」が両立されており、高校生向け学習ツールおよび今後の風洞実験比較基盤（Phase 2 以降）として堅牢な土台が完成している。

---

## 参考文献（References）

1. Hess, J. L., & Smith, A. M. O. (1967). Calculation of potential flow about arbitrary bodies. *Progress in Aeronautical Sciences*, 8, 1–138.
2. Hess, J. L. (1990). Panel Methods in Computational Fluid Dynamics. *Annual Review of Fluid Mechanics*, 22, 255–274. `https://doi.org/10.1146/annurev.fl.22.010190.001351`
3. Katz, J., & Plotkin, A. (2001). *Low-Speed Aerodynamics* (2nd ed.). Cambridge Aerospace Series No. 13, Cambridge University Press.
4. Abbott, I. H., & von Doenhoff, A. E. (1959). *Theory of Wing Sections: Including a Summary of Airfoil Data*. Dover Publications (originally McGraw-Hill, 1949; based on NACA Report No. 824, 1945).
5. Jacobs, E. N., Ward, K. E., & Pinkerton, R. M. (1933). *The Characteristics of 78 Related Airfoil Sections from Tests in the Variable-Density Wind Tunnel*. NACA Report No. 460.
6. Ladson, C. L. (1988). *Effects of Independent Variation of Mach and Reynolds Numbers on the Low-Speed Aerodynamic Characteristics of the NACA 0012 Airfoil Section*. NASA Technical Memorandum 4074.
7. Gregory, N., & O'Reilly, C. L. (1970). *Low-Speed Aerodynamic Characteristics of NACA 0012 Aerofoil Section, including the Effects of Upper-Surface Roughness Simulating Hoar Frost*. Aeronautical Research Council R&M No. 3726.
8. Anderson, J. D. (2017). *Fundamentals of Aerodynamics* (6th ed.). McGraw-Hill Education.
9. Drela, M. (1989). XFOIL: An Analysis and Design System for Low Reynolds Number Airfoils. In T. J. Mueller (Ed.), *Low Reynolds Number Aerodynamics*, Lecture Notes in Engineering, Vol. 54 (pp. 1–12). Springer-Verlag. `https://doi.org/10.1007/978-3-642-84010-4_1`
10. Babinsky, H. (2003). How do wings work? *Physics Education*, 38(6), 497–503.
11. Sutherland, W. (1893). The viscosity of gases and molecular force. *Philosophical Magazine*, Series 5, 36(223), 507–531. `https://doi.org/10.1080/14786449308620508`
12. Benson, T. / NASA Glenn Research Center. *Beginner's Guide to Aeronautics — FoilSim Interactive Airfoil Simulator*. NASA.
