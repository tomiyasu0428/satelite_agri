import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || 'Agri-AI-Project';

if (!mongoUri) {
  console.error('MONGODB_URI が未設定です (.env)。');
  process.exit(1);
}

function toGeoJSONPolygon(regionLatLngs) {
  if (!Array.isArray(regionLatLngs) || regionLatLngs.length < 3) return null;
  const ring = regionLatLngs.map(p => [Number(p.lng), Number(p.lat)]);
  if (ring.length > 0) ring.push([...ring[0]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function loadJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.error(`ファイルが見つかりません: ${targetPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(targetPath, 'utf8');
  let data = raw;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    // そのまま文字列として次段で扱う
  }
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('JSONのパースに失敗しました:', e.message);
      process.exit(1);
    }
  }
  if (Array.isArray(data)) {
    if (data.length === 1) return data[0];
    console.error('配列が与えられました。単一オブジェクトを貼り付けてください。');
    process.exit(1);
  }
  if (!data || typeof data !== 'object') {
    console.error('オブジェクト形式のJSONを貼り付けてください。');
    process.exit(1);
  }
  return data;
}

async function main() {
  const inputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(process.cwd(), 'data/field.json');
  const field = loadJsonFile(inputPath);

  if (field.is_deleted) {
    console.log(`削除フラグのためスキップ: ${field.field_name || '(名称未設定)'} (ID: ${field.id})`);
    process.exit(0);
  }

  const polygon = toGeoJSONPolygon(field.region_latlngs);
  if (!polygon) {
    console.error('region_latlngs から有効なポリゴンを生成できませんでした。3点以上の座標が必要です。');
    process.exit(1);
  }

  const areaHa = round2((Number(field.calculation_area) || 0) / 100);

  const doc = {
    external_id: field.id,
    source: 'agri-note',
    name: field.field_name || '',
    area_ha: areaHa,
    geometry: polygon.geometry,
    geometry_json: JSON.stringify(polygon),
    current_crop: '',
    current_year: new Date().getFullYear(),
    deleted: false,
    memo: field.other || '',
    created_at: new Date(),
    updated_at: new Date()
  };

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const fields = db.collection('fields');

  try {
    const res = await fields.updateOne(
      { source: 'agri-note', external_id: field.id },
      { $set: doc },
      { upsert: true }
    );
    if (res.upsertedCount > 0) {
      console.log(`追加: ${doc.name} (ID: ${doc.external_id}, 面積: ${doc.area_ha}ha)`);
    } else if (res.matchedCount > 0) {
      console.log(`更新: ${doc.name} (ID: ${doc.external_id}, 面積: ${doc.area_ha}ha)`);
    } else {
      console.log(`変更なし: ${doc.name} (ID: ${doc.external_id})`);
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
