# 1. 背景と目的

- **現状**：北海道で約100ha、圃場が車で1時間離在。毎日の見回り負担が大きい。
- **課題**：巡回の“抜け/ムダ”を減らし、**異常候補の早期発見→現地確認の優先順位付け**を自動化したい。
- **方針**：**Sentinel‑2（10m, L2A）****を主データ源に、MongoDB既存の****圃場GeoJSON**を活用。ノーコードに限定せず、軽量な自前パイプラインで**週1前後の有効観測**を確保し、**LINE/メール**へ「今週見るべき圃場」を自動配信する。

---

# 2. スコープ（品目/季節）

- 品目：**ブロッコリー、長ネギ、かぼちゃ**（6–10月の生育期が主戦場）。
- 目的：
  - **生育ムラ/遅延**の早期把握（NDVI中心）。
  - **過湿/冠水・倒伏兆候**の補足（曇天時は後にSentinel‑1で拡張可能）。
  - **作業ステージの粗把握**（定植→被覆→収穫後の大きな変化）。
- 解像度：10m（区画平均の傾向把握。株単位診断は対象外）。

---

# 3. 成果物（MVP）

1. **ダッシュボード**（Web/スマホ）
   - 圃場ポリゴンごとに**NDVI偏差の色塗り**、スパークライン（時系列）。
   - **アラート一覧**（優先度順）。
2. **週報**（自動配信）
   - 「**今週見るべき圃場TOP N**」「候補の理由（指標/位置）」
3. **MongoDB**の**観測・統計**スキーマ一式（既存のfieldsと連携）。

---

# 4. 全体アーキテクチャ（選択肢）

**共通**：Mongoの`fields`（GeoJSON）を**STAC**検索の`intersects`に使用。

- **A. STAC（Planetary Computer / Earth Search）＋自前処理（推奨）**
  - STAC APIで**Sentinel‑2 L2A**を照会→該当タイルの**COG**を読み込み→**NDVI**算出→**雲/影マスク**→**7日ロール中央値**で合成→**圃場内統計**→Mongo保存。
  - 長所：**ベンダーロック低**、費用最小、Mongoと親和性高い。
- **B. Copernicus Data Space Ecosystem API**
  - 公式エコシステムで検索/取得。Aと同様の自前処理。
  - 長所：公式の継続性・網羅性。短所：API仕様キャッチアップ要。
- **C. マネージド配信（Sentinel Hub等）**
  - タイル/統計APIで素早く可視化・統計化。短期PoCには有用。
  - 長所：開発速度。短所：**商用費用**とロックイン配慮。

> **推奨構成**：A（STAC＋自前）。まずNDVIに集中し、雲天週は欠測扱い→後段でSAR併用を増築。

---

# 5. データフロー（日次 or 隔日ジョブ）

0. **入力**：`fields`（GeoJSON, 2dsphere index）／観測期間（例：6–10月）。
1. **Discover**：STACに対して`time=昨日−7日:昨日`、`collections=sentinel-2-l2a`、`intersects=field.geometry`で検索。
2. **Filter**：`eo:cloud_cover ≤ 40`、重複は最新。光学欠測なら**スキップ**。
3. **Read**：COGの**B8（NIR）・B4（Red）・SCL**を範囲切出し（圃場境界＋バッファ）。
4. **Cloud/Shadow Mask**：SCLの\*\*[3,7,8,9,10,11]\*\*を除外、**膨張1px**で縁を拡大。
5. **Index**：`NDVI = (B8 − B4) / (B8 + B4)` を10m解像で算出。
6. **Composite**：対象期間の有効ピクセルで**中央値合成（7日）**。
7. **Z‑score/偏差化**：圃場内の**中央値/σ**に対する**偏差マップ**を作成。
8. **集計**：`mean/median/std/p5/p95`, `低NDVI（中央値−2σ以下）の面積割合`。
9. **保存**：Mongoに**観測レコード**＋**集計**を`field_id×date`でUpsert。
10. **アラート生成**：
    - ルール①：`低NDVI割合 ≥ θ%`（例：15%）。
    - ルール②：`週次中央値が直近3合成の移動中央値−Δ以上の低下`。
11. **配信**：
    - ダッシュボードの**色塗り**更新。
    - **週報**：LINE/メールにTOP Nと位置サムネ。

---

# 6. MongoDB 設計（案）

```yaml
# 既存
fields:               # 圃場ポリゴン（GeoJSON）
  - field_id: F001
    name: 第1北ブロック
    crop: broccoli
    geometry: { type: Polygon, coordinates: [...] }
    ab_azimuth_deg: 12
    area_ha: 3.25
    updated_at: 2025-08-15

# 新規（観測/集計）
s2_observations:
  - _id: <ObjectId>
    field_id: F001
    date: 2025-08-12          # 合成代表日（UTC）
    window_days: 7            # 合成窓幅
    ndvi_stats:               # 圃場内
      mean: 0.58
      median: 0.60
      std: 0.06
      p5: 0.42
      p95: 0.71
      low_frac_sigma2: 0.18   # 中央値−2σ以下の画素割合
    masked_frac: 0.22         # マスクで除外された画素割合
    stac_assets:              # 参照したシーンとCOG
      - { id: "S2A_20250810_T54WVK", href: "s3://...B04.tif" }
    tiles_url: "https://.../tiles/{z}/{x}/{y}.png"  # 可視化タイル（任意）
    created_at: 2025-08-12T03:10:00Z

alerts:
  - _id: <ObjectId>
    field_id: F001
    date: 2025-08-12
    type: "ndvi_drop"
    score: 0.82                 # 優先度スコア（0–1）
    reason: "low_frac_sigma2=0.18 >= 0.15"
    bbox_hint: [minx, miny, maxx, maxy] # 低NDVIクラスタの外接矩形
    status: "open"             # open/resolved
```

**Index**：

- `fields.geometry` に **2dsphere**
- `s2_observations`: `{ field_id: 1, date: -1 }`、TTLは任意（長期保持するなら不要）
- `alerts`: `{ status: 1, date: -1 }`

---

# 7. 処理仕様（詳細）

- **データ**：Sentinel‑2 **L2A（BOA反射率）**。取得は**STAC**で検索、**COG**を範囲切出し。
- **雲/影マスク**：Scene Classification（SCL）で以下を除外：
  - `3: Cloud Shadows`、`7: Clouds Low Prob/Unclassified`、`8: Cloud Med Prob`、`9: Cloud High Prob`、`10: Cirrus`、`11: Snow/Ice`
  - 必要に応じ`6: Water`も除外（圃場条件次第）
  - \*\*膨張（1px）\*\*で雲縁のリーク抑制。
- **インデックス**：`NDVI = (B8 − B4) / (B8 + B4)`（10m）。
- **合成**：観測窓内の**中央値**（Median）でロバスト化。欠測が多い場合は**窓を+7日**拡張。
- **品質**：`masked_frac`が閾値（例：>0.6）を超えた場合は**無効化**し、次週に繰越。
- **拡張余地**：
  - **NDRE**（B8A/20m）を10mへリサンプル（苗立ち初期の感度向上）。
  - **異常クラスタ**の**DBSCAN**抽出→`bbox_hint`に格納。

---

# 8. 可視化/配信

- **タイル配信**：COG→**XYZ/WMTS**（例：`titiler`）で**NDVI/偏差マップ**を即座に地図へ重畳。
- **ダッシュボード**：
  - 地図（圃場色塗り）＋右ペインに**時系列（スパークライン）**。
  - フィルタ：作物/地域/アラート種別、日付スライダー。
- **通知**：LINE/メールに**TOP N圃場**、サムネ、簡易理由、マップディープリンク。

---

# 9. 運用フロー（週次）

1. 深夜ジョブで**STAC検索→処理→Mongo保存**。
2. 朝（例：7:30 JST）に**週報生成**（月/木など固定）
3. 巡回前に**優先圃場を共有**→現地アプリで結果記録→**閾値の自動チューニング**。

---

# 10. 検証計画（PoC→Pilot）

- **PoC（3–4週間）**：代表**5圃場**で週次運用。KPI：
  - **見回り時間の削減率**（ベース比▲30%目標）
  - **見逃し率**（現地報告ベース）
  - **誤検知率**（低NDVIだが無問題のケース）
- **Pilot（6–8週間）**：全圃場に拡張、**アラート重み**（冠水>生育遅れ）調整、**NDRE/気象**を追加。

---

# 11. セキュリティ/権利・運用

- **データ権利**：Copernicusデータは**無償利用可**（出典表記）。
- **コスト**：自前処理（COG直読）＋Mongo中心→**サーバ小規模/ストレージ軽量**。
- **運用**：Docker化→**cron/ワーカー**で定期実行。失敗時リトライ＆Slack/LINE通知。

---

# 12. リスクと対策

- **曇天連続で欠測**：合成窓拡張、のちに**Sentinel‑1**併用で補完。
- **誤検知**：現地フィードバックで**しきい値学習**、クラスタ面積の最小値設定。
- **API変更**：STACは標準化されており**ベンダー切替容易**。エンドポイントは複数冗長化。

---

# 13. ロードマップ（8週間）

- **W1**：環境整備（STAC接続、COG直読、Mongoスキーマ/Index、試験圃場選定）
- **W2**：NDVI処理（SCLマスク、7日合成、統計）
- **W3**：タイル配信 & ダッシュボードMVP（色塗り/時系列）
- **W4**：アラート生成/週報配信（LINE/メール）
- **W5–6**：運用テスト（代表5圃場）、閾値調整、UI磨き込み
- **W7–8**：全圃場展開、運用ドキュメント化、バックアップ/監視

---

# 14. 付録

## 14.1 Sentinel‑2（NDVIに必要なバンド）

- **B4（Red, 10m）**, **B8（NIR, 10m）**
- 参考：NDRE（**B8A/20m**, **B5–7/20m**を10mへリサンプル）

## 14.2 SCL（Scene Classification）判定の利用

- マスク対象：`3,7,8,9,10,11`（必要に応じ`6`）
- 縁漏れ対策：膨張（1px）

## 14.3 しきい値（初期案）

- `low_frac_sigma2 ≥ 0.15` で**アラート**
- `masked_frac > 0.6` は**無効化**
- 直近3合成の**移動中央値−0.07**を下回ったら**注意**

---

# 15. 次アクション（あなた側）

1. **圃場**``**サンプル5件**を共有（匿名化可）。
2. **優先KPI**の順位（例：冠水>生育遅れ）。
3. 週報の**配信曜日/時間**（例：月曜7:30, 木曜7:30）。

# 16. 次アクション（こちら側）

- STAC接続の**最小コード試作**（ローカル）
- Mongoスキーマ作成＆**ダミーデータ投入**
- ダッシュボード**ワイヤーフレーム**作成

---

# 17. Mongo現状スキーマ確認＆修正案（あなたのDB前提 v1.1）

**結論：そのままでも開始可能。** ただし以下4点の“軽微な整備”でSTAC連携と幾何計算が安定します。

## 17.1 いまのフィールド（抜粋）

```yaml
_id: ObjectId(68a30c719fd30ee54af95a46)
external_id: "522100"
source: "agri-note"
name: "橋向こう①"
area_ha: 1.23
current_year: 2025
current_crop: ""            # 未設定でも可（任意）
deleted: false
created_at: 2025-08-18T11:20:17Z
updated_at: 2025-08-18T11:20:17Z
geometry: { ... }            # Object（要GeoJSON）
geometry_json: "{type:Feature,...}" # 文字列の重複データ
memo: ""
```

## 17.2 最小修正（推奨）

1. **geometryの正規化**

- `geometry` を **GeoJSON Geometry**（例：`{type:"Polygon", coordinates:[[ [lon,lat],... ]]}`）に統一。
- `geometry_json`（文字列）は**削除 or 同期停止**（二重管理回避）。

2. **座標系と健全性**

- 座標は **EPSG:4326（lon,lat）**。
- Polygonは**最初/最後の座標が一致**（リング閉合）、**反時計回り**推奨。穴（holes）がある場合は内側リングは**時計回り**。

3. **インデックス**

- `geometry` に **2dsphere**。
- 運用用に `{ source:1, external_id:1 }` の複合ユニーク（任意）。

4. **メタの拡張（任意）**

- バージョニング：`valid_from`, `valid_to` を追加（境界更新の履歴管理）。
- ラベル用：`centroid: { type:"Point", coordinates:[lon,lat] }`（任意）。

> 以上で、STACの `intersects` に**そのままfields.geometry**を投げられます。

## 17.3 `s2_observations` / `alerts` の参照キー

- 参照キーは ``** に **``**（ObjectId）を格納**する運用に変更（安定・一意）。
- 既存の `external_id` は**クロスウォーク**として併置（検索や外部照合に利用）。

```yaml
s2_observations:
  - _id: <ObjectId>
    field_oid: ObjectId("68a30c...a46")  # ← 参照はMongoの_idを正とする
    external_id: "522100"
    source: "agri-note"
    date: 2025-08-12
    window_days: 7
    ndvi_stats: { mean: 0.58, median: 0.60, std: 0.06, p5: 0.42, p95: 0.71, low_frac_sigma2: 0.18 }
    masked_frac: 0.22
    stac_assets: [ { id: "S2A_20250810_T54WVK", href: "s3://..." } ]
    created_at: 2025-08-12T03:10:00Z

alerts:
  - _id: <ObjectId>
    field_oid: ObjectId("68a30c...a46")
    external_id: "522100"
    date: 2025-08-12
    type: "ndvi_drop"
    score: 0.82
    reason: "low_frac_sigma2=0.18 >= 0.15"
    bbox_hint: [minx, miny, maxx, maxy]
    status: "open"
```

**Index 推奨**：

- `s2_observations`: `{ field_oid:1, date:-1 }`
- `alerts`: `{ status:1, date:-1 }`（＋ `{ field_oid:1 }`）

## 17.4 STAC連携：`/search` 例（概念）

```json
{
  "collections": ["sentinel-2-l2a"],
  "datetime": "2025-07-01/2025-07-07",
  "intersects": <fields.geometry>,
  "query": { "eo:cloud_cover": {"lte": 40} }
}
```

- 返ってきたアイテムのCOGから **B04/B08/SCL** を切出し→**NDVI**→**SCLマスク**→**7日中央値合成**→**集計**→**Mongo upsert**。

## 17.5 幾何の品質ガードレール

- **自己交差**（self‑intersection）を検出したらレコードを**保留**としてフラグ（`geometry_valid:false, reason:"self_intersection"`）。
- **極端に細長い**（長辺/短辺比 ≫）ポリゴンは警告（座標誤りの疑い）。

## 17.6 マイグレーション手順（最短15分）

1. `geometry_json` → `geometry` へ**正規化**（JSON.parse→Feature.geometry抽出）
2. `geometry` に **2dsphere index** 付与
3. 代表5件で **STAC検索→可視化**（ダッシュボードMVP）
4. `s2_observations` / `alerts` の**コレクション作成**（Index付与）

---

# 18. 企画書差分（v1→v1.1）

- **参照キー**を `field_id`（文字列）→ ``**（ObjectId）** に変更。
- `fields` の前提を ``**一本化**に更新、`geometry_json`の二重管理を廃止。
- Index方針・品質ガードレールを追記。

---

# 19. ダッシュボードMVP仕様（v1）

**目的**：週次の“見るべき圃場”を即決できるUI。現場はLINE通知、管理者はWebで全体俯瞰。

## 19.1 画面構成

- **メイン地図**（MapLibre GL / Leaflet）
  - レイヤ1：圃場ポリゴン（`alerts.score` で色分け、凡例付き）
  - レイヤ2：**NDVI偏差タイル**（`/tiles/ndvi/{z}/{x}/{y}.png?date=YYYY-MM-DD`）
  - レイヤ3：低NDVIクラスタ（`bbox_hint`）
- **右ペイン**
  - A. **アラート一覧**（優先度順、検索/フィルタ：作物・地区・日付）
  - B. **時系列**（圃場の`median NDVI` スパークライン、移動中央値）
  - C. **最新シーン情報**（取得日、雲量、SCLマスク率、サムネ）
- **操作**：日付スライダー（週単位）、作物/地区フィルタ、圃場検索、凡例ON/OFF。

## 19.2 API（概念）

- `GET /api/fields?active=true` → GeoJSON（`_id, name, crop, geometry`）
- `GET /api/alerts?status=open&limit=100&date=2025-08-12` → TopN（`field_oid, score, reason, bbox_hint`）
- `GET /api/observations?field_oid=...&range=2025-06-01..2025-10-31` → `median, p5, p95` の時系列
- `GET /tiles/ndvi/{z}/{x}/{y}.png?date=YYYY-MM-DD` → NDVI偏差タイル（titiler等のプロキシ）
- `GET /api/thumb?field_oid=...&date=...` → 256pxサムネ

## 19.3 可視化ルール

- 色分け：`alerts.score` を 5段階にビン分割（例：0.8+ 赤、0.6–0.8 橙、0.4–0.6 黄、…）。
- 無効シーン：`masked_frac > 0.6` は地図に灰色ハッチで表示。
- 凡例には\*\*観測窓（7日合成）\*\*とデータ日付を明記。

## 19.4 技術スタック（推奨）

- **フロント**：Next.js / React + MapLibre GL + Chart.js（時系列）
- **タイル**：`titiler`（COG→XYZ）、CDNキャッシュ（Cloudflare等）
- **API**：FastAPI/Express（どちらでも）、Mongoドライバ
- **認可**：トークン（簡易）→ 後にGoogle/LINE OAuth

## 19.5 LINE連携

- 週2回（例：月/木 7:30）に**Top N圃場**を配信：小地図サムネ＋理由＋ダッシュボードへのディープリンク（圃場ID付き）。

---

# 20. 自動取り込み（スケジューラ）

- **ジョブ**：`discover→filter→read→mask→ndvi→composite→aggregate→upsert→alert→tile` を1本化。
- **起動**：
  - ① Cloud Scheduler → Cloud Run Jobs（or AWS EventBridge → ECS/Fargate）
  - ② GitHub Actions **cron**（セルフホストでもOK）
  - ③ **n8n**（CRONノード）で外形を組む案も可
- **堅牢化**：
  - 冪等（`field_oid×date×window_days` でUpsert）
  - **バックフィル**（期間指定）
  - **リトライ**（指数バックオフ）、失敗通知（Slack/LINE）
  - 実行ログをMongo `jobs` コレクションへ記録（開始/終了、処理件数、失敗理由）
- **コスト**：COG直読 + タイルのCDNキャッシュで最小化（ストレージは統計のみMongo、ラスタはオンデマンド）

