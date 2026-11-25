# AirFlow Lab 数値計算手法仕様書（`NUMERICAL_METHOD.md`）

> **文書ステータス**: Phase 1 統合設計確定版（Single Source of Truth: 理論・数値計算仕様）  
> **対象コンポーネント**: `backend/app/geometry/`, `backend/app/solvers/`, `backend/app/visualization/`, `backend/app/services/`  
> **最上位設計原則**: **教育重視。初心者でも扱いやすく、物理的に正確で、計算の限界を正直に示すこと。**

---

## 目次

1. [概要とPhase構成（計算手法の位置づけ）](#1-概要とphase構成計算手法の位置づけ)
2. [物理モデル・支配方程式・適用範囲と限界](#2-物理モデル支配方程式適用範囲と限界)
3. [座標系・無次元化・パネル離散化仕様](#3-座標系無次元化パネル離散化仕様)
4. [翼型座標生成・前処理アルゴリズム](#4-翼型座標生成前処理アルゴリズム)
5. [Hess-Smith 2Dパネル法の定式化](#5-hess-smith-2dパネル法の定式化)
6. [境界条件・Kutta条件・連立一次方程式](#6-境界条件kutta条件連立一次方程式)
7. [表面速度・圧力係数・空力係数の算出と $C_D = \mathrm{null}$ の根拠](#7-表面速度圧力係数空力係数の算出と-c_d--mathrmnull-の根拠)
8. [流体物性推算と無次元数（$Re, M$）・妥当性警告基準](#8-流体物性推算と無次元数re-m妥当性警告基準)
9. [空間速度場と流線の数値積分アルゴリズム](#9-空間速度場と流線の数値積分アルゴリズム)
10. [数値安定性・収束判定・異常入力ガード](#10-数値安定性収束判定異常入力ガード)
11. [初学者向け教育的解説の物理ロジック（同着理論の排除）](#11-初学者向け教育的解説の物理ロジック同着理論の排除)
12. [APIリクエスト7キーとの対応およびPhase 2 / Phase 3拡張方針](#12-apiリクエスト7キーとの対応およびphase-2--phase-3拡張方針)

---

## 1. 概要とPhase構成（計算手法の位置づけ）

AirFlow Lab は、高校生および流体力学の初学者が2次元翼型周りの流れと空力特性を直感的に理解するためのWebベース2D流体解析ソフトウェアである。本システムでは、物理モデルの複雑さと計算負荷に応じて計算エンジン（ソルバー）を3段階の Phase に分離し、`BaseSolver` 抽象インターフェース（Strategy パターン）の下で拡張する。

| フェーズ | ソルバー識別子 (`solver.method`) | 物理モデル | 計算可能な主要物理量 | 計算不可能な物理量・主な限界 | 実装状態 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | `panel_method` | 2次元・定常・非圧縮・非粘性・渦なし流れ（ポテンシャル流：Hess-Smith パネル法） | 表面速度 $V_t$、圧力係数 $C_p$、循環 $\Gamma$、揚力係数 $C_L$、$1/4$ 弦周りモーメント係数 $C_{m,c/4}$、外部速度場 $(u,v)$、流線 | **抗力係数 $C_D$（常時 `null`）**、境界層発達、流れの剥離・失速、遷音速衝撃波 | **Phase 1 実装対象** |
| **Phase 2** | `xfoil` | ポテンシャル流 ＋ 積分型境界層連成解析（VII: Viscous-Inviscid Interaction、$e^N$ 遷移判定） | Phase 1 の全項目 ＋ **形状抗力・摩擦抗力を含む $C_D$**、排除厚さ $\delta^*$、運動量厚さ $\theta$、層流剥離泡・軽度の後縁剥離 | 大規模剥離後の非定常渦放出、深い失速域（Deep Stall）、高マッハ数衝撃波干渉 | 開発予定（UI `disabled` / API `501`） |
| **Phase 3** | `cfd_su2` | 2次元圧縮性/非圧縮性レイノルズ平均ナビエ・ストークス方程式（RANS：SU2 等連携） | 粘性流れ場全域 $(u,v,p,\nu_t)$、$C_L, C_D, C_m$、剥離渦領域、圧縮性・衝撃波 | 3次元翼端渦（誘導抗力）、LES/DNSスケールの微細乱流構造 | 将来構想（UI `disabled` / API `501`） |

### 1.1 パネル法候補の比較と Hess-Smith 法の選定理由

Phase 1 のポテンシャル流ソルバーとして以下の3手法を比較検討し、**① Hess-Smith パネル法（一定強度吹出し $\sigma_j$ ＋ 全翼共通一定渦 $\gamma$）** を標準採用する。

| 候補手法 | 未知数・境界条件 | 薄翼・キャンバー精度 | 数値安定性（行列条件数） | 実装・教育的明快性 | 判定 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **① Hess-Smith 法**<br>（一定吹出し $\sigma_j$ ＋ 共通一定渦 $\gamma$） | $N$ パネルの $\sigma_j$ ＋ 全パネル共通 $\gamma$（計 $N+1$ 個）、中点 $\mathbf{V}\cdot\mathbf{n}=0$ ＋ Kutta条件 | 実用翼厚（$t/c \ge 4\%$：NACA 0012〜6412 等）で高精度（$N=160$ で $C_L$ クロスチェック差 $< 0.8\%$） | **極めて高い**（対角項 $+1/2$ を持つ第2種フレドホルム積分方程式構造であり鋸歯状振動が生じない） | **最良**（吹出し $\sigma_j$ ＝翼厚による流線の押しのけ、渦 $\gamma$ ＝循環と揚力という物理的意味が1対1で対応） | **Phase 1 採用** |
| **② ノイマン型・線形渦パネル法**<br>（節点線形渦 $\gamma_j$、中点 $\mathbf{V}\cdot\mathbf{n}=0$） | 節点 $\gamma_1,\dots,\gamma_{N+1}$、中点 $\mathbf{V}\cdot\mathbf{n}=0$ ＋ $\gamma_1+\gamma_{N+1}=0$ | 中〜高 | **低い**（第1種積分方程式に近く、偶数パネルや鋭角後縁で奇偶モードの鋸歯状振動が発生しやすい） | 中 | 不採用 |
| **③ 流関数一定・線形渦パネル法**<br>（XFOIL 無粘性型：$\Psi = \Psi_0$） | 節点 $\gamma_1,\dots,\gamma_{N+1}$ ＋ 内部流関数定数 $\Psi_0$ | 極薄翼（$t/c < 2\%$）まで最高精度 | 高い | やや複雑（流関数系と速度場系の2種類の影響係数が必要） | Phase 2 以降の高度オプション候補 |

---

## 2. 物理モデル・支配方程式・適用範囲と限界

### 2.1 支配方程式と物理的前提

Phase 1 で扱う流れ場は、以下の4仮定を満たす**理想流体（Ideal Fluid）のポテンシャル流れ**である。

1. **2次元流れ（2D Flow）**: スパン（翼幅）方向に一様（無限翼幅相当）であり、翼端渦および誘導抗力は存在しない。
2. **定常流れ（Steady Flow）**: 時間微分項 $\partial/\partial t = 0$。カルマン渦や失速フラッタ等の非定常現象は含まない。
3. **非圧縮流れ（Incompressible Flow）**: 密度 $\rho = \text{const.}$。連続の式は $\nabla \cdot \mathbf{V} = 0$ となる（低マッハ数 $M < 0.3$ で妥当）。
4. **非粘性・渦なし流れ（Inviscid, Irrotational Flow）**: 粘性係数 $\mu = 0$（レイノルズ数 $Re \to \infty$ の外層極限）かつ渦度 $\boldsymbol{\omega} = \nabla \times \mathbf{V} = \mathbf{0}$。

渦なし条件 $\nabla \times \mathbf{V} = \mathbf{0}$ より速度ポテンシャル $\Phi(x,y)$ が定義でき、$\mathbf{V} = \nabla \Phi$ を連続の式 $\nabla \cdot \mathbf{V} = 0$ に代入すると**2次元ラプラス方程式**が得られる：

$$\nabla^2 \Phi = \frac{\partial^2 \Phi}{\partial x^2} + \frac{\partial^2 \Phi}{\partial y^2} = 0 \qquad \text{in } \Omega_{\mathrm{ext}}$$

ラプラス方程式は線形であるため、**重ね合わせの原理**が厳密に成立する。すなわち、一様流ポテンシャル $\Phi_\infty$ と、翼表面 $\partial\Omega_B$ 上に分布させた吹出し（Source）および渦（Vortex）の特異点分布ポテンシャルの和として一般解を構成できる：

$$\Phi(x,y) = V_\infty (x\cos\alpha + y\sin\alpha) + \oint_{\partial\Omega_B} \frac{\sigma(s)}{2\pi}\ln r\,ds - \oint_{\partial\Omega_B} \frac{\gamma(s)}{2\pi}\theta_r\,ds$$

ここで $(r, \theta_r)$ は翼面素片 $ds$ から評価点 $(x,y)$ への局所極座標であり、$\gamma(s) > 0$ は時計回り循環（正の揚力を生む向き）を表す。さらに定常・非圧縮・非粘性・渦なし流れでは、流線によらず空間全域で**ベルヌーイの定理**が成立する：

$$p + \frac{1}{2}\rho |\mathbf{V}|^2 = p_\infty + \frac{1}{2}\rho V_\infty^2 = \text{const.}$$

### 2.2 厳守すべき物理的限界（UI・API・解説で隠蔽しない事項）

- **粘性CFDとの明確な区別**: パネル法は境界層も乱流モデルも含まない「2次元非粘性ポテンシャル流解析」であり、システム内のいかなる箇所でも「粘性CFD」と呼称してはならない。
- **剥離・失速の未モデル化**: 実際の翼では高迎角（通常 $|\alpha| \gtrsim 10^\circ \sim 15^\circ$）において上面の逆圧力勾配（$dp/dx > 0$）に耐えきれず境界層が剥離し、失速（$C_L$ の急落・圧力抗力の急増）が生じる。パネル法では流れが常に翼面に付着し続けるため、$C_L$ が $\sin\alpha$ 的に単調増加し続け現実より過大評価される。
- **ダランベールのパラドックスと抗力ゼロ**: 2次元定常非圧縮ポテンシャル流れでは、閉物体に働く流れ方向合力（抗力 $D$）は数学的に厳密にゼロとなる。摩擦抗力 $C_{D,f}$ も剥離圧力抗力 $C_{D,p}$ も原理的に算出できないため、**Phase 1 では `cd: null` を厳守する**。
- **圧縮性・衝撃波の未考慮**: $M \ge 0.3$ では空気の密度変化が無視できなくなり、さらに局所流速が音速 $a$ を超える遷音速域では衝撃波が発生するため、非圧縮ラプラス方程式の適用範囲外となる。

---

## 3. 座標系・無次元化・パネル離散化仕様

### 3.1 全体座標系と無次元計算系

- **翼固定物理座標系 $(x, y)$**:
  - 原点 $(0, 0)$ を翼前縁（Leading Edge, LE）、$(c, 0)$ を翼後縁（Trailing Edge, TE）にとる。
  - $+x$ 軸：前縁から後縁へ向かう翼弦方向（Chordwise direction）。
  - $+y$ 軸：翼弦に垂直で下面から上面へ向かう方向（Thickness / Normal direction）。
  - 一様流速度ベクトル：迎角 $\alpha$（単位 rad、度入力 $\alpha_{\mathrm{deg}}$ から $\alpha = \alpha_{\mathrm{deg}}\pi / 180$ へ変換）に対し $\mathbf{V}_\infty = V_\infty (\cos\alpha, \sin\alpha)$。
- **無次元計算系 $(\hat{x}, \hat{y})$**:
  - 弦長 $c$ [m] や流速 $V_\infty$ [m/s] の大小による連立一次方程式のスケーリング悪化を防ぎ、数値精度を常に一定に保つため、ソルバー内部はすべて **$\hat{c} = 1,\; \hat{V}_\infty = 1$** の無次元系で計算する：
    $$\hat{x} = \frac{x}{c},\quad \hat{y} = \frac{y}{c},\quad \hat{\mathbf{V}} = \frac{\mathbf{V}}{V_\infty},\quad \hat{\sigma}_j = \frac{\sigma_j}{V_\infty},\quad \hat{\gamma} = \frac{\gamma}{V_\infty},\quad \hat{\Gamma} = \frac{\Gamma}{V_\infty c}$$
  - 有次元物理量への変換はポスト処理層で一括実施する：
    $$x = c\hat{x},\quad y = c\hat{y},\quad \mathbf{V} = V_\infty\hat{\mathbf{V}},\quad \Gamma = V_\infty c\hat{\Gamma},\quad L' = \frac{1}{2}\rho V_\infty^2 c\, C_L,\quad M'_{c/4} = \frac{1}{2}\rho V_\infty^2 c^2\, C_{m,c/4}$$

### 3.2 パネル進行方向（時計回り）と局所基底ベクトル

節点列 $(\hat{X}_j, \hat{Y}_j)\; (j = 1, \dots, N+1)$ は、必ず **時計回り（Clockwise）** に並べる：

$$\text{下面後縁 } (1, 0) \;\xrightarrow{i = 1, \dots, N/2}\; \text{前縁 } (0, 0) \;\xrightarrow{i = N/2+1, \dots, N}\; \text{上面後縁 } (1, 0)$$

第 $i$ パネル（始点 $(\hat{X}_i, \hat{Y}_i)$、終点 $(\hat{X}_{i+1}, \hat{Y}_{i+1})$、$i = 1, \dots, N$）の幾何量は以下の式で定義する：

$$\Delta \hat{X}_i = \hat{X}_{i+1} - \hat{X}_i, \qquad \Delta \hat{Y}_i = \hat{Y}_{i+1} - \hat{Y}_i, \qquad \hat{S}_i = \sqrt{\Delta \hat{X}_i^2 + \Delta \hat{Y}_i^2}$$

$$\phi_i = \operatorname{atan2}(\Delta \hat{Y}_i,\; \Delta \hat{X}_i) \in (-\pi, \pi]$$

$$\hat{x}_{c,i} = \frac{\hat{X}_i + \hat{X}_{i+1}}{2}, \qquad \hat{y}_{c,i} = \frac{\hat{Y}_i + \hat{Y}_{i+1}}{2} \quad (\text{コロケーション点＝パネル中点})$$

- **単位接線ベクトル（時計回り方向）**:
  $$\mathbf{t}_i = (\cos\phi_i,\; \sin\phi_i)$$
- **単位外向き法線ベクトル（翼内部から外部へ向かう方向）**:
  $$\mathbf{n}_i = (-\sin\phi_i,\; \cos\phi_i)$$

> [!IMPORTANT]
> **符号・向きの検算ルール（実装時必須確認）**
> - 下面パネル（後縁 $\to$ 前縁）：$\Delta\hat{X}_i < 0, \Delta\hat{Y}_i \approx 0 \implies \phi_i \approx \pi \implies \mathbf{t}_i \approx (-1, 0)$、$\mathbf{n}_i \approx (0, -1)$（下向き＝外向き）。
> - 前縁付近（下面 $\to$ 上面）：$\Delta\hat{X}_i \approx 0, \Delta\hat{Y}_i > 0 \implies \phi_i \approx +\pi/2 \implies \mathbf{t}_i \approx (0, 1)$、$\mathbf{n}_i \approx (-1, 0)$（前向き＝外向き）。
> - 上面パネル（前縁 $\to$ 後縁）：$\Delta\hat{X}_i > 0, \Delta\hat{Y}_i \approx 0 \implies \phi_i \approx 0 \implies \mathbf{t}_i \approx (1, 0)$、$\mathbf{n}_i \approx (0, 1)$（上向き＝外向き）。
> - 任意の $i$ について $\det[\mathbf{t}_i, \mathbf{n}_i] = \cos^2\phi_i + \sin^2\phi_i = +1$ となり、局所座標 $(\xi, \eta)$（$\xi$ が $\mathbf{t}_i$ 方向、$\eta$ が $\mathbf{n}_i$ 方向）は右手正規直交基底をなす。また **$\eta > 0$ が常に翼外部側** に対応する。

### 3.3 Full-Cosine クラスタリングとパネル数規約

前縁の急激な圧力ピーク（最小 $C_p$・よどみ点移動）と後縁の Kutta 条件の双方を高精度に解像するため、弦方向パラメータ $\xi \in [0, 1]$ に **Full-cosine クラスタリング**を適用する。

- **パネル数 `num_panels` ($N$) の統合規約**:
  - **デフォルト値**: **`N = 160`**（簡易モード・本格モード初期値共通）
  - **設定許容範囲**: **`40 <= N <= 300` かつ偶数のみ（`multipleOf: 2`）**
  - **根拠**: $N < 40$ では前縁吸込ピークの解像不足により圧力積分 $C_{L,p}$ の誤差が増大し、$N > 300$ では閉後縁先端の極小パネル同士が接近しすぎて影響係数行列の条件数が悪化するため制限する。また偶数に固定することで、対称翼（NACA 0012）の $\alpha = 0^\circ$ 解析において前縁 $(0, 0)$ が厳密に第 $N/2 + 1$ 節点となり、上下パネル配置が機械精度レベルで完全対称になる。
- **節点パラメータ生成手順**:
  片面パネル数を $N_h = N / 2$ とし、$k = 0, 1, \dots, N_h$ に対して

  $$\beta_k = \frac{\pi k}{N_h}, \qquad \xi_k = \frac{1}{2}(1 - \cos\beta_k) \in [0, 1]$$

  を生成する（$\xi_0 = 0$ が前縁、$\xi_{N_h} = 1$ が後縁）。
  - 下面節点列：$\xi_{N_h}, \xi_{N_h - 1}, \dots, \xi_1$（$N_h$ 点：後縁 $(1,0)$ から前縁直前まで）
  - 前縁節点：$\xi_0 = 0$（1点：上下共有）
  - 上面節点列：$\xi_1, \xi_2, \dots, \xi_{N_h}$ に対応する上面点（$N_h$ 点：前縁直後から後縁 $(1,0)$ まで）
  これにより合計 $N + 1$ 個の節点と $N$ 個のパネル（$i = 1, \dots, N_h$ が `side = "lower"`、$i = N_h + 1, \dots, N$ が `side = "upper"`）が得られる。

---

## 4. 翼型座標生成・前処理アルゴリズム

### 4.1 NACA 4桁翼型生成式（`0012`, `2412`, `4412`, `6412` および任意4桁コード）

4桁コード `MPXX`（各桁 $M, P \in \{0,\dots,9\}$, $XX \in \{01,\dots,40\}$、ただし $M > 0$ のとき $P \in \{1,\dots,9\}$；$M=0$ かつ $P \neq 0$、または $M \neq 0$ かつ $P=0$ は不正コードとして `422` エラー）から以下の3無次元パラメータを定める：

$$m = \frac{M}{100} \;(\text{最大キャンバー比}), \qquad p = \frac{P}{10} \;(\text{最大キャンバー弦方向位置}), \qquad t = \frac{XX}{100} \;(\text{最大翼厚比})$$

| 標準プリセット翼型 | $m$ | $p$ | $t$ | 特徴 |
| :--- | :---: | :---: | :---: | :--- |
| **NACA 0012** | $0.00$ | $0.0$ | $0.12$ | 12%厚 対称翼型（迎角 $0^\circ$ で $C_L = 0, C_{m,c/4} = 0$） |
| **NACA 2412** | $0.02$ | $0.4$ | $0.12$ | 2%キャンバー（40%弦位置）・12%厚 |
| **NACA 4412** | $0.04$ | $0.4$ | $0.12$ | 4%キャンバー（40%弦位置）・12%厚 |
| **NACA 6412** | $0.06$ | $0.4$ | $0.12$ | 6%キャンバー（40%弦位置）・12%厚（高揚力キャンバー翼） |

1. **平均キャンバー曲線 $y_c(\xi)$ と勾配角 $\theta(\xi)$**:
   - 対称翼（$m = 0$）のとき：
     $$y_c(\xi) = 0, \qquad \frac{dy_c}{d\xi} = 0, \qquad \theta(\xi) = 0$$
   - キャンバー翼（$m > 0,\; 0 < p < 1$）のとき：
     $$y_c(\xi) = \begin{cases} \dfrac{m}{p^2}(2p\xi - \xi^2) & (0 \le \xi < p) \\[8pt] \dfrac{m}{(1-p)^2}\bigl((1 - 2p) + 2p\xi - \xi^2\bigr) & (p \le \xi \le 1) \end{cases}$$

     $$\frac{dy_c}{d\xi} = \begin{cases} \dfrac{2m}{p^2}(p - \xi) & (0 \le \xi < p) \\[8pt] \dfrac{2m}{(1-p)^2}(p - \xi) & (p \le \xi \le 1) \end{cases}, \qquad \theta(\xi) = \arctan\!\left(\frac{dy_c}{d\xi}\right)$$

2. **半厚み分布 $y_t(\xi)$ と後縁閉合オプション (`closed_te`)**:

   $$y_t(\xi) = 5t\left(0.2969\sqrt{\xi} - 0.1260\xi - 0.3516\xi^2 + 0.2843\xi^3 + a_4\xi^4\right)$$

   $$a_4 = \begin{cases} -0.1036 & (\texttt{closed\_te = true}:\; \text{デフォルト閉後縁}, \; y_t(1) = 0.0000) \\ -0.1015 & (\texttt{closed\_te = false}:\; \text{NACA原典開後縁}, \; y_t(1) = +0.0105t) \end{cases}$$

   - **デフォルトを `closed_te = true` ($a_4 = -0.1036$) とする数値的根拠と `closed_te = false` の厳密仕様**:
     開後縁のまま後縁端面パネルを省略すると閉曲線条件（$\oint \mathbf{V}\cdot\mathbf{n}\,ds = 0$）が破れて後縁付近でギャップ分のみかけ湧き出しが生じ、逆に微小な垂直端面パネル（鈍頭後縁パネル）を挿入すると非粘性流では角部特異性により悪条件化・振動が生じる。したがって Phase 1 パネル法では $y_t(1)=0$ となる修正第4次係数 $a_4 = -0.1036$ を標準採用する。一方、本格モードで `closed_te = false` が明示指定された場合は、NACA翼型では原典の開後縁座標（$a_4 = -0.1015$, $\Delta\hat{y}_{\mathrm{TE}} = +0.021t$）をそのまま保持し、後縁端面パネルは置かず上下最終パネル（$i=1, N$）に線形 Kutta 条件 $V_{t,1}+V_{t,N}=0$ を課す（ただし翼内部判定用の閉ポリゴンのみ後縁始終点を線分で閉じて判定し、10.2節の吹出し総和検査閾値にギャップ $|\Delta\hat{y}_{\mathrm{TE}}|$ を加味する）。

3. **法線方向オフセットによる上下表面座標**:

   $$\hat{x}_U(\xi) = \xi - y_t(\xi)\sin\theta(\xi), \qquad \hat{y}_U(\xi) = y_c(\xi) + y_t(\xi)\cos\theta(\xi)$$
   $$\hat{x}_L(\xi) = \xi + y_t(\xi)\sin\theta(\xi), \qquad \hat{y}_L(\xi) = y_c(\xi) - y_t(\xi)\cos\theta(\xi)$$

### 4.2 カスタム翼型（DAT / CSV）の正規化・閉合・スプライン再パネル化

本格モードでユーザーが読み込む Selig 形式・Lednicer 形式 DAT ファイルおよび CSV 座標データに対しては、以下の5段階パイプラインで前処理を行う。

1. **パーサと形式自動判別**:
   - 先頭の文字列ヘッダ行・空行・コメント行（`#` 始まり）をスキップし、2列の浮動小数点座標列 $(x_r, y_r)$ を抽出する（有効点数 $< 12$ の場合は `INVALID_AIRFOIL_GEOMETRY` として `422` エラー）。
   - Lednicer 形式の先頭点数行（例：`61. 61.` のように両値が $> 2.0$ かつ整数相当の行）を検出して除去する。
   - 座標進行パターンの判別：
     - **Selig 形式（反時計回り一筆書き：上面後縁 $(1,0) \to$ 前縁 $(0,0) \to$ 下面後縁 $(1,0)$）**: 列全体を逆順（リバース）にして時計回りへ変換。
     - **Lednicer 形式（ブロック1：前縁 $\to$ 上面後縁、ブロック2：前縁 $\to$ 下面後縁）**: ブロック2を逆順にしてブロック1と結合し、前縁重複点を統合して時計回り一筆書きへ変換。
     - **既に時計回り（下面後縁 $\to$ 前縁 $\to$ 上面後縁）**: そのまま採用。
   - 隣接2点間距離 $\sqrt{\Delta x^2 + \Delta y^2} < 10^{-9}$ の重複点を除去する。

2. **弦長正規化・回転補正（De-rotation & Unit-chord Normalization）**:
   - 折れ線弧長 $s$ をパラメータとする周期/自然境界3次スプライン $(\tilde{x}(s), \tilde{y}(s))$ を構築し、後縁中点 $\mathbf{P}_{\mathrm{TE}} = \frac{1}{2}(\mathbf{P}_1 + \mathbf{P}_{\mathrm{end}})$ から最も遠いスプライン上の点（最適化により厳密な最前点 $\mathbf{P}_{\mathrm{LE}}$ を特定）を前縁とする。
   - 翼弦ベクトル $\mathbf{c}_{\mathrm{vec}} = \mathbf{P}_{\mathrm{TE}} - \mathbf{P}_{\mathrm{LE}}$ の長さ $c_{\mathrm{raw}} = \|\mathbf{c}_{\mathrm{vec}}\|$ と傾き角 $\psi_0 = \operatorname{atan2}(y_{\mathrm{TE}} - y_{\mathrm{LE}}, x_{\mathrm{TE}} - x_{\mathrm{LE}})$ を求め、全点に平行移動・回転・スケーリングを適用して $\mathbf{P}_{\mathrm{LE}} \mapsto (0, 0)$、$\mathbf{P}_{\mathrm{TE}} \mapsto (1, 0)$ に正規化する（$|c_{\mathrm{raw}} - 1| > 10^{-4}$ または $|\psi_0| > 10^{-4}\;\mathrm{rad}$ の補正を行った場合は `CUSTOM_AIRFOIL_NORMALIZED` 情報警告を発行し、元弦長 $c_{\mathrm{raw}}$ と回転補正角 $\psi_0$ [deg] をメッセージに明示する）。

3. **後縁閉合処理（Linear Trailing-Edge Blending）**:
   - `closed_te = true` かつ後縁上下端ギャップ $\Delta \hat{y}_{\mathrm{TE}} = \hat{y}_{\mathrm{TE},U} - \hat{y}_{\mathrm{TE},L}$ が $|\Delta \hat{y}_{\mathrm{TE}}| > 10^{-5}$ の場合、翼全体のキャンバー形状を崩さずに後縁を $(1, 0)$ へ滑らかに一致させる弦方向線形ブレンドを適用し、`OPEN_TE_CLOSED_AUTO` 情報警告を発行する（`closed_te = false` の場合はブレンドせず開後縁を保持する）：
     $$\hat{y}_{U,\mathrm{closed}}(\hat{x}) = \hat{y}_U(\hat{x}) - \frac{1}{2}\Delta \hat{y}_{\mathrm{TE}}\cdot \hat{x}, \qquad \hat{y}_{L,\mathrm{closed}}(\hat{x}) = \hat{y}_L(\hat{x}) + \frac{1}{2}\Delta \hat{y}_{\mathrm{TE}}\cdot \hat{x}$$

4. **3次スプライン再パネル化（Cosine Re-paneling）**:
   - 正規化・閉合後の点列に対し弧長パラメータ $s \in [0, S_{\mathrm{total}}]$ 上の `scipy.interpolate.CubicSpline` を構成する。
   - 前縁弧長位置 $s_{\mathrm{LE}}$ で下面区間 $[0, s_{\mathrm{LE}}]$ と上面区間 $[s_{\mathrm{LE}}, S_{\mathrm{total}}]$ に分割し、Full-cosine 分布 $\xi_k = \frac{1}{2}(1 - \cos(\pi k / N_h))$ に対応する節点を再サンプリングして時計回り $N$ パネルを生成する。

5. **幾何学的妥当性検査**:
   - 内部弦位置（$0.01 \le \hat{x} \le 0.99$）において上面と下面が交差・逆転（$\hat{y}_U(\hat{x}) \le \hat{y}_L(\hat{x})$）していないこと、および非隣接パネル線分同士の自己交差が存在しないことを検査する。違反時は計算を実行せず `422 Unprocessable Entity` を返す。

---

## 5. Hess-Smith 2Dパネル法の定式化

### 5.1 局所座標変換と距離変数

任意の空間評価点またはコロケーション点 $(\hat{x}, \hat{y})$ を、第 $j$ パネル（始点 $(\hat{X}_j, \hat{Y}_j)$、傾き角 $\phi_j$、パネル長 $\hat{S}_j$）の局所座標系 $(\xi, \eta)$ へ変換する：

$$\xi = (\hat{x} - \hat{X}_j)\cos\phi_j + (\hat{y} - \hat{Y}_j)\sin\phi_j$$
$$\eta = -(\hat{x} - \hat{X}_j)\sin\phi_j + (\hat{y} - \hat{Y}_j)\cos\phi_j$$

パネル始点 $(0, 0)$ および終点 $(\hat{S}_j, 0)$ からの距離二乗を次式で定義する：

$$r_1^2 = \xi^2 + \eta^2, \qquad r_2^2 = (\xi - \hat{S}_j)^2 + \eta^2$$

### 5.2 分岐切断（Branch-cut）フリーの解析的特異積分公式

パネル $j$ 上に一様分布する単位吹出し（$\hat{\sigma}_j = 1$）および単位時計回り渦（$\hat{\gamma} = 1$）が局所座標 $(\xi, \eta)$ に誘起する速度成分を導出する際、$\theta_2 - \theta_1 = \operatorname{atan2}(\eta, \xi - \hat{S}_j) - \operatorname{atan2}(\eta, \xi)$ をそのまま計算すると、パネル延長線上（$\eta \approx 0, \xi < 0$）で $\pm\pi$ の分岐切断を跨ぎ $2\pi$ の非物理的ジャンプ誤差が発生しうる。

これを完全に防止するため、複素平面上の比 $z_2 / z_1 = \frac{(\xi - \hat{S}_j) + i\eta}{\xi + i\eta} = \frac{\xi(\xi - \hat{S}_j) + \eta^2 + i\eta\hat{S}_j}{\xi^2 + \eta^2}$ の偏角に基づく**単一 `atan2` 公式**を採用する：

$$\Lambda(\xi, \eta; \hat{S}_j) = \frac{1}{2}\ln\!\left(\frac{r_2^2}{r_1^2}\right), \qquad \beta(\xi, \eta; \hat{S}_j) = \operatorname{atan2}\!\Bigl(\eta \hat{S}_j,\; \xi(\xi - \hat{S}_j) + \eta^2\Bigr) \in (-\pi, \pi]$$

ここで $\beta$ は評価点からパネル $j$ を見込む符号付き視角（$\eta > 0$ の外側面で $\beta > 0$、$\eta < 0$ の内側面で $\beta < 0$、パネル延長線上 $\eta = 0, \xi \notin [0, \hat{S}_j]$ で連続的に $\beta = 0$）である。

1. **単位強度吹出しパネル（$\hat{\sigma}_j = 1$）によるパネル $j$ 局所誘起速度 $(u_s, v_s)$**:
   $$u_s = \frac{1}{2\pi}\int_0^{\hat{S}_j} \frac{\xi - s}{(\xi - s)^2 + \eta^2}\,ds = -\frac{\Lambda}{2\pi}, \qquad v_s = \frac{1}{2\pi}\int_0^{\hat{S}_j} \frac{\eta}{(\xi - s)^2 + \eta^2}\,ds = +\frac{\beta}{2\pi}$$

2. **単位強度時計回り渦パネル（$\hat{\gamma} = 1$）によるパネル $j$ 局所誘起速度 $(u_v, v_v)$**:
   時計回り微小点渦 $d\hat{\Gamma} = \hat{\gamma}\,ds$ が誘起する速度ベクトル $\frac{d\hat{\Gamma}}{2\pi r^2}\bigl(\eta, -(\xi - s)\bigr)$ を積分して次式を得る：
   $$u_v = +\frac{\beta}{2\pi} = v_s, \qquad v_v = +\frac{\Lambda}{2\pi} = -u_s$$

3. **全体座標系 $(\hat{x}, \hat{y})$ における誘起速度ベクトルへの変換**:
   任意の局所誘起速度 $(u_{\mathrm{loc}}, v_{\mathrm{loc}})$ は、$\mathbf{V}_{\mathrm{glob}} = u_{\mathrm{loc}}\mathbf{t}_j + v_{\mathrm{loc}}\mathbf{n}_j$ より全体座標系へ次式で変換される：
   $$\hat{u}_{\mathrm{glob}} = u_{\mathrm{loc}}\cos\phi_j - v_{\mathrm{loc}}\sin\phi_j, \qquad \hat{v}_{\mathrm{glob}} = u_{\mathrm{loc}}\sin\phi_j + v_{\mathrm{loc}}\cos\phi_j$$

### 5.3 コロケーション点間の法線・接線影響係数行列

第 $j$ パネルから第 $i$ パネル中点 $(\hat{x}_{c,i}, \hat{y}_{c,i})$ への法線方向および接線方向影響係数を $A_{n,ij}, A_{t,ij}$（吹出し）および $B_{n,ij}, B_{t,ij}$（渦）とする。

- **非対角成分（$i \neq j$）**:
  パネル角度差 $\Delta\phi_{ij} = \phi_i - \phi_j$（実装時は三角関数の加法定理 $\cos\Delta\phi_{ij} = \cos\phi_i\cos\phi_j + \sin\phi_i\sin\phi_j$, $\sin\Delta\phi_{ij} = \sin\phi_i\cos\phi_j - \cos\phi_i\sin\phi_j$ で高速計算可能）を用いて、
  $$A_{n,ij} = -u_{s,ij}\sin\Delta\phi_{ij} + v_{s,ij}\cos\Delta\phi_{ij}, \qquad A_{t,ij} = u_{s,ij}\cos\Delta\phi_{ij} + v_{s,ij}\sin\Delta\phi_{ij}$$
  $$B_{n,ij} = -u_{v,ij}\sin\Delta\phi_{ij} + v_{v,ij}\cos\Delta\phi_{ij} = -v_{s,ij}\sin\Delta\phi_{ij} - u_{s,ij}\cos\Delta\phi_{ij} = -A_{t,ij}$$
  $$B_{t,ij} = u_{v,ij}\cos\Delta\phi_{ij} + v_{v,ij}\sin\Delta\phi_{ij} = v_{s,ij}\cos\Delta\phi_{ij} - u_{s,ij}\sin\Delta\phi_{ij} = +A_{n,ij}$$

  > [!TIP]
  > **共役関係による高速・無バグ実装**: $u_v = v_s,\; v_v = -u_s$ を代入すると、すべての $i \neq j$ に対して恒等的に
  > $$B_{n,ij} = -A_{t,ij}, \qquad B_{t,ij} = +A_{n,ij}$$
  > が成り立つ。これは複素解析におけるコーシー・リーマン関係式の離散表現そのものであり、後述する対角項 $i = j$（$A_{n,ii} = +1/2, A_{t,ii} = 0, B_{n,ii} = 0, B_{t,ii} = +1/2$）でも $B_{n,ii} = -A_{t,ii} = 0,\; B_{t,ii} = +A_{n,ii} = +1/2$ が完全に成立する！

- **対角成分（自己パネル特異積分：$i = j$、翼外側面極限 $\xi = \hat{S}_i/2,\; \eta \to 0^+$）**:
  パネル中点の外側面極限では $r_1 = r_2 = \hat{S}_i/2 \implies \Lambda = 0$（コーシー主値）、かつ $\beta \to +\pi$ となるため、
  $$A_{n,ii} = +\frac{1}{2}, \qquad A_{t,ii} = 0, \qquad B_{n,ii} = 0, \qquad B_{t,ii} = +\frac{1}{2}$$

---

## 6. 境界条件・Kutta条件・連立一次方程式

### 6.1 $(N+1) \times (N+1)$ 線形系の構成

未知数ベクトルを

$$\mathbf{q} = \bigl[\hat{\sigma}_1,\; \hat{\sigma}_2,\; \dots,\; \hat{\sigma}_N,\; \hat{\gamma}\bigr]^T \in \mathbb{R}^{N+1}$$

とし、連立一次方程式 $M \mathbf{q} = \mathbf{b}$ を構成する。

1. **翼面非貫通境界条件（第 $1 \sim N$ 行：$\hat{\mathbf{V}}_i \cdot \mathbf{n}_i = 0$）**:
   無次元一様流 $\mathbf{e}_\infty = (\cos\alpha, \sin\alpha)$ の第 $i$ パネル外向き法線成分は
   $$\mathbf{e}_\infty \cdot \mathbf{n}_i = -\cos\alpha\sin\phi_i + \sin\alpha\cos\phi_i = \sin(\alpha - \phi_i)$$
   であるから、各コロケーション点 $i = 1, \dots, N$ で次式を課す：
   $$\sum_{j=1}^N A_{n,ij}\hat{\sigma}_j + \left(\sum_{j=1}^N B_{n,ij}\right)\hat{\gamma} = -\sin(\alpha - \phi_i) \qquad (i = 1, \dots, N)$$
   すなわち行列要素は $M_{i,j} = A_{n,ij}\; (j=1,\dots,N)$、$M_{i,N+1} = \sum_{j=1}^N B_{n,ij} = -\sum_{j=1}^N A_{t,ij}$、右辺は $b_i = -\sin(\alpha - \phi_i)$ である。

2. **線形 Kutta 条件（第 $N+1$ 行：後縁での滑らかな流出と圧力一致）**:
   粘性流体の薄膜境界層極限（$Re \to \infty$）において、鋭い後縁を回り込む無限大流速は物理的に許容されず、流れは後縁から滑らかに流出して後縁上下の圧力が一致する（$C_{p,1} = C_{p,N}$）。
   時計回り接線定義により、後縁から流出する順流では
   - 下面後縁パネル（$i = 1$：後縁 $\to$ 前縁向き）では接線速度は負（$V_{t,1} < 0$、後縁方向は $-\mathbf{t}_1$）、
   - 上面後縁パネル（$i = N$：前縁 $\to$ 後縁向き）では接線速度は正（$V_{t,N} > 0$、後縁方向は $+\mathbf{t}_N$）
   となる。したがって両パネルの後縁流出速さが等しく（$|V_{t,1}| = |V_{t,N}|$）かつ後縁回り込みがゼロとなる線形条件は **$V_{t,1} + V_{t,N} = 0$** で与えられる：

   $$\sum_{j=1}^N \bigl(A_{t,1j} + A_{t,Nj}\bigr)\hat{\sigma}_j + \left(\sum_{j=1}^N \bigl(B_{t,1j} + B_{t,Nj}\bigr)\right)\hat{\gamma} = -\bigl(\cos(\alpha - \phi_1) + \cos(\alpha - \phi_N)\bigr)$$

   この式を満たすとき、ベルヌーイの定理から
   $$C_{p,1} = 1 - \left(\frac{V_{t,1}}{V_\infty}\right)^2 = 1 - \left(-\frac{V_{t,N}}{V_\infty}\right)^2 = C_{p,N}$$
   が機械精度で厳密に保証される（非物理的な解 $V_{t,1} = V_{t,N}$ は後縁を高速で回り込む循環流に対応するため排除される）。

### 6.2 線形ソルバーと循環 $\Gamma$ の算出

- 線形系 $M\mathbf{q} = \mathbf{b}$ は密行列 $(N+1)\times(N+1)$（標準 $161 \times 161$）であり、ピボット選択付き LU 分解（`scipy.linalg.solve(M, b)`）により計算時間 $1 \sim 3\,\mathrm{ms}$ で直接解を得る。
- 得られた無次元渦強度 $\hat{\gamma} = q_{N+1}$ から、無次元循環 $\hat{\Gamma}$ および有次元循環 $\Gamma$ [$\mathrm{m^2/s}$] を次式で算出する：
  $$\hat{\Gamma} = \hat{\gamma}\sum_{j=1}^N \hat{S}_j, \qquad \Gamma = V_\infty c\,\hat{\Gamma}$$

---

## 7. 表面速度・圧力係数・空力係数の算出と $C_D = \mathrm{null}$ の根拠

### 7.1 表面接線速度比と圧力係数 $C_{p,i}$

各パネル中点 $i = 1, \dots, N$ における無次元表面接線速度は、既に構築済みの接線影響係数行列を用いて $O(N^2)$ の行列ベクトル積で直ちに求まる：

$$\frac{V_{t,i}}{V_\infty} = \cos(\alpha - \phi_i) + \sum_{j=1}^N A_{t,ij}\hat{\sigma}_j + \left(\sum_{j=1}^N B_{t,ij}\right)\hat{\gamma}$$

非圧縮ベルヌーイの定理より、各パネルの圧力係数 $C_{p,i}$ は次式で定まる：

$$C_{p,i} = \frac{p_i - p_\infty}{\frac{1}{2}\rho V_\infty^2} = 1 - \left(\frac{V_{t,i}}{V_\infty}\right)^2$$

- **符号の扱い**:
  - 接線速度比 `vt_ratio`（または CSV の `vt_over_vinf`）は時計回り接線 $\mathbf{t}_i$ に沿う符号付き値（通常、上面で正、下面で負、前縁よどみ点で符号反転）である。前縁よどみ点位置は $V_{t,i}$ が負から正へゼロクロスする隣接パネル中点間の線形補間で特定できる。
  - UIで「表面流速の速さ比」を表示する際は絶対値 $|V_{t,i}| / V_\infty$ を参照する。

### 7.2 揚力係数 $C_L$（2手法の算出とクロスチェック）

AirFlow Lab では数値計算の健全性を常時自己診断するため、物理的に独立な2つの方法で揚力係数を算出し比較する。

1. **主表示値 `cl`（Kutta-Joukowski 定理による揚力係数 $C_{L,\mathrm{KJ}}$）**:
   2次元ポテンシャル流における Kutta-Joukowski の定理 $L' = \rho V_\infty \Gamma$ より、
   $$C_{L,\mathrm{KJ}} = \frac{L'}{\frac{1}{2}\rho V_\infty^2 c} = \frac{2\Gamma}{V_\infty c} = 2\hat{\Gamma} = 2\hat{\gamma}\sum_{j=1}^N \hat{S}_j$$
   パネル中点での前縁ピーク離散化誤差の影響を受けにくく大域的循環から直接定まるため、**APIレスポンスの `coefficients.cl`（主表示値）には $C_{L,\mathrm{KJ}}$ を採用する**。

2. **検証値 `cl_pressure_integration`（表面圧力積分による揚力係数 $C_{L,p}$）**:
   第 $i$ パネルに働く圧力は外向き法線 $\mathbf{n}_i$ と逆向き（翼を押す内向き $-\mathbf{n}_i$）に作用するため、無次元空気力の翼固定座標成分 $(C_X, C_Y)$ は
   $$\Delta C_{X,i} = -C_{p,i} n_{x,i} \hat{S}_i, \qquad \Delta C_{Y,i} = -C_{p,i} n_{y,i} \hat{S}_i$$
   $$C_X = \sum_{i=1}^N \Delta C_{X,i}, \qquad C_Y = \sum_{i=1}^N \Delta C_{Y,i}$$
   これを一様流方向 $\mathbf{e}_\infty = (\cos\alpha, \sin\alpha)$ に直交する揚力方向単位ベクトル $\mathbf{e}_L = (-\sin\alpha, \cos\alpha)$ へ射影して $C_{L,p}$ を得る：
   $$C_{L,p} = -C_X\sin\alpha + C_Y\cos\alpha$$

3. **クロスチェック差分 `cl_discrepancy`**:
   $$\Delta C_L = |C_{L,\mathrm{KJ}} - C_{L,p}|$$
   を `diagnostics.cl_discrepancy` に常時出力する。標準 `N = 160` では実用迎角域で相対差 $\Delta C_L / |C_{L,\mathrm{KJ}}| < 0.8\%$ に収まる。相対差が $5\%$（小揚力時 $|C_{L,\mathrm{KJ}}| < 0.2$ では絶対差 $0.01$：境界 $0.2 \times 5\% = 0.01$ で連続）を超えた場合は `CL_CROSSCHECK_WARN` 警告を発行する。

### 7.3 1/4弦点周りピッチングモーメント係数 $C_{m,c/4}$（頭上げ正）

航空工学の標準規約に従い、前縁から 25% 弦長位置 $(\hat{x}_{\mathrm{ref}}, \hat{y}_{\mathrm{ref}}) = (0.25, 0.0)$ 周りのピッチングモーメント係数を **頭上げ（Nose-up）正** として定義する。
翼前縁が左 $(0,0)$、後縁が右 $(1,0)$、上面が $+y$ の座標系では、頭上げ方向（前縁が $+y$ へ上がり後縁が $-y$ へ下がる回転）は $(x,y)$ 平面上で**時計回り（$-z$ 軸回り）**であるため、反時計回り正の2次元外積 $(\hat{\mathbf{r}}_i \times \Delta\mathbf{C}_i)_z$ に負号を付す：

$$C_{m,c/4} = -\sum_{i=1}^N \Bigl[(\hat{x}_{c,i} - 0.25)\,\Delta C_{Y,i} - \hat{y}_{c,i}\,\Delta C_{X,i}\Bigr]$$

- **符号の物理検算**: 正キャンバー翼（例：NACA 2412, $\alpha = 0^\circ$）では最大キャンバーが $0.4c$ 付近にあるため $x/c > 0.25$ 側の揚力寄与 $\Delta C_{Y,i} > 0$ が勝り、$(\hat{x}_{c,i}-0.25)\Delta C_{Y,i} > 0 \implies C_{m,c/4} < 0$（頭下げモーメント、NACA 2412 薄翼理論値 $-0.0529$ に対しパネル法計算値 $\approx -0.0539$）となって物理的符号と完全一致する。

### 7.4 抗力係数 `cd = null` の厳格仕様

- 一様流方向への圧力積分射影値
  $$C_{D,p} = C_X\cos\alpha + C_Y\sin\alpha$$
  は連続系（$N \to \infty$）のダランベールのパラドックスにより厳密解が $0$ であり、有限パネル数 $N$ で生じる微小値（通常 $|C_{D,p}| \sim 10^{-4} \sim 10^{-3}$）は前縁曲率部の離散化誤差（Induced numerical pressure error）に過ぎない。
- これを `cd: 0.0` と表示すると初学者が「翼には抗力が働かない」と誤解し、逆に `C_{D,p}` の数値を表示すると「パネル法で抗力が計算できた」という重大な物理的虚偽になる。
- したがって **Phase 1 では `coefficients.cd` を常時 `null` とし、`0` や数値へのフォールバックをバックエンド・フロントエンド双方で禁止する**。数値診断目的の $C_{D,p}$ は `diagnostics.cd_pressure_numerical_error` フィールドのみに隔離保持する。

---

## 8. 流体物性推算と無次元数（$Re, M$）・妥当性警告基準

### 8.1 流体物性の決定モード（`fluid_properties`）

リクエストの `fluid_properties.mode` に応じて、密度 $\rho$ [$\mathrm{kg/m^3}$]、粘性係数 $\mu$ [$\mathrm{Pa\cdot s}$]、動粘性係数 $\nu$ [$\mathrm{m^2/s}$]、音速 $a$ [$\mathrm{m/s}$] を以下の通り決定する。

1. **プリセット `"water_20c"` 指定時（液体水 20℃ 標準値：`mode` より最優先で適用）**:
   $$\rho = 998.2\;\mathrm{kg/m^3}, \quad \mu = 1.002\times 10^{-3}\;\mathrm{Pa\cdot s}, \quad \nu = \frac{\mu}{\rho} = 1.003807\times 10^{-6}\;\mathrm{m^2/s}, \quad a = 1482.0\;\mathrm{m/s}$$

2. **`mode = "temperature_auto"`（理想気体空気 ＋ Sutherland 則：`preset != "water_20c"` 時）**:
   入力温度 $T$ [K]（デフォルト `293.15` K = 20℃；プリセット `"air_0c"` は `273.15` K）および静圧 $p_\infty$ [Pa]（デフォルト `101325.0` Pa）に対し、乾燥空気の気体定数 $R_{\mathrm{air}} = 287.058\;\mathrm{J/(kg\cdot K)}$、比熱比 $\gamma_{\mathrm{air}} = 1.4$ を用いて推算する：
   $$\rho = \frac{p_\infty}{R_{\mathrm{air}} T}$$
   $$\mu(T) = \mu_0 \left(\frac{T}{T_0}\right)^{3/2} \frac{T_0 + S}{T + S} \qquad (\mu_0 = 1.716\times 10^{-5}\;\mathrm{Pa\cdot s},\; T_0 = 273.15\;\mathrm{K},\; S = 110.4\;\mathrm{K})$$
   $$\nu = \frac{\mu}{\rho}, \qquad a = \sqrt{\gamma_{\mathrm{air}} R_{\mathrm{air}} T}$$
   （検算：$T = 293.15\;\mathrm{K}, p_\infty = 101325\;\mathrm{Pa}$ のとき $\rho = 1.204085\;\mathrm{kg/m^3}$, $\mu = 1.813322\times 10^{-5}\;\mathrm{Pa\cdot s}$, $\nu = 1.505975\times 10^{-5}\;\mathrm{m^2/s}$, $a = 343.2368\;\mathrm{m/s}$。）

3. **`mode = "direct_mu"`（密度 $\rho$・粘性係数 $\mu$ 直接入力：`preset == "custom"` 時）**:
   入力された $\rho > 0,\; \mu > 0$ をそのまま用い、$\nu = \mu / \rho$ とする。音速 $a$ は `speed_of_sound_mps` が指定されていればそれを用いる。未指定（`null`）時は、気体密度域（$\rho \le 10.0\;\mathrm{kg/m^3}$）であれば入力温度 $T$ から $\sqrt{\gamma_{\mathrm{air}} R_{\mathrm{air}} T}$ で算出し、高密度液体相当（$\rho > 10.0\;\mathrm{kg/m^3}$）であれば空気音速式の誤適用を防ぐため `422` バリデーションエラー（`speed_of_sound_mps` 指定必須）とする。

4. **`mode = "direct_nu"`（密度 $\rho$・動粘性係数 $\nu$ 直接入力：`preset == "custom"` 時）**:
   入力された $\rho > 0,\; \nu > 0$ をそのまま用い、$\mu = \rho \nu$ とする（音速 $a$ の決定規則は同上）。

### 8.2 レイノルズ数 $Re$・マッハ数 $M$ と Phase 1 での役割

$$Re = \frac{\rho V_\infty c}{\mu} = \frac{V_\infty c}{\nu}, \qquad M = \frac{V_\infty}{a}$$

> [!NOTE]
> **Phase 1 における無次元解の $Re, M$ 非依存性**  
> ラプラス方程式 $\nabla^2\Phi = 0$ と非貫通条件・Kutta条件には $\rho, \mu, \nu, a$ が一切含まれないため、**Phase 1 の無次元解（$C_p(\hat{x}), C_L, C_{m,c/4}$, 無次元速度場 $\hat{\mathbf{V}}$, 流線形状）は $Re$ や $M$ を変えても変化しない**。AirFlow Lab ではこの事実を隠さず解説パネルに明記した上で、(1) 実際の風洞実験や航空機スケールとの対応付け（$Re$ による流れ領域の理解）、(2) 有次元速度・循環・揚力の換算、(3) 非圧縮・薄境界層近似が成り立つかどうかの**妥当性警告判定**に $Re, M$ を活用する。

### 8.3 統一警告判定テーブル（`warnings`）

すべてのソルバー実行後に以下の閾値判定を行い、該当する警告オブジェクト `{ code, severity, title, message }` を配列で返却する（複数同時該当可。迎角警告とマッハ数警告はそれぞれ上位の `critical` が発火した際は同系統の下位 `warning` を重複発火させない）。

| 判定条件 | 警告コード (`code`) | 重要度 (`severity`) | 物理的根拠とユーザーへの伝達要旨 |
| :--- | :--- | :---: | :--- |
| $10^\circ < |\alpha| \le 12^\circ$ | `HIGH_AOA_CAUTION` | `warning` | **剥離開始域の注意**：実際の翼では上面後縁側から境界層の剥離が始まり揚力の伸びが鈍化する角度域。パネル法は剥離を計算できないため $C_L$ を過大評価している可能性がある。 |
| $|\alpha| > 12^\circ$ | `STALL_UNMODELED` | `critical` | **失速（ストール）未考慮の強い警告**：実機・風洞実験では通常 $12^\circ \sim 16^\circ$ 前後で流れが大きく剥離して失速し $C_L$ が急減する。非粘性パネル法では失速を再現できないため、表示される高い $C_L$ は現実の流れと大きく異なる。 |
| $0.3 \le M < 0.7$（かつ下記 `critical` 非該当） | `COMPRESSIBILITY_CAUTION` | `warning` | **圧縮性影響の注意**：マッハ数が $0.3$ 以上の亜音速域では空気の密度変化が無視できなくなり、非圧縮近似による負圧ピークや $C_L$ に数%以上の誤差（Prandtl-Glauert 補正相当の差）が生じる。 |
| $M \ge 0.7$ または $V_{\max} \ge a$（すなわち $M \cdot \max_i \frac{|V_{t,i}|}{V_\infty} \ge 1.0$） | `TRANSONIC_OUT_OF_RANGE` | `critical` | **遷音速・衝撃波領域（適用範囲外）**：一様流または翼面上の最大流速が音速に達しており、衝撃波や造波抗力が発生する領域のため非圧縮パネル法の適用範囲外である。 |
| $Re < 5\times 10^4$ | `LOW_RE_CAUTION` | `info` | **低レイノルズ数域の案内**：昆虫・小型模型等の低 $Re$ 領域では粘性境界層が厚く層流剥離泡や早期剥離が起きやすいため、理想流体解との乖離が大きくなる。 |
| $|C_{L,\mathrm{KJ}}| \ge 0.2$ で $\frac{\Delta C_L}{|C_{L,\mathrm{KJ}}|} > 0.05$、または $|C_{L,\mathrm{KJ}}| < 0.2$ で $\Delta C_L > 0.01$ | `CL_CROSSCHECK_WARN` | `warning` | **$C_L$ クロスチェック乖離警告**：循環から求めた $C_L$ と表面圧力積分から求めた $C_L$ の差が大きく、パネル数不足または急峻な翼形状による離散化誤差が示唆される（パネル数の増加を推奨）。 |

---

## 9. 空間速度場と流線の数値積分アルゴリズム

### 9.1 空間格子上の速度場・圧力場計算と特異値ガード

1. **標準計算領域と格子解像度**:
   - 標準計算領域：`x_range = [-0.5, 1.6]`, `y_range = [-0.7, 0.7]`（前縁上流 $0.5c$、後縁下流 $0.6c$、上下各 $0.7c$）
   - 標準格子点数：`grid_nx = 120`, `grid_ny = 80`（合計 $9,600$ 点）
   - 実装方式：外部格子点座標配列 `(M_pts, 1)` とパネル配列 `(1, N)` の NumPy 2次元ブロードキャスト演算により、Python ループを一切使わず約 $15 \sim 30\,\mathrm{ms}$ で一括計算する。

2. **翼内部点の判定とマスク（`is_inside_airfoil`）**:
   - 節点列 $(\hat{X}_j, \hat{Y}_j)\; (j=1,\dots,N+1)$ に対する偶奇交差法（Ray-casting / Winding number 判定。`closed_te = false` で始点と終点に後縁ギャップがある場合も、内部判定ポリゴンとしては始終点を線分で閉じて判定する）により各格子点の内部判定配列 `is_inside_airfoil: bool[grid_ny][grid_nx]` を求める。
   - **翼内部点ではポテンシャル特異点分布の内部人工流が生じるため物理的意味を持たない**。したがって `is_inside_airfoil == true` の全格子点において `u_ratio`, `v_ratio`, `speed_ratio`, `cp` をすべて **`null`** として出力し、Canvas 描画では翼断面ポリゴンでマスクする。

3. **パネル極近傍の2段階特異値ガード（必須実装）**:
   - **ガード①（パネル端点対数特異点の正則化）**: 一定強度パネルの両端節点では $\Lambda = \frac{1}{2}\ln(r_2^2/r_1^2)$ が対数特異点を持つため、すべての空間評価において
     $$r_1^2 \leftarrow \max\!\bigl(r_1^2,\; (\varepsilon_r \hat{S}_j)^2\bigr), \qquad r_2^2 \leftarrow \max\!\bigl(r_2^2,\; (\varepsilon_r \hat{S}_j)^2\bigr) \qquad (\varepsilon_r = 10^{-6})$$
     で下限クランプし、`0` 除算や `Inf/NaN` の発生を完全に防ぐ。
   - **ガード②（パネル極薄境界層での表面速度クランプ）**: 外部評価点が第 $j$ パネルの外側極近傍（$0 \le \xi \le \hat{S}_j$ かつ $0 \le \eta < \varepsilon_\eta \bar{S}$、ここで平均パネル長 $\bar{S} = \frac{1}{N}\sum \hat{S}_k$、$\varepsilon_\eta = 10^{-3}$）に偶然入った場合、離散パネル近似の近傍誤差による非物理的コンター斑点を防ぐため、当該評価点の無次元速度を第 $j$ パネル表面接線速度 $(V_{t,j}/V_\infty)\mathbf{t}_j$ へ置換する。

4. **空間格子の無次元量定義**:
   $$\texttt{u\_ratio} = \frac{u}{V_\infty}, \quad \texttt{v\_ratio} = \frac{v}{V_\infty}, \quad \texttt{speed\_ratio} = \frac{\sqrt{u^2 + v^2}}{V_\infty}, \quad \texttt{cp} = 1 - \left(\texttt{speed\_ratio}\right)^2$$

### 9.2 流線（Streamlines）の弧長正規化4次ルンゲ・クッタ積分（Arc-length Normalized RK4）

時間刻み $\Delta t$ による通常の $\frac{d\hat{\mathbf{x}}}{dt} = \hat{\mathbf{V}}(\hat{\mathbf{x}})$ 積分では、前縁上面の高速域で1ステップの移動距離が大きくなりすぎて翼面を貫通しやすく、逆によどみ点近傍の低速域で点群が密集・停滞する欠点がある。これを解決するため、速度ベクトルをその大きさで正規化した**空間弧長パラメータ $s$ に関する常微分方程式**を4次ルンゲ・クッタ法（RK4）で積分する：

$$\frac{d\hat{\mathbf{x}}}{ds} = \mathbf{f}(\hat{\mathbf{x}}) = \frac{\hat{\mathbf{V}}(\hat{\mathbf{x}})}{\|\hat{\mathbf{V}}(\hat{\mathbf{x}})\|_2}$$

1. **適応弧長ステップ幅 $\Delta s$**:
   評価点から全パネル線分への最短距離を $d_{\min}(\hat{\mathbf{x}})$ とし、翼近傍で自動的に細分化する2段階ステップを用いる：
   $$\Delta s = \begin{cases} 0.004 & (d_{\min}(\hat{\mathbf{x}}) < 0.08:\; \text{翼近傍高曲率域}) \\ 0.015 & (d_{\min}(\hat{\mathbf{x}}) \ge 0.08:\; \text{遠方場}) \end{cases}$$

2. **1ステップの RK4 更新式**:
   $$\begin{aligned}
   \mathbf{k}_1 &= \mathbf{f}(\hat{\mathbf{x}}_n), &
   \mathbf{k}_2 &= \mathbf{f}\!\left(\hat{\mathbf{x}}_n + \tfrac{1}{2}\Delta s\,\mathbf{k}_1\right), \\
   \mathbf{k}_3 &= \mathbf{f}\!\left(\hat{\mathbf{x}}_n + \tfrac{1}{2}\Delta s\,\mathbf{k}_2\right), &
   \mathbf{k}_4 &= \mathbf{f}\!\left(\hat{\mathbf{x}}_n + \Delta s\,\mathbf{k}_3\right), \\
   \hat{\mathbf{x}}_{n+1} &= \hat{\mathbf{x}}_n + \frac{\Delta s}{6}\bigl(\mathbf{k}_1 + 2\mathbf{k}_2 + 2\mathbf{k}_3 + \mathbf{k}_4\bigr)
   \end{aligned}$$
   （※計算速度最適化として、全流線の現在アクティブな先端点をまとめた配列に対しパネル誘起速度をバッチ評価するベクトル化 RK4 実装を推奨する。）

3. **開始点（Seed 点）配置仕様**:
   - 標準本数：`num_streamlines = 28`（設定許容範囲：`10 <= num_streamlines <= 60`）。
   - 翼近傍密度維持レイク投影方式：任意の迎角 $\alpha \in [-45^\circ, +45^\circ]$ でも翼周りの流線が疎にならないよう、翼弦中心 $(0.5, 0)$ を通り一様流単位ベクトル $\mathbf{e}_\infty = (\cos\alpha, \sin\alpha)$ に直交する幅 $[-0.7, +0.7]$ の仮想レイク線分上に `num_streamlines` 個の基準点を等間隔配置し、各点から風上方向 $-\mathbf{e}_\infty$ へ計算領域の流入境界（$x_{\min}, y_{\min}, y_{\max}$ の交点）まで逆投影した位置を開始シード点とする。

4. **4つの積分停止条件（いずれか1つを満たした時点で当該流線の追跡を終了）**:
   1. **計算領域外への流出**: $\hat{x} > x_{\max}\;(= 1.6)$、または $\hat{y} < y_{\min} - 0.05\;(= -0.75)$、または $\hat{y} > y_{\max} + 0.05\;(= +0.75)$、または $\hat{x} < x_{\min} - 0.05\;(= -0.55)$。
   2. **翼内部侵入または翼面極近傍衝突**: 翼内部判定 `is_inside_airfoil(x_{n+1}) == true`、またはパネル最短距離 $d_{\min}(\hat{\mathbf{x}}_{n+1}) < 1.5\times 10^{-3}$（衝突直前の点 $\hat{\mathbf{x}}_n$ までを有効点列として保持し、翼断面への食い込み線を防止）。
   3. **よどみ点到達**: 無次元速さ $\|\hat{\mathbf{V}}(\hat{\mathbf{x}}_n)\|_2 < 10^{-3}$。
   4. **最大ステップ数到達**: ステップ数 $n \ge \texttt{max\_steps}\;(= 800)$（閉渦トラップ等による無限ループ防止、最大領域幅 `[-5.0, 5.0]` でも全域走破可能）。

---

## 10. 数値安定性・収束判定・異常入力ガード

「収束していない計算結果を正常結果として描画しない」という絶対規則を担保するため、計算前（バリデーション層）と計算後（ソルバー診断層）の2段階で厳格なゲートを設ける。

### 10.1 計算前入力バリデーション（違反時は HTTP `422 Unprocessable Entity`）

| 検証項目 | 許容条件 | エラーコード例 |
| :--- | :--- | :--- |
| 風速 `velocity` ($V_\infty$) | $0.01 \le V_\infty \le 1000.0\;\mathrm{m/s}$（有限実数） | `INVALID_FLOW_CONDITION` |
| 翼弦長 `chord_length` ($c$) | $10^{-4} \le c \le 100.0\;\mathrm{m}$（有限実数） | `INVALID_CHORD_LENGTH` |
| 迎角 `angle_of_attack` ($\alpha_{\mathrm{deg}}$) | $-45.0^\circ \le \alpha_{\mathrm{deg}} \le +45.0^\circ$ | `AOA_OUT_OF_ALLOWED_RANGE` |
| 流体物性（$T, p_\infty, \rho, \mu, \nu, a$） | $50.0 \le T \le 2000.0\;\mathrm{K}$、その他の指定物性値は $> 0$（また `direct_mu`/`direct_nu` で $\rho > 10\;\mathrm{kg/m^3}$ 時は `speed_of_sound_mps` 非 `null` 必須） | `INVALID_FLUID_PROPERTIES` |
| パネル数 `num_panels` ($N$) | 整数、$40 \le N \le 300$、かつ $N \bmod 2 == 0$ | `INVALID_NUM_PANELS` |
| 計算領域 `x_range`, `y_range` | $-5.0 \le x_{\min} < 0.0,\; 1.0 < x_{\max} \le 5.0$、および $-5.0 \le y_{\min} < 0.0 < y_{\max} \le 5.0$ | `INVALID_DOMAIN_RANGE` |
| 流線本数 `num_streamlines` | 整数、$10 \le \texttt{num\_streamlines} \le 60$ | `INVALID_NUM_STREAMLINES` |
| 翼型座標・NACAコード | 有効4桁コード、または点数 $\ge 12$・非自己交差・上下非逆転の座標列 | `INVALID_AIRFOIL_GEOMETRY` |
| 未実装ソルバー指定 | `solver.method` が `"xfoil"` または `"cfd_su2"` の場合は **`501 Not Implemented`** | `SOLVER_NOT_IMPLEMENTED` |

### 10.2 ソルバー解の健全性・収束判定（違反時は `status = "failed"`、正常グラフ描画を遮断）

直接法（LU分解）であっても悪条件行列や特異形状により非物理的な解が出力される恐れがあるため、以下の6条件すべてを満たした場合にのみ `converged = true` かつ `status = "success"` と判定する：

1. **有限値保証**: 解ベクトル $\mathbf{q}$、表面 $C_{p,i}$、空力係数 $C_L, C_{m,c/4}$ の全要素に `NaN` および `Inf` が一切含まれないこと。
2. **行列条件数上限（`diagnostics.condition_number`）**: $\kappa_2(M) = \operatorname{cond}(M) < 10^{10}$（通常の NACA 4桁翼・$N \in [40, 300]$ では $\kappa_2(M) \sim 10^2 \sim 10^4$）。
3. **線形系残差ノルム（`diagnostics.linear_residual_max`）**: $\|M\mathbf{q} - \mathbf{b}\|_\infty < 10^{-8}$。
4. **物体の吹出し総和（質量保存）検査**: 湧き出し正味体積流量が後縁ギャップ許容量の範囲内であること：
   $$\left|\sum_{j=1}^N \hat{\sigma}_j \hat{S}_j\right| < 5\times 10^{-2} + 2.0\,|\Delta\hat{y}_{\mathrm{TE}}|$$
   （閉後縁 $|\Delta\hat{y}_{\mathrm{TE}}|=0, N=160$ では通常 $10^{-4} \sim 10^{-3}$ 以下となる。）
5. **Kutta 条件充足検査（`diagnostics.te_cp_diff`）**: 後縁上下パネルの圧力係数差 $|C_{p,1} - C_{p,N}| < 10^{-5}$。
6. **表面 $C_p$ の有界性検査（`diagnostics.cp_min`, `cp_min_xc`, `max_velocity_ratio`）**: 正圧上限 $C_{p,i} \le 1.0 + 10^{-6}$（よどみ点理論上限）かつ負圧下限 $\min_i C_{p,i} > -500.0$（すなわち表面速度比 $|V_{t,i}|/V_\infty < 22.38$：薄翼・大迎角の正当なポテンシャル流吸引ピークを誤遮断せず、特異破綻のみを検出する閾値）。

上記1〜6のいずれかに違反した場合は、`AnalysisResponse` 契約に従い `status: "failed"`, `diagnostics.converged: false` とし、`coefficients`, `surface`, `flow_field`, `streamlines` をすべて `null` にして `failure` オブジェクトにエラー詳細を格納して返却することで、壊れた計算結果が画面に描画されることを確実に阻止する（正常時は `failure: null` とし、`diagnostics` に `cl_discrepancy`, `cl_discrepancy_relative`, `cd_pressure_numerical_error` 等を記録する）。

---

## 11. 初学者向け教育的解説の物理ロジック（同着理論の排除）

### 11.1 絶対禁止事項：「同着理論（Equal Transit-Time Fallacy）」の完全排除

世間の入門書やWeb記事で広く流布している以下の誤説明は、流体力学的に誤りであるため AirFlow Lab の解説文・ツールチップ・ドキュメントのすべてにおいて**一切使用しない**：

> ❌ **禁止される誤説明（同着理論）**:  
> 「翼の上面は膨らんでいて下面より道のりが長い。前縁で上下に分かれた空気の粒は後縁で**同時に出会わなければならない**ため、遠い上面を通る空気の方が速く流れる。」

**なぜ誤りか（解説パネルの「よくある誤解」コラムで高校生に示すポイント）**:
1. **対称翼でも揚力が出る事実**: 上面と下面の長さが**全く同じ**対称翼（`NACA 0012`）でも、迎角（例：$\alpha = 5^\circ$）をつけると上面の流れが加速し強い揚力が生じる。道のりの長さの差ではこれを説明できない。
2. **実際には同時に着かない（上面の方がずっと早く着く）**: 本ソフトの流速分布や風洞の煙線実験で確認できる通り、揚力が発生しているとき前縁で上下に分かれた流体粒子は同時に後縁へ着くのではなく、**上面を通る流体粒子の方が下面の粒子よりも大幅に早く後縁を通過し追い越していく**（これが翼周りの時計回り循環 $\Gamma > 0$ の存在そのものである）。

### 11.2 高校生向けの正しい4段階説明ロジック（実数値連動ルールベース生成）

`explanationEngine` は、解析結果の実数値（翼型名、対称/キャンバー区分、迎角 $\alpha$、最小圧力係数 $C_{p,\min}$ とその位置 $x/c$、最大流速比 $(|V|/V_\infty)_{\max}$、揚力係数 $C_L$、レイノルズ数 $Re$）をテンプレートへ埋め込み、以下の因果関係に沿って説明する。

1. **ステップ1：後縁条件（クッタの条件）と流れの曲がり（循環の発生）**
   - 翼に迎角 $\alpha$ や反り（キャンバー）があると、流れは尖った後縁を下から上へ急激に回り込むことができず、後縁から滑らかに後ろへ流れ去ろうとする（クッタの条件）。その結果、翼全体の周りに時計回りの「循環（渦の成分）」が自然に定まり、前縁から上面へ向かう流線が強く曲げられて流管（流線の間隔）が絞られる。
2. **ステップ2：流線の曲率と圧力勾配（なぜ圧力が下がるのか）**
   - 空気が曲線に沿って曲がるためには、カーブの内側へ向かう力（向心力）が必要になる。翼の上面に沿って流れが下向きに曲げられるとき、外側の離れた大気圧よりも翼表面側の圧力が低くなる（負圧：$C_p < 0$）ことで、空気を翼面側へ引き寄せる圧力差が釣り合っている。
3. **ステップ3：ベルヌーイの定理（低圧と高速の結びつき）**
   - エネルギー保存則を表すベルヌーイの定理（$p + \frac{1}{2}\rho V^2 = \text{一定}$）により、圧力が下がる場所では空気は引き込まれて加速し、圧力が高まる場所では減速する。今回の解析では、翼上面の $x/c = \{\texttt{cp\_min\_xc}\}$ 付近で流速が一様流の $\{\texttt{max\_velocity\_ratio}\}$ 倍に加速され、最小圧力係数 $C_{p,\min} = \{\texttt{cp\_min}\}$ の強い負圧ピークが生じている。一方、下面の前縁よどみ点付近では流れがせき止められて減速し、正圧（$C_p > 0$）になっている。
4. **ステップ4：上下の圧力差の合力 ＝ 揚力（運動量変化の反作用）**
   - 翼上面の広い範囲の「負圧による吸い上げ（上向きの力）」と、下面の「正圧による押し上げ」を翼全体で足し合わせた合力が揚力（今回の $C_L = \{\texttt{cl}\}$）となる。また翼全体で見ると、翼が通過する空気を下向きに曲げた（吹き下ろしを与えた）反作用として翼が上向きの力を受けていることと一致する（ニュートンの第3法則）。

---

## 12. APIリクエスト7キーとの対応およびPhase 2 / Phase 3拡張方針

### 12.1 APIリクエスト7キーと数値計算パラメータの対応表

`POST /api/analysis/run` のリクエスト JSON トップレベル7キーが、本仕様書のどの数式変数に入力されるかを以下に示す。

| トップレベルキー | 主なサブフィールド | 本仕様書の対応変数・単位 | Phase 1 計算での役割 |
| :--- | :--- | :--- | :--- |
| `airfoil` | `source_type`, `naca_code`, `raw_coordinates_text` | $m, p, t$ または入力点列 $(x_r, y_r)$ | 翼断面無次元節点 $(\hat{X}_j, \hat{Y}_j)$ の生成（第4章） |
| `angle_of_attack` | （数値直値） | $\alpha_{\mathrm{deg}}$ [deg] $\to \alpha = \alpha_{\mathrm{deg}}\pi/180$ [rad] | 一様流方向 $\mathbf{e}_\infty = (\cos\alpha, \sin\alpha)$、右辺 $\mathbf{b}$、揚力射影角、高迎角警告判定 |
| `velocity` | （数値直値） | $V_\infty$ [m/s] | $Re, M$ 算出、有次元速度・循環 $\Gamma$ 換算、遷音速警告判定 |
| `chord_length` | （数値直値） | $c$ [m] | $Re$ 算出、物理座標 $(x,y)$・循環 $\Gamma$ 換算 |
| `fluid_properties` | `preset`, `mode`, `temperature_k`, `static_pressure_pa`, `density_kg_m3`, `dynamic_viscosity_pa_s`, `kinematic_viscosity_m2_s` | $T$ [K], $p_\infty$ [Pa], $\rho$ [$\mathrm{kg/m^3}$], $\mu$ [$\mathrm{Pa\cdot s}$], $\nu$ [$\mathrm{m^2/s}$], $a$ [m/s] | Sutherland則 / 直接入力による $Re, M$ 算出と低 $Re$・圧縮性警告判定（第8章） |
| `solver` | `method` (`"panel_method"` \| `"xfoil"` \| `"cfd_su2"`) | `BaseSolver` 具象クラス選択 | Phase 1 では `"panel_method"` のみ実行、他は `501` 返却 |
| `numerical_settings` | `num_panels`, `closed_te`, `grid_nx`, `grid_ny`, `x_range`, `y_range`, `num_streamlines` | $N$（初期値 `160`）, $a_4$ 切替（初期値 `true`）, $N_x\times N_y$（`120x80`）, 計算領域, 流線本数（`28`） | パネル離散化・空間格子評価・RK4流線追跡の数値解像度制御 |

### 12.2 Phase 2（XFOIL 粘性-非粘性相互作用連携）への拡張設計

- **物理モデル**: 線形渦パネル法（流関数一定定式化）と2方程式積分型境界層式（運動量厚さ $\theta$・形状係数 $H$・増幅率 $N_{\mathrm{crit}}$）をニュートン法で強連成し、壁面吹出し速度 $V_n = \frac{d}{ds}(U_e \delta^*)$ によって境界層排除厚さをポテンシャル流へフィードバックする。
- **インターフェース互換性**:
  - `AnalysisResponse` スキーマは Phase 1 時点で既に `coefficients.cd: number | null` を許容しており、Phase 2 の `XfoilSolver` では Squire-Young 式から算出した有限の正値 `cd`（および内訳 `cdf`, `cdp` の拡張診断値）を返却するだけで既存のフロントエンド KPI カード・比較グラフがそのまま動作する。
  - XFOIL は GPL ライセンスの外部 Fortran バイナリであるため、サブプロセス分離・タイムアウト制御（例：5秒）・境界層ニュートン反復非収束時の `status = "failed"` 変換アダプタを `backend/app/solvers/xfoil/` に実装する。

### 12.3 Phase 3（本格2D CFD：SU2 / OpenFOAM 等連携）への拡張設計

- **物理モデル**: 構造格子または非構造ハイブリッド境界層メッシュ上の2次元定常 RANS（Spalart-Allmaras または $k$-$\omega$ SST 乱流モデル）および圧縮性オイラー/ナビエ・ストークス方程式。
- **データ構造と可視化・出力の接続性**:
  - 計算時間が数秒〜数十秒に及ぶため、`POST /api/analysis/run` の同期応答に加えて非同期ジョブIDポーリングへ拡張できるよう `GET /api/analysis/{analysis_id}` エンドポイントを Phase 1 から備えている。
  - 空間場データの出力変換を `backend/app/exporters/` に分離し、Phase 3 では構造格子／非構造格子データを VTK（`.vts` / `.vtu` / `.vtk`）形式でエクスポート可能とする。また描画層は `FlowRenderer` インターフェースを介して Canvas 2D から WebGL シェーダレンダラへ透過的に差し替えられる設計とする。
