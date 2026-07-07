import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MATRIX,
  DEFAULT_MONITOR_CONFIG,
  DEFAULT_MASAKARI_CONFIG,
  DEFAULT_WATCHER_CONFIG,
  STANDARD_LAYERS,
  createLogEntry,
  deepClone,
  usedResources,
  hasCapacityFor
} from '../src/domain.mjs';

test('standard consul layers match upstream consul driver', () => {
  assert.deepEqual(STANDARD_LAYERS, ['manage', 'tenant', 'storage']);
});

test('default matrix follows upstream sample recovery rows', () => {
  assert.equal(DEFAULT_MATRIX.length, 8);
  assert.deepEqual(DEFAULT_MATRIX.find((rule) => rule.health.join(',') === 'up,up,down').action, ['recovery']);
  assert.deepEqual(DEFAULT_MATRIX.find((rule) => rule.health.join(',') === 'up,down,up').action, []);
  assert.deepEqual(DEFAULT_MATRIX.find((rule) => rule.health.join(',') === 'down,down,down').action, ['recovery']);
});

test('default configs expose parameters used by v1 model', () => {
  assert.equal(DEFAULT_MONITOR_CONFIG.monitoringDriver, 'consul');
  assert.equal(DEFAULT_MONITOR_CONFIG.monitoringSamples, 1);
  assert.equal(DEFAULT_MASAKARI_CONFIG.hostFailure.evacuateAllInstances, true);
  assert.equal(DEFAULT_WATCHER_CONFIG.enabled, false);
});

test('deepClone isolates nested values', () => {
  const source = { nested: { value: 1 } };
  const cloned = deepClone(source);
  cloned.nested.value = 2;
  assert.equal(source.nested.value, 1);
});

test('createLogEntry stores detail snapshot', () => {
  const detail = { host: { name: 'compute-1', state: 'up' } };
  const entry = createLogEntry(7, 'consul', 'sample recorded', detail);

  detail.host.state = 'down';

  assert.deepEqual(entry, {
    tick: 7,
    stage: 'consul',
    message: 'sample recorded',
    detail: { host: { name: 'compute-1', state: 'up' } }
  });
});

test('resource helpers calculate host capacity', () => {
  const host = {
    capacity: { vcpus: 4, ramMb: 8192, diskGb: 100 },
    vms: [
      { resources: { vcpus: 1, ramMb: 1024, diskGb: 10 } },
      { resources: { vcpus: 2, ramMb: 2048, diskGb: 20 } }
    ]
  };

  assert.deepEqual(usedResources(host), { vcpus: 3, ramMb: 3072, diskGb: 30 });
  assert.equal(hasCapacityFor(host, { vcpus: 1, ramMb: 1024, diskGb: 10 }), true);
  assert.equal(hasCapacityFor(host, { vcpus: 2, ramMb: 1024, diskGb: 10 }), false);
});
