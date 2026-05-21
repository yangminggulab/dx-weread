const fs = require('fs');
const path = require('path');

const workerDir = path.join(__dirname, '..');
const dashboardPath = path.join(__dirname, '../../web/dashboard.html');
const staleFiles = [
  path.join(workerDir, 'public/tasks/index.html'),
  path.join(workerDir, 'src/dashboard.js'),
];

if (!fs.existsSync(dashboardPath)) {
  throw new Error('Missing dashboard.html: web dashboard source of truth was not found.');
}

const missingContent = ['<div id="root"></div>', '/api/data']
  .filter((snippet) => !fs.readFileSync(dashboardPath, 'utf8').includes(snippet));

if (missingContent.length > 0) {
  throw new Error(`dashboard.html looks incomplete, missing: ${missingContent.join(', ')}`);
}

const remainingStaleFiles = staleFiles.filter((file) => fs.existsSync(file));
if (remainingStaleFiles.length > 0) {
  throw new Error(
    `Found stale dashboard duplicates. Keep dashboard.html as the only web source and remove: ${remainingStaleFiles.join(', ')}`
  );
}

console.log('dashboard.html verified as the single web UI source of truth.');
