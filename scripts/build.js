const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
const out = `export const DASHBOARD_HTML = ${JSON.stringify(html)};\n`;
fs.writeFileSync(path.join(__dirname, '../src/dashboard.js'), out);
console.log('Built src/dashboard.js');
