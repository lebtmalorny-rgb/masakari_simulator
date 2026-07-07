export const STANDARD_LAYERS = ['manage', 'tenant', 'storage'];

export const DEFAULT_MATRIX = [
  { health: ['up', 'up', 'up'], action: [] },
  { health: ['up', 'up', 'down'], action: ['recovery'] },
  { health: ['up', 'down', 'up'], action: [] },
  { health: ['up', 'down', 'down'], action: ['recovery'] },
  { health: ['down', 'up', 'up'], action: [] },
  { health: ['down', 'up', 'down'], action: ['recovery'] },
  { health: ['down', 'down', 'up'], action: [] },
  { health: ['down', 'down', 'down'], action: ['recovery'] }
];

export const DEFAULT_MONITOR_CONFIG = {
  monitoringDriver: 'consul',
  monitoringInterval: 60,
  monitoringSamples: 1,
  apiRetryMax: 12,
  apiRetryInterval: 10,
  consul: {
    agentManage: '127.0.0.1:8500',
    agentTenant: '127.0.0.1:8501',
    agentStorage: '127.0.0.1:8502',
    matrixConfigFile: '/etc/masakarimonitors/matrix.yaml'
  }
};

export const DEFAULT_FENCING_CONFIG = {
  enabled: false,
  driver: 'redfish',
  endpoint: 'https://bmc.example/redfish/v1/Systems/compute-1',
  timeout: 60,
  verifyPowerOff: true,
  expectedResult: 'success',
  status: 'not-run',
  lastError: ''
};

export const DEFAULT_MASAKARI_CONFIG = {
  duplicateNotificationDetectionInterval: 180,
  waitPeriodAfterServiceUpdate: 180,
  waitPeriodAfterEvacuation: 90,
  verifyInterval: 1,
  waitPeriodAfterPowerOff: 180,
  processUnfinishedNotificationsInterval: 120,
  retryNotificationNewStatusInterval: 60,
  checkExpiredNotificationsInterval: 600,
  notificationsExpiredInterval: 86400,
  hostFailureRecoveryThreads: 3,
  coordinationBackendUrl: '',
  hostFailure: {
    evacuateAllInstances: true,
    haEnabledInstanceMetadataKey: 'HA_Enabled',
    ignoreInstancesInErrorState: false,
    addReservedHostToAggregate: false,
    serviceDisableReason: 'Masakari detected host failed.'
  },
  taskflowDriverRecoveryFlows: {
    hostAutoFailureRecoveryTasks: [
      'disable_compute_service_task',
      'prepare_HA_enabled_instances_task',
      'evacuate_instances_task'
    ],
    hostRhFailureRecoveryTasks: [
      'disable_compute_service_task',
      'prepare_HA_enabled_instances_task',
      'evacuate_instances_task'
    ]
  }
};

export const DEFAULT_WATCHER_CONFIG = {
  enabled: false,
  auditRunning: false,
  actionPlanPending: false,
  migrationTouchingVm: false,
  changedNovaServiceState: false,
  placementPressure: false,
  decisionEngine: {
    notificationTopics: ['nova.versioned_notifications', 'watcher.watcher_notifications'],
    maxAuditWorkers: 2,
    maxGeneralWorkers: 4,
    actionPlanExpiry: 24,
    checkPeriodicInterval: 1800,
    metricMapPath: '/etc/watcher/metric_map.yaml',
    continuousAuditInterval: 10
  },
  applier: {
    workers: 1,
    workflowEngine: 'taskflow',
    rollbackWhenActionplanFailed: false
  },
  datasources: {
    datasources: ['gnocchi', 'ceilometer', 'monasca', 'prometheus'],
    queryMaxRetries: 10,
    queryTimeout: 1
  },
  novaClient: {
    apiVersion: '2.56',
    endpointType: 'publicURL',
    regionName: ''
  },
  placementClient: {
    apiVersion: '1.29',
    interface: 'public',
    regionName: ''
  }
};

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function usedResources(host) {
  return host.vms.reduce(
    (acc, vm) => ({
      vcpus: acc.vcpus + vm.resources.vcpus,
      ramMb: acc.ramMb + vm.resources.ramMb,
      diskGb: acc.diskGb + vm.resources.diskGb
    }),
    { vcpus: 0, ramMb: 0, diskGb: 0 }
  );
}

export function hasCapacityFor(host, resources) {
  const used = usedResources(host);
  return (
    used.vcpus + resources.vcpus <= host.capacity.vcpus &&
    used.ramMb + resources.ramMb <= host.capacity.ramMb &&
    used.diskGb + resources.diskGb <= host.capacity.diskGb
  );
}

export function createLogEntry(clock, stage, message, detail = {}) {
  return {
    tick: clock,
    stage,
    message,
    detail: deepClone(detail)
  };
}
