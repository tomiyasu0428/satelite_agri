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

// アグリノートから取得した全60件のデータ
const agriNoteFields = [
  {
    "id": 522100,
    "field_name": "橋向こう①",
    "calculation_area": 122.956416859627,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 42.71728011865095, "lng": 142.42766532853145},
      {"lat": 42.718974850957565, "lng": 142.42932829812068},
      {"lat": 42.718675320242895, "lng": 142.43013296082515},
      {"lat": 42.717449590043145, "lng": 142.42856655076045}
    ]
  },
  {
    "id": 522102,
    "field_name": "橋向こう②",
    "calculation_area": 255.205030399561,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 42.71861226096087, "lng": 142.43027243569392},
      {"lat": 42.71805260420811, "lng": 142.42960724785823},
      {"lat": 42.717414122425524, "lng": 142.42893133118648},
      {"lat": 42.71709219238337, "lng": 142.42975637221124},
      {"lat": 42.71684120541723, "lng": 142.43047412487547},
      {"lat": 42.716972922689116, "lng": 142.43093305245498},
      {"lat": 42.71729382275703, "lng": 142.43128469167382},
      {"lat": 42.71784891294344, "lng": 142.4318377664068}
    ]
  },
  {
    "id": 522104,
    "field_name": "橋向こう③",
    "calculation_area": 324.621734304428,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 42.71910067301977, "lng": 142.42953466057676},
      {"lat": 42.719542083173955, "lng": 142.4302642214288},
      {"lat": 42.71943961323945, "lng": 142.4308221209039},
      {"lat": 42.71982488596143, "lng": 142.4315817392292},
      {"lat": 42.72001405991829, "lng": 142.43286919955634},
      {"lat": 42.71987124558968, "lng": 142.43320652229855},
      {"lat": 42.71802761702812, "lng": 142.4318436203361}
    ]
  },
  {
    "id": 531504,
    "field_name": "倉庫",
    "calculation_area": 0,
    "is_deleted": false,
    "region_latlngs": []
  },
  {
    "id": 531505,
    "field_name": "家",
    "calculation_area": 0,
    "is_deleted": false,
    "region_latlngs": []
  },
  {
    "id": 531948,
    "field_name": "フォレスト①",
    "calculation_area": 81.2659007966518,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 42.717284348552425, "lng": 142.421946283872},
      {"lat": 42.71795830538318, "lng": 142.42266511588798},
      {"lat": 42.71813763184836, "lng": 142.4234268632482},
      {"lat": 42.71798983500819, "lng": 142.42333835035072},
      {"lat": 42.71791692187789, "lng": 142.42340004115806},
      {"lat": 42.717599650889134, "lng": 142.42322301536308},
      {"lat": 42.71683898125647, "lng": 142.42256319194541}
    ]
  },
  {
    "id": 539199,
    "field_name": "小山",
    "calculation_area": 4.28013605922461,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 34.90606871308737, "lng": 134.1346897266473},
      {"lat": 34.906220488956734, "lng": 134.1346622340049},
      {"lat": 34.90630077618742, "lng": 134.13463239442962},
      {"lat": 34.90636346621732, "lng": 134.13456500392812},
      {"lat": 34.90649104599124, "lng": 134.13427398425}
    ]
  },
  {
    "id": 539968,
    "field_name": "坊",
    "calculation_area": 20.67,
    "is_deleted": false,
    "region_latlngs": [
      {"lat": 34.89991040691153, "lng": 134.132182182764},
      {"lat": 34.89996100278249, "lng": 134.13247722575565},
      {"lat": 34.89997860133901, "lng": 134.13262742946048},
      {"lat": 34.899932405120126, "lng": 134.13274544665714},
      {"lat": 34.8997784175362, "lng": 134.1331906933536},
      {"lat": 34.899747619984744, "lng": 134.13317460009952},
      {"lat": 34.89973882068224, "lng": 134.13312900254627},
      {"lat": 34.899747619984744, "lng": 134.1330270786037},
      {"lat": 34.899701423635946, "lng": 134.13298684546848},
      {"lat": 34.8996728258832, "lng": 134.1329546589603},
      {"lat": 34.899598031713516, "lng": 134.13294124791523},
      {"lat": 34.89956503426407, "lng": 134.13292247245212},
      {"lat": 34.899560634603155, "lng": 134.13285005280872},
      {"lat": 34.89960023154302, "lng": 134.13270521352192},
      {"lat": 34.89965082760507, "lng": 134.1325925607433},
      {"lat": 34.89972562172666, "lng": 134.13249331900974},
      {"lat": 34.89978501701,  "lng": 134.13240212390323},
      {"lat": 34.89986861029896, "lng": 134.13226264903446}
    ]
  }
];

function toGeoJSONPolygon(regionLatLngs) {
  if (!Array.isArray(regionLatLngs) || regionLatLngs.length < 3) return null;
  const ring = regionLatLngs.map(p => [Number(p.lng), Number(p.lat)]);
  if (ring.length > 0) ring.push([...ring[0]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function importAllFields() {
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const fields = db.collection('fields');

    let imported = 0;
    let skipped = 0;

    for (const field of agriNoteFields) {
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
        source: 'agrinote'
      };

      const existingField = await fields.findOne({ agrinote_id: field.id });
      if (existingField) {
        await fields.updateOne(
          { agrinote_id: field.id },
          { $set: { ...doc, updated_at: new Date() } }
        );
        console.log(`更新: ${field.field_name} (面積: ${areaHa}ha)`);
      } else {
        await fields.insertOne(doc);
        console.log(`追加: ${field.field_name} (面積: ${areaHa}ha)`);
        imported++;
      }
    }

    console.log(`\n完了: ${imported}件追加, ${skipped}件スキップ`);
  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.close();
  }
}

importAllFields();