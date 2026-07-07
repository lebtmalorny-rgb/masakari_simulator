import { createLogEntry, hasCapacityFor } from './domain.mjs';
import { selectEvacuationVms } from './masakari.mjs';

function vmoveId(state) {
  return `vmove-${String(state.vmoves.length + 1).padStart(4, '0')}`;
}

export function findPlacementCandidates(state, sourceHostName, resources, options = {}) {
  return state.hosts
    .filter((host) => host.name !== sourceHostName)
    .filter((host) => host.novaServiceStatus === 'enabled')
    .filter((host) => host.novaServiceState === 'up')
    .filter((host) => !host.masakariOnMaintenance)
    .filter((host) => (options.reservedOnly ? host.reserved === true : true))
    .filter((host) => hasCapacityFor(host, resources))
    .map((host) => host.name);
}

export function createVMove(state, vm, sourceHostName, notificationUuid) {
  return {
    uuid: vmoveId(state),
    instanceUuid: vm.uuid,
    instanceName: vm.name,
    notificationUuid,
    sourceHost: sourceHostName,
    destHost: null,
    type: 'evacuation',
    status: 'pending',
    startTick: null,
    endTick: null,
    message: 'waiting for Nova servers.evacuate'
  };
}

export function evacuateVm(state, vmove, destinationHostName) {
  const source = state.hosts.find((host) => host.name === vmove.sourceHost);
  const destination = state.hosts.find((host) => host.name === destinationHostName);
  const vmIndex = source?.vms.findIndex((vm) => vm.uuid === vmove.instanceUuid) ?? -1;

  if (!source || !destination || vmIndex === -1) {
    vmove.status = 'failed';
    vmove.message = 'destination or source VM is missing';
    vmove.endTick = state.clock;
    return vmove;
  }

  const [vm] = source.vms.splice(vmIndex, 1);
  vm.host = destination.name;
  vm.taskState = null;
  vm.locked = false;
  destination.vms.push(vm);

  vmove.destHost = destination.name;
  vmove.status = 'succeeded';
  vmove.endTick = state.clock;
  vmove.message = 'Nova evacuation rebuild completed on destination host';

  state.eventLog.push(createLogEntry(state.clock, 'nova', `${vm.name} evacuated to ${destination.name}`, {
    source: source.name,
    destination: destination.name
  }));

  return vmove;
}

export function evacuateSelectedVms(state, sourceHostName, notificationUuid) {
  const selected = selectEvacuationVms(state, sourceHostName);
  const reservedOnly = state.recoveryMethod === 'reserved_host';
  let succeeded = 0;
  let failed = 0;

  for (const vm of selected) {
    const vmove = createVMove(state, vm, sourceHostName, notificationUuid);
    vmove.status = 'ongoing';
    vmove.startTick = state.clock;
    state.vmoves.push(vmove);

    const candidates = findPlacementCandidates(state, sourceHostName, vm.resources, { reservedOnly });
    if (candidates.length === 0) {
      vmove.status = 'failed';
      vmove.endTick = state.clock;
      vmove.message = 'No valid host from Placement allocation candidates';
      failed += 1;
      continue;
    }

    evacuateVm(state, vmove, candidates[0]);
    succeeded += 1;
  }

  return { selected: selected.length, succeeded, failed };
}
