import { createLogEntry } from './domain.mjs';

export function fencingWarning(state) {
  const needsRecovery = state.currentMatrixResult?.action.includes('recovery');

  if (needsRecovery && !state.fencing.enabled) {
    return 'Matrix requested recovery without fencing; evacuation continues with split-brain risk';
  }

  return null;
}

export function runRedfishFencing(state) {
  const target = state.activeHost;
  const result = state.fencing.expectedResult;

  if (result === 'success') {
    state.fencing.status = 'succeeded';
    state.fencing.lastError = '';
    state.eventLog.push(createLogEntry(state.clock, 'fencing', `Redfish fenced ${target}`, {
      driver: state.fencing.driver,
      endpoint: state.fencing.endpoint
    }));
    return { ok: true, status: 'succeeded' };
  }

  state.fencing.status = result === 'unreachable' ? 'unreachable' : 'failed';
  state.fencing.lastError = result === 'unreachable'
    ? 'Redfish endpoint unreachable'
    : 'Redfish power action failed';
  state.eventLog.push(createLogEntry(state.clock, 'fencing', `Redfish fencing blocked recovery for ${target}`, {
    driver: state.fencing.driver,
    status: state.fencing.status,
    error: state.fencing.lastError
  }));

  return { ok: false, status: state.fencing.status, error: state.fencing.lastError };
}
