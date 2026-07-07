import { access, readFile } from 'node:fs/promises';
import { createSimulation, stepSimulation } from '../src/simulation.mjs';
import { listScenarios } from '../src/scenarios.mjs';
import { renderApp } from '../src/ui.mjs';

class FakeRoot {
  innerHTML = '';

  querySelector(selector) {
    const marker = selector.slice(1, -1);
    if (!this.innerHTML.includes(marker)) {
      throw new Error(`rendered UI must contain ${selector}`);
    }

    return { addEventListener() {} };
  }

  querySelectorAll(selector) {
    const marker = selector.slice(1, -1);
    const count = this.innerHTML.split(marker).length - 1;
    return Array.from({ length: count }, () => ({
      checked: false,
      dataset: {},
      value: '',
      addEventListener() {}
    }));
  }
}

const requiredFiles = [
  'index.html',
  'styles.css',
  'src/main.mjs',
  'src/ui.mjs',
  'src/simulation.mjs'
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url));
}

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

if (!html.includes('id="app"')) {
  throw new Error('index.html must contain #app root');
}

if (!html.includes('src="./src/main.mjs"')) {
  throw new Error('index.html must load ./src/main.mjs');
}

const renderedRoot = new FakeRoot();
renderApp(renderedRoot, createSimulation('healthy-baseline'), () => {});

const requiredUiMarkers = [
  'class="panel controls-panel stack"',
  'class="panel topology-panel stack"',
  'class="panel step-panel stack"',
  'data-role="scenario-select"',
  'data-role="step"',
  'data-role="topology"',
  'data-role="event-log"',
  'data-role="interface-toggle" data-host="compute-1"',
  'data-role="interface-readonly" data-host="compute-2"',
  'destination interfaces are read-only',
  'data-role="matrix-toggle"',
  'data-role="config-number"',
  'data-role="watcher-toggle"',
  'data-role="health-vector"',
  'Как пользоваться',
  'Включите Redfish fencing',
  'Если нужно проверить другую policy',
  'class="list-note"',
  'Это меняет policy, а не состояние интерфейсов',
  'sequence: [manage, tenant, storage]',
  'policy: default matrix',
  '2 x 2 x 2 = 8',
  'data-role="matrix-rule"',
  'health: [up, up, up]',
  'health: [up, up, down]',
  'manage up',
  'tenant down',
  'storage down',
  'Сети и интерфейсы',
  'сеть управления',
  'пользовательский трафик VM',
  'доступ к хранилищу',
  '<summary>Fencing</summary>',
  'data-role="fencing-toggle"',
  'data-role="fencing-result"',
  'driver redfish',
  '<option value="unreachable" >unreachable</option>',
  '<details class="panel-section" open>',
  '<details class="panel-section">',
  '<summary>Masakari monitor</summary>',
  '<summary>Watcher</summary>',
  'data-role="pipeline-step"',
  'Consul observe',
  'Health vector',
  'Matrix match',
  'Redfish fencing',
  'Masakari notification',
  'Taskflow',
  'Nova evacuate',
  'pipeline-step active',
  'pipeline-step pending',
  'Сброс',
  'Шаг'
];

for (const expected of requiredUiMarkers) {
  if (!renderedRoot.innerHTML.includes(expected)) {
    throw new Error(`rendered UI must contain ${expected}`);
  }
}

if (renderedRoot.innerHTML.indexOf('<h3>Health vector</h3>') > renderedRoot.innerHTML.indexOf('<summary>Fencing</summary>')) {
  throw new Error('Fencing panel must render below Health vector');
}

if (renderedRoot.innerHTML.includes('data-role="matrix-plane"')) {
  throw new Error('Matrix must not privilege one interface as a fixed plane');
}

if (renderedRoot.innerHTML.includes('data-role="interface-toggle" data-host="compute-2"')) {
  throw new Error('Destination host interfaces must be read-only');
}

const redfishSuccessRoot = new FakeRoot();
renderApp(redfishSuccessRoot, createSimulation('redfish-fencing-success'), () => {});

for (const expected of [
  'data-role="fencing-toggle" data-path="enabled" type="checkbox" checked',
  'driver redfish',
  '<option value="success" selected>success</option>'
]) {
  if (!redfishSuccessRoot.innerHTML.includes(expected)) {
    throw new Error(`redfish fencing UI must contain ${expected}`);
  }
}

const redfishFailedState = createSimulation('redfish-fencing-failed');
for (let i = 0; i < 4; i += 1) {
  stepSimulation(redfishFailedState);
}

const redfishFailedRoot = new FakeRoot();
renderApp(redfishFailedRoot, redfishFailedState, () => {});

for (const expected of [
  'Redfish fencing',
  'pipeline-step blocked',
  'Masakari notification',
  'pipeline-step pending'
]) {
  if (!redfishFailedRoot.innerHTML.includes(expected)) {
    throw new Error(`redfish failed pipeline must contain ${expected}`);
  }
}

const customPolicyRoot = new FakeRoot();
renderApp(customPolicyRoot, createSimulation('custom-matrix-policy'), () => {});

for (const expected of [
  'policy: custom matrix',
  'matrix-cell changed',
  'health: [up, down, up] action: [recovery]'
]) {
  if (!customPolicyRoot.innerHTML.includes(expected)) {
    throw new Error(`custom matrix UI must contain ${expected}`);
  }
}

const state = createSimulation('storage-isolated');
for (let i = 0; i < 5; i += 1) {
  stepSimulation(state);
}

if (state.notifications.length !== 1) {
  throw new Error('storage-isolated scenario must create one notification after stepping');
}

for (const scenario of listScenarios()) {
  const scenarioState = createSimulation(scenario.id);
  for (let i = 0; i < 10; i += 1) {
    stepSimulation(scenarioState);
  }

  if (!scenarioState.currentExplanation) {
    throw new Error(`scenario ${scenario.id} must have current explanation`);
  }
}

console.log('static smoke ok');
