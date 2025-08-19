// モックAPI（ローカル動作確認用）
let mockFields = [];
let nextId = 1;

async function listFields(page = 1, limit = 100) {
  console.log('Mock API: listFields called');
  return mockFields;
}

async function createField(data) {
  console.log('Mock API: createField called', data);
  
  // 新しいデータ構造に対応
  const currentYear = data.year || new Date().getFullYear();
  const cropHistory = [];
  
  if (data.crop) {
    cropHistory.push({
      year: currentYear,
      crop: data.crop,
      variety: data.variety || '',
      planting_date: null,
      harvest_date: null
    });
  }
  
  const newField = {
    id: nextId++,
    _id: `mock_${nextId}`,
    name: data.name || '',
    area_ha: data.area_ha || 0,
    geometry_json: data.geometry_json || null,
    crop_history: cropHistory,
    current_crop: data.crop || '',
    current_year: currentYear,
    crop: data.crop || '', // 後方互換性
    memo: data.memo || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  mockFields.push(newField);
  return newField;
}

async function updateField(id, data) {
  console.log('Mock API: updateField called', id, data);
  
  const index = mockFields.findIndex(f => f.id == id || f._id == id);
  if (index >= 0) {
    const existing = mockFields[index];
    const currentYear = data.year || new Date().getFullYear();
    
    // 作付け履歴の更新
    let cropHistory = [...(existing.crop_history || [])];
    if (data.crop) {
      const existingYearIndex = cropHistory.findIndex(entry => entry.year === currentYear);
      
      if (existingYearIndex >= 0) {
        cropHistory[existingYearIndex] = {
          ...cropHistory[existingYearIndex],
          crop: data.crop,
          variety: data.variety || cropHistory[existingYearIndex].variety || ''
        };
      } else {
        cropHistory.push({
          year: currentYear,
          crop: data.crop,
          variety: data.variety || '',
          planting_date: null,
          harvest_date: null
        });
      }
    }
    
    mockFields[index] = {
      ...existing,
      ...data,
      crop_history: cropHistory,
      current_crop: data.crop || existing.current_crop,
      current_year: currentYear,
      crop: data.crop || existing.crop, // 後方互換性
      updated_at: new Date().toISOString()
    };
    
    return mockFields[index];
  }
  throw new Error('圃場が見つかりません');
}

async function deleteField(id) {
  console.log('Mock API: deleteField called', id);
  
  const index = mockFields.findIndex(f => f.id == id || f._id == id);
  if (index >= 0) {
    mockFields.splice(index, 1);
    return;
  }
  throw new Error('圃場が見つかりません');
}
