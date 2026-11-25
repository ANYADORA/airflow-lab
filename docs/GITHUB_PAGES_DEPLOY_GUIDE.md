# GitHub Pages 限定公開（シークレット URL 方式）デプロイ手順

このガイドでは、**AirFlow Lab（ブラウザ完結型 Hess-Smith 2D パネル法アプリ + 妥当性検証論文 PDF）** を、**URL を知っている人だけが開ける形**で GitHub Pages 上に無料公開する手順を説明します。

---

## 1. セキュリティと仕様上の位置づけ（必読）

- **完全ブラウザ完結動作**: Static 版は `VITE_SOLVER_MODE=browser` でビルドされ、NACA 4桁・カスタム翼型解析・流線 RK4・Cp 分布・論文 PDF（`./paper/AirFlow_Lab_Phase1_Validation_Paper.pdf`）のすべてがブラウザ内で完結するため、FastAPI バックエンドサーバー不要で GitHub Pages にデプロイできます。
- **限定公開の仕組み**:
  - 通常のルート URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）および `404.html` には **「Restricted Access / 限定公開ページ」の案内画面のみ** が表示され、アプリ本体やシークレット URL へのリンクは一切存在しません。
  - `robots.txt`（`Disallow: /`）および HTML `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />` により検索エンジンへのインデックスを拒否します。
  - アプリ本体と PDF は、GitHub Actions Secrets の `ACCESS_TOKEN` を用いて生成される **`/s/<ACCESS_TOKEN>/`** のパス配下にのみ配置されます。
  - `ACCESS_TOKEN` の文字列自体はソースコード・Git コミット履歴・Actions ログのいずれにも残りません。
- **GitHub 無料プランでの注意点**:
  - 無料の GitHub アカウントで GitHub Pages を使う場合、**リポジトリ自体は Public である必要があります**（ソースコード自体は第三者からも閲覧可能ですが、パスワード・トークンは一切リポジトリに入れない設計です）。
  - もし真のログイン認証・アクセス制御が必要な場合は、GitHub Enterprise の Private Pages や Cloudflare Access 等の前段認証を併用してください。

---

## 2. デプロイ前の準備手順（ブラウザで GitHub を操作）

### 手順 A: 推測困難なシークレットトークン（16〜64文字）を生成する

PowerShell で以下の1行を実行し、出力された文字列を控えておきます（例：32〜43文字の URL-safe ランダム文字列）。

```powershell
& 'D:\home\geminiファイル\airflowlab_env\venv\Scripts\python.exe' -c "import secrets; print(secrets.token_urlsafe(24))"
```

> 使用可能文字は半角英数字・`-`（ハイフン）・`_`（アンダースコア）の 16〜64 文字です。

### 手順 B: GitHub に新しい Public リポジトリを作成する

1. GitHub にサインインし、右上 `+` -> `New repository` を開きます。
2. `Repository name` を決めます（例：`airflow-lab`）。
3. 公開範囲は **Public** を選択し、`Add a README` / `.gitignore` はチェックせず作成します。

### 手順 C: Repository Secret `ACCESS_TOKEN` を登録する

1. 作成したリポジトリの **Settings** -> 左メニュー **Secrets and variables** -> **Actions** を開きます。
2. **New repository secret** をクリックし、以下を入力して保存します。
   - **Name**: `ACCESS_TOKEN`
   - **Secret**: 手順 A で生成したランダム文字列

### 手順 D: GitHub Pages のデプロイ方式を「GitHub Actions」に変更する

1. リポジトリの **Settings** -> 左メニュー **Pages** を開きます。
2. **Build and deployment** の **Source** を `Deploy from a branch` から **`GitHub Actions`** に変更します。

---

## 3. Git 初期化と初回プッシュ手順

> **環境補足**: 本環境の Windows 側には `git` / `gh` が未導入ですが、WSL (`Ubuntu-24.04`) には `/usr/bin/git` が導入されています。必要に応じて GitHub 認証（PAT または SSH 鍵）を設定してからプッシュしてください。

WSL（または Git for Windows の PowerShell）から `AirFlowLab` ルートへ移動し、以下を実行します（`<あなたのGitHubユーザー名>` と `<リポジトリ名>` は置き換えてください）。

```bash
cd /mnt/c/home/AirFlowLab

git init -b main
git add .
git status   # node_modules/, pages_dist/, venv/ 等が含まれていないこと、PDFが含まれることを確認
git commit -m "feat: add browser-resident Hess-Smith solver and unlisted GitHub Pages workflow"

git remote add origin https://github.com/<あなたのGitHubユーザー名>/<リポジトリ名>.git
git push -u origin main
```

プッシュすると `.github/workflows/deploy-pages.yml` が自動実行され、型チェック・ユニットテスト・ブラウザ用ビルド・`pages_dist` 生成・GitHub Pages デプロイまでが走ります。

---

## 4. 公開 URL の確認とトークン更新（無効化）

### 招待用 URL の形式

Actions タブで `Deploy Unlisted AirFlow Lab to GitHub Pages` が緑チェックで完了したら、以下の URL を共有してください。

- **招待者用アプリ URL**:
  `https://<あなたのGitHubユーザー名>.github.io/<リポジトリ名>/s/<ACCESS_TOKEN>/`
- **ルート URL（遮断確認用）**:
  `https://<あなたのGitHubユーザー名>.github.io/<リポジトリ名>/` -> 「Restricted Access / 限定公開ページ」のみが表示されます。

### 旧 URL を無効化（ローテーション）したい場合

1. GitHub リポジトリの **Settings -> Secrets and variables -> Actions -> `ACCESS_TOKEN`** を新しいトークンへ更新する。
2. **Actions -> `Deploy Unlisted AirFlow Lab to GitHub Pages` -> `Run workflow`** を実行する。
3. 再デプロイ完了後、旧 `/s/<旧トークン>/` は `404.html` の遮断画面に切り替わります。

---

## 5. ローカルでの事前ビルド検証コマンド

デプロイ構成を手元で再検証する場合は、以下を実行します（`build_pages_bundle.mjs` が `pages_dist/` を生成します）。確認後は `pages_dist/` を削除してください。

```powershell
Set-Location c:\home\AirFlowLab\frontend
$env:VITE_SOLVER_MODE = "browser"
$env:VITE_BASE_PATH = "./"
& 'D:\home\geminiファイル\airflowlab_env\node\node.exe' ./node_modules/vite/bin/vite.js build

Set-Location c:\home\AirFlowLab
$env:ACCESS_TOKEN = "your_16plus_char_token_here"
& 'D:\home\geminiファイル\airflowlab_env\node\node.exe' ./scripts/build_pages_bundle.mjs
```
