/*
  NDVI レポート生成スクリプト
  - MongoDB から最新NDVI（各圃場1件）を取得
  - reports/ に CSV / Markdown / HTML(簡易グラフ) を出力
*/
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';
const TITILER_URL = process.env.TITILER_URL || 'http://localhost:8000';

async function fetchNdviStatsViaTitiler(stacItemUrl, geometry) {
  if (!stacItemUrl || !geometry) return null;
  const params = new URLSearchParams({
    url: stacItemUrl,
    assets: 'nir,red',
    asset_as_band: 'true',
    expression: '(nir-red)/(nir+red)',
    categorical: 'false',
    histogram: 'true'
  });
  const statsUrl = `${TITILER_URL}/stac/statistics?${params.toString()}`;
  const body = { type: 'Feature', properties: {}, geometry };
  let resp = await fetch(statsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const fallback = `${statsUrl}&geojson=${encodeURIComponent(JSON.stringify(body))}`;
    resp = await fetch(fallback);
  }
  if (!resp.ok) return null;
  const statsData = await resp.json();
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env を読み込む（ローカル実行時）
dotenv.config();

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return Number(value).toFixed(digits);
}

async function fetchLatestNdviByField(db) {
  const coll = db.collection('s2_ndvi_timeseries');
  // 各圃場で最新日時の1件を取得（item.datetime または datetime のどちらでも対応）
  const pipeline = [
    { $addFields: { dt: { $ifNull: ['$item.datetime', '$datetime'] } } },
    { $sort: { dt: -1 } },
    { $group: { _id: '$field_id', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { dt: -1 } },
    { $lookup: { from: 'fields', localField: 'field_id', foreignField: '_id', as: 'field' } },
    { $addFields: { field: { $first: '$field' } } }
  ];
  return await coll.aggregate(pipeline).toArray();
}

function normalizeDoc(r) {
  const fieldId = (r.field_id && r.field_id.toString) ? r.field_id.toString() : (r.field_id ?? '');
  const fieldName = r.field?.name || '';
  const datetime = r.item?.datetime || r.datetime || r.dt || null;
  const cloud = r.item?.cloud_cover ?? r.cloud_cover ?? null;
  const stacId = r.item?.id || r.stac_item_id || null;
  const ndvi = r.ndvi || r.ndvi_statistics || r.statistics || r.stats || null;
  const mean = ndvi?.mean ?? ndvi?.avg ?? null;
  const median = ndvi?.median ?? ndvi?.p50 ?? null;
  const min = ndvi?.min ?? ndvi?.p0 ?? null;
  const max = ndvi?.max ?? ndvi?.p100 ?? null;
  const std = ndvi?.std ?? ndvi?.stdev ?? ndvi?.stddev ?? null;
  const count = ndvi?.count ?? ndvi?.n ?? ndvi?.valid_pixels ?? null;
  return { field_id: fieldId, field_name: fieldName, item: { datetime, cloud_cover: cloud, id: stacId }, ndvi: { mean, median, min, max, std, count } };
}

function toCsv(rows) {
  const header = [
    'field_id','field_name','datetime','cloud_cover','mean','median','min','max','std','count','stac_item_id'
  ];
  const lines = [header.join(',')];
  for (const raw of rows) {
    const r = normalizeDoc(raw);
    const f = [
      r.field_id,
      r.field_name,
      r.item?.datetime ?? '',
      r.item?.cloud_cover ?? '',
      formatNumber(r.ndvi?.mean),
      formatNumber(r.ndvi?.median),
      formatNumber(r.ndvi?.min),
      formatNumber(r.ndvi?.max),
      formatNumber(r.ndvi?.std),
      r.ndvi?.count ?? '',
      r.item?.id ?? ''
    ].map(v => typeof v === 'string' && v.includes(',') ? `"${v.replaceAll('"','""')}"` : v);
    lines.push(f.join(','));
  }
  return lines.join('\n');
}

function toMarkdown(rows) {
  const th = '| 圃場ID | 名称 | 取得日時 | 雲量% | 平均 | 中央 | 最小 | 最大 | 標準偏差 | ピクセル数 | STAC |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|';
  const lines = [th];
  for (const raw of rows) {
    const r = normalizeDoc(raw);
    lines.push(
      `| ${r.field_id} | ${r.field_name || '-'} | ${r.item?.datetime ?? ''} | ${formatNumber(r.item?.cloud_cover ?? null, 1)} | ${formatNumber(r.ndvi?.mean)} | ${formatNumber(r.ndvi?.median)} | ${formatNumber(r.ndvi?.min)} | ${formatNumber(r.ndvi?.max)} | ${formatNumber(r.ndvi?.std)} | ${r.ndvi?.count ?? ''} | ${r.item?.id ?? ''} |`
    );
  }
  return lines.join('\n');
}

function toHtml(rows) {
  // シンプルなインライン棒グラフ（mean のみ）
  const bars = rows.map(raw => {
    const r = normalizeDoc(raw);
    return { id: r.field_id, name: r.field_name || '', mean: Number(r.ndvi?.mean ?? 0) };
  });
  const max = Math.max(0.0001, ...bars.map(b => Math.abs(b.mean)));
  const items = bars.map(b => {
    const w = Math.round((Math.abs(b.mean) / max) * 300);
    const color = b.mean >= 0.4 ? '#2e7d32' : b.mean >= 0.2 ? '#f9a825' : '#e53935';
    const label = b.name ? `${b.name} (${b.id})` : b.id;
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
      <code style="min-width: 320px;">${label}</code>
      <div style="background:#eee;width:320px;height:10px;position:relative;">
        <div style="background:${color};height:10px;width:${w}px;"></div>
      </div>
      <span style="font-family:monospace;">${formatNumber(b.mean)}</span>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>NDVI Latest</title></head>
<body style="font-family: -apple-system,Segoe UI,Roboto,Helvetica,Arial,system-ui; padding:16px;">
  <h2>NDVI 最新（圃場ごと1件）</h2>
  ${items}
  <p style="color:#888">色: 緑(>=0.4) / 黄(>=0.2) / 赤(&lt;0.2)</p>
</body></html>`;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || '';
  const dbName = process.env.MONGODB_DATABASE || 'Agri-AI-Project';
  if (!mongoUri) throw new Error('MONGODB_URI is required');

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    const rows = await fetchLatestNdviByField(db);

    // 値が欠損している場合は TiTiler でオンデマンド計算
    for (const r of rows) {
      const hasMean = !!(r?.ndvi?.mean ?? r?.ndvi_statistics?.mean);
      if (hasMean) continue;
      const stacUrl = r.stac_item_url || (r.item?.id ? `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${encodeURIComponent(r.item.id)}` : null);
      const geom = r.field?.geometry || null;
      try {
        const ndvi = await fetchNdviStatsViaTitiler(stacUrl, geom);
        if (ndvi) {
          r.ndvi = r.ndvi || {};
          r.ndvi.mean = ndvi.mean ?? r.ndvi.mean;
          r.ndvi.median = ndvi.median ?? r.ndvi.median;
          r.ndvi.min = ndvi.min ?? r.ndvi.min;
          r.ndvi.max = ndvi.max ?? r.ndvi.max;
          r.ndvi.std = ndvi.stdev ?? ndvi.std ?? r.ndvi.std;
          r.ndvi.count = ndvi.count ?? ndvi.n ?? r.ndvi.count;
        }
      } catch {}
    }

    const reportsDir = path.join(__dirname, '..', 'reports');
    ensureDir(reportsDir);

    fs.writeFileSync(path.join(reportsDir, 'ndvi_latest.csv'), toCsv(rows));
    fs.writeFileSync(path.join(reportsDir, 'ndvi_latest.md'), toMarkdown(rows));
    fs.writeFileSync(path.join(reportsDir, 'ndvi_latest.html'), toHtml(rows));

    console.log(`Generated reports in ${reportsDir}`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('report failed:', e);
  process.exit(1);
});


