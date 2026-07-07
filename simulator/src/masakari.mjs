import { createLogEntry } from './domain.mjs';

function nextId(prefix, state) {
  const key = `_${prefix}Sequence`;
  state[key] = (state[key] ?? 0) + 1;
  return `${prefix}-${String(state[key]).padStart(4, '0')}`;
}

export function createHostNotification(state, hostName, vector, action) {
  const hasRecovery = action.includes('recovery');
  const event = hasRecovery ? 'STOPPED' : 'STARTED';

  return {
    uuid: nextId('notification', state),
    type: 'COMPUTE_HOST',
    hostname: hostName,
    generatedTick: state.clock,
    payload: {
      event,
      cluster_status: event === 'STOPPED' ? 'OFFLINE' : 'ONLINE',
      host_status: 'NORMAL',
      health_vector: [...vector]
    },
    status: 'new'
  };
}

export function isDuplicateNotification(state, hostName, event) {
  const window = state.masakariConfig.duplicateNotificationDetectionInterval;
  return state.notifications.some((notification) => {
    const age = state.clock - notification.generatedTick;
    return (
      notification.hostname === hostName &&
      notification.payload.event === event &&
      age >= 0 &&
      age <= window
    );
  });
}

export function startHostFailureTaskflow(state, notificationUuid) {
  const notification = state.notifications.find((candidate) => candidate.uuid === notificationUuid);
  if (!notification) {
    throw new Error(`Unknown notification: ${notificationUuid}`);
  }

  const host = state.hosts.find((candidate) => candidate.name === notification.hostname);
  if (!host) {
    throw new Error(`Unknown host: ${notification.hostname}`);
  }

  notification.status = 'running';
  host.masakariOnMaintenance = true;
  host.novaServiceStatus = 'disabled';
  host.novaServiceState = 'down';
  host.novaServiceDisabledReason = state.masakariConfig.hostFailure.serviceDisableReason;

  state.taskflow = {
    notificationUuid,
    sourceHost: host.name,
    currentStep: 'disable_compute_service_task',
    steps: [
      { name: 'disable_compute_service_task', status: 'running', progress: 30, message: 'nova-compute service disabled' },
      { name: 'prepare_HA_enabled_instances_task', status: 'pending', progress: 0, message: 'waiting for VM selection' },
      { name: 'evacuate_instances_task', status: 'pending', progress: 0, message: 'waiting for Nova evacuate calls' }
    ]
  };

  state.eventLog.push(createLogEntry(state.clock, 'masakari', `Notification ${notification.uuid} is running`, {
    host: host.name
  }));
}

export function selectEvacuationVms(state, hostName) {
  const host = state.hosts.find((candidate) => candidate.name === hostName);
  if (!host) {
    return [];
  }

  return host.vms.filter((vm) => {
    if (state.masakariConfig.hostFailure.ignoreInstancesInErrorState && vm.vmState === 'error') {
      return false;
    }

    if (state.masakariConfig.hostFailure.evacuateAllInstances) {
      return true;
    }

    return vm.haEnabled === true;
  });
}

export function advanceTaskflow(state) {
  if (!state.taskflow) {
    return null;
  }

  if (state.taskflow.currentStep === 'finished') {
    return null;
  }

  const steps = state.taskflow.steps;
  const currentIndex = steps.findIndex((step) => step.name === state.taskflow.currentStep);

  if (currentIndex === -1) {
    throw new Error(`Unknown taskflow step: ${state.taskflow.currentStep}`);
  }

  steps[currentIndex].status = 'succeeded';
  steps[currentIndex].progress = 100;

  const next = steps[currentIndex + 1];
  if (!next) {
    state.taskflow.currentStep = 'finished';
    return null;
  }

  next.status = 'running';
  next.progress = 30;
  state.taskflow.currentStep = next.name;
  state.eventLog.push(createLogEntry(state.clock, 'taskflow', `Taskflow moved to ${next.name}`));
  return next;
}
