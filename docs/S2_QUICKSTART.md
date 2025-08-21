# Sentinel-2 NDVI クイックスタート（最小セット）

誰でも最短で「地図でエリアを選び、最新の衛星（Sentinel‑2）NDVIを確認」できる最小構成の手順です。

---

## 0. 必要なもの
- Node.js 18+
- Google Maps APIキー
- TiTiler（NDVI計算用）。Docker推奨
- MongoDB（任意。DBなしモードでも可）

## 1. リポジトリを取得
```bash
git clone https://github.com/tomiyasu0428/satelite_agri.git
cd satelite_agri
```

## 2. .env を用意（プロジェクト直下）
```bash
# （DBなしモードの場合は MONGODB_* を未設定のままでOK）
# MONGODB_URI=あなたのMongo接続文字列
# MONGODB_DATABASE=Agri-AI-Project
GOOGLE_MAPS_API_KEY=あなたのAPIキー
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
TITILER_URL=http://localhost:8000
```

## 3. TiTiler を起動
Dockerが使える場合：
```bash
docker run -p 8000:8000 ghcr.io/developmentseed/titiler:latest
```

## 4. 依存インストール＆サーバ起動
```bash
npm install
npm run dev
```
- ブラウザで http://localhost:3000/ を開く

## 5. 使い方（最小フロー）
1. 地図上部の描画ツールでポリゴンを描く（分析したい圃場）
2. 右側フォームに圃場名などを入れて「新規保存」
3. 登録直後、画面上部のNDVIパネルに最新のNDVIプレビュー画像が表示されます
4. 「プレビュー画像」リンクからPNGを開く／保存可能

この最小フローでは「選んだエリアの最新シーン」だけを自動探索し、雲量等をほどよく緩めながら取得します。

## よくある質問
- Q. Mongoを使わずに試せる？
  - A. 本アプリは圃場ポリゴンを保存して再利用する前提のためDBを使います。DB不要の超簡易版を作る場合は、ポリゴンをその場でTiTilerに渡すミニページを別途用意します（拡張案参照）。

- Q. 画像が出ない
  - A. `TITILER_URL` が正しいか、TiTilerコンテナが起動しているか確認してください。

## 運用（任意）
- 定期取得（バッチ蓄積）を有効化するには `.env` に以下を追記し、サーバを再起動：
```bash
CRON_ENABLED=true
CRON_SCHEDULE=0 3 * * *
CRON_TZ=Asia/Tokyo
ADMIN_TOKEN=任意の強固な文字列
```
- 手動トリガ（管理API）：
```bash
curl -X POST http://localhost:3000/api/admin/ingest/s2 \
  -H "X-Admin-Token: あなたのADMIN_TOKEN"
```
- 保存先コレクション：`s2_ndvi_timeseries`

## DBなしの超簡易版（実装済み）
- フロントで描いたGeoJSONを直接サーバへ送信し、TiTilerに投げるモード：
  - `POST /api/s2/preview.simple`（body: GeoJSON Feature）→ 最新NDVI PNGを返す
  - `POST /api/s2/stats.simple`（body: GeoJSON Feature）→ NDVI統計を返す
- これによりMongo不要で「描く→即見る」が可能。

### サンプル（curl）
```bash
# プレビュー画像を保存（PNG）
curl -X POST http://localhost:3000/api/s2/preview.simple \
  -H "Content-Type: application/json" \
  --data '{
    "type":"Feature",
    "properties":{},
    "geometry": {"type":"Polygon","coordinates":[[[139.7,35.6],[139.8,35.6],[139.8,35.7],[139.7,35.7],[139.7,35.6]]]} ,
    "days": 10,
    "cloud": 70,
    "size": 1024
  }' --output ndvi.png

# 統計値を取得（JSON）
curl -X POST http://localhost:3000/api/s2/stats.simple \
  -H "Content-Type: application/json" \
  --data '{
    "type":"Feature",
    "properties":{},
    "geometry": {"type":"Polygon","coordinates":[[[139.7,35.6],[139.8,35.6],[139.8,35.7],[139.7,35.7],[139.7,35.6]]]} ,
    "days": 10,
    "cloud": 70
  }'
```

## トラブルシュート
- CORSエラー：`.env` の `ALLOWED_ORIGINS` にアクセス元URLを追記
- レート制限：アクセス過多時は日数や雲量条件を調整し再試行
- 精度差：NDVIは10m解像度。小さすぎる区画ではノイズが増えます

---

このドキュメントの手順で「地図で選ぶ→最新NDVIを見る」だけを最短で実現できます。