/**
 * GitHub Pages 限定公開（シークレットトークン URL `/s/<ACCESS_TOKEN>/`）用
 * 静的ホスティングバンドル組み立てスクリプト。
 *
 * 環境変数 ACCESS_TOKEN（GitHub Actions Secrets 等から注入）を検証し、
 * ルート `/` と `404.html` にはアクセス遮断ページと `robots.txt` を配置、
 * 実体アプリ（frontend/dist）は `pages_dist/s/<ACCESS_TOKEN>/` 配下にのみ出力する。
 * ログにはトークン文字列を一切出力しない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'frontend', 'dist');
const OUT_DIR = path.join(ROOT_DIR, 'pages_dist');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const rawToken = (process.env.ACCESS_TOKEN ?? '').trim();

if (!TOKEN_PATTERN.test(rawToken)) {
  console.error(
    '[build_pages_bundle] Error: 環境変数 ACCESS_TOKEN が未設定または形式不正です。'
  );
  console.error(
    '16〜64文字の半角英数字・ハイフン・アンダースコア（/^[A-Za-z0-9_-]{16,64}$/）を指定してください。'
  );
  process.exit(1);
}

if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(
    `[build_pages_bundle] Error: ビルド済みディレクトリが見つかりません: ${DIST_DIR}`
  );
  console.error(
    '先に VITE_SOLVER_MODE=browser VITE_BASE_PATH=./ で frontend をビルドしてください。'
  );
  process.exit(1);
}

const RESTRICTED_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
    <title>Restricted Access</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        padding: 24px;
      }
      main {
        max-width: 480px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 28px 32px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 20px;
        color: #f8fafc;
      }
      p {
        margin: 0 0 10px;
        font-size: 14px;
        line-height: 1.65;
        color: #cbd5e1;
      }
      p:last-child { margin-bottom: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Restricted Access / 限定公開ページ</h1>
      <p>
        このページを表示するには、発行された専用の招待 URL が必要です。
      </p>
      <p>
        Direct access without the unlisted invitation link is not available.
      </p>
    </main>
  </body>
</html>
`;

const ROBOTS_TXT = `User-agent: *
Disallow: /
`;

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), ROBOTS_TXT, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), RESTRICTED_HTML, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, '404.html'), RESTRICTED_HTML, 'utf8');

const secretTargetDir = path.join(OUT_DIR, 's', rawToken);
fs.mkdirSync(secretTargetDir, { recursive: true });
fs.cpSync(DIST_DIR, secretTargetDir, { recursive: true });

console.log(
  `[build_pages_bundle] OK: pages_dist/s/<REDACTED (${rawToken.length} chars)>/ を生成しました。`
);
