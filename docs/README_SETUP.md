# MongoDB連携セットアップガイド

このガイドでは、圃場データベースアプリをMongoDBと連携させる手順を説明します。

## 必要な準備

### 1. MongoDB接続情報の確認
MongoDB Atlas または ローカルMongoDBの接続情報を準備してください：
- 接続URI（例：`mongodb+srv://username:password@cluster.mongodb.net/`）
- データベース名（例：`farm`）

### 2. 環境設定ファイルの作成

プロジェクトルートに `.env` ファイルを作成し、以下の内容を記入してください：

```bash
# MongoDB接続設定
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/Agri-AI-Project?retryWrites=true&w=majority
MONGODB_DATABASE=Agri-AI-Project

# Google Maps API設定
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# サーバー設定
PORT=3000
NODE_ENV=development

# CORS設定（フロントエンドのURL）
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080
```

**重要：** 
- `username`, `password`, `cluster` を実際のMongoDB接続情報に変更してください
- `your_google_maps_api_key_here` を実際のGoogle Maps APIキーに変更してください
- `.env` ファイルは既に `.gitignore` に追加されているため、誤ってGitにコミットされません

### 3. APIキーの設定について

Google Maps APIキーは `.env` ファイルで管理されるため、`js/config.js` での設定は不要です。サーバーが自動的に環境変数からAPIキーを取得してフロントエンドに提供します。

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. APIサーバーの起動

```bash
# 開発モード（ファイル変更時の自動再起動）
npm run dev

# または通常起動
npm start
```

サーバーが正常に起動すると、以下のメッセージが表示されます：
```
MongoDB接続成功
データベース 'Agri-AI-Project' に正常に接続しました
サーバーがポート 3000 で起動しました
ヘルスチェック: http://localhost:3000/api/health
API エンドポイント: http://localhost:3000/api/fields
```

### 3. フロントエンドの表示

静的ファイルサーバーを起動するか、ブラウザで直接 `index.html` を開きます：

```bash
# Python 3を使用する場合
python3 -m http.server 8080

# Node.jsのserveパッケージを使用する場合
npx serve .
```

## データベーススキーマ

MongoDB内の `Agri-AI-Project` データベースの `fields` コレクションに以下の形式でデータが保存されます：

```javascript
{
  "_id": ObjectId("..."),
  "name": "圃場名",
  "crop": "作物名", 
  "memo": "メモ",
  "area_ha": 1.2345,
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[経度, 緯度], ...]]
  },
  "created_at": ISODate("..."),
  "updated_at": ISODate("..."),
  "deleted": false
}
```

## API仕様

### エンドポイント

- **GET** `/api/health` - サーバーヘルスチェック
- **GET** `/api/config` - フロントエンド用設定取得（APIキーなど）
- **GET** `/api/fields` - 圃場一覧取得
- **POST** `/api/fields` - 新規圃場作成
- **PUT** `/api/fields/:id` - 圃場更新
- **DELETE** `/api/fields/:id` - 圃場削除（論理削除）

### リクエスト例

#### 圃場作成
```javascript
POST /api/fields
Content-Type: application/json

{
  "name": "第1北ブロック",
  "crop": "小麦",
  "memo": "2024年度作付け",
  "area_ha": 2.5,
  "geometry_json": "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[[141.1,43.1],[141.2,43.1],[141.2,43.2],[141.1,43.2],[141.1,43.1]]]}}"
}
```

## トラブルシューティング

### MongoDB接続エラー
- `.env` ファイルの `MONGODB_URI` が正しいかご確認ください
- MongoDBサーバーが稼働しているかご確認ください
- ネットワークアクセス許可設定をご確認ください（Atlas使用時）

### CORS エラー
- ブラウザの開発者ツールでCORSエラーが表示される場合、`.env` の `ALLOWED_ORIGINS` にフロントエンドのURLを追加してください

### Google Maps 読み込みエラー
- APIキーが正しく設定されているかご確認ください
- APIキーに Drawing ライブラリと Geometry ライブラリの使用権限があるかご確認ください

## 本番環境での注意事項

1. **セキュリティ設定**
   - Google Maps APIキーにHTTPリファラ制限を設定
   - MongoDBの接続文字列を環境変数で管理
   - HTTPS通信の使用を推奨

2. **パフォーマンス**
   - MongoDBに2dsphereインデックスを作成することを推奨
   - 大量データの場合はページネーション実装を検討

3. **監視**
   - APIサーバーの稼働状況監視
   - MongoDB接続状況の監視
   - Google Maps API使用量の監視
