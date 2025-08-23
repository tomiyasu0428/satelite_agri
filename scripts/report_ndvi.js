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
  // 各圃場で最新日時の1件を取得
  const pipeline = [
    { $sort: { 'item.datetime': -1 } },
    { $group: {
        _id: '$field_id',
        doc: { $first: '$$ROOT' }
    }},
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { 'item.datetime': -1 } }
  ];
  return await coll.aggregate(pipeline).toArray();
}

function toCsv(rows) {
  const header = [
    'field_id','datetime','cloud_cover','mean','median','min','max','std','count','stac_item_id'
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const f = [
      r.field_id,
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
  const th = '| 圃場ID | 取得日時 | 雲量% | 平均 | 中央 | 最小 | 最大 | 標準偏差 | ピクセル数 | STAC |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---|';
  const lines = [th];
  for (const r of rows) {
    lines.push(
      `| ${r.field_id} | ${r.item?.datetime ?? ''} | ${formatNumber(r.item?.cloud_cover ?? null, 1)} | ${formatNumber(r.ndvi?.mean)} | ${formatNumber(r.ndvi?.median)} | ${formatNumber(r.ndvi?.min)} | ${formatNumber(r.ndvi?.max)} | ${formatNumber(r.ndvi?.std)} | ${r.ndvi?.count ?? ''} | ${r.item?.id ?? ''} |`
    );
  }
  return lines.join('\n');
}

function toHtml(rows) {
  // シンプルなインライン棒グラフ（mean のみ）
  const bars = rows.map(r => ({ id: r.field_id, mean: Number(r.ndvi?.mean ?? 0) }));
  const max = Math.max(0.0001, ...bars.map(b => Math.abs(b.mean)));
  const items = bars.map(b => {
    const w = Math.round((Math.abs(b.mean) / max) * 300);
    const color = b.mean >= 0.4 ? '#2e7d32' : b.mean >= 0.2 ? '#f9a825' : '#e53935';
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
      <code style="min-width: 220px;">${b.id}</code>
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


