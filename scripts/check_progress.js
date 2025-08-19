import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/all_fields.json', 'utf8'));
const validFields = data.filter(f => !f.is_deleted && f.field_name && f.field_name.trim() !== '');

console.log('投入済みの8件:');
validFields.forEach((field, index) => {
  console.log(`${index + 1}. ${field.field_name} (ID: ${field.id})`);
});

console.log('\n画面に表示されている圃場から、次に処理すべきもの:');
console.log('- 豊糠グループの「橋向こう③」以降');
console.log('- 鵡川グループの全て');
console.log('- その他グループの全て');
