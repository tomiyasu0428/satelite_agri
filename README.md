# 圃場ポリゴン登録システム

Google Maps上で圃場ポリゴンを描画し、面積を計算してMongoDBに保存するWebアプリケーションです。

## 主な機能

- **Google Maps統合**: ポリゴン描画、面積自動計算（ヘクタール表示）
- **圃場管理**: 圃場名、年度、作物、品種、メモの管理
- **作付履歴**: 年度別の作物・品種履歴を自動記録
- **GeoJSON対応**: 地理情報をGeoJSON形式で保存・管理
- **作物マスタ**: 作物候補の自動サジェスト機能

## クイックスタート

### 1. 環境設定

プロジェクトルートに `.env` ファイルを作成：

```bash
# MongoDB接続設定
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/Agri-AI-Project?retryWrites=true&w=majority
MONGODB_DATABASE=Agri-AI-Project

# Google Maps API設定
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# サーバー設定
PORT=3000
NODE_ENV=development

# CORS設定
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080
```

### 2. 依存関係のインストールと起動

```bash
npm install
npm run dev
```

### 3. アクセス

ブラウザで http://localhost:3000/ を開いてください。

## データ構造

### 圃場データ (fields コレクション)

```javascript
{
  "_id": ObjectId("..."),
  "name": "第1圃場",
  "area_ha": 2.50,
  "memo": "備考",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], ...]]
  },
  "geometry_json": "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{...}}",
  "crop_history": [
    {
      "year": 2025,
      "crop": "小麦",
      "variety": "ゆめちから",
      "planting_date": null,
      "harvest_date": null
    }
  ],
  "current_crop": "小麦",
  "current_year": 2025,
  "created_at": "2025-08-17T...",
  "updated_at": "2025-08-17T...",
  "deleted": false
}
```

### 作物マスタ (crops コレクション)

```javascript
{
  "_id": ObjectId("..."),
  "name": "小麦",
  "varieties": ["ゆめちから", "きたほなみ"],
  "created_at": "2025-08-17T...",
  "updated_at": "2025-08-17T...",
  "deleted": false
}
```

## API仕様

### 圃場管理
- `GET /api/fields` - 圃場一覧取得
- `POST /api/fields` - 新規圃場作成
- `PUT /api/fields/:id` - 圃場更新
- `DELETE /api/fields/:id?hard=true` - 圃場削除

### 作物管理
- `GET /api/crops?q=検索語&limit=200` - 作物一覧取得
- `POST /api/crops` - 作物マスタ作成
- `PUT /api/crops/:id` - 作物マスタ更新
- `DELETE /api/crops/:id?hard=true` - 作物マスタ削除

### システム
- `GET /api/health` - サーバーヘルスチェック
- `GET /api/config` - フロントエンド設定取得
- `GET /api/debug/db` - DB接続確認・コレクション一覧

## プロジェクト構成

```
圃場データベース/
├── docs/                 # ドキュメント類
│   ├── google_maps版_面積計測＆geo_json登録_企画書.md
│   ├── 問題点と解決策.md
│   └── README_SETUP.md
├── js/                   # フロントエンドJavaScript
│   ├── api.external.js   # 外部API通信
│   ├── api.js           # モックAPI（開発用）
│   ├── api.loader.js    # API実装の動的読み込み
│   ├── config.js        # 設定管理
│   └── main.js          # メインロジック
├── index.html           # フロントエンドUI
├── server.js            # APIサーバー
├── package.json         # Node.js依存関係
├── .env                 # 環境設定（要作成）
├── .gitignore          # Git無視設定
└── README.md           # このファイル
```

## 技術スタック

- **フロントエンド**: Vanilla JavaScript, Google Maps API, TailwindCSS
- **バックエンド**: Node.js, Express
- **データベース**: MongoDB (Atlas推奨)
- **地理情報**: GeoJSON, Google Maps Geometry Library

## 使い方

1. **ポリゴン描画**: 地図上でクリックして頂点を追加、ダブルクリックで確定
2. **面積計算**: ポリゴン作成・編集時に自動でヘクタール単位で計算
3. **圃場情報入力**: 圃場名、年度、作物、品種、メモを入力
4. **保存**: 「新規保存」でMongoDBに保存、以後は一覧から選択して編集可能
5. **作物サジェスト**: 過去に入力した作物が候補として表示

## 将来の拡張計画

- 衛星データ連携 (Sentinel-2, NDVI時系列解析)
- ABライン生成機能
- 作業エリア管理
- マルチポリゴン・穴あき対応
- データインポート・エクスポート

## ライセンス

MIT License

## サポート

詳細なセットアップ手順は `docs/README_SETUP.md` を参照してください。