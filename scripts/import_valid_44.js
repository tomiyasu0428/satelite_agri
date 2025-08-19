import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || 'Agri-AI-Project';

if (!mongoUri) {
  console.error('MONGODB_URI が未設定です (.env)');
  process.exit(1);
}

function toPolygon(regionLatLngs) {
  if (!Array.isArray(regionLatLngs) || regionLatLngs.length < 3) return null;
  const ring = regionLatLngs.map(p => [Number(p.lng), Number(p.lat)]);
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

function toPoint(center) {
  if (!center || typeof center.lng !== 'number' || typeof center.lat !== 'number') return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Point',
      coordinates: [Number(center.lng), Number(center.lat)]
    }
  };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function main() {
  const jsonPath = path.resolve(process.cwd(), 'data/all_fields.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`データファイルが見つかりません: ${jsonPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  let all;
  try {
    all = JSON.parse(raw);
  } catch (e) {
    console.error('JSONのパースに失敗しました:', e.message);
    process.exit(1);
  }
  if (!Array.isArray(all)) {
    console.error('想定外のデータ形式です。配列ではありません。');
    process.exit(1);
  }

  // 有効圃場のみ（削除されていない & 名前あり）
  const valid = all.filter(f => !f.is_deleted && f.field_name && String(f.field_name).trim() !== '');

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const fields = db.collection('fields');

  try {
    // 既存のagri-note由来を削除
    const del = await fields.deleteMany({ source: 'agri-note' });
    console.log(`既存データ削除: ${del.deletedCount}件`);

    let inserted = 0;
    let skipped = 0;

    for (const f of valid) {
      const poly = toPolygon(f.region_latlngs);
      const point = !poly ? toPoint(f.center_latlng) : null;
      const feature = poly || point; // Polygon優先, なければPoint
      if (!feature) {
        skipped++;
        continue;
      }

      const areaHa = round2((Number(f.calculation_area) || 0) / 100);

      const doc = {
        external_id: f.id,
        source: 'agri-note',
        name: f.field_name,
        area_ha: areaHa,
        geometry: feature.geometry,
        geometry_json: JSON.stringify(feature),
        current_crop: '',
        current_year: new Date().getFullYear(),
        deleted: false,
        memo: '',
        created_at: new Date(),
        updated_at: new Date()
      };

      await fields.insertOne(doc);
      inserted++;
    }

    console.log(`MongoDB投入 完了: 挿入=${inserted} 件, スキップ=${skipped} 件, 対象=${valid.length} 件`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
