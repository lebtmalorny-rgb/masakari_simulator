import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario, listScenarios } from '../src/scenarios.mjs';

test('scenario catalog contains required v1 presets', () => {
  const ids = listScenarios().map((scenario) => scenario.id);
  assert.deepEqual(ids, [
    'healthy-baseline',
    'storage-isolated',
    'tenant-only-down',
    'manage-only-down',
    'tenant-storage-down',
    'unstable-interface',
    'no-valid-destination',
    'reserved-host-recovery',
    'watcher-conflict',
    'custom-matrix-policy',
    'redfish-fencing-success',
    'redfish-fencing-failed'
  ]);
});

test('storage isolated scenario starts with storage down on compute-1', () => {
  const scenario = getScenario('storage-isolated');
  const compute1 = scenario.hosts.find((host) => host.name === 'compute-1');
  assert.equal(compute1.interfaces.storage, 'down');
  assert.equal(compute1.interfaces.manage, 'up');
  assert.equal(compute1.interfaces.tenant, 'up');
});

test('scenario getter returns cloned values', () => {
  const first = getScenario('healthy-baseline');
  const second = getScenario('healthy-baseline');
  first.hosts[0].interfaces.manage = 'down';
  assert.equal(second.hosts[0].interfaces.manage, 'up');
});
