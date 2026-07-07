export function explainWatcherContext(state) {
  const watcher = state.watcher;

  if (!watcher.enabled) {
    return [];
  }

  const warnings = [];

  if (watcher.auditRunning) {
    warnings.push('Watcher audit is running while Masakari recovery is active');
  }

  if (watcher.actionPlanPending) {
    warnings.push('Watcher action plan is pending and can compete for Nova resources');
  }

  if (watcher.migrationTouchingVm) {
    warnings.push('Watcher migration action touches VM placement during evacuation');
  }

  if (watcher.changedNovaServiceState) {
    warnings.push('Watcher changed Nova service state before Masakari taskflow');
  }

  if (watcher.placementPressure) {
    warnings.push('Watcher context marks Placement pressure');
  }

  return warnings;
}
