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

// 画面から取得した60件のデータをここに貼り付け
const allFieldsFromBrowser = [
  // ここにPlaywrightから取得したJSONデータを貼り付けてください
];

async function processFieldsFromBrowser() {
  console.log('ブラウザから取得したデータを処理中...');
  console.log('取得データ数:', allFieldsFromBrowser.length);
  
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const fields = db.collection('fields');

    // 既存データを確認
    const existingCount = await fields.countDocuments({ source: 'agri-note' });
    console.log('既存のアグリノートデータ:', existingCount, '件');

    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const field of allFieldsFromBrowser) {
      if (!field.field_name || field.field_name.trim() === '' || field.is_deleted) {
        console.log(`スキップ: ${field.field_name || 'no name'} (削除済みまたは名前なし)`);
        skipped++;
        continue;
      }

      const geoJson = toGeoJSONPolygon(field.region_latlngs);
      const areaHa = round2((field.calculation_area || 0) / 100);

      const doc = {
        external_id: field.id,
        source: 'agri-note',
        area_ha: areaHa,
        created_at: new Date(),
        current_crop: '',
        current_year: new Date().getFullYear(),
        deleted: false,
        geometry: geoJson ? geoJson.geometry : null,
        geometry_json: JSON.stringify(geoJson),
        memo: field.other || '',
        name: field.field_name,
        updated_at: new Date()
      };

      const res = await fields.updateOne(
        { external_id: field.id },
        { $set: doc },
        { upsert: true }
      );

      if (res.upsertedCount > 0) {
        console.log(`追加: ${field.field_name} (ID: ${field.id}, 面積: ${areaHa}ha)`);
        imported++;
      } else if (res.matchedCount > 0) {
        console.log(`更新: ${field.field_name} (ID: ${field.id}, 面積: ${areaHa}ha)`);
        updated++;
      }
    }

    console.log('=== 処理完了 ===');
    console.log(`新規追加: ${imported}件`);
    console.log(`更新: ${updated}件`);
    console.log(`スキップ: ${skipped}件`);
    console.log(`処理対象: ${allFieldsFromBrowser.length}件`);

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.close();
  }
}

// 関数を実行
if (allFieldsFromBrowser.length > 0) {
  processFieldsFromBrowser().catch(console.error);
} else {
  console.log('データが設定されていません。allFieldsFromBrowser配列にPlaywrightから取得したJSONデータを追加してください。');
}
