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

async function insertField(fieldData) {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const fields = db.collection('fields');

  if (fieldData.is_deleted) {
    console.log('削除済みフィールドのためスキップ');
    await client.close();
    return;
  }

  const feature = toGeoJSONPolygon(fieldData.region_latlngs);

  const doc = {
    source: 'agri-note',
    external_id: fieldData.id,
    name: fieldData.field_name || '',
    memo: fieldData.other || '',
    area_ha: feature ? round2((Number(fieldData.calculation_area) || 0) / 100) : 0,
    geometry: feature ? feature.geometry : null,
    geometry_json: feature ? JSON.stringify(feature) : null,
    current_crop: '',
    current_year: new Date().getFullYear(),
    created_at: new Date(),
    updated_at: new Date(),
    deleted: false
  };

  const res = await fields.updateOne(
    { source: 'agri-note', external_id: fieldData.id },
    { $set: doc },
    { upsert: true }
  );

  if (res.upsertedCount > 0) {
    console.log(`追加: ${fieldData.field_name} (ID: ${fieldData.id}, 面積: ${doc.area_ha}ha)`);
  } else if (res.matchedCount > 0) {
    console.log(`更新: ${fieldData.field_name} (ID: ${fieldData.id}, 面積: ${doc.area_ha}ha)`);
  }

  await client.close();
}

// ここにアグリノートからコピペしたJSONデータを貼り付けて実行してください
// 例: const fieldData = { "id": 522102, "field_name": "橋向こう②", ... };

// 橋向こう②のサンプル（次に追加予定）
const fieldData = {
  "id": 522102,
  "field_name": "橋向こう②",
  "address": "",
  "area": 0.0,
  "water_area": 0.0,
  "other": "",
  "show": false,
  "region_color": "red",
  "region_color_48": "red",
  "position": 2,
  "field_block_id": 26405,
  "show_pin": false,
  "use_region": true,
  "existence_period_start": null,
  "existence_period_end": null,
  "owner": "",
  "land_memo": "",
  "land_type": "text",
  "is_deleted": false,
  "center_latlng": {"lat": 42.717516005473094, "lng": 142.43038712779511},
  "region_latlngs": [
    {"lat": 42.71861226096087, "lng": 142.43027243569392},
    {"lat": 42.71805260420811, "lng": 142.42960724785823},
    {"lat": 42.717414122425524, "lng": 142.42893133118648},
    {"lat": 42.71709219238337, "lng": 142.42975637221124},
    {"lat": 42.71684120541723, "lng": 142.43047412487547},
    {"lat": 42.716972922689116, "lng": 142.43093305245498},
    {"lat": 42.71729382275703, "lng": 142.43128469167382},
    {"lat": 42.71784891294344, "lng": 142.4318377664068}
  ],
  "calculation_area": 255.205030399561,
  "rent": "0.0",
  "project_ids": [149402, 231778, 605872],
  "land_ids": [],
  "images": [],
  "files": []
};

insertField(fieldData).catch(console.error);
