import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const email = process.env.AGRINOTE_EMAIL || 'aolarena16@gmail.com';
const password = process.env.AGRINOTE_PASSWORD || 'aolarena0428';
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

async function loginAndGetCookies() {
  const res = await fetch('https://agri-note.jp/pw-api/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status}`);
  }
  // collect cookies
  const rawSetCookie = res.headers.get('set-cookie');
  if (!rawSetCookie) throw new Error('set-cookie header not found');
  // Some environments combine cookies; pass as-is
  return rawSetCookie
    .split(/,(?=[^;]+;)/) // split cookies safely
    .map(c => c.split(';')[0])
    .join('; ');
}

async function fetchJson(url, cookieHeader) {
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Cache-Control': 'no-cache',
      'Cookie': cookieHeader
    }
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  const cookie = await loginAndGetCookies();
  const fields = await fetchJson('https://agri-note.jp/an-api/v1/agri_fields', cookie);

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection('fields');

  let inserted = 0; let updated = 0; let skipped = 0;
  for (const r of fields) {
    if (r.is_deleted) { skipped++; continue; }
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
    const res = await col.updateOne(
      { source: 'agri-note', external_id: r.id },
      { $set: doc },
      { upsert: true }
    );
    if (res.upsertedCount > 0) inserted++; else if (res.matchedCount > 0) updated++; else skipped++;
  }

  console.log(JSON.stringify({ inserted, updated, skipped }, null, 2));
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
