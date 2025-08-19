import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || 'Agri-AI-Project';

if (!mongoUri) {
  console.error('MONGODB_URI が未設定です。プロジェクトルートの .env に設定してください。');
  process.exit(1);
}

function toGeoJSONPolygon(regionLatLngs) {
  if (!Array.isArray(regionLatLngs) || regionLatLngs.length < 3) return null;
  const ring = regionLatLngs.map(p => [Number(p.lng), Number(p.lat)]);
  // close ring
  if (ring.length > 0) ring.push([...ring[0]]);
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring]
    }
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeToArray(value) {
  try {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return normalizeToArray(parsed);
    }
  } catch (_) {}

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.results)) return value.results;
  }

  if (Array.isArray(value)) return value;

  return null;
}

async function main() {
  const filePath = path.resolve(process.cwd(), 'data/agri_fields_raw.json');
  if (!fs.existsSync(filePath)) {
    console.error(`データファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let rows;
  try {
    const firstParsed = JSON.parse(raw);
    rows = normalizeToArray(firstParsed);
  } catch (e) {
    console.error('JSONのパースに失敗しました:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error('想定外のデータ形式です。配列ではありません。');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const fields = db.collection('fields');

  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    // スキップ条件: 削除済み、ポリゴン未使用
    if (r.is_deleted) continue;

    const feature = toGeoJSONPolygon(r.region_latlngs);

    const doc = {
      source: 'agri-note',
      external_id: r.id,
      name: r.field_name || '',
      memo: r.other || '',
      area_ha: feature ? round2((Number(r.calculation_area) || 0) / 100) : 0,
      geometry: feature ? feature.geometry : null,
      geometry_json: feature ? JSON.stringify(feature) : null,
      current_crop: '',
      current_year: new Date().getFullYear(),
      created_at: new Date(),
      updated_at: new Date(),
      deleted: false
    };

    const res = await fields.updateOne(
      { source: 'agri-note', external_id: r.id },
      { $set: doc },
      { upsert: true }
    );

    if (res.upsertedCount > 0) inserted += 1; else if (res.matchedCount > 0) updated += 1;
  }

  console.log(`完了: 追加 ${inserted}, 更新 ${updated}`);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
