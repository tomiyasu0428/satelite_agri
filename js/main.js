let map, drawingManager, currentPolygon = null;
let selectedRecord = null; // 現在編集中のレコード（nullなら新規）

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=drawing,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Mapsの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 43.06417, lng: 141.34694 }, // 札幌周辺
    zoom: 10,
    mapTypeId: 'hybrid'
  });

  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: google.maps.drawing.OverlayType.POLYGON,
    drawingControl: true,
    drawingControlOptions: {
      position: google.maps.ControlPosition.TOP_LEFT,
      drawingModes: ['polygon']
    },
    polygonOptions: {
      strokeColor: '#22c55e',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#22c55e',
      fillOpacity: 0.25,
      editable: true,
      draggable: false
    }
  });
  drawingManager.setMap(map);

  google.maps.event.addListener(drawingManager, 'overlaycomplete', (e) => {
    if (e.type === 'polygon') {
      if (currentPolygon) currentPolygon.setMap(null);
      currentPolygon = e.overlay;
      setupPolygonListeners(currentPolygon);
      updateAreaAndForm();
    }
  });
}

function setupPolygonListeners(poly) {
  const path = poly.getPath();
  const paths = poly.getPaths ? poly.getPaths() : null;
  const update = () => updateAreaAndForm();
  if (paths) {
    for (let i = 0; i < paths.getLength(); i++) {
      const p = paths.getAt(i);
      p.addListener('set_at', update);
      p.addListener('insert_at', update);
      p.addListener('remove_at', update);
    }
  } else if (path) {
    path.addListener('set_at', update);
    path.addListener('insert_at', update);
    path.addListener('remove_at', update);
  }
}

function computeAreaHa(poly) {
  if (!poly) return 0;
  const paths = poly.getPaths().getAt(0); // 外輪のみ想定
  const areaM2 = google.maps.geometry.spherical.computeArea(paths);
  const areaHa = areaM2 / 10000.0;
  return Math.round(areaHa * 100) / 100; // 小数点2桁へ丸め
}

function polygonToGeoJSON(poly) {
  if (!poly) return null;
  const path = poly.getPaths().getAt(0); // 外輪のみ
  const coords = [];
  for (let i = 0; i < path.getLength(); i++) {
    const latLng = path.getAt(i);
    coords.push([latLng.lng(), latLng.lat()]); // [lng, lat]
  }
  // GeoJSON Polygonは最後に始点を重ねて閉じる必要がある
  if (coords.length > 0) coords.push([...coords[0]]);
  const gj = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [coords]
    }
  };
  return gj;
}

function geoJSONToPolygon(geojson) {
  const feature = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
  if (!feature || !feature.geometry || feature.geometry.type !== 'Polygon') return null;
  const ring = feature.geometry.coordinates[0];
  const path = ring.map(([lng, lat]) => ({ lat, lng }));
  const poly = new google.maps.Polygon({
    paths: path,
    strokeColor: '#3b82f6',
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: '#3b82f6',
    fillOpacity: 0.25,
    editable: true
  });
  poly.setMap(map);
  setupPolygonListeners(poly);
  return poly;
}

function fitToPolygon(poly) {
  const bounds = new google.maps.LatLngBounds();
  poly.getPath().forEach((latLng) => bounds.extend(latLng));
  map.fitBounds(bounds);
}

async function loadLatestNdviTile(fieldId, fieldGeoJson) {
  if (!fieldId) return;
  try {
    const base = (window.APP_CONFIG && window.APP_CONFIG.externalApiBase) || '/api';
    const res = await fetch(`${base}/s2/ndvi/latest?field_id=${encodeURIComponent(fieldId)}`);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`NDVI取得に失敗: ${t}`);
    }
    const data = await res.json();
    const meta = document.getElementById('ndvi-meta');
    const el = document.getElementById('ndvi-map');
    const links = document.getElementById('ndvi-links');
    meta.textContent = `取得日: ${data.datetime || '-'} / 雲量: ${data.cloud_cover ?? '-'}%`;
    // プレビュー画像モード（静的IMGで表示し、この先の地図処理はスキップ）
    const ts = Date.now();
    el.innerHTML = `<img src="/api/s2/preview.png?field_id=${encodeURIComponent(fieldId)}&size=1024&_=${ts}" alt="NDVI preview" class="w-full h-full object-contain"/>`;
    links.innerHTML = `
      <a href="/api/s2/preview.png?field_id=${encodeURIComponent(fieldId)}&size=1024&item_url=${encodeURIComponent(data.stac_item_url)}&_=${ts}" target="_blank">プレビュー画像</a>
      <a href="${data.stac_item_url}" target="_blank">STACアイテム</a>
    `;
    if (window.__NDVI_MAP__) { try { window.__NDVI_MAP__.remove(); } catch {} window.__NDVI_MAP__ = null; }

    // Google MapsにNDVIのグラウンドオーバーレイを重ねる（半透明）
    try {
      // 圃場BBox
      let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
      if (fieldGeoJson && fieldGeoJson.geometry && fieldGeoJson.geometry.type === 'Polygon') {
        const ring = fieldGeoJson.geometry.coordinates[0] || [];
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
      }
      const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
      const titilerBase = window.APP_CONFIG?.titilerBase || 'http://localhost:8000';
      const params = new URLSearchParams({
        url: data.stac_item_url,
        assets: 'nir,red',
        asset_as_band: 'true',
        expression: '(nir-red)/(nir+red)',
        rescale: '-1,1',
        colormap_name: 'viridis',
        resampling: 'bilinear'
      }).toString();
      const imgUrl = `${titilerBase}/stac/bbox/${bbox}/2048x2048.png?${params}`;
      const sw = new google.maps.LatLng(minLat, minLng);
      const ne = new google.maps.LatLng(maxLat, maxLng);
      const gBounds = new google.maps.LatLngBounds(sw, ne);
      if (window.__NDVI_GROUND__) { try { window.__NDVI_GROUND__.setMap(null); } catch {} }
      const overlay = new google.maps.GroundOverlay(imgUrl, gBounds, { opacity: 0.65 });
      overlay.setMap(map);
      window.__NDVI_GROUND__ = overlay;
    } catch (e) { /* 失敗しても致命ではない */ }
    return;
    // Leafletでタイルを埋め込み
    try {
      if (window.__NDVI_MAP__) {
        window.__NDVI_MAP__.remove();
        window.__NDVI_MAP__ = null;
      }
      el.innerHTML = ''; // コンテナをクリア
      const llMap = L.map('ndvi-map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(llMap);
      // NDVIを画像オーバーレイで描画（複数タイルを同一BBoxに重ねて境界の欠けを補完）
      let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
      if (fieldGeoJson && fieldGeoJson.geometry && fieldGeoJson.geometry.type === 'Polygon') {
        const ring = fieldGeoJson.geometry.coordinates[0] || [];
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
      } else {
        const vb = llMap.getBounds();
        minLng = vb.getWest(); minLat = vb.getSouth(); maxLng = vb.getEast(); maxLat = vb.getNorth();
      }
      const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
      const imgBounds = L.latLngBounds([ [minLat, minLng], [maxLat, maxLng] ]);
      const titilerBase = window.APP_CONFIG?.titilerBase || 'http://localhost:8000';
      const baseParams = {
        assets: 'nir,red', asset_as_band: 'true', expression: '(nir-red)/(nir+red)', rescale: '-1,1', colormap_name: 'viridis'
      };
      function addOverlayForItem(itemUrl) {
        const common = new URLSearchParams({ ...baseParams, url: itemUrl }).toString();
        const imgUrl = `${titilerBase}/stac/bbox/${bbox}/1024x1024.png?${common}`;
        L.imageOverlay(imgUrl, imgBounds, { opacity: 0.75, crossOrigin: true }).addTo(llMap);
      }
      // 1) まず代表アイテム
      addOverlayForItem(data.stac_item_url);
      // 2) 同日・近傍の追加タイルを探索して重ねる
      (async () => {
        try {
          const dt = (data.datetime || '').slice(0,10);
          if (!dt || !fieldGeoJson) return;
          const from = `${dt}T00:00:00Z`; const to = `${dt}T23:59:59Z`;
          const stacBody = { collections: ['sentinel-2-l2a'], datetime: `${from}/${to}`, intersects: fieldGeoJson.geometry, query: { 'eo:cloud_cover': { lte: 60 } }, limit: 6 };
          const r = await fetch('https://earth-search.aws.element84.com/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacBody) });
          if (!r.ok) return;
          const j = await r.json();
          const items = Array.isArray(j.features) ? j.features : [];
          items.forEach((it) => {
            const self = (it.links || []).find(l => l.rel === 'self')?.href;
            if (self && self !== data.stac_item_url) addOverlayForItem(self);
          });
        } catch (e) { console.warn('stac mosaic fetch failed', e); }
      })();
      // 圃場ポリゴンがあれば縁取りしてズーム
      if (fieldGeoJson && fieldGeoJson.geometry && fieldGeoJson.geometry.type === 'Polygon') {
        const ring = fieldGeoJson.geometry.coordinates[0] || [];
        const latlngs = ring.map(([lng, lat]) => [lat, lng]);
        const layer = L.polygon(latlngs, { color: '#22c55e', weight: 2, fillOpacity: 0 }).addTo(llMap);
        llMap.fitBounds(layer.getBounds(), { padding: [12, 12] });
      } else {
        llMap.setView([43.06, 141.35], 10);
      }
      window.__NDVI_MAP__ = llMap;
    } catch (_) {
      el.textContent = '地図表示に失敗しました';
    }

    // 共有リンク（プレビュー/タイルテンプレ/STAC）
    links.innerHTML = `
      <a href="${data.tile_template.replace('{z}','15').replace('{x}','29020').replace('{y}','12975')}" target="_blank">タイル例</a>
      <a href="${data.stac_item_url}" target="_blank">STACアイテム</a>
    `;
  } catch (e) {
    const el = document.getElementById('ndvi-map');
    el.textContent = 'NDVIの取得に失敗しました: ' + (e?.message || 'unknown');
  }
}

function getRecordId(rec) {
  return rec?.id || rec?._id || '';
}

function normalizeRecord(rec) {
  if (!rec) return rec;
  if (!rec.id && rec._id) {
    return { ...rec, id: rec._id };
  }
  return rec;
}

function setFormState(record) {
  const rid = getRecordId(record);
  document.getElementById('field-id').value = rid;
  document.getElementById('field-name').value = record?.name || '';
  document.getElementById('field-crop').value = record?.crop || '';
  document.getElementById('field-variety').value = record?.variety || '';
  document.getElementById('field-year').value = record?.current_year || record?.year || new Date().getFullYear();
  document.getElementById('field-memo').value = record?.memo || '';
  document.getElementById('field-area').value = record?.area_ha ? Number(record.area_ha).toFixed(2) : '';
  const updating = !!rid;
  document.getElementById('btn-save-update').disabled = !updating;
  document.getElementById('btn-delete').disabled = !updating;
}

function updateAreaAndForm() {
  const areaHa = computeAreaHa(currentPolygon);
  document.getElementById('field-area').value = areaHa ? areaHa.toFixed(2) : '';
}

async function refreshList() {
  const container = document.getElementById('field-list');
  container.innerHTML = '<div class="p-4 text-sm text-gray-500">読み込み中…</div>';
  try {
    const resp = await listFields(1, 200);
    const list = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
    if (!list || list.length === 0) {
      container.innerHTML = '<div class="p-4 text-sm text-gray-500">登録はまだありません</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach((rec) => {
      const item = document.createElement('button');
      item.className = 'w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between';
      const name = rec.name || '(無題)';
      const crop = rec.crop || '-';
      const area = typeof rec.area_ha === 'number' ? Number(rec.area_ha).toFixed(2) : '-';
      item.innerHTML = `<div><div class='font-medium'>${name}</div><div class='text-xs text-gray-500'>${crop}</div></div><div class='text-sm text-gray-700'>${area} ha</div>`;
      item.addEventListener('click', () => loadRecord(rec));
      container.appendChild(item);
    });
  } catch (e) {
    container.innerHTML = `<div class='p-4 text-sm text-red-600'>一覧取得エラー: ${e.message}</div>`;
  }
}

function clearPolygon() {
  if (currentPolygon) {
    currentPolygon.setMap(null);
    currentPolygon = null;
  }
}

function clearFormAndMap() {
  selectedRecord = null;
  setFormState(null);
  clearPolygon();
}

async function loadRecord(rec) {
  clearPolygon();
  selectedRecord = normalizeRecord(rec);
  setFormState(selectedRecord);
  const gj = selectedRecord.geometry_json || selectedRecord.geometryJson || null;
  if (gj) {
    currentPolygon = geoJSONToPolygon(gj);
    if (currentPolygon) {
      fitToPolygon(currentPolygon);
      updateAreaAndForm();
    }
  }
  // NDVI表示更新
  const fid = getRecordId(selectedRecord);
  let feature = null;
  try { feature = gj ? (typeof gj === 'string' ? JSON.parse(gj) : gj) : null; } catch (_) {}
  if (fid) await loadLatestNdviTile(fid, feature);
}

async function onSaveNew() {
  try {
    if (!currentPolygon) return alert('先にポリゴンを作成してください');
    const name = document.getElementById('field-name').value.trim();
    const crop = document.getElementById('field-crop').value.trim();
    const variety = document.getElementById('field-variety').value.trim();
    const year = parseInt(document.getElementById('field-year').value) || new Date().getFullYear();
    const memo = document.getElementById('field-memo').value.trim();
    const area_ha = computeAreaHa(currentPolygon);
    const gj = polygonToGeoJSON(currentPolygon);
    const payload = { name, crop, variety, year, memo, area_ha, geometry_json: JSON.stringify(gj) };
    const created = await createField(payload);
    const normalized = normalizeRecord(created);
    await refreshList();
    await loadRecord(normalized);
    alert('新規保存しました');
  } catch (e) {
    alert('保存エラー: ' + e.message);
  }
}

async function onSaveUpdate() {
  try {
    const rid = getRecordId(selectedRecord);
    if (!rid) return alert('更新対象がありません');
    if (!currentPolygon) return alert('ポリゴンがありません');
    const id = rid;
    const name = document.getElementById('field-name').value.trim();
    const crop = document.getElementById('field-crop').value.trim();
    const variety = document.getElementById('field-variety').value.trim();
    const year = parseInt(document.getElementById('field-year').value) || new Date().getFullYear();
    const memo = document.getElementById('field-memo').value.trim();
    const area_ha = computeAreaHa(currentPolygon);
    const gj = polygonToGeoJSON(currentPolygon);
    const payload = { id, name, crop, variety, year, memo, area_ha, geometry_json: JSON.stringify(gj) };
    const updated = await updateField(id, payload);
    const normalized = normalizeRecord(updated);
    await refreshList();
    await loadRecord(normalized);
    alert('更新保存しました');
  } catch (e) {
    alert('更新エラー: ' + e.message);
  }
}

async function onDelete() {
  try {
    const rid = getRecordId(selectedRecord);
    if (!rid) return alert('削除対象がありません');
    if (!confirm('本当に削除しますか？')) return;
    await deleteField(rid + '?hard=true');
    clearFormAndMap();
    await refreshList();
    alert('削除しました');
  } catch (e) {
    alert('削除エラー: ' + e.message);
  }
}

function bindUI() {
  document.getElementById('btn-save-new').addEventListener('click', onSaveNew);
  document.getElementById('btn-save-update').addEventListener('click', onSaveUpdate);
  document.getElementById('btn-delete').addEventListener('click', onDelete);
  document.getElementById('btn-clear').addEventListener('click', clearFormAndMap);
  document.getElementById('btn-reload').addEventListener('click', refreshList);
  const ndviBtn = document.getElementById('btn-load-ndvi');
  if (ndviBtn) ndviBtn.addEventListener('click', () => {
    const fid = getRecordId(selectedRecord);
    if (fid) loadLatestNdviTile(fid);
  });
}

async function populateCropDatalist() {
  try {
    const res = await fetch(`${(window.APP_CONFIG && window.APP_CONFIG.externalApiBase) || '/api'}/crops?limit=500`);
    if (!res.ok) return;
    const crops = await res.json();
    const dl = document.getElementById('crops-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    crops.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      dl.appendChild(opt);
    });
  } catch (e) {
    console.warn('crops datalist load failed', e);
  }
}

(async function bootstrap() {
  // 設定の読み込み完了を待機
  if (window.APP_CONFIG_READY && typeof window.APP_CONFIG_READY.then === 'function') {
    try { await window.APP_CONFIG_READY; } catch (e) { console.error(e); }
  }
  // 年度フィールドにデフォルト値設定
  const yearEl = document.getElementById('field-year');
  if (yearEl) yearEl.value = new Date().getFullYear();

  // APIスクリプトの読み込み完了を待機
  if (window.API_READY && typeof window.API_READY.then === 'function') {
    try { await window.API_READY; } catch (e) { console.error(e); }
  }

  bindUI();
  populateCropDatalist();
  await refreshList();

  const apiKey = window.APP_CONFIG.googleMapsApiKey || '';
  if (!apiKey) {
    console.warn('Google Maps APIキーが設定されていません。');
    return;
  }

  try {
    await loadGoogleMaps(apiKey);
    initMap();
  } catch (e) {
    console.error(e);
    const mapEl = document.getElementById('map');
    mapEl.innerHTML = '<div class="p-4 text-red-600">Google Mapsの読み込みに失敗しました。APIキー設定をご確認ください。</div>';
  }
})();
