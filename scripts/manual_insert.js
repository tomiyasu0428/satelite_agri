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
    console.log(`追加: ${fieldData.field_name} (ID: ${fieldData.id})`);
  } else if (res.matchedCount > 0) {
    console.log(`更新: ${fieldData.field_name} (ID: ${fieldData.id})`);
  }

  await client.close();
}

// 使用例:
// const fieldData = { コピペしたJSON };
// insertField(fieldData);

// 橋向こう①のサンプル
const sample1 = {
  "id": 522100,
  "field_name": "橋向こう①",
  "address": "",
  "area": 0.0,
  "water_area": 0.0,
  "other": "",
  "show": false,
  "region_color": "red",
  "region_color_48": "red",
  "position": 1,
  "field_block_id": 26405,
  "show_pin": false,
  "use_region": true,
  "existence_period_start": null,
  "existence_period_end": null,
  "owner": "",
  "land_memo": "",
  "land_type": "text",
  "is_deleted": false,
  "center_latlng": {"lat": 42.718094969973635, "lng": 142.42892328455943},
  "region_latlngs": [
    {"lat": 42.71728011865095, "lng": 142.42766532853145},
    {"lat": 42.718974850957565, "lng": 142.42932829812068},
    {"lat": 42.718675320242895, "lng": 142.43013296082515},
    {"lat": 42.717449590043145, "lng": 142.42856655076045}
  ],
  "calculation_area": 122.956416859627,
  "rent": "0.0",
  "project_ids": [150311, 231778, 605872],
  "land_ids": [],
  "images": [],
  "files": []
};

insertField(sample1).catch(console.error);
