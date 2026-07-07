import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MATRIX } from '../src/domain.mjs';
import {
  addConsulObservation,
  computeStableVector,
  evaluateMatrix,
  validateMatrix
} from '../src/health.mjs';

test('consul observation maps member status 1 to up and other values to down', () => {
  const history = {};
  addConsulObservation(history, 'compute-1', 'storage', 1);
  addConsulObservation(history, 'compute-1', 'storage', 2);
  assert.deepEqual(history['compute-1'].storage, ['up', 'down']);
});

test('stable vector requires monitoringSamples equal consecutive observations', () => {
  const history = {
    'compute-1': {
      manage: ['up', 'up', 'up'],
      tenant: ['up', 'up', 'up'],
      storage: ['up', 'down', 'down']
    }
  };

  const vector = computeStableVector(history, 'compute-1', ['manage', 'tenant', 'storage'], 2);
  assert.deepEqual(vector.stable, ['up', 'up', 'down']);
  assert.deepEqual(vector.unstableDimensions, []);
});

test('mixed sample window makes dimension unstable', () => {
  const history = {
    'compute-1': {
      manage: ['up', 'up', 'up'],
      tenant: ['up', 'up', 'up'],
      storage: ['down', 'up', 'down']
    }
  };

  const vector = computeStableVector(history, 'compute-1', ['manage', 'tenant', 'storage'], 3);
  assert.deepEqual(vector.stable, ['up', 'up', null]);
  assert.deepEqual(vector.unstableDimensions, ['storage']);
});

test('matrix evaluation returns recovery for upstream storage isolation row', () => {
  const result = evaluateMatrix(DEFAULT_MATRIX, ['up', 'up', 'down']);
  assert.deepEqual(result.action, ['recovery']);
  assert.equal(result.matched, true);
});

test('matrix evaluation ignores rows with mismatched health length', () => {
  const result = evaluateMatrix([{ health: ['up'], action: ['recovery'] }], ['up', 'down', 'down']);

  assert.equal(result.matched, false);
  assert.deepEqual(result.action, []);
  assert.equal(result.reason, 'no matrix row matches stable vector');
});

test('matrix evaluation returns matched rule snapshot', () => {
  const matrix = [{ health: ['up', 'up', 'down'], action: ['recovery'] }];
  const result = evaluateMatrix(matrix, ['up', 'up', 'down']);

  result.matchedRule.action.length = 0;
  result.matchedRule.health[0] = 'down';

  assert.deepEqual(matrix[0], { health: ['up', 'up', 'down'], action: ['recovery'] });
});

test('matrix validation reports unsupported health values and invalid row length', () => {
  const result = validateMatrix(['manage', 'tenant', 'storage'], [
    { health: ['up', 'broken'], action: [] },
    { health: ['up', 'down', 'up'], action: ['recovery', 'poweroff'] }
  ]);

  assert.deepEqual(result.errors, [
    'row 1 health length 2 does not match sequence length 3',
    'row 1 has unsupported health value broken',
    'row 2 has unsupported action poweroff'
  ]);
});

test('matrix validation reports malformed matrix rows without throwing', () => {
  const result = validateMatrix(['manage', 'tenant', 'storage'], [
    null,
    { action: [] },
    { health: ['up', 'down', 'up'] },
    { health: 'up,down,up', action: [] }
  ]);

  assert.deepEqual(result.errors, [
    'row 1 must be an object',
    'row 2 health must be an array',
    'row 3 action must be an array',
    'row 4 health must be an array'
  ]);
});

test('matrix validation reports malformed top-level inputs without throwing', () => {
  assert.deepEqual(validateMatrix('manage', []).errors, ['sequence must be an array']);
  assert.deepEqual(validateMatrix(['manage'], null).errors, ['matrix must be an array']);
});
