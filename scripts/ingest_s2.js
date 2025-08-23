import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

// Node18+ fetch

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;
const TITILER_URL = process.env.TITILER_URL || 'http://localhost:8000';

if (!MONGODB_URI || !MONGODB_DATABASE) {
  console.error('Missing MONGODB_URI or MONGODB_DATABASE in .env');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

async function searchLatestSceneByFieldGeometry(fieldGeometry, days = 10, cloud = 70) {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stacBody = {
    collections: ['sentinel-2-l2a'],
    datetime: `${from.toISOString()}/${to.toISOString()}`,
    intersects: fieldGeometry,
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

function extractItemUrl(item) {
  const selfLink = (item.links || []).find(l => l.rel === 'self')?.href || null;
  return selfLink || `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(item.id)}`;
}

async function fetchNdviStatsForGeometry(itemUrl, geometry) {
  const params = new URLSearchParams({
    url: itemUrl,
    assets: 'nir,red',
    asset_as_band: 'true',
    expression: '(nir-red)/(nir+red)',
    categorical: 'false',
    histogram: 'true'
  });
  const statsUrl = `${TITILER_URL}/stac/statistics?${params}`;
  const body = { type: 'Feature', properties: {}, geometry };
  let resp = await fetch(statsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const fallback = `${statsUrl}&geojson=${encodeURIComponent(JSON.stringify(body))}`;
    resp = await fetch(fallback);
  }
  if (!resp.ok) throw new Error(await resp.text());
  const statsData = await resp.json();

  // レスポンス互換抽出
  let ndvi = null;
  if (statsData && typeof statsData === 'object') {
    if (statsData.properties?.statistics) {
      const s = statsData.properties.statistics;
      const firstKey = Object.keys(s)[0];
      ndvi = s['(nir-red)/(nir+red)'] || s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
    }
    if (!ndvi && statsData.statistics && typeof statsData.statistics === 'object') {
      const s = statsData.statistics; const firstKey = Object.keys(s)[0];
      ndvi = s.expression || s.ndvi || s.b1 || (firstKey ? s[firstKey] : null);
    }
    if (!ndvi) ndvi = statsData.expression || statsData.stats || null;
    if (!ndvi && statsData.mean !== undefined) ndvi = statsData;
  }
  return ndvi;
}

async function ingestOneField(field) {
  // サーバから呼ばれる場合に備え、毎回connect()は安全（再利用）
  await client.connect();
  const days = 10;
  const cloud = 70;
  const attempts = [ [days, cloud], [Math.max(20, days*3), Math.max(cloud, 80)], [60, 90] ];

  let item = null;
  for (const [d, c] of attempts) {
    item = await searchLatestSceneByFieldGeometry(field.geometry, d, c);
    if (item) break;
  }
  if (!item) return { status: 'skipped', reason: 'no_scene_found' };

  const itemUrl = extractItemUrl(item);
  const datetime = item.properties?.datetime;
  const cloudCover = item.properties?.['eo:cloud_cover'];

  const col = client.db(MONGODB_DATABASE).collection('s2_ndvi_timeseries');
  const exists = await col.findOne({ field_id: field._id, stac_item_id: item.id });
  if (exists) return { status: 'skipped', reason: 'already_ingested', stac_item_id: item.id };

  let ndviStats = await fetchNdviStatsForGeometry(itemUrl, field.geometry);
  // 予防: nullだったら表層バッファを当てて再試行
  if (!ndviStats) {
    try {
      const buffered = JSON.parse(JSON.stringify(field.geometry));
      // 非厳密: bbox縮小などはせず、そのまま2回目（TiTiler側の一過性対策）
      ndviStats = await fetchNdviStatsForGeometry(itemUrl, buffered);
    } catch {}
  }
  if (!ndviStats) return { status: 'failed', reason: 'stats_null' };

  const doc = {
    field_id: field._id,
    stac_item_id: item.id,
    stac_item_url: itemUrl,
    datetime: datetime ? new Date(datetime) : new Date(),
    cloud_cover: typeof cloudCover === 'number' ? cloudCover : null,
    ndvi: {
      min: ndviStats.min ?? null,
      max: ndviStats.max ?? null,
      mean: ndviStats.mean ?? null,
      median: ndviStats.median ?? null,
      std: ndviStats.stdev ?? ndviStats.std ?? null,
      histogram: ndviStats.histogram || null,
      valid_pixels: ndviStats.valid_percent ?? ndviStats.count ?? null
    },
    created_at: new Date()
  };
  await col.insertOne(doc);
  return { status: 'ingested', stac_item_id: item.id };
}

async function main() {
  await client.connect();
  const fields = await client.db(MONGODB_DATABASE).collection('fields').find({ deleted: { $ne: true } }).toArray();
  let ok = 0, skip = 0, fail = 0;
  for (const field of fields) {
    try {
      const r = await ingestOneField(field);
      if (r.status === 'ingested') ok++; else if (r.status === 'skipped') skip++; else fail++;
      console.log(`[ingest] ${field.name || field._id}:`, r);
      await new Promise(res => setTimeout(res, 500));
    } catch (e) {
      fail++;
      console.error(`[ingest] ${field.name || field._id} failed:`, e.message);
    }
  }
  console.log(`Done. ingested=${ok}, skipped=${skip}, failed=${fail}`);
  await client.close();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { ingestOneField };
