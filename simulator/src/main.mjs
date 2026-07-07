import { createAppController } from './ui.mjs';

const root = document.querySelector('#app');

if (!root) {
  throw new Error('Missing #app root');
}

createAppController(root, 'healthy-baseline');
