import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { ingestOneField } from './scripts/ingest_s2.js';

// 環境変数を読み込み
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const TITILER_URL = process.env.TITILER_URL || 'http://localhost:8000';

// CORS設定
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

// 静的ファイル配信（フロントエンド）
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// 環境変数をフロントエンドに提供するエンドポイント
app.get('/api/config', (req, res) => {
  const apiMode = 'external';
  const baseFromEnv = process.env.EXTERNAL_API_BASE || '';
  const defaultBase = `http://localhost:${PORT}/api`;
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    apiMode,
    externalApiBase: baseFromEnv || defaultBase
  });
});

// 作物マスタ: 一覧
app.get('/api/crops', async (req, res) => {
  try {
    await client.connect();
    const collection = client.db(dbName).collection('crops');
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const filter = { deleted: { $ne: true } };
    if (q) filter.name = { $regex: q, $options: 'i' };
    const docs = await collection.find(filter).sort({ name: 1 }).limit(limit).toArray();
    res.json(docs);
  } catch (e) {
    console.error('crops list error:', e);
    res.status(500).json({ error: 'crops_list_failed' });
  }
});

// 作物マスタ: 作成
app.post('/api/crops', async (req, res) => {
  try {
    const { name, varieties } = req.body || {};
    const cropName = (name || '').toString().trim();
    if (!cropName) return res.status(400).json({ error: 'name_required' });
    await client.connect();
    const collection = client.db(dbName).collection('crops');
    const exists = await collection.findOne({ name: cropName, deleted: { $ne: true } });
    if (exists) return res.status(409).json({ error: 'duplicate', id: exists._id });
    const doc = {
      name: cropName,
      varieties: Array.isArray(varieties) ? varieties.map(v => (v || '').toString().trim()).filter(Boolean) : [],
      created_at: new Date(),
      updated_at: new Date(),
      deleted: false
    };
    const r = await collection.insertOne(doc);
    res.status(201).json({ ...doc, _id: r.insertedId });
  } catch (e) {
    console.error('crops create error:', e);
    res.status(500).json({ error: 'crops_create_failed' });
  }
});

// 作物マスタ: 更新
app.put('/api/crops/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'invalid_id' });
    const { name, varieties } = req.body || {};
    await client.connect();
    const collection = client.db(dbName).collection('crops');
    const update = { updated_at: new Date() };
    if (name !== undefined) update.name = (name || '').toString().trim();
    if (varieties !== undefined) update.varieties = Array.isArray(varieties) ? varieties.map(v => (v || '').toString().trim()).filter(Boolean) : [];
    const r = await collection.updateOne({ _id: new ObjectId(id) }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ error: 'not_found' });
    const doc = await collection.findOne({ _id: new ObjectId(id) });
    res.json(doc);
  } catch (e) {
    console.error('crops update error:', e);
    res.status(500).json({ error: 'crops_update_failed' });
  }
});

// 作物マスタ: 削除（ハード/論理）
app.delete('/api/crops/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'invalid_id' });
    await client.connect();
    const collection = client.db(dbName).collection('crops');
    const hard = (req.query.hard === 'true') || (process.env.HARD_DELETE === 'true');
    if (hard) {
      const d = await collection.deleteOne({ _id: new ObjectId(id) });
      if (d.deletedCount === 0) return res.status(404).json({ error: 'not_found' });
      return res.status(204).send();
    }
    const r = await collection.updateOne({ _id: new ObjectId(id) }, { $set: { deleted: true, deleted_at: new Date() } });
    if (r.matchedCount === 0) return res.status(404).json({ error: 'not_found' });
    res.status(204).send();
  } catch (e) {
    console.error('crops delete error:', e);
    res.status(500).json({ error: 'crops_delete_failed' });
  }
});

// MongoDB接続設定
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || 'Agri-AI-Project';

if (!mongoUri) {
  console.error('MONGODB_URIが設定されていません。.envファイルを確認してください。');
  process.exit(1);
}

const client = new MongoClient(mongoUri);

// データベース接続確認
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('MongoDB接続成功');
    // 接続テスト
    await client.db(dbName).admin().ping();
    console.log(`データベース '${dbName}' に正常に接続しました`);
  } catch (error) {
    console.error('MongoDB接続エラー:', error);
    process.exit(1);
  }
}

// 作物マスタを存在保証（name を作成/更新、variety があれば varieties に追加）
async function upsertCropMaster(cropName, varietyName) {
  const name = (cropName || '').toString().trim();
  const variety = (varietyName || '').toString().trim();
  if (!name) return;
  await client.connect();
  const crops = client.db(dbName).collection('crops');
  const update = {
    // 同じパスに対する競合を避けるため、$setOnInsert では varieties を設定しない
    $setOnInsert: { name, created_at: new Date(), deleted: false },
    $set: { updated_at: new Date() }
  };
  if (variety) {
    update.$addToSet = { varieties: variety };
  }
  await crops.updateOne({ name, deleted: { $ne: true } }, update, { upsert: true });
}

// Sentinel-2 NDVI タイルテンプレート取得（MVP: titiler 公開エンドポイント利用）
app.get('/api/s2/ndvi/latest', async (req, res) => {
  try {
    const fieldId = (req.query.field_id || req.query.id || '').toString();
    if (!ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'invalid_field_id' });
    await client.connect();
    const field = await client.db(dbName).collection('fields').findOne({ _id: new ObjectId(fieldId) });
    if (!field || !field.geometry) return res.status(404).json({ error: 'field_not_found' });

    // パラメータ（デフォルト: 10日/雲量70%）
    const qDays = Math.min(parseInt(req.query.days) || 10, 120);
    const qCloud = Math.min(parseInt(req.query.cloud) || 70, 100);

    async function searchScene(days, cloud) {
      const to = new Date();
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const stacBody = {
        collections: ['sentinel-2-l2a'],
        datetime: `${from.toISOString()}/${to.toISOString()}`,
        intersects: field.geometry,
        query: { 'eo:cloud_cover': { lte: cloud } },
        limit: 1,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }]
      };
      const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody)
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      return j.features && j.features[0] ? j.features[0] : null;
    }

    // 段階的に緩めて探索
    const attempts = [
      [qDays, qCloud],
      [Math.max(20, qDays * 3), Math.max(qCloud, 80)],
      [60, 90]
    ];

    let item = null, used = null;
    for (const [d, c] of attempts) {
      item = await searchScene(d, c);
      if (item) { used = { days: d, cloud: c }; break; }
    }
    if (!item) {
      return res.status(404).json({ error: 'no_scene_found', message: `過去${attempts[2][0]}日以内・雲量≤${attempts[2][1]}%でもシーンが見つかりませんでした` });
    }

    // STAC Item の自己参照URL
    const selfLink = (item.links || []).find(l => l.rel === 'self')?.href || null;
    const itemUrl = selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(item.id)}`;

    // titiler の STAC タイルテンプレート（NDVI式）
    const expr = encodeURIComponent('(nir-red)/(nir+red)');
    // 圃場のBBoxで切り出し
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    try {
      const ring = field.geometry?.coordinates?.[0] || [];
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
    } catch {}
    const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
    const common = `url=${encodeURIComponent(itemUrl)}&assets=nir,red&asset_as_band=true&expression=${expr}&rescale=-1,1&colormap_name=rdylgn&resampling=nearest`;
    const tile = `${TITILER_URL}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${common}`;
    const preview = `${TITILER_URL}/stac/bbox/${bbox}/768x768.png?${common}`;

    res.json({
      field_id: fieldId,
      datetime: item.properties?.datetime || null,
      cloud_cover: item.properties?.['eo:cloud_cover'] ?? null,
      tile_template: tile,
      preview_url: preview,
      stac_item_url: itemUrl,
      used_search: used
    });
  } catch (e) {
    console.error('s2 ndvi latest error:', e);
    res.status(500).json({ error: 's2_ndvi_failed', message: e.message });
  }
});

// NDVI統計値取得エンドポイント（mean, median, std, min, max, histogram）
app.get('/api/s2/ndvi/stats', async (req, res) => {
  try {
    const fieldId = (req.query.field_id || req.query.id || '').toString();
    if (!ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'invalid_field_id' });
    
    await client.connect();
    const field = await client.db(dbName).collection('fields').findOne({ _id: new ObjectId(fieldId) });
    if (!field || !field.geometry) return res.status(404).json({ error: 'field_not_found' });

    // 最新のSTACアイテムを取得（既存ロジック再利用）
    const qDays = Math.min(parseInt(req.query.days) || 10, 120);
    const qCloud = Math.min(parseInt(req.query.cloud) || 70, 100);

    async function searchScene(days, cloud) {
      const to = new Date();
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const stacBody = {
        collections: ['sentinel-2-l2a'],
        datetime: `${from.toISOString()}/${to.toISOString()}`,
        intersects: field.geometry,
        query: { 'eo:cloud_cover': { lte: cloud } },
        limit: 1,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }]
      };
      const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody)
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      return j.features && j.features[0] ? j.features[0] : null;
    }

    const attempts = [
      [qDays, qCloud],
      [Math.max(20, qDays * 3), Math.max(qCloud, 80)],
      [60, 90]
    ];

    let item = null;
    for (const [d, c] of attempts) {
      item = await searchScene(d, c);
      if (item) break;
    }
    if (!item) {
      return res.status(404).json({ error: 'no_scene_found' });
    }

    const selfLink = (item.links || []).find(l => l.rel === 'self')?.href || null;
    const itemUrl = selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(item.id)}`;

    // 圃場のBBox
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    try {
      const ring = field.geometry?.coordinates?.[0] || [];
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
    } catch {}
    const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;

    // TiTilerのstatisticsエンドポイントを使用してNDVI統計値を取得（圃場ポリゴンでクリップ）
    const statsParams = new URLSearchParams({
      url: itemUrl,
      assets: 'nir,red',
      asset_as_band: 'true',
      expression: '(nir-red)/(nir+red)',
      categorical: 'false',
      histogram: 'true'
    });

    const statsUrl = `${TITILER_URL}/stac/statistics?${statsParams}`;
    const statsBody = { type: 'Feature', properties: {}, geometry: field.geometry };
    let statsResponse = await fetch(statsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(statsBody)
    });
    // POSTが受け付けられない場合のフォールバック（GET + geojson=）
    if (!statsResponse.ok) {
      const fallbackUrl = `${statsUrl}&geojson=${encodeURIComponent(JSON.stringify(statsBody))}`;
      statsResponse = await fetch(fallbackUrl);
    }
    
    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();
      return res.status(500).json({ error: 'stats_failed', message: errorText });
    }

    const statsData = await statsResponse.json();

    // レスポンス形式を吸収しつつ統計本体を抽出
    let ndviStats = null;
    if (statsData && typeof statsData === 'object') {
      // TiTiler典型: { type: 'Feature', properties: { statistics: { '(nir-red)/(nir+red)': {...} } } }
      if (statsData.properties && statsData.properties.statistics) {
        const s = statsData.properties.statistics;
        const firstKey = Object.keys(s)[0];
        ndviStats = s['(nir-red)/(nir+red)'] || s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
      }
      // 別形
      if (!ndviStats && statsData.statistics && typeof statsData.statistics === 'object') {
        const s = statsData.statistics;
        const firstKey = Object.keys(s)[0];
        ndviStats = s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
      }
      if (!ndviStats) {
        // 平坦 or 他名
        ndviStats = statsData.expression || statsData.stats || null;
      }
      if (!ndviStats && statsData.mean !== undefined) {
        ndviStats = statsData; // 既に平坦
      }
    }

    // プロパティ名差異の吸収（stddevなど）
    const stdValue = ndviStats ? (ndviStats.std ?? ndviStats.stdev ?? ndviStats.stddev ?? null) : null;
    const result = {
      field_id: fieldId,
      datetime: item.properties?.datetime || null,
      cloud_cover: item.properties?.['eo:cloud_cover'] ?? null,
      ndvi_statistics: {
        mean: ndviStats ? (ndviStats.mean ?? ndviStats.avg ?? null) : null,
        median: ndviStats ? (ndviStats.median ?? ndviStats.p50 ?? null) : null,
        std: stdValue,
        min: ndviStats ? (ndviStats.min ?? ndviStats.p0 ?? null) : null,
        max: ndviStats ? (ndviStats.max ?? ndviStats.p100 ?? null) : null,
        count: ndviStats ? (ndviStats.count ?? ndviStats.n ?? null) : null,
        histogram: ndviStats ? (ndviStats.histogram ?? ndviStats.histogram_bins ?? null) : null
      },
      interpretation: {
        vegetation_health: (ndviStats?.mean ?? 0) > 0.6 ? 'excellent' : 
                          (ndviStats?.mean ?? 0) > 0.4 ? 'good' : 
                          (ndviStats?.mean ?? 0) > 0.2 ? 'poor' : 'very_poor',
        coverage_percentage: ndviStats?.mean != null ? Math.round(((ndviStats.mean + 1) * 50)) : null
      }
    };

    res.json(result);
  } catch (e) {
    console.error('ndvi stats error:', e);
    res.status(500).json({ error: 'ndvi_stats_failed', message: e.message });
  }
});

// サーバ側プロキシ: 圃場ごとのNDVIプレビューPNGを返す
app.get('/api/s2/preview.png', async (req, res) => {
  try {
    const fieldId = (req.query.field_id || req.query.id || '').toString();
    const days = Math.min(parseInt(req.query.days) || 10, 120);
    const cloud = Math.min(parseInt(req.query.cloud) || 70, 100);
    const size = Math.max(256, Math.min(parseInt(req.query.size) || 768, 2048));
    const itemUrlFromClient = (req.query.item_url || '').toString();
    if (!ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'invalid_field_id' });

    await client.connect();
    const field = await client.db(dbName).collection('fields').findOne({ _id: new ObjectId(fieldId) });
    if (!field || !field.geometry) return res.status(404).json({ error: 'field_not_found' });

    // STAC Item URLを優先利用（指定がなければ段階的に検索）
    let itemUrl = itemUrlFromClient;
    if (!itemUrl) {
      async function searchScene(daysArg, cloudArg) {
        const to = new Date();
        const from = new Date(Date.now() - daysArg * 24 * 60 * 60 * 1000);
        const stacBody = {
          collections: ['sentinel-2-l2a'],
          datetime: `${from.toISOString()}/${to.toISOString()}`,
          intersects: field.geometry,
          query: { 'eo:cloud_cover': { lte: cloudArg } },
          limit: 1,
          sortby: [{ field: 'properties.datetime', direction: 'desc' }]
        };
        const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody)
        });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        const it = j.features && j.features[0];
        if (!it) return null;
        const selfLink = (it.links || []).find(l => l.rel === 'self')?.href || null;
        return selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(it.id)}`;
      }
      const attempts = [ [days, cloud], [Math.max(20, days*3), Math.max(cloud, 80)], [60, 90] ];
      for (const [d, c] of attempts) {
        itemUrl = await searchScene(d, c);
        if (itemUrl) break;
      }
      if (!itemUrl) return res.status(404).json({ error: 'no_scene_found' });
    }

    // 圃場BBox
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    const ring = field.geometry?.coordinates?.[0] || [];
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    const pad = 0.001;
    minLng -= pad; minLat -= pad; maxLng += pad; maxLat += pad;

    // titiler へ（NDVI）
    const expr = encodeURIComponent('(nir-red)/(nir+red)');
    const common = `url=${encodeURIComponent(itemUrl)}&assets=nir,red&asset_as_band=true&expression=${expr}&rescale=-1,1&colormap_name=rdylgn&resampling=nearest`;
    const previewUrl = `${TITILER_URL}/stac/bbox/${minLng},${minLat},${maxLng},${maxLat}/${size}x${size}.png?${common}`;

    const imgRes = await fetch(previewUrl);
    if (!imgRes.ok) {
      const txt = await imgRes.text();
      return res.status(502).json({ error: 'titiler_failed', detail: txt, previewUrl });
    }
    const ab = await imgRes.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.send(Buffer.from(ab));
  } catch (e) {
    console.error('s2 preview proxy error:', e);
    res.status(500).json({ error: 's2_preview_failed', message: e.message });
  }
});

// ========== DBなし簡易モード: GeoJSONを直接受け取りNDVI取得 ==========
// 1) プレビュー画像（PNG）
app.post('/api/s2/preview.simple', async (req, res) => {
  try {
    const body = req.body || {};
    const feature = body.type === 'Feature' ? body : (body.feature || null);
    const geometry = feature?.geometry || body.geometry;
    const days = Math.min(parseInt(body.days) || 10, 120);
    const cloud = Math.min(parseInt(body.cloud) || 70, 100);
    const size = Math.max(256, Math.min(parseInt(body.size) || 768, 2048));
    let itemUrl = (body.item_url || '').toString();

    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
      return res.status(400).json({ error: 'invalid_geometry' });
    }

    async function searchScene(g, daysArg, cloudArg) {
      const to = new Date();
      const from = new Date(Date.now() - daysArg * 24 * 60 * 60 * 1000);
      const stacBody = {
        collections: ['sentinel-2-l2a'],
        datetime: `${from.toISOString()}/${to.toISOString()}`,
        intersects: g,
        query: { 'eo:cloud_cover': { lte: cloudArg } },
        limit: 1,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }]
      };
      const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody)
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const it = j.features && j.features[0];
      if (!it) return null;
      const selfLink = (it.links || []).find(l => l.rel === 'self')?.href || null;
      return selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(it.id)}`;
    }

    if (!itemUrl) {
      const attempts = [ [days, cloud], [Math.max(20, days*3), Math.max(cloud, 80)], [60, 90] ];
      for (const [d, c] of attempts) {
        itemUrl = await searchScene(geometry, d, c);
        if (itemUrl) break;
      }
      if (!itemUrl) return res.status(404).json({ error: 'no_scene_found' });
    }

    // BBox from geometry
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    try {
      const ring = geometry?.coordinates?.[0] || [];
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
    } catch {}

    const expr = encodeURIComponent('(nir-red)/(nir+red)');
    const common = `url=${encodeURIComponent(itemUrl)}&assets=nir,red&asset_as_band=true&expression=${expr}&rescale=-1,1&colormap_name=rdylgn&resampling=nearest`;
    const previewUrl = `${TITILER_URL}/stac/bbox/${minLng},${minLat},${maxLng},${maxLat}/${size}x${size}.png?${common}`;

    const imgRes = await fetch(previewUrl);
    if (!imgRes.ok) {
      const txt = await imgRes.text();
      return res.status(502).json({ error: 'titiler_failed', detail: txt, previewUrl });
    }
    const ab = await imgRes.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.send(Buffer.from(ab));
  } catch (e) {
    console.error('preview.simple error:', e);
    res.status(500).json({ error: 'preview_simple_failed', message: e.message });
  }
});

// 2) 統計（JSON）
app.post('/api/s2/stats.simple', async (req, res) => {
  try {
    const body = req.body || {};
    const feature = body.type === 'Feature' ? body : (body.feature || null);
    const geometry = feature?.geometry || body.geometry;
    const days = Math.min(parseInt(body.days) || 10, 120);
    const cloud = Math.min(parseInt(body.cloud) || 70, 100);
    let itemUrl = (body.item_url || '').toString();

    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
      return res.status(400).json({ error: 'invalid_geometry' });
    }

    async function searchScene(g, daysArg, cloudArg) {
      const to = new Date();
      const from = new Date(Date.now() - daysArg * 24 * 60 * 60 * 1000);
      const stacBody = {
        collections: ['sentinel-2-l2a'],
        datetime: `${from.toISOString()}/${to.toISOString()}`,
        intersects: g,
        query: { 'eo:cloud_cover': { lte: cloudArg } },
        limit: 1,
        sortby: [{ field: 'properties.datetime', direction: 'desc' }]
      };
      const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody)
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const it = j.features && j.features[0];
      if (!it) return null;
      const selfLink = (it.links || []).find(l => l.rel === 'self')?.href || null;
      return selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(it.id)}`;
    }

    if (!itemUrl) {
      const attempts = [ [days, cloud], [Math.max(20, days*3), Math.max(cloud, 80)], [60, 90] ];
      for (const [d, c] of attempts) {
        itemUrl = await searchScene(geometry, d, c);
        if (itemUrl) break;
      }
      if (!itemUrl) return res.status(404).json({ error: 'no_scene_found' });
    }

    const params = new URLSearchParams({
      url: itemUrl,
      assets: 'nir,red',
      asset_as_band: 'true',
      expression: '(nir-red)/(nir+red)',
      categorical: 'false',
      histogram: 'true'
    });
    const statsUrl = `${TITILER_URL}/stac/statistics?${params}`;
    const statsBody = { type: 'Feature', properties: {}, geometry };
    let statsResponse = await fetch(statsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statsBody) });
    if (!statsResponse.ok) {
      const fallbackUrl = `${statsUrl}&geojson=${encodeURIComponent(JSON.stringify(statsBody))}`;
      statsResponse = await fetch(fallbackUrl);
    }
    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();
      return res.status(502).json({ error: 'stats_failed', message: errorText });
    }

    const statsData = await statsResponse.json();
    let ndviStats = null;
    if (statsData && typeof statsData === 'object') {
      if (statsData.properties && statsData.properties.statistics) {
        const s = statsData.properties.statistics;
        const firstKey = Object.keys(s)[0];
        ndviStats = s['(nir-red)/(nir+red)'] || s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
      }
      if (!ndviStats && statsData.statistics && typeof statsData.statistics === 'object') {
        const s = statsData.statistics;
        const firstKey = Object.keys(s)[0];
        ndviStats = s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
      }
      if (!ndviStats) ndviStats = statsData.expression || statsData.stats || (statsData.mean !== undefined ? statsData : null);
    }

    const stdValue = ndviStats ? (ndviStats.std ?? ndviStats.stdev ?? ndviStats.stddev ?? null) : null;
    res.json({
      stac_item_url: itemUrl,
      ndvi_statistics: {
        mean: ndviStats ? (ndviStats.mean ?? ndviStats.avg ?? null) : null,
        median: ndviStats ? (ndviStats.median ?? ndviStats.p50 ?? null) : null,
        std: stdValue,
        min: ndviStats ? (ndviStats.min ?? ndviStats.p0 ?? null) : null,
        max: ndviStats ? (ndviStats.max ?? ndviStats.p100 ?? null) : null,
        count: ndviStats ? (ndviStats.count ?? ndviStats.n ?? null) : null,
        histogram: ndviStats ? (ndviStats.histogram ?? ndviStats.histogram_bins ?? null) : null
      }
    });
  } catch (e) {
    console.error('stats.simple error:', e);
    res.status(500).json({ error: 'stats_simple_failed', message: e.message });
  }
});
// ヘルスチェックエンドポイント
app.get('/api/health', (req, res) => {
  res.json({ 
    ok: true, 
    message: '圃場データベースAPI サーバーが稼働中',
    timestamp: new Date().toISOString() 
  });
});

// デバッグ: 現在のDB名とコレクション一覧を返す
app.get('/api/debug/db', async (req, res) => {
  try {
    await client.connect();
    const db = client.db(dbName);
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    res.json({
      mongodb_database: dbName,
      collections: cols.map(c => c.name)
    });
  } catch (e) {
    res.status(500).json({ error: 'debug_failed', message: e.message });
  }
});

// 管理: 古いコレクションの削除（要: X-Admin-Token）
app.delete('/api/admin/collections/:name', async (req, res) => {
  try {
    const token = req.header('X-Admin-Token') || '';
    const required = process.env.ADMIN_TOKEN || '';
    if (!required || token !== required) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const name = req.params.name;
    await client.connect();
    const db = client.db(dbName);
    const result = await db.collection(name).drop().then(() => ({ ok: true })).catch(err => ({ ok: false, message: err.message }));
    if (!result.ok) return res.status(400).json({ error: 'drop_failed', message: result.message });
    res.json({ ok: true, dropped: name });
  } catch (e) {
    res.status(500).json({ error: 'admin_failed', message: e.message });
  }
});

// 圃場一覧取得
app.get('/api/fields', async (req, res) => {
  try {
    await client.connect();
    const collection = client.db(dbName).collection('fields');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    
    const fields = await collection
      .find({ deleted: { $ne: true } })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    // フロントエンド用: geometry_json を優先。無ければ geometry から生成。crop は後方互換のために補完。
    const fieldsWithGeometryJson = fields.map(field => ({
      ...field,
      crop: field.current_crop || '',
      geometry_json: field.geometry_json || (field.geometry ? JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: field.geometry
      }) : null)
    }));
    
    res.json(fieldsWithGeometryJson);
  } catch (error) {
    console.error('圃場一覧取得エラー:', error);
    res.status(500).json({ error: '圃場一覧の取得に失敗しました' });
  }
});

// 圃場作成
app.post('/api/fields', async (req, res) => {
  try {
    const { name, crop, variety, year, memo, area_ha, geometry_json } = req.body;
    
    if (!geometry_json) {
      return res.status(400).json({ error: 'geometry_jsonは必須です' });
    }
    
    let geometry;
    try {
      const geoFeature = JSON.parse(geometry_json);
      geometry = geoFeature.geometry;
    } catch (parseError) {
      return res.status(400).json({ error: 'geometry_jsonの形式が正しくありません' });
    }
    
    await client.connect();
    const collection = client.db(dbName).collection('fields');
    
    // 現在の年度を取得
    const currentYear = year || new Date().getFullYear();
    
    // 作付け履歴の初期データ
    const cropHistory = [];
    if (crop) {
      cropHistory.push({
        year: currentYear,
        crop: crop,
        variety: variety || '',
        planting_date: null,
        harvest_date: null
      });
    }
    
    // 面積(ha)は小数点2桁に丸めて保存
    const areaHaRounded = Math.round((Number(area_ha) || 0) * 100) / 100;

    const newField = {
      name: name || '',
      memo: memo || '',
      area_ha: areaHaRounded,
      geometry: geometry,
      geometry_json: geometry_json,
      crop_history: cropHistory,
      current_crop: crop || '',
      current_year: currentYear,
      created_at: new Date(),
      updated_at: new Date(),
      deleted: false
    };
    
    const result = await collection.insertOne(newField);
    // 作物マスタを更新
    if (crop) {
      await upsertCropMaster(crop, variety);
    }
    
    const createdField = {
      ...newField,
      _id: result.insertedId,
      id: result.insertedId.toString(),
      crop: newField.current_crop, // 後方互換性のため
      geometry_json: geometry_json
    };
    
    res.status(201).json(createdField);
  } catch (error) {
    console.error('圃場作成エラー:', error);
    res.status(500).json({ error: '圃場の作成に失敗しました' });
  }
});

// 圃場更新
app.put('/api/fields/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, crop, variety, year, memo, area_ha, geometry_json } = req.body;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: '無効なIDです' });
    }
    
    let geometry;
    if (geometry_json) {
      try {
        const geoFeature = JSON.parse(geometry_json);
        geometry = geoFeature.geometry;
      } catch (parseError) {
        return res.status(400).json({ error: 'geometry_jsonの形式が正しくありません' });
      }
    }
    
    await client.connect();
    const collection = client.db(dbName).collection('fields');
    
    const updateData = {
      updated_at: new Date()
    };
    
    if (name !== undefined) updateData.name = name;
    if (memo !== undefined) updateData.memo = memo;
    if (area_ha !== undefined) {
      const areaHaRounded = Math.round((Number(area_ha) || 0) * 100) / 100;
      updateData.area_ha = areaHaRounded;
    }
    if (geometry) updateData.geometry = geometry;
    if (geometry_json) updateData.geometry_json = geometry_json;
    
    // 作付け情報が更新される場合
    if (crop !== undefined) {
      const currentYear = year || new Date().getFullYear();
      updateData.current_crop = crop;
      updateData.current_year = currentYear;
      
      // 既存の圃場データを取得
      const existingField = await collection.findOne({ _id: new ObjectId(id) });
      if (existingField && existingField.crop_history) {
        const cropHistory = [...existingField.crop_history];
        
        // 同じ年度のエントリがあるかチェック
        const existingYearIndex = cropHistory.findIndex(entry => entry.year === currentYear);
        
        if (existingYearIndex >= 0) {
          // 既存の年度データを更新
          cropHistory[existingYearIndex] = {
            ...cropHistory[existingYearIndex],
            crop: crop,
            variety: variety || cropHistory[existingYearIndex].variety || ''
          };
        } else {
          // 新しい年度エントリを追加
          cropHistory.push({
            year: currentYear,
            crop: crop,
            variety: variety || '',
            planting_date: null,
            harvest_date: null
          });
        }
        
        updateData.crop_history = cropHistory;
      } else {
        // crop_historyが存在しない場合は初期化
        updateData.crop_history = [{
          year: currentYear,
          crop: crop,
          variety: variety || '',
          planting_date: null,
          harvest_date: null
        }];
      }
    }
    
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: '圃場が見つかりません' });
    }
    
    const updatedField = await collection.findOne({ _id: new ObjectId(id) });
    // 作物マスタを更新
    if (crop !== undefined) {
      await upsertCropMaster(crop, variety);
    }
    
    const responseField = {
      ...updatedField,
      id: updatedField._id.toString(),
      crop: updatedField.current_crop || '', // 後方互換性のため
      geometry_json: updatedField.geometry_json || (updatedField.geometry ? JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: updatedField.geometry
      }) : null)
    };
    
    res.json(responseField);
  } catch (error) {
    console.error('圃場更新エラー:', error);
    res.status(500).json({ error: '圃場の更新に失敗しました' });
  }
});

// 圃場削除（論理削除）
app.delete('/api/fields/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: '無効なIDです' });
    }
    
    await client.connect();
    const collection = client.db(dbName).collection('fields');

    // ハード削除指定（クエリ ?hard=true または 環境変数 HARD_DELETE=true）
    const hard = (req.query.hard === 'true') || (process.env.HARD_DELETE === 'true');

    if (hard) {
      const del = await collection.deleteOne({ _id: new ObjectId(id) });
      if (del.deletedCount === 0) return res.status(404).json({ error: '圃場が見つかりません' });
      return res.status(204).send();
    } else {
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            deleted: true, 
            deleted_at: new Date() 
          } 
        }
      );
      if (result.matchedCount === 0) return res.status(404).json({ error: '圃場が見つかりません' });
      return res.status(204).send();
    }
  } catch (error) {
    console.error('圃場削除エラー:', error);
    res.status(500).json({ error: '圃場の削除に失敗しました' });
  }
});

// サーバー起動
async function startServer() {
  await connectToDatabase();
  
  app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
    console.log(`ヘルスチェック: http://localhost:${PORT}/api/health`);
    console.log(`API エンドポイント: http://localhost:${PORT}/api/fields`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('サーバーを終了しています...');
  await client.close();
  process.exit(0);
});

startServer().catch(console.error);

// ============== NDVI定期インジェスト（オプション） ==============
// 環境変数 CRON_ENABLED=true の場合、CRON_SCHEDULE（デフォルト: 毎日3時）で実行
const enableCron = (process.env.CRON_ENABLED || 'false').toLowerCase() === 'true';
const cronExpr = process.env.CRON_SCHEDULE || '0 3 * * *';

async function ingestAllFieldsOnce() {
  try {
    await client.connect();
    const fields = await client.db(dbName).collection('fields').find({ deleted: { $ne: true } }).toArray();
    let ok = 0, skip = 0, fail = 0;
    for (const field of fields) {
      try {
        const r = await ingestOneField(field);
        if (r.status === 'ingested') ok++; else if (r.status === 'skipped') skip++; else fail++;
        console.log(`[cron ingest] ${field.name || field._id}:`, r);
        await new Promise(res => setTimeout(res, 500));
      } catch (e) {
        fail++;
        console.error(`[cron ingest] ${field.name || field._id} failed:`, e.message);
      }
    }
    console.log(`[cron ingest] done. ingested=${ok}, skipped=${skip}, failed=${fail}`);
  } catch (e) {
    console.error('[cron ingest] error:', e);
  }
}

if (enableCron) {
  try {
    cron.schedule(cronExpr, () => {
      console.log(`[cron] start NDVI ingest at ${new Date().toISOString()}`);
      ingestAllFieldsOnce().catch(e => console.error('[cron] failed:', e));
    }, { timezone: process.env.CRON_TZ || 'Asia/Tokyo' });
    console.log(`[cron] scheduled: ${cronExpr} (TZ=${process.env.CRON_TZ || 'Asia/Tokyo'})`);
  } catch (e) {
    console.error('[cron] schedule failed:', e.message);
  }
}

// 管理API: 手動実行（要 X-Admin-Token）
app.post('/api/admin/ingest/s2', async (req, res) => {
  try {
    const token = req.header('X-Admin-Token') || '';
    const required = process.env.ADMIN_TOKEN || '';
    if (!required || token !== required) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    ingestAllFieldsOnce().then(() => {
      res.json({ ok: true, started: true });
    }).catch(e => {
      res.status(500).json({ ok: false, error: e.message });
    });
  } catch (e) {
    res.status(500).json({ error: 'admin_ingest_failed', message: e.message });
  }
});
