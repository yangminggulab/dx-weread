import test from 'node:test';
import assert from 'node:assert/strict';
import guards from '../scripts/deploy.cjs';

test('release verification refuses a missing or wrongly typed state binding', () => {
  for (const bindings of [[], [{ name: 'TASKS_STATE', type: 'kv_namespace' }]]) {
    assert.throws(() => guards.assertTaskState({ resources: { bindings } }), /TaskState binding/);
  }
  guards.assertTaskState({ resources: { bindings: [{ name: 'TASKS_STATE', type: 'durable_object_namespace' }] } });
});
test('release verification refuses drift or traffic shared with an unverified version', () => {
  guards.assertDeployment({ versions: [{ version_id: 'verified', percentage: 100 }] }, 'verified');
  for (const versions of [[{ version_id: 'other', percentage: 100 }], [{ version_id: 'verified', percentage: 50 }, { version_id: 'other', percentage: 50 }]]) {
    assert.throws(() => guards.assertDeployment({ versions }, 'verified'), /differs/);
  }
});
