import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/scenarios.mjs';
import {
  createHostNotification,
  isDuplicateNotification,
  startHostFailureTaskflow,
  selectEvacuationVms,
  advanceTaskflow
} from '../src/masakari.mjs';

test('createHostNotification creates COMPUTE_HOST STOPPED event for recovery action', () => {
  const state = getScenario('storage-isolated');
  const notification = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);

  assert.equal(notification.type, 'COMPUTE_HOST');
  assert.equal(notification.payload.event, 'STOPPED');
  assert.equal(notification.payload.cluster_status, 'OFFLINE');
  assert.equal(notification.payload.host_status, 'NORMAL');
  assert.equal(notification.status, 'new');
});

test('duplicate detection uses configured interval', () => {
  const state = getScenario('storage-isolated');
  const first = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);
  state.notifications.push(first);
  state.clock = first.generatedTick + 60;

  assert.equal(isDuplicateNotification(state, 'compute-1', 'STOPPED'), true);
  state.clock = first.generatedTick + 181;
  assert.equal(isDuplicateNotification(state, 'compute-1', 'STOPPED'), false);
});

test('duplicate detection ignores future notifications and includes exact boundary', () => {
  const state = getScenario('storage-isolated');
  state.notifications.push({
    hostname: 'compute-1',
    generatedTick: 200,
    payload: { event: 'STOPPED' }
  });

  state.clock = 100;
  assert.equal(isDuplicateNotification(state, 'compute-1', 'STOPPED'), false);

  state.clock = 380;
  assert.equal(isDuplicateNotification(state, 'compute-1', 'STOPPED'), true);

  state.clock = 381;
  assert.equal(isDuplicateNotification(state, 'compute-1', 'STOPPED'), false);
});

test('createHostNotification uses monotonic ids within same tick', () => {
  const state = getScenario('storage-isolated');
  const first = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);
  const second = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);

  assert.notEqual(first.uuid, second.uuid);
  assert.equal(first.uuid, 'notification-0001');
  assert.equal(second.uuid, 'notification-0002');
});

test('createHostNotification stores health vector snapshot', () => {
  const state = getScenario('storage-isolated');
  const vector = ['up', 'up', 'down'];
  const notification = createHostNotification(state, 'compute-1', vector, ['recovery']);

  vector[2] = 'up';

  assert.deepEqual(notification.payload.health_vector, ['up', 'up', 'down']);
});

test('taskflow start puts host into maintenance and disables nova compute', () => {
  const state = getScenario('storage-isolated');
  const notification = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);
  state.notifications.push(notification);

  startHostFailureTaskflow(state, notification.uuid);

  const host = state.hosts.find((candidate) => candidate.name === 'compute-1');
  assert.equal(notification.status, 'running');
  assert.equal(host.masakariOnMaintenance, true);
  assert.equal(host.novaServiceStatus, 'disabled');
  assert.equal(host.novaServiceDisabledReason, 'Masakari detected host failed.');
});

test('selectEvacuationVms follows evacuate_all_instances and HA metadata flag', () => {
  const state = getScenario('storage-isolated');
  assert.deepEqual(selectEvacuationVms(state, 'compute-1').map((vm) => vm.uuid), ['vm-001', 'vm-002']);

  state.masakariConfig.hostFailure.evacuateAllInstances = false;
  assert.deepEqual(selectEvacuationVms(state, 'compute-1').map((vm) => vm.uuid), ['vm-001']);
});

test('selectEvacuationVms can ignore instances in error state', () => {
  const state = getScenario('storage-isolated');
  state.hosts[0].vms[0].vmState = 'error';
  state.masakariConfig.hostFailure.ignoreInstancesInErrorState = true;

  assert.deepEqual(selectEvacuationVms(state, 'compute-1').map((vm) => vm.uuid), ['vm-002']);
});

test('advanceTaskflow moves through disable, prepare, evacuate steps', () => {
  const state = getScenario('storage-isolated');
  const notification = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);
  state.notifications.push(notification);
  startHostFailureTaskflow(state, notification.uuid);

  assert.equal(state.taskflow.currentStep, 'disable_compute_service_task');
  advanceTaskflow(state);
  assert.equal(state.taskflow.currentStep, 'prepare_HA_enabled_instances_task');
  advanceTaskflow(state);
  assert.equal(state.taskflow.currentStep, 'evacuate_instances_task');
});

test('advanceTaskflow is idempotent after finished state', () => {
  const state = getScenario('storage-isolated');
  const notification = createHostNotification(state, 'compute-1', ['up', 'up', 'down'], ['recovery']);
  state.notifications.push(notification);
  startHostFailureTaskflow(state, notification.uuid);

  advanceTaskflow(state);
  advanceTaskflow(state);
  advanceTaskflow(state);
  assert.equal(state.taskflow.currentStep, 'finished');
  assert.equal(advanceTaskflow(state), null);
  assert.equal(state.taskflow.currentStep, 'finished');
});
