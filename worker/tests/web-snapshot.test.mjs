import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseAppEdits as rebase } from '../../web/src/core/snapshot.mjs';
const baseline = { tasks: [{ id: 1, title: 'Original', status: 'todo' }], notes: [], updates: [] };

test('typing during a save preserves new local edits and remote additions', () => {
  const latest = { ...baseline, tasks: [{ ...baseline.tasks[0], title: 'Typed while saving' }] };
  const receipt = { ...baseline, tasks: [{ ...baseline.tasks[0], status: 'completed' }, { id: 2, title: 'Other client' }] };
  const merged = rebase(baseline, latest, receipt);
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.tasks[0].title, 'Typed while saving');
  assert.equal(merged.tasks[0].status, 'completed');
});

test('a server refresh with no local edits retains every remote field', () => {
  const receipt = { ...baseline, tasks: [{ ...baseline.tasks[0], title: 'Mac', status: 'completed' }] };
  assert.equal(rebase(baseline, baseline, receipt).tasks[0].title, 'Mac');
});

test('delete and add while saving do not resurrect local removals or drop remote inserts', () => {
  const latest = { ...baseline, tasks: [{ id: 3, title: 'Local new' }] };
  const receipt = { ...baseline, tasks: [...baseline.tasks, { id: 2, title: 'Remote new' }] };
  assert.deepEqual(Array.from(rebase(baseline, latest, receipt).tasks, item => item.id), [2, 3]);
});
