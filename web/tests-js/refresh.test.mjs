import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRefresh } from '../src/core/cloud-refresh.mjs';
import { deferred } from './helpers.mjs';

test('foreground monitor refreshes initially and retries a failed module without acknowledging the revision', async () => {
  let revision = 1, good = 0, failed = 0, succeeds = false;
  const monitor = createCloudRefresh({ getRevision: async () => ({ revision }), refresh: [() => { good++; }, () => { failed++; return succeeds; }] });
  await monitor.start(); await monitor.check(); assert.equal(good, 2); assert.equal(failed, 2);
  succeeds = true; await monitor.check(); await monitor.check(); assert.equal(good, 3);
  revision++; await monitor.check(); assert.equal(good, 4); monitor.stop();
});
test('same revision refreshes at the Shanghai day boundary and unavailable local revision falls back to full reads', async () => {
  let date = 'day-1', count = 0;
  const monitor = createCloudRefresh({ getRevision: async () => ({ revision: 1 }), day: () => date, refresh: [() => count++] });
  await monitor.start(); await monitor.check(); assert.equal(count, 1); date = 'day-2'; await monitor.check(); assert.equal(count, 2);
  monitor.stop();
  const local = createCloudRefresh({ getRevision: async () => { throw Object.assign(new Error(), { status: 404 }); }, refresh: [() => count++] });
  await local.start(); await local.check(); assert.equal(count, 4); local.stop();
});
test('coalesced checks and stopped revision reads cannot start background refreshes', async () => {
  const gate = deferred(); let count = 0, checks = 0;
  const monitor = createCloudRefresh({ getRevision: () => { checks++; return gate.promise; }, refresh: [() => count++] });
  const first = monitor.start(), second = monitor.check(); assert.equal(checks, 1);
  monitor.stop(); gate.resolve({ revision: 1 }); await Promise.all([first, second]); assert.equal(count, 0);
  await monitor.check(); assert.equal(checks, 1);
});
