# Google Maps版 面積計測＆GeoJSON登録 企画書（Draft v1）

最終更新: 2025-08-15

---

## 1. 目的

- **Google Maps JavaScript API** の Drawing/Geometry を使い、地図上で圃場ポリゴンを描いて**面積を自動計算**し、**GeoJSON＋メタ情報**を **MongoDB** に登録する最小システムを構築する。
- 既存の StraightBar（軌跡/ABライン）や作業エリアと**同じGeoJSON基準**でデータ連携できる状態にする。

---

## 2. ユースケース（主要）

1. **圃場登録**: ポリゴンを描く→面積(m²/ha)を表示→名前/作物/メモを入力→保存。
2. **圃場編集**: 既存ポリゴンを読み込み→頂点ドラッグで修正→面積再計算→保存。
3. **ABライン生成（任意）**: 2点クリックで**方位角・距離**を算出→`ab_azimuth_deg` と長さを属性保存。
4. **作業エリア**: 一時的なサブポリゴン（防除/収穫エリア）を作図・保存。

---

## 3. 画面フロー（最小）

1. 地図表示（Google Maps / JS API）。
2. DrawingManager で**Polygon**モード選択→頂点クリック→**ダブルクリックで確定**。
3. Geometry Library で \`\` を実行→m²/ha 表示。
4. `Polygon#getPaths()` から座標列を取得→**[lng, lat]** へ変換→**GeoJSON Polygon** を生成。
5. 圃場名/作物/メモ入力→**保存**（POST `/api/fields`）。

---

## 4. 技術構成

- **フロント**: Google Maps JavaScript API（Maps / Drawing / Geometry）, React（任意）。
- **バックエンド**: Node.js（Express/Fastify） + MongoDB Atlas。
- **DB**: `fields` コレクション、`geometry` に GeoJSON（`Polygon`/`MultiPolygon`）。`2dsphere` インデックスを付与。
- **計算**: `google.maps.geometry.spherical.computeArea(path)`（m²）。ha は `m² / 10000`。

---

## 5. データモデル（MongoDB）

```json
{
  "field_id": "F001",
  "name": "第1北ブロック",
  "crop": "broccoli",
  "area_m2": 32570.3,
  "area_ha": 3.2570,
  "ab_azimuth_deg": 12.0,
  "measurement": {
    "source": "google-maps-drawing",
    "measured_at": "2025-08-15T03:10:00Z",
    "note": "手描き"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], ... [lng, lat]]]
  },
  "updated_at": "2025-08-15T03:10:00Z"
}
```

> **注意**: GeoJSON は **[lng, lat]**（経度・緯度）順。リングは始点=終点でクローズ。穴（内側除外）は interior ring を追加。飛び地は `MultiPolygon`。

---

## 6. API（例）

### POST `/api/fields`

**Request**

```json
{
  "name": "第1北ブロック",
  "crop": "broccoli",
  "area_m2": 32570.3,
  "area_ha": 3.2570,
  "measurement": {
    "source": "google-maps-drawing",
    "measured_at": "2025-08-15T03:10:00Z",
    "note": ""
  },
  "geometry": { "type": "Polygon", "coordinates": [[[lng, lat], ...]] }
}
```

**Response**

```json
{ "ok": true, "field_id": "F001" }
```

### GET `/api/fields?near=lng,lat&radius_m=300`

- 近傍検索（`$near`）。

### POST `/api/abline`

- 2点（A,B）から `ab_azimuth_deg` と距離(m) を算出して保存。

---

## 7. フロント実装ポイント（抜粋）

```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY&libraries=drawing,geometry"></script>
```

```js
const map = new google.maps.Map(el, { center, zoom: 16 });
const dm = new google.maps.drawing.DrawingManager({
  drawingMode: google.maps.drawing.OverlayType.POLYGON,
  drawingControl: true,
  polygonOptions: { editable: true, fillOpacity: 0.15 }
});
dm.setMap(map);

google.maps.event.addListener(dm, 'overlaycomplete', (e) => {
  if (e.type !== google.maps.drawing.OverlayType.POLYGON) return;
  const poly = e.overlay; // google.maps.Polygon
  const paths = poly.getPaths(); // MVCArray<MVCArray<LatLng>>
  const rings = [];
  for (let i = 0; i < paths.getLength(); i++) {
    const path = paths.getAt(i);
    const ring = [];
    for (let j = 0; j < path.getLength(); j++) {
      const ll = path.getAt(j);
      ring.push([ll.lng(), ll.lat()]);
    }
    // クローズ
    if (ring.length && (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1])) {
      ring.push(ring[0]);
    }
    rings.push(ring);
  }

  // 面積計算（外輪−内輪の合計）
  let m2 = 0;
  for (let i = 0; i < paths.getLength(); i++) {
    const path = paths.getAt(i);
    const arr = [];
    for (let j = 0; j < path.getLength(); j++) arr.push(path.getAt(j));
    m2 += google.maps.geometry.spherical.computeArea(arr);
  }

  const geojson = { type: 'Polygon', coordinates: rings };
  const payload = {
    name, crop, area_m2: m2, area_ha: m2 / 10000,
    measurement: { source: 'google-maps-drawing', measured_at: new Date().toISOString() },
    geometry: geojson
  };
  // fetch('/api/fields', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
});
```

**ABライン（方位角・距離）**

```js
const heading = google.maps.geometry.spherical.computeHeading(A, B); // 北を0°とした時計回りではないので注意
const distanceM = google.maps.geometry.spherical.computeDistanceBetween(A, B);
```

> 必要なら北基準の方位角へ変換ロジックを追加（例: `bearing = (90 - heading + 360) % 360` など）。

---

## 8. ライセンス/ポリシー配慮

- **ユーザーが手で描いた頂点座標**はユーザー入力として自社DBへ保存可能。
- ただし **Googleが提供する地図コンテンツのキャッシュ/再配布/オフライン利用は禁止**（地図タイルやストリートビュー画像等）。
- **帰属表示**（© Google）をマップ上で保持。
- ルート/プレイス等の派生データ保存はサービス固有ポリシーに従う（本機能は該当しないが将来拡張時に注意）。
- 詳細は社内チェックリスト（ToS抜粋）を用意し、公開前に法務レビューを実施。

---

## 9. 料金見積り（概算の考え方）

- 指標: **Dynamic Map ロード数** と Drawing/Geometry の呼び出しは **同一ロード内の動作**として扱われる想定。
- 課金/無料枠は Google の**最新の価格表と計算機**で試算（プロジェクト規模で月間合算）。
- 小規模 PoC: 1,000〜10,000 map loads/月 → **無料枠内/少額**見込み。
- 本番: 50,000〜200,000 map loads/月 → 数百〜数千USD/月のレンジ（ディスカウント次第）。

> 正確な金額は、実トラフィック前提で**公式プライシング計算機**による見積りを実施。

---

## 10. 非機能要件

- **パフォーマンス**: 過度な再レンダリングを避ける。大規模ポリゴンは簡略化（Douglas–Peucker）。
- **精度**: `computeArea` は球面幾何に基づく。大面積・高緯度の歪みは仕様書に注意書きを明記。
- **監視**: GCPの請求アラート、Map loads のクォータ警告を設定。
- **セキュリティ**: APIキーの**HTTPリファラ制限**（web）、**IP制限**（サーバ）を必須。

---

## 11. 受け入れ基準 / テスト

**機能テスト**

-

**API/DBテスト**

-

**E2E**

-

---

## 12. スケジュール（例）

- W1: プロト（描画→面積→JSON保存）
- W2: 編集機能/穴あき対応、API/DB確定
- W3: ABライン/検索機能、法務レビュー
- W4: 本番デプロイ、モニタリング/アラート設定

---

## 13. リスクと対策

- **料金変動/課金超過**: 請求アラート、Dailyクォータ、キャッシュ/利用制御。
- **ToS違反の懸念**: 法務チェックリスト、コードレビュー、ドキュメント整備。
- **編集UXの複雑化**: MVPでは最小機能→要望次第で拡張。

---

## 14. 今後の拡張

- 画像下敷き（オルソ/衛星）とのスナップ、点群→輪郭抽出。
- フィールド分割/結合、境界のトポロジー整合。
- 直進アシスト（ABライン）との相互参照・誘導UI。

---

## 15. オープン事項（要回答）

1. **複数区画**を1圃場で管理しますか？（`MultiPolygon`）
2. \*\*穴あき（内輪）\*\*対応は初期から必要ですか？
3. **ABライン**は同画面で作成・保存しますか？
4. 保存時の**自動スナップ**（道路/水路/既存境界）を入れますか？
5. 予想**月間 map loads** はどれくらいですか？（料金試算に必要）

---

## 16. 衛星データ連携（STAC/EO）を見据えた設計ガイド

**結論**: 本企画で作る **GeoJSON 圃場境界を原本（source of truth）** にすれば、後段の人工衛星連携はシンプルになります。

> **今回の前提（ユーザー指定）**
>
> - センサー: **Sentinel-2（10m）**
> - 解析期間: **6月〜10月**（毎年のシーズン）
> - 指標: **NDVI のみ**（NDWI/EVIは不要）
> - 出力: **日次タイムシリーズ**（観測がない日は欠損。※補間ポリシーは下記）

### 16.1 圃場スキーマに今から入れておく推奨フィールド

```jsonc
// fields への追加推奨
{
  "centroid": { "type": "Point", "coordinates": [lng, lat] },
  "bbox": [minLng, minLat, maxLng, maxLat],
  "simplified_geometry": { "type": "Polygon", "coordinates": [...] }, // 表示/前処理の高速化
  "simplify_tolerance_m": 1.0,
  "buffer_m": 0,               // 解析時の膨張/収縮既定
  "stac_prefs": {
    "collections": ["sentinel-2-l2a"],
    "season": { "from": "06-01", "to": "10-31" },
    "gsd_target_m": 10,
    "cloud_cover_max": 40      // %（暫定既定。必要なら変更）
  }
}
```

> `simplified_geometry` は元の `geometry` を壊さずに**別フィールド**で保持。地図や前処理を高速化。

### 16.2 追加コレクション案

**scenes**（STACメタ）

```jsonc
{
  "stac_id": "S2A_2025-06-03_T54TVK",
  "collection": "sentinel-2-l2a",
  "datetime": "2025-06-03T01:23:45Z",
  "eo:cloud_cover": 12.3,
  "gsd": 10,
  "geometry": { "type": "Polygon", "coordinates": [...] },
  "assets": { "red": ".../B04.tif", "nir": ".../B08.tif", "scl": ".../SCL.tif", "thumb": ".../preview.png" },
  "ingest_status": "ready|processing|done|error"
}
```

**eo\_timeseries**（圃場×日付の指数/品質：**NDVIのみ**）

```jsonc
{
  "field_id": "F001",
  "date": "2025-06-03",
  "ndvi": 0.71,
  "cloud_cover": 12.3,
  "scene_ref": "S2A_2025-06-03_T54TVK",
  "quicklook_png": "https://.../F001_20250603.png"
}
```

### 16.3 連携パイプライン（最小）

1. **STAC検索**: `fields.geometry` で `intersects` クエリ + 期間（毎年6/1〜10/31）+ 雲量≤`cloud_cover_max`。
2. **マスク処理**: Sentinel-2 の **SCL（Scene Classification Layer）** で雲/影/雪を除外。
3. **クリップ&指標**: COG（Cloud Optimized GeoTIFF）を圃場ポリゴンで**クリップ**→ **NDVI = (B08 − B04) / (B08 + B04)** を計算。
4. **集約**: 圃場内の NDVI の統計量（平均/中央値/分位など）を計算し、**観測日**として `eo_timeseries` に1レコード保存。
5. **可視化**: `field_id` ごとに**日次タイムライン**をグラフ表示。クイックルックPNGを地図オーバレイ。

> **日次シリーズの考え方**: Sentinel-2 の実観測は5日前後の再訪が基本。**欠測日は null のまま**保存し、 必要に応じてアプリ側で（a）前回保持（forward-fill）や（b）線形補間を**表示時オプション**として提供。

### 16.4 実装の注意

- **座標系**: フロントのGeoJSONは WGS84（EPSG:4326）。解析時はフィールドのUTMゾーンへ**動的再投影**してピクセル境界を安定化。
- **ポリゴン妥当性**: 自己交差/穴の向きは失敗要因。サーバで `buffer(0)` 等で修復を試行し、ダメならユーザーに修正を促す。
- **リング向き**: 外輪=反時計回り/内輪=時計回りを推奨（実装差異対策）。
- **品質閾値**: `cloud_cover_max`（既定40%）と SCL クラス別のマスク組合せは環境に合わせて調整可。

### 16.5 受け入れ基準 追加

-

---

## 付録 D. 推奨ワークフロー（PoC）

- W1: 既存アプリで圃場GeoJSONを作成 → `centroid/bbox` 自動付与
- W2: 公的STAC（Sentinel-2）で **6/1〜10/31** の intersects 検索 → 最初の NDVI 時系列を作成
- W3: COG を圃場でクリップ → NDVI 計算 → `eo_timeseries` へ保存
- W4: ダッシュボードに**日次NDVIグラフ＋最新サムネ**表示

