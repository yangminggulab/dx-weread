import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { buildDashboard } = require('../scripts/build.cjs');

test('checked-in web page exactly matches the module build and does not ship browser Babel or example records', () => {
  const html = buildDashboard({ write: false }); assert.equal(readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8'), html);
  assert.equal(html.includes('text/babel'), false); assert.equal(html.includes('@babel/standalone'), false);
  assert.equal(html.includes('出版个人学习方法论电子书'), false);
  assert.ok(html.includes('/api/diary/entry')); assert.ok(html.includes('_readingWriteVersion'));
});
test('generated script parses and reaches the React mount with existing CDN globals', () => {
  const html = buildDashboard({ write: false }), script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  let mounted;
  const React = { createElement: (type, props) => ({ type, props }), Fragment: Symbol('fragment'), useState() {}, useEffect() {}, useMemo() {}, useRef() {}, useCallback() {}, useSyncExternalStore() {} };
  vm.runInNewContext(script, { React, ReactDOM: { createRoot: () => ({ render: element => { mounted = element; } }) }, document: { getElementById: () => ({}) }, location: { pathname: '/tasks' }, fetch() {}, setTimeout, clearTimeout, TextEncoder });
  assert.equal(typeof mounted.type, 'function');
});
