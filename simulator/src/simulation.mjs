import { createLogEntry } from './domain.mjs';
import { getScenario } from './scenarios.mjs';
import { addConsulObservation, computeStableVector, evaluateMatrix, validateMatrix } from './health.mjs';
import { fencingWarning, runRedfishFencing } from './fencing.mjs';
import {
  advanceTaskflow,
  createHostNotification,
  isDuplicateNotification,
  startHostFailureTaskflow
} from './masakari.mjs';
import { evacuateSelectedVms } from './evacuation.mjs';
import { explainWatcherContext } from './watcher.mjs';

function hasExistingHealthHistory(state) {
  return Object.values(state.healthHistory).some((hostHistory) =>
    Object.values(hostHistory).some((samples) => samples.length > 0)
  );
}

export function createSimulation(scenarioId = 'healthy-baseline') {
  const state = getScenario(scenarioId);
  state.scenarioId = scenarioId;
  state.phase = hasExistingHealthHistory(state) ? 'health-evaluate' : 'consul-observe';
  state.currentExplanation = 'Симуляция готова к первому шагу';
  state.matrixValidation = validateMatrix(state.sequence, state.matrix);
  return state;
}

export function resetSimulation(state) {
  return createSimulation(state.scenarioId);
}

export function toggleInterface(state, hostName, layer) {
  const host = state.hosts.find((candidate) => candidate.name === hostName);
  if (!host) {
    throw new Error(`Unknown host: ${hostName}`);
  }

  if (!state.sequence.includes(layer)) {
    throw new Error(`Unknown layer: ${layer}`);
  }

  if (hostName !== state.activeHost) {
    throw new Error('Only active host interfaces can be changed');
  }

  host.interfaces[layer] = host.interfaces[layer] === 'up' ? 'down' : 'up';
  state.phase = 'consul-observe';
  state.currentExplanation = `${hostName}.${layer} switched to ${host.interfaces[layer]}`;
}

function observeActiveHost(state) {
  const host = state.hosts.find((candidate) => candidate.name === state.activeHost);
  if (!host) {
    throw new Error(`Unknown active host: ${state.activeHost}`);
  }

  for (const layer of state.sequence) {
    addConsulObservation(state.healthHistory, host.name, layer, host.interfaces[layer]);
  }

  state.eventLog.push(createLogEntry(state.clock, 'consul', `Consul samples recorded for ${host.name}`));
}

function evaluateHealthAndMaybeNotify(state) {
  const vector = computeStableVector(
    state.healthHistory,
    state.activeHost,
    state.sequence,
    state.monitorConfig.monitoringSamples
  );

  state.currentVector = vector;

  if (!vector.ready) {
    state.currentExplanation = `health vector has unstable dimensions: ${vector.unstableDimensions.join(', ')}`;
    state.phase = 'consul-observe';
    return;
  }

  const previous = state.lastStableVectors[state.activeHost];
  const vectorKey = vector.stable.join(',');

  if (previous === vectorKey) {
    state.currentExplanation = 'stable vector did not change; hostmonitor suppresses repeat notification';
    state.phase = 'done';
    return;
  }

  state.lastStableVectors[state.activeHost] = vectorKey;
  const matrixResult = evaluateMatrix(state.matrix, vector.stable);
  state.currentMatrixResult = matrixResult;

  if (!matrixResult.action.includes('recovery')) {
    state.currentExplanation = matrixResult.reason;
    state.phase = 'done';
    return;
  }

  if (isDuplicateNotification(state, state.activeHost, 'STOPPED')) {
    state.currentExplanation = 'duplicate notification window suppressed COMPUTE_HOST STOPPED';
    state.phase = 'done';
    return;
  }

  if (state.fencing.enabled) {
    state.fencing.status = 'pending';
    state.fencing.lastError = '';
    state.currentExplanation = 'matrix action contains recovery; waiting for Redfish fencing';
    state.phase = 'fencing';
    return;
  }

  const notification = createHostNotification(state, state.activeHost, vector.stable, matrixResult.action);
  state.notifications.push(notification);
  state.activeNotificationId = notification.uuid;
  state.currentExplanation = 'matrix action contains recovery; fencing disabled; Masakari notification created';
  state.phase = 'masakari-start';
}

function createRecoveryNotificationAfterFencing(state) {
  const notification = createHostNotification(
    state,
    state.activeHost,
    state.currentVector.stable,
    state.currentMatrixResult.action
  );
  state.notifications.push(notification);
  state.activeNotificationId = notification.uuid;
  state.currentExplanation = 'Redfish fencing succeeded; Masakari notification created';
  state.phase = 'masakari-start';
}

function finishNotification(state, failedCount) {
  const notification = state.notifications.find((candidate) => candidate.uuid === state.activeNotificationId);
  if (!notification) {
    return;
  }

  notification.status = failedCount > 0 ? 'error' : 'finished';
  state.currentExplanation = failedCount > 0
    ? 'one or more VMoves failed; notification enters error path'
    : 'all VMoves succeeded; notification finished';
  state.phase = 'done';
}

export function stepSimulation(state) {
  state.clock += 1;
  state.warnings = explainWatcherContext(state);
  const warning = fencingWarning(state);
  if (warning) {
    state.warnings.push(warning);
  }
  state.matrixValidation = validateMatrix(state.sequence, state.matrix);

  if (state.phase === 'consul-observe') {
    observeActiveHost(state);
    state.phase = 'health-evaluate';
    state.currentExplanation = 'Consul raw health collected from manage, tenant and storage layers';
    return state;
  }

  if (state.phase === 'health-evaluate') {
    evaluateHealthAndMaybeNotify(state);
    const latestWarning = fencingWarning(state);
    if (latestWarning && !state.warnings.includes(latestWarning)) {
      state.warnings.push(latestWarning);
    }
    return state;
  }

  if (state.phase === 'fencing') {
    const result = runRedfishFencing(state);
    if (!result.ok) {
      state.currentExplanation = `Redfish fencing failed; recovery blocked: ${result.error}`;
      state.phase = 'done';
      return state;
    }

    createRecoveryNotificationAfterFencing(state);
    return state;
  }

  if (state.phase === 'masakari-start') {
    startHostFailureTaskflow(state, state.activeNotificationId);
    state.phase = 'taskflow-prepare';
    state.currentExplanation = 'Masakari engine set host on_maintenance and disabled nova-compute';
    return state;
  }

  if (state.phase === 'taskflow-prepare') {
    advanceTaskflow(state);
    state.currentExplanation = 'Masakari selected instances according to evacuate_all_instances and HA metadata';
    state.phase = 'taskflow-evacuate';
    return state;
  }

  if (state.phase === 'taskflow-evacuate') {
    advanceTaskflow(state);
    const result = evacuateSelectedVms(state, state.activeHost, state.activeNotificationId);
    state.currentExplanation = `Nova evacuation completed: ${result.succeeded} succeeded, ${result.failed} failed`;
    finishNotification(state, result.failed);
    return state;
  }

  return state;
}
