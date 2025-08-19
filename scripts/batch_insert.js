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

async function processAllFields() {
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const fields = db.collection('fields');

    // all_fields.json を読み込み
    const filePath = path.resolve(process.cwd(), 'data/all_fields.json');
    if (!fs.existsSync(filePath)) {
      console.error(`データファイルが見つかりません: ${filePath}`);
      process.exit(1);
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    const allFields = JSON.parse(rawData);

    console.log(`総件数: ${allFields.length}件`);

    let processed = 0;
    let skipped = 0;
    let deleted = 0;

    for (const fieldData of allFields) {
      if (fieldData.is_deleted) {
        console.log(`削除済み: ${fieldData.field_name || 'No Name'} (ID: ${fieldData.id})`);
        deleted++;
        continue;
      }

      if (!fieldData.field_name || fieldData.field_name.trim() === '') {
        console.log(`名前なし: (ID: ${fieldData.id})`);
        skipped++;
        continue;
      }

      const geoJson = toGeoJSONPolygon(fieldData.region_latlngs);
      const areaHa = round2(fieldData.calculation_area / 100);

      const doc = {
        external_id: fieldData.id,
        source: 'agri-note',
        area_ha: areaHa,
        created_at: new Date(),
        current_crop: '',
        current_year: new Date().getFullYear(),
        deleted: false,
        geometry: geoJson ? geoJson.geometry : null,
        geometry_json: JSON.stringify(geoJson),
        memo: fieldData.other || '',
        name: fieldData.field_name,
        updated_at: new Date()
      };

      const res = await fields.updateOne(
        { external_id: fieldData.id },
        { $set: doc },
        { upsert: true }
      );

      if (res.upsertedCount > 0) {
        console.log(`追加: ${fieldData.field_name} (ID: ${fieldData.id}, 面積: ${doc.area_ha}ha)`);
      } else if (res.matchedCount > 0) {
        console.log(`更新: ${fieldData.field_name} (ID: ${fieldData.id}, 面積: ${doc.area_ha}ha)`);
      }

      processed++;
    }

    console.log('\n=== 処理完了 ===');
    console.log(`追加/更新: ${processed}件`);
    console.log(`削除済み: ${deleted}件`);
    console.log(`名前なし: ${skipped}件`);
    console.log(`総件数: ${allFields.length}件`);

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.close();
  }
}

processAllFields().catch(console.error);