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
  if (ring.length > 0) ring.push([...ring[0]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function importCompleteFields() {
  // 完全なJSONファイルから読み込み
  const filePath = path.resolve(process.cwd(), 'data/all_fields_complete.json');
  
  if (!fs.existsSync(filePath)) {
    console.error(`データファイルが見つかりません: ${filePath}`);
    process.exit(1);
  }
  
  const rawData = fs.readFileSync(filePath, 'utf8');
  let fieldsData;
  
  try {
    fieldsData = JSON.parse(rawData);
  } catch (e) {
    console.error('JSONのパースに失敗しました:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(fieldsData)) {
    console.error('想定外のデータ形式です。配列ではありません。');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const fields = db.collection('fields');

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const field of fieldsData) {
      if (field.is_deleted) {
        skipped++;
        continue;
      }

      if (!field.field_name || field.field_name.trim() === '') {
        skipped++;
        continue;
      }

      const geoJson = toGeoJSONPolygon(field.region_latlngs);
      const areaHa = round2(field.calculation_area / 100);

      const doc = {
        agrinote_id: field.id,
        name: field.field_name,
        area_ha: areaHa,
        geometry_json: geoJson,
        created_at: new Date(),
        updated_at: new Date(),
        source: 'agrinote'
      };

      const existingField = await fields.findOne({ agrinote_id: field.id });
      if (existingField) {
        await fields.updateOne(
          { agrinote_id: field.id },
          { $set: { ...doc, updated_at: new Date() } }
        );
        console.log(`更新: ${field.field_name} (面積: ${areaHa}ha)`);
        updated++;
      } else {
        await fields.insertOne(doc);
        console.log(`追加: ${field.field_name} (面積: ${areaHa}ha)`);
        imported++;
      }
    }

    console.log(`\n完了: ${imported}件追加, ${updated}件更新, ${skipped}件スキップ`);
    console.log(`総処理件数: ${fieldsData.length}件`);
  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.close();
  }
}

importCompleteFields();
