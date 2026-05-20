const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const dashboardPath = path.join(rootDir, 'dashboard.html');
const staleFiles = [
  path.join(rootDir, 'public/tasks/index.html'),
  path.join(rootDir, 'src/dashboard.js'),
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
