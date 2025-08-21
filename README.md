# 圃場ポリゴン登録システム + 衛星データ分析

Google Maps上で圃場ポリゴンを描画し、面積を計算してMongoDBに保存するWebアプリケーションです。Sentinel-2衛星データを利用したNDVI分析機能も搭載しています。

## 主な機能

### 圃場管理
- **Google Maps統合**: ポリゴン描画、面積自動計算（ヘクタール表示）
- **圃場管理**: 圃場名、年度、作物、品種、メモの管理
- **作付履歴**: 年度別の作物・品種履歴を自動記録
- **GeoJSON対応**: 地理情報をGeoJSON形式で保存・管理
- **作物マスタ**: 作物候補の自動サジェスト機能

### 衛星データ分析（NEW）
- **Sentinel-2 NDVI**: 圃場ごとの最新NDVI画像表示
- **NDVI統計値**: 平均、中央値、標準偏差、最小値、最大値の算出
- **ヒストグラム**: NDVI値の分布グラフ表示
- **プレビュー画像**: 圃場範囲のNDVIマップ表示
- **自動シーン検索**: 雲量・日数条件に基づく最適シーン選択

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

# 衛星データ処理（TiTiler）設定
TITILER_URL=http://localhost:8000
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

### 衛星データ分析（NEW）
- `GET /api/s2/ndvi/latest?field_id=xxx&days=10&cloud=70` - 最新NDVIデータ取得
- `GET /api/s2/ndvi/stats?field_id=xxx&days=10&cloud=70` - NDVI統計値取得
- `GET /api/s2/preview.png?field_id=xxx&size=1024` - NDVIプレビュー画像取得

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
│   └── main.js          # メインロジック + NDVI分析
├── index.html           # フロントエンドUI
├── server.js            # APIサーバー + 衛星データ処理
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
- **衛星データ**: Sentinel-2 L2A, AWS Element84 STAC API, TiTiler

## 使い方

### 圃場登録・管理
1. **ポリゴン描画**: 地図上でクリックして頂点を追加、ダブルクリックで確定
2. **面積計算**: ポリゴン作成・編集時に自動でヘクタール単位で計算
3. **圃場情報入力**: 圃場名、年度、作物、品種、メモを入力
4. **保存**: 「新規保存」でMongoDBに保存、以後は一覧から選択して編集可能
5. **作物サジェスト**: 過去に入力した作物が候補として表示

### NDVI分析（NEW）
1. **圃場選択**: 一覧から分析したい圃場を選択
2. **NDVI表示**: 自動で最新のSentinel-2データからNDVI画像を生成
3. **統計値確認**: 平均NDVI、標準偏差、ヒストグラムなどを表示
4. **条件調整**: 検索日数（10〜120日）、雲量閾値（70%以下など）を調整可能
5. **画像保存**: プレビュー画像をPNG形式でダウンロード可能

## 衛星データ仕様

### Sentinel-2 NDVI分析
- **データソース**: AWS Element84 STAC API (Sentinel-2 L2A)
- **処理方式**: TiTiler経由でリアルタイム計算 `(NIR-Red)/(NIR+Red)`
- **解像度**: 10m/pixel
- **更新頻度**: 約5日（軌道により異なる）
- **雲量フィルタ**: デフォルト70%以下、最大90%まで自動拡張
- **検索範囲**: デフォルト10日間、最大120日まで拡張可能

### NDVI統計項目
- **基本統計**: 平均、中央値、標準偏差、最小値、最大値
- **ヒストグラム**: NDVI値分布（-1.0〜1.0の範囲）
- **有効画素数**: 雲・無効画素を除いた実際の分析対象画素数

## 将来の拡張計画

- **時系列分析**: 複数日のNDVI変化グラフ表示
- **アラート機能**: NDVI閾値に基づく自動通知
- **他の指標**: LAI、クロロフィル指数、土壌調整植生指数
- **ABライン生成**: 作業経路の最適化
- **作業エリア管理**: 区画内での詳細管理
- **データエクスポート**: CSV、GeoTIFF形式での出力

## ライセンス

MIT License

## サポート

詳細なセットアップ手順は `docs/README_SETUP.md` を参照してください。

衛星データ分析機能の技術詳細は `sentinel_2_（_10_m）_mongo圃場ポリゴンで作るリモート圃場モニタリング｜企画書_v_1.md` を参照してください。