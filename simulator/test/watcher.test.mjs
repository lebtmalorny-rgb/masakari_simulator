import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/scenarios.mjs';
import { explainWatcherContext } from '../src/watcher.mjs';

test('disabled watcher produces no conflict warnings', () => {
  const state = getScenario('storage-isolated');
  assert.deepEqual(explainWatcherContext(state), []);
});

test('watcher conflict scenario reports audit, migration and placement warnings', () => {
  const state = getScenario('watcher-conflict');
  assert.deepEqual(explainWatcherContext(state), [
    'Watcher audit is running while Masakari recovery is active',
    'Watcher action plan is pending and can compete for Nova resources',
    'Watcher migration action touches VM placement during evacuation',
    'Watcher context marks Placement pressure'
  ]);
});
