const { buildDashboard } = require('../../web/scripts/build.cjs');
const html = buildDashboard();
if (!html.includes('<div id="root"></div>') || !html.includes('/api/diary/entry')) throw new Error('Incomplete web build');
console.log('Web modules compiled; Worker and local server use the same dashboard.html.');
