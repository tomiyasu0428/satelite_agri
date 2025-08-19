// 外部API（例：Node/Express + MongoDB）向けのCRUD
function getApiBase() {
  const cfg = window.APP_CONFIG || {};
  return cfg.externalApiBase || '';
}

async function listFields(page = 1, limit = 100) {
  const res = await fetch(`${getApiBase()}/fields?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error('一覧取得に失敗しました');
  return await res.json();
}

async function createField(data) {
  const res = await fetch(`${getApiBase()}/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('作成に失敗しました');
  return await res.json();
}

async function updateField(id, data) {
  const res = await fetch(`${getApiBase()}/fields/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('更新に失敗しました');
  return await res.json();
}

async function deleteField(id) {
  const res = await fetch(`${getApiBase()}/fields/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('削除に失敗しました');
}
