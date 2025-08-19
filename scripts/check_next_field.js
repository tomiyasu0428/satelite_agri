import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/all_fields.json', 'utf8'));
console.log('Total records:', data.length);

const validFields = data.filter(f => !f.is_deleted && f.field_name && f.field_name.trim() !== '');
console.log('Valid fields:', validFields.length);

// 次に処理する圃場（9番目）を表示
if (validFields[8]) {
  console.log('Next field to process (index 8):', validFields[8].field_name, '(ID:', validFields[8].id + ')');
  
  // 9番目の圃場データをfield.jsonに保存
  fs.writeFileSync('data/field.json', JSON.stringify(validFields[8], null, 2));
  console.log('Saved to data/field.json');
} else {
  console.log('No more fields to process');
}
