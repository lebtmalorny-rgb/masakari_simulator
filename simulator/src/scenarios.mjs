import {
  DEFAULT_MASAKARI_CONFIG,
  DEFAULT_FENCING_CONFIG,
  DEFAULT_MATRIX,
  DEFAULT_MONITOR_CONFIG,
  DEFAULT_WATCHER_CONFIG,
  STANDARD_LAYERS,
  deepClone
} from './domain.mjs';

function baseHosts() {
  return [
    {
      name: 'compute-1',
      role: 'source',
      interfaces: { manage: 'up', tenant: 'up', storage: 'up' },
      novaServiceStatus: 'enabled',
      novaServiceState: 'up',
      novaServiceDisabledReason: '',
      masakariOnMaintenance: false,
      reserved: false,
      capacity: { vcpus: 8, ramMb: 16384, diskGb: 200 },
      placementAllocations: [],
      vms: [
        {
          uuid: 'vm-001',
          name: 'api-1',
          host: 'compute-1',
          vmState: 'active',
          taskState: null,
          haEnabled: true,
          locked: false,
          resources: { vcpus: 2, ramMb: 2048, diskGb: 20 }
        },
        {
          uuid: 'vm-002',
          name: 'batch-1',
          host: 'compute-1',
          vmState: 'active',
          taskState: null,
          haEnabled: false,
          locked: false,
          resources: { vcpus: 2, ramMb: 2048, diskGb: 20 }
        }
      ]
    },
    {
      name: 'compute-2',
      role: 'destination',
      interfaces: { manage: 'up', tenant: 'up', storage: 'up' },
      novaServiceStatus: 'enabled',
      novaServiceState: 'up',
      novaServiceDisabledReason: '',
      masakariOnMaintenance: false,
      reserved: false,
      capacity: { vcpus: 8, ramMb: 16384, diskGb: 200 },
      placementAllocations: [],
      vms: []
    },
    {
      name: 'compute-3',
      role: 'reserved',
      interfaces: { manage: 'up', tenant: 'up', storage: 'up' },
      novaServiceStatus: 'enabled',
      novaServiceState: 'up',
      novaServiceDisabledReason: '',
      masakariOnMaintenance: false,
      reserved: true,
      capacity: { vcpus: 8, ramMb: 16384, diskGb: 200 },
      placementAllocations: [],
      vms: []
    }
  ];
}

function baseScenario(id, name) {
  return {
    id,
    name,
    sequence: [...STANDARD_LAYERS],
    matrix: deepClone(DEFAULT_MATRIX),
    monitorConfig: deepClone(DEFAULT_MONITOR_CONFIG),
    fencing: deepClone(DEFAULT_FENCING_CONFIG),
    masakariConfig: deepClone(DEFAULT_MASAKARI_CONFIG),
    watcher: deepClone(DEFAULT_WATCHER_CONFIG),
    hosts: baseHosts(),
    notifications: [],
    vmoves: [],
    eventLog: [],
    warnings: [],
    clock: 0,
    activeHost: 'compute-1',
    lastStableVectors: {},
    healthHistory: {},
    activeNotificationId: null,
    taskflow: null,
    scenarioExpectation: 'no-recovery'
  };
}

const scenarios = [
  baseScenario('healthy-baseline', 'Здоровое базовое состояние'),
  baseScenario('storage-isolated', 'Изоляция storage'),
  baseScenario('tenant-only-down', 'Изоляция только tenant'),
  baseScenario('manage-only-down', 'Down только manage'),
  baseScenario('tenant-storage-down', 'Tenant + storage down'),
  baseScenario('unstable-interface', 'Нестабильный интерфейс'),
  baseScenario('no-valid-destination', 'Нет подходящего destination'),
  baseScenario('reserved-host-recovery', 'Восстановление через reserved host'),
  baseScenario('watcher-conflict', 'Конфликт с Watcher'),
  baseScenario('custom-matrix-policy', 'Измененная политика matrix'),
  baseScenario('redfish-fencing-success', 'Redfish fencing успешен'),
  baseScenario('redfish-fencing-failed', 'Redfish fencing failed')
];

scenarios.find((scenario) => scenario.id === 'storage-isolated').hosts[0].interfaces.storage = 'down';
scenarios.find((scenario) => scenario.id === 'storage-isolated').scenarioExpectation = 'recovery';

scenarios.find((scenario) => scenario.id === 'tenant-only-down').hosts[0].interfaces.tenant = 'down';

scenarios.find((scenario) => scenario.id === 'manage-only-down').hosts[0].interfaces.manage = 'down';

const tenantStorage = scenarios.find((scenario) => scenario.id === 'tenant-storage-down');
tenantStorage.hosts[0].interfaces.tenant = 'down';
tenantStorage.hosts[0].interfaces.storage = 'down';
tenantStorage.scenarioExpectation = 'recovery';

const unstable = scenarios.find((scenario) => scenario.id === 'unstable-interface');
unstable.monitorConfig.monitoringSamples = 3;
unstable.hosts[0].interfaces.storage = 'down';
unstable.healthHistory = {
  'compute-1': {
    manage: ['up', 'up'],
    tenant: ['up', 'up'],
    storage: ['up', 'down']
  }
};

const noDestination = scenarios.find((scenario) => scenario.id === 'no-valid-destination');
noDestination.hosts[0].interfaces.storage = 'down';
noDestination.hosts[1].capacity = { vcpus: 2, ramMb: 2048, diskGb: 20 };
noDestination.hosts[1].vms = [
  {
    uuid: 'vm-900',
    name: 'capacity-blocker',
    host: 'compute-2',
    vmState: 'active',
    taskState: null,
    haEnabled: true,
    locked: false,
    resources: { vcpus: 2, ramMb: 2048, diskGb: 20 }
  }
];
noDestination.hosts[2].novaServiceState = 'down';
noDestination.scenarioExpectation = 'recovery-failed';

const reserved = scenarios.find((scenario) => scenario.id === 'reserved-host-recovery');
reserved.hosts[0].interfaces.storage = 'down';
reserved.hosts[1].novaServiceState = 'down';
reserved.recoveryMethod = 'reserved_host';
reserved.scenarioExpectation = 'recovery';

const watcherConflict = scenarios.find((scenario) => scenario.id === 'watcher-conflict');
watcherConflict.hosts[0].interfaces.storage = 'down';
watcherConflict.watcher.enabled = true;
watcherConflict.watcher.auditRunning = true;
watcherConflict.watcher.actionPlanPending = true;
watcherConflict.watcher.migrationTouchingVm = true;
watcherConflict.watcher.placementPressure = true;
watcherConflict.scenarioExpectation = 'recovery-with-warnings';

const customMatrix = scenarios.find((scenario) => scenario.id === 'custom-matrix-policy');
customMatrix.hosts[0].interfaces.tenant = 'down';
customMatrix.matrix = customMatrix.matrix.map((rule) => {
  if (rule.health.join(',') === 'up,down,up') {
    return { health: rule.health, action: ['recovery'] };
  }
  return rule;
});
customMatrix.scenarioExpectation = 'recovery';

const redfishSuccess = scenarios.find((scenario) => scenario.id === 'redfish-fencing-success');
redfishSuccess.hosts[0].interfaces.storage = 'down';
redfishSuccess.fencing.enabled = true;
redfishSuccess.fencing.expectedResult = 'success';
redfishSuccess.scenarioExpectation = 'recovery-with-fencing';

const redfishFailed = scenarios.find((scenario) => scenario.id === 'redfish-fencing-failed');
redfishFailed.hosts[0].interfaces.storage = 'down';
redfishFailed.fencing.enabled = true;
redfishFailed.fencing.expectedResult = 'failed';
redfishFailed.scenarioExpectation = 'fencing-failed';

export function listScenarios() {
  return scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name }));
}

export function getScenario(id) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return deepClone(scenario);
}
