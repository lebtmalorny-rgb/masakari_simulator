import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../src/scenarios.mjs';
import {
  createVMove,
  findPlacementCandidates,
  evacuateVm,
  evacuateSelectedVms
} from '../src/evacuation.mjs';

test('findPlacementCandidates excludes source host and hosts without capacity', () => {
  const state = getScenario('no-valid-destination');
  const source = state.hosts.find((host) => host.name === 'compute-1');
  const vm = source.vms[0];

  assert.deepEqual(findPlacementCandidates(state, 'compute-1', vm.resources), []);
});

test('reserved recovery selects reserved host first', () => {
  const state = getScenario('reserved-host-recovery');
  const source = state.hosts.find((host) => host.name === 'compute-1');
  const vm = source.vms[0];

  assert.deepEqual(findPlacementCandidates(state, 'compute-1', vm.resources, { reservedOnly: true }), ['compute-3']);
});

test('createVMove creates pending evacuation record', () => {
  const state = getScenario('storage-isolated');
  const source = state.hosts.find((host) => host.name === 'compute-1');
  const vmove = createVMove(state, source.vms[0], 'compute-1', 'notification-0001');

  assert.equal(vmove.type, 'evacuation');
  assert.equal(vmove.status, 'pending');
  assert.equal(vmove.sourceHost, 'compute-1');
});

test('evacuateVm moves VM to destination and marks vmove succeeded', () => {
  const state = getScenario('storage-isolated');
  const source = state.hosts.find((host) => host.name === 'compute-1');
  const vm = source.vms[0];
  const vmove = createVMove(state, vm, 'compute-1', 'notification-0001');
  state.vmoves.push(vmove);

  evacuateVm(state, vmove, 'compute-2');

  const destination = state.hosts.find((host) => host.name === 'compute-2');
  assert.equal(destination.vms.some((candidate) => candidate.uuid === vm.uuid), true);
  assert.equal(state.hosts.find((host) => host.name === 'compute-1').vms.some((candidate) => candidate.uuid === vm.uuid), false);
  assert.equal(vmove.status, 'succeeded');
  assert.equal(vmove.destHost, 'compute-2');
});

test('evacuateSelectedVms marks vmove failed when no candidate exists', () => {
  const state = getScenario('no-valid-destination');
  const result = evacuateSelectedVms(state, 'compute-1', 'notification-0001');

  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 2);
  assert.equal(state.vmoves.every((vmove) => vmove.status === 'failed'), true);
});
