import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimulation,
  resetSimulation,
  stepSimulation,
  toggleInterface
} from '../src/simulation.mjs';

test('storage isolation reaches finished notification and succeeded vmoves', () => {
  const state = createSimulation('storage-isolated');

  for (let i = 0; i < 8; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.notifications[0].status, 'finished');
  assert.equal(state.vmoves.length, 2);
  assert.equal(state.vmoves.every((vmove) => vmove.status === 'succeeded'), true);
  assert.equal(state.hosts.find((host) => host.name === 'compute-2').vms.length, 2);
  assert.equal(state.warnings.some((warning) => warning.includes('without fencing')), true);
});

test('tenant-only-down does not create Masakari recovery notification by default matrix', () => {
  const state = createSimulation('tenant-only-down');

  for (let i = 0; i < 4; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.notifications.length, 0);
  assert.equal(state.vmoves.length, 0);
  assert.equal(state.currentExplanation.includes('matrix action is empty'), true);
});

test('unstable samples suppress recovery until stable sample window is present', () => {
  const state = createSimulation('unstable-interface');
  stepSimulation(state);

  assert.equal(state.notifications.length, 0);
  assert.equal(state.currentExplanation.includes('unstable'), true);
});

test('toggleInterface changes host layer and reset restores preset', () => {
  const state = createSimulation('healthy-baseline');
  toggleInterface(state, 'compute-1', 'storage');
  assert.equal(state.hosts.find((host) => host.name === 'compute-1').interfaces.storage, 'down');

  const reset = resetSimulation(state);
  assert.equal(reset.hosts.find((host) => host.name === 'compute-1').interfaces.storage, 'up');
});

test('updating matrix can turn tenant-only-down into recovery', () => {
  const state = createSimulation('tenant-only-down');
  const row = state.matrix.find((rule) => rule.health.join(',') === 'up,down,up');
  row.action = ['recovery'];

  for (let i = 0; i < 5; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].payload.event, 'STOPPED');
});

test('updating monitoringSamples changes unstable behavior', () => {
  const state = createSimulation('storage-isolated');
  state.monitorConfig.monitoringSamples = 2;
  stepSimulation(state);
  stepSimulation(state);
  assert.equal(state.notifications.length, 0);

  stepSimulation(state);
  stepSimulation(state);
  assert.equal(state.notifications.length, 1);
});

test('redfish fencing success gates notification before evacuation', () => {
  const state = createSimulation('redfish-fencing-success');

  stepSimulation(state);
  stepSimulation(state);
  assert.equal(state.phase, 'fencing');
  assert.equal(state.notifications.length, 0);

  stepSimulation(state);
  assert.equal(state.fencing.status, 'succeeded');
  assert.equal(state.notifications.length, 1);
  assert.equal(state.currentExplanation.includes('Redfish fencing succeeded'), true);

  for (let i = 0; i < 5; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.notifications[0].status, 'finished');
  assert.equal(state.vmoves.every((vmove) => vmove.status === 'succeeded'), true);
});

test('redfish fencing failure blocks notification and evacuation', () => {
  const state = createSimulation('redfish-fencing-failed');

  for (let i = 0; i < 4; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.fencing.status, 'failed');
  assert.equal(state.notifications.length, 0);
  assert.equal(state.vmoves.length, 0);
  assert.equal(state.phase, 'done');
  assert.equal(state.currentExplanation.includes('Redfish fencing failed'), true);
});

test('redfish fencing unreachable blocks notification and evacuation', () => {
  const state = createSimulation('storage-isolated');
  state.fencing.enabled = true;
  state.fencing.expectedResult = 'unreachable';

  for (let i = 0; i < 4; i += 1) {
    stepSimulation(state);
  }

  assert.equal(state.fencing.status, 'unreachable');
  assert.equal(state.notifications.length, 0);
  assert.equal(state.vmoves.length, 0);
  assert.equal(state.phase, 'done');
  assert.equal(state.fencing.lastError, 'Redfish endpoint unreachable');
});
