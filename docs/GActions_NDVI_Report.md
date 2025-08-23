## GitHub Actions 導入と NDVI インジェスト振り返り

### ゴール
- 圃場ポリゴンごとに Sentinel‑2 の最新 NDVI を定期取得し、MongoDB に蓄積
- 実行は GitHub Actions（サーバー常時稼働なし）

### 主な取り組みと課題/解決
- 環境変数とSecrets整備
  - `.env` → GitHub Actions の Repository Secrets へ移行
  - 必要: `MONGODB_URI`, `MONGODB_DATABASE`, `TITILER_URL`
  - ワークフローでは `.env` 生成を廃止し、ステップ `env:` でSecretsを直接注入

- 依存関係エラー（npm ci EUSAGE）
  - lock未同期で失敗 → ローカルで `npm install` 実行し `package-lock.json` を同期
  - ワークフローに `npm ci || npm install` を設定し堅牢化、npmキャッシュ有効化

- TiTiler 連携
  - エンドポイント/パラメータの誤り（`/crop`→`/bbox`、`colormap`→`colormap_name` など）を修正
  - 画像生成はサーバ側プロキシ経由（`/api/s2/preview.png`）に統一
  - 可視化は Google Maps GroundOverlay と静的プレビューの両輪で安定化

- NDVI 統計の抽出
  - TiTilerの統計レスポンス差異を吸収するパーサを実装（mean/median/std/min/max/count）
  - `s2_ndvi_timeseries` へ upsert で時系列蓄積

- GitHub Actions での接続トラブル
  - TLS エラー: Atlas の IP 許可リストに 0.0.0.0/0（検証時）を追加 → 解消
  - 認証エラー: DBユーザーとパスワードを再設定、必要に応じて URL エンコード（`@`→`%40` 等）

### 現在のワークフロー要点
- 5日ごとのスケジュール実行 + 手動実行
- Node 18 / npm キャッシュ / `npm ci || npm install`
- ステップ `env:` で Secrets を注入し `scripts/ingest_s2.js` を実行

### MongoDB スキーマ（概略）
- `fields`: 圃場情報（GeoJSON など）
- `s2_ndvi_timeseries`: 圃場×日時のNDVI統計
  - 例: `{ field_id, item: { id, datetime, cloud_cover, stac_item_url }, ndvi: { mean, median, min, max, std, count }, created_at }`

### 使い方（ダッシュボード出力）
- ローカルで最新NDVIを表・CSV・HTMLグラフに出力:
  - `npm run report`
  - 出力先: `reports/ndvi_latest.md`, `reports/ndvi_latest.csv`, `reports/ndvi_latest.html`

### 次の拡張
- ヒストグラム可視化、時系列ラインチャート、閾値アラート
- GitHub Pages へのレポート公開、Artifacts 保存


