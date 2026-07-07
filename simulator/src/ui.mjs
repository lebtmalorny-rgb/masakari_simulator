import { listScenarios } from './scenarios.mjs';
import { createSimulation, resetSimulation, stepSimulation, toggleInterface } from './simulation.mjs';
import { DEFAULT_MATRIX } from './domain.mjs';

function statusClass(value) {
  if (value === 'up' || value === 'enabled' || value === 'finished' || value === 'succeeded') {
    return 'ok';
  }

  if (value === 'down' || value === 'disabled' || value === 'error' || value === 'failed') {
    return 'bad';
  }

  return 'warn';
}

const INTERFACE_DETAILS = {
  manage: {
    role: 'сеть управления',
    description: 'Consul, управление Nova service и путь Masakari monitor/API'
  },
  tenant: {
    role: 'сеть пользовательского трафика',
    description: 'пользовательский трафик VM между tenant-сетями'
  },
  storage: {
    role: 'доступ к хранилищу',
    description: 'путь к shared или block storage; в matrix по умолчанию down запускает recovery'
  }
};

function formatList(values) {
  return `[${values.join(', ')}]`;
}

function formatVector(values) {
  return formatList(values.map((value) => value ?? 'unstable'));
}

function formatAction(action) {
  return action.length === 0 ? '[]' : formatList(action);
}

function interfaceDetail(layer) {
  return INTERFACE_DETAILS[layer] ?? {
    role: 'экспериментальная сеть',
    description: 'дополнительный слой вне базовой sequence'
  };
}

function findMatrixRule(matrix, sequence, valuesByLayer) {
  const health = sequence.map((layer) => valuesByLayer[layer]);
  const index = matrix.findIndex((rule) =>
    Array.isArray(rule.health) &&
    rule.health.length === health.length &&
    rule.health.every((value, valueIndex) => value === health[valueIndex])
  );

  return {
    health,
    key: health.join(','),
    index,
    rule: index >= 0 ? matrix[index] : null
  };
}

function findMatrixRuleByHealth(matrix, health) {
  return matrix.find((rule) =>
    Array.isArray(rule.health) &&
    rule.health.length === health.length &&
    rule.health.every((value, valueIndex) => value === health[valueIndex])
  );
}

function sameAction(left, right) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function matrixRuleChangedFromDefault(rule) {
  if (!rule) {
    return false;
  }

  const defaultRule = findMatrixRuleByHealth(DEFAULT_MATRIX, rule.health);
  return !defaultRule || !sameAction(rule.action, defaultRule.action);
}

function matrixPolicyLabel(matrix) {
  return matrix.some(matrixRuleChangedFromDefault) ? 'policy: custom matrix' : 'policy: default matrix';
}

function renderMatrixCell(entry, activeKey) {
  if (!entry.rule) {
    return `
      <div class="matrix-cell missing" title="health: ${formatVector(entry.health)}">
        <span>missing</span>
      </div>
    `;
  }

  const action = formatAction(entry.rule.action);
  const actionClass = entry.rule.action.includes('recovery') ? 'bad' : 'ok';
  const changedClass = matrixRuleChangedFromDefault(entry.rule) ? 'changed' : '';
  const label = `health: ${formatVector(entry.health)} action: ${action}`;

  return `
    <button
      class="matrix-cell ${changedClass} ${actionClass} ${entry.key === activeKey ? 'active' : ''}"
      type="button"
      data-role="matrix-toggle"
      data-row="${entry.index}"
      title="${label}"
      aria-label="${label}"
    >
      <span>${action}</span>
    </button>
  `;
}

function renderScenarioOptions(currentId) {
  return listScenarios()
    .map((scenario) => `<option value="${scenario.id}" ${scenario.id === currentId ? 'selected' : ''}>${scenario.name}</option>`)
    .join('');
}

function renderHost(host) {
  const interfaces = Object.entries(host.interfaces)
    .map(([layer, status]) => `
      <div class="interface-row">
        <span class="interface-label">
          <strong>${layer}</strong>
          <small>${interfaceDetail(layer).role}</small>
        </span>
        <button class="interface-button ${status}" type="button" data-role="interface-toggle" data-host="${host.name}" data-layer="${layer}">${status}</button>
      </div>
    `)
    .join('');

  const vms = host.vms.length === 0
    ? '<span class="status-chip">VM нет</span>'
    : host.vms.map((vm) => `
      <div class="vm-row">
        <span>${vm.name}</span>
        <span class="status-chip ${vm.haEnabled ? 'ok' : 'warn'}">${vm.haEnabled ? 'HA' : 'non-HA'}</span>
      </div>
    `).join('');

  return `
    <article class="host-card">
      <div class="host-title">
        <strong>${host.name}</strong>
        <span class="status-chip ${statusClass(host.novaServiceState)}">nova ${host.novaServiceState}</span>
      </div>
      <span class="status-chip ${host.masakariOnMaintenance ? 'warn' : 'ok'}">maintenance ${host.masakariOnMaintenance}</span>
      <div class="stack">${interfaces}</div>
      <div class="stack">${vms}</div>
    </article>
  `;
}

function renderMatrix(state) {
  const active = state.currentVector?.ready ? state.currentVector.stable.join(',') : '';
  const axisValues = ['up', 'down'];

  const planes = axisValues.map((storage) => `
    <div class="matrix-plane" data-role="matrix-plane">
      <div class="matrix-plane-title">storage = ${storage}</div>
      <div class="matrix-grid">
        <div class="matrix-axis-corner"></div>
        ${axisValues.map((tenant) => `<div class="matrix-axis-label">tenant ${tenant}</div>`).join('')}
        ${axisValues.map((manage) => `
          <div class="matrix-axis-label row-label">manage ${manage}</div>
          ${axisValues.map((tenant) => renderMatrixCell(
            findMatrixRule(state.matrix, state.sequence, { manage, tenant, storage }),
            active
          )).join('')}
        `).join('')}
      </div>
    </div>
  `).join('');

  return `
    <div class="matrix-meta">
      <span>sequence: ${formatList(state.sequence)}</span>
      <span>${matrixPolicyLabel(state.matrix)}</span>
      <span>2 x 2 x 2 = 8</span>
    </div>
    <div class="matrix-planes">${planes}</div>
  `;
}

function renderUsageGuide() {
  return `
    <ol class="info-list">
      <li>Выберите сценарий.</li>
      <li>Переключите интерфейсы исходного хоста между up и down.</li>
      <li>Измените monitoring_samples, если нужно увидеть нестабильный vector.</li>
      <li>Включите Redfish fencing, если нужно проверить gate перед Masakari notification.</li>
      <li>
        Если нужно проверить другую policy, переключите ячейку matrix между [] и [recovery].
        <small class="list-note">Это меняет policy, а не состояние интерфейсов: так можно проверить, какой action будет выбран для того же health.</small>
      </li>
      <li>Нажимайте кнопку Шаг до notification, taskflow, evacuation или решения без action.</li>
    </ol>
  `;
}

function renderHealthVector(state) {
  const stableVector = state.currentVector
    ? `health: ${formatVector(state.currentVector.stable)}`
    : 'health: нет данных';
  const rawSamples = state.sequence.map((layer) => {
    const samples = state.healthHistory[state.activeHost]?.[layer] ?? [];
    return `
      <div class="config-row">
        <span>${layer}</span>
        <span class="status-chip">${formatVector(samples)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="stack" data-role="health-vector">
      <div class="config-row"><span>sequence</span><span class="status-chip">sequence: ${formatList(state.sequence)}</span></div>
      <div class="config-row"><span>stable</span><span class="status-chip">${stableVector}</span></div>
      <div class="help-text">unstable означает, что последние ${state.monitorConfig.monitoringSamples} наблюдений еще не совпали.</div>
      <div class="stack">${rawSamples}</div>
    </div>
  `;
}

function renderNetworkLegend(state) {
  return `
    <div class="stack">
      ${state.sequence.map((layer) => {
        const detail = interfaceDetail(layer);
        return `
          <div class="legend-row">
            <strong>${layer}</strong>
            <span>${detail.role}: ${detail.description}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderMonitorConfig(state) {
  return `
    <div class="config-row"><span>monitoring_driver</span><span class="status-chip">${state.monitorConfig.monitoringDriver}</span></div>
    <label class="config-row"><span>monitoring_samples</span><input data-role="config-number" data-path="monitorConfig.monitoringSamples" type="number" min="1" max="5" value="${state.monitorConfig.monitoringSamples}"></label>
    <label class="config-row"><span>api_retry_max</span><input data-role="config-number" data-path="monitorConfig.apiRetryMax" type="number" min="0" max="60" value="${state.monitorConfig.apiRetryMax}"></label>
    <label class="config-row"><span>api_retry_interval</span><input data-role="config-number" data-path="monitorConfig.apiRetryInterval" type="number" min="1" max="120" value="${state.monitorConfig.apiRetryInterval}"></label>
    <div class="config-row"><span>agent_manage</span><span class="status-chip">${state.monitorConfig.consul.agentManage}</span></div>
    <div class="config-row"><span>agent_tenant</span><span class="status-chip">${state.monitorConfig.consul.agentTenant}</span></div>
    <div class="config-row"><span>agent_storage</span><span class="status-chip">${state.monitorConfig.consul.agentStorage}</span></div>
  `;
}

function renderFencingConfig(state) {
  const resultOptions = ['success', 'failed', 'unreachable']
    .map((result) => `<option value="${result}" ${state.fencing.expectedResult === result ? 'selected' : ''}>${result}</option>`)
    .join('');

  return `
    <div class="stack" data-role="fencing-config">
      <label class="config-row"><span>enabled</span><input data-role="fencing-toggle" data-path="enabled" type="checkbox" ${state.fencing.enabled ? 'checked' : ''}></label>
      <div class="config-row"><span>driver</span><span class="status-chip">driver ${state.fencing.driver}</span></div>
      <label class="config-row"><span>expected result</span><select data-role="fencing-result" data-path="expectedResult">${resultOptions}</select></label>
      <div class="config-row"><span>status</span><span class="status-chip ${statusClass(state.fencing.status)}">${state.fencing.status}</span></div>
      <div class="config-row"><span>verify_power_off</span><span class="status-chip">${state.fencing.verifyPowerOff}</span></div>
      <div class="help-text">Redfish fencing is optional in the simulator. Best practice is to require successful fencing before evacuation.</div>
    </div>
  `;
}

function renderMasakariConfig(state) {
  return `
    <div class="config-row"><span>duplicate_notification_detection_interval</span><span class="status-chip">${state.masakariConfig.duplicateNotificationDetectionInterval}</span></div>
    <div class="config-row"><span>wait_period_after_service_update</span><span class="status-chip">${state.masakariConfig.waitPeriodAfterServiceUpdate}</span></div>
    <div class="config-row"><span>host_failure_recovery_threads</span><span class="status-chip">${state.masakariConfig.hostFailureRecoveryThreads}</span></div>
    <div class="config-row"><span>evacuate_all_instances</span><span class="status-chip">${state.masakariConfig.hostFailure.evacuateAllInstances}</span></div>
    <div class="config-row"><span>service_disable_reason</span><span class="status-chip">${state.masakariConfig.hostFailure.serviceDisableReason}</span></div>
  `;
}

function renderWatcherConfig(state) {
  return `
    <label class="config-row"><span>enabled</span><input data-role="watcher-toggle" data-path="enabled" type="checkbox" ${state.watcher.enabled ? 'checked' : ''}></label>
    <label class="config-row"><span>auditRunning</span><input data-role="watcher-toggle" data-path="auditRunning" type="checkbox" ${state.watcher.auditRunning ? 'checked' : ''}></label>
    <label class="config-row"><span>actionPlanPending</span><input data-role="watcher-toggle" data-path="actionPlanPending" type="checkbox" ${state.watcher.actionPlanPending ? 'checked' : ''}></label>
    <label class="config-row"><span>migrationTouchingVm</span><input data-role="watcher-toggle" data-path="migrationTouchingVm" type="checkbox" ${state.watcher.migrationTouchingVm ? 'checked' : ''}></label>
    <label class="config-row"><span>placementPressure</span><input data-role="watcher-toggle" data-path="placementPressure" type="checkbox" ${state.watcher.placementPressure ? 'checked' : ''}></label>
    <div class="config-row"><span>notification_topics</span><span class="status-chip">${state.watcher.decisionEngine.notificationTopics.join(', ')}</span></div>
    <div class="config-row"><span>workflow_engine</span><span class="status-chip">${state.watcher.applier.workflowEngine}</span></div>
    <div class="config-row"><span>placement_client.api_version</span><span class="status-chip">${state.watcher.placementClient.apiVersion}</span></div>
  `;
}

function renderEventLog(state) {
  return state.eventLog.slice(-12).map((entry) => `
    <li><strong>${entry.stage}</strong> #${entry.tick}: ${entry.message}</li>
  `).join('');
}

function renderSummary(state) {
  const vector = state.currentVector ? state.currentVector.stable.map((value) => value ?? 'unstable').join(' / ') : 'нет данных';
  const action = state.currentMatrixResult ? state.currentMatrixResult.action.join(', ') || '[]' : 'нет данных';
  const fencing = state.fencing.enabled ? state.fencing.status : 'disabled';
  const notification = state.notifications.at(-1)?.status ?? 'нет';
  const vmoves = state.vmoves.length === 0 ? 'нет' : state.vmoves.map((vmove) => `${vmove.instanceName}:${vmove.status}`).join(', ');

  return `Health ${vector} -> Matrix ${action} -> Fencing ${fencing} -> Notification ${notification} -> VMoves ${vmoves}`;
}

function setByPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;

  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part];
  }

  cursor[parts.at(-1)] = value;
}

export function renderApp(root, state, dispatch) {
  root.innerHTML = `
    <section class="panel controls-panel stack">
      <h2>Сценарии</h2>
      <select data-role="scenario-select">${renderScenarioOptions(state.scenarioId)}</select>
      <h3>Как пользоваться</h3>
      ${renderUsageGuide()}
      <details class="panel-section" open>
        <summary>Matrix</summary>
        <div class="matrix-table" data-role="matrix">${renderMatrix(state)}</div>
      </details>
      <h3>Health vector</h3>
      ${renderHealthVector(state)}
      <details class="panel-section" open>
        <summary>Fencing</summary>
        ${renderFencingConfig(state)}
      </details>
      <details class="panel-section">
        <summary>Сети и интерфейсы</summary>
        ${renderNetworkLegend(state)}
      </details>
      <details class="panel-section">
        <summary>Masakari monitor</summary>
        ${renderMonitorConfig(state)}
      </details>
      <details class="panel-section">
        <summary>Masakari recovery</summary>
        ${renderMasakariConfig(state)}
      </details>
      <details class="panel-section">
        <summary>Watcher</summary>
        ${renderWatcherConfig(state)}
      </details>
    </section>
    <section class="panel topology-panel stack">
      <h2>Топология</h2>
      <div class="topology" data-role="topology">${state.hosts.map(renderHost).join('')}</div>
    </section>
    <section class="panel step-panel stack">
      <h2>Текущий шаг</h2>
      <p>${state.currentExplanation}</p>
      <h3>Предупреждения</h3>
      <ul class="log-list">${state.warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul>
      <h3>Журнал</h3>
      <ul class="log-list" data-role="event-log">${renderEventLog(state)}</ul>
    </section>
    <section class="toolbar">
      <button type="button" data-role="reset">Сброс</button>
      <button type="button" data-role="step">Шаг</button>
      <span class="status-chip">${renderSummary(state)}</span>
    </section>
  `;

  root.querySelector('[data-role="scenario-select"]').addEventListener('change', (event) => {
    dispatch({ type: 'scenario', scenarioId: event.target.value });
  });

  root.querySelector('[data-role="reset"]').addEventListener('click', () => {
    dispatch({ type: 'reset' });
  });

  root.querySelector('[data-role="step"]').addEventListener('click', () => {
    dispatch({ type: 'step' });
  });

  for (const button of root.querySelectorAll('[data-role="interface-toggle"]')) {
    button.addEventListener('click', () => {
      dispatch({ type: 'toggle-interface', host: button.dataset.host, layer: button.dataset.layer });
    });
  }

  for (const button of root.querySelectorAll('[data-role="matrix-toggle"]')) {
    button.addEventListener('click', () => {
      dispatch({ type: 'matrix-toggle', row: Number(button.dataset.row) });
    });
  }

  for (const input of root.querySelectorAll('[data-role="config-number"]')) {
    input.addEventListener('change', () => {
      dispatch({
        type: 'config-number',
        path: input.dataset.path,
        value: Number(input.value)
      });
    });
  }

  for (const input of root.querySelectorAll('[data-role="watcher-toggle"]')) {
    input.addEventListener('change', () => {
      dispatch({
        type: 'watcher-toggle',
        path: input.dataset.path,
        value: input.checked
      });
    });
  }

  for (const input of root.querySelectorAll('[data-role="fencing-toggle"]')) {
    input.addEventListener('change', () => {
      dispatch({
        type: 'fencing-update',
        path: input.dataset.path,
        value: input.checked
      });
    });
  }

  for (const select of root.querySelectorAll('[data-role="fencing-result"]')) {
    select.addEventListener('change', () => {
      dispatch({
        type: 'fencing-update',
        path: select.dataset.path,
        value: select.value
      });
    });
  }
}

export function createAppController(root, initialScenarioId = 'healthy-baseline') {
  let state = createSimulation(initialScenarioId);

  function dispatch(action) {
    if (action.type === 'scenario') {
      state = createSimulation(action.scenarioId);
    }

    if (action.type === 'reset') {
      state = resetSimulation(state);
    }

    if (action.type === 'step') {
      stepSimulation(state);
    }

    if (action.type === 'toggle-interface') {
      toggleInterface(state, action.host, action.layer);
    }

    if (action.type === 'matrix-toggle') {
      const rule = state.matrix[action.row];
      rule.action = rule.action.includes('recovery') ? [] : ['recovery'];
      state.phase = 'consul-observe';
      state.currentExplanation = `matrix cell ${formatVector(rule.health)} changed to ${formatAction(rule.action)}`;
    }

    if (action.type === 'config-number') {
      setByPath(state, action.path, action.value);
      state.phase = 'consul-observe';
      state.currentExplanation = `${action.path} changed to ${action.value}`;
    }

    if (action.type === 'watcher-toggle') {
      state.watcher[action.path] = action.value;
      state.currentExplanation = `watcher.${action.path} changed to ${action.value}`;
    }

    if (action.type === 'fencing-update') {
      state.fencing[action.path] = action.value;
      state.fencing.status = 'not-run';
      state.fencing.lastError = '';
      state.phase = 'consul-observe';
      state.currentExplanation = `fencing.${action.path} changed to ${action.value}`;
    }

    renderApp(root, state, dispatch);
  }

  renderApp(root, state, dispatch);
  return { getState: () => state, dispatch };
}
