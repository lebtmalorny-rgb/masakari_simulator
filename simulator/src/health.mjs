const SUPPORTED_HEALTH = new Set(['up', 'down']);
const SUPPORTED_ACTIONS = new Set(['recovery']);

export function consulStatusToHealth(status) {
  return status === 1 || status === 'up' ? 'up' : 'down';
}

export function addConsulObservation(history, hostName, layer, status) {
  history[hostName] ??= {};
  history[hostName][layer] ??= [];
  history[hostName][layer].push(consulStatusToHealth(status));
  return history[hostName][layer];
}

export function computeStableVector(history, hostName, sequence, monitoringSamples) {
  const hostHistory = history[hostName] ?? {};
  const raw = {};
  const stable = [];
  const unstableDimensions = [];

  for (const layer of sequence) {
    const samples = hostHistory[layer] ?? [];
    const window = samples.slice(-monitoringSamples);
    raw[layer] = [...samples];

    if (window.length < monitoringSamples) {
      stable.push(null);
      unstableDimensions.push(layer);
      continue;
    }

    const unique = new Set(window);
    if (unique.size === 1) {
      stable.push(window[0]);
    } else {
      stable.push(null);
      unstableDimensions.push(layer);
    }
  }

  return {
    sequence: [...sequence],
    raw,
    stable,
    unstableDimensions,
    ready: unstableDimensions.length === 0
  };
}

export function evaluateMatrix(matrix, vector) {
  if (vector.some((value) => value === null)) {
    return {
      matched: false,
      action: [],
      matchedRule: null,
      reason: 'health vector has unstable dimensions'
    };
  }

  const matchedRule = matrix.find(
    (rule) =>
      Array.isArray(rule.health) &&
      Array.isArray(rule.action) &&
      rule.health.length === vector.length &&
      rule.health.every((value, index) => value === vector[index])
  );

  if (!matchedRule) {
    return {
      matched: false,
      action: [],
      matchedRule: null,
      reason: 'no matrix row matches stable vector'
    };
  }

  return {
    matched: true,
    action: [...matchedRule.action],
    matchedRule: {
      health: [...matchedRule.health],
      action: [...matchedRule.action]
    },
    reason: matchedRule.action.includes('recovery') ? 'matrix action contains recovery' : 'matrix action is empty'
  };
}

export function validateMatrix(sequence, matrix) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(sequence)) {
    errors.push('sequence must be an array');
    return {
      valid: false,
      errors,
      warnings
    };
  }

  if (!Array.isArray(matrix)) {
    errors.push('matrix must be an array');
    return {
      valid: false,
      errors,
      warnings
    };
  }

  sequence.forEach((layer) => {
    if (!['manage', 'tenant', 'storage'].includes(layer)) {
      warnings.push(`sequence contains experimental layer ${layer}`);
    }
  });

  matrix.forEach((rule, index) => {
    const rowNumber = index + 1;

    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(`row ${rowNumber} must be an object`);
      return;
    }

    if (!Array.isArray(rule.health)) {
      errors.push(`row ${rowNumber} health must be an array`);
    }

    if (!Array.isArray(rule.action)) {
      errors.push(`row ${rowNumber} action must be an array`);
    }

    if (Array.isArray(rule.health) && rule.health.length !== sequence.length) {
      errors.push(`row ${rowNumber} health length ${rule.health.length} does not match sequence length ${sequence.length}`);
    }

    if (Array.isArray(rule.health)) {
      rule.health.forEach((value) => {
        if (!SUPPORTED_HEALTH.has(value)) {
          errors.push(`row ${rowNumber} has unsupported health value ${value}`);
        }
      });
    }

    if (Array.isArray(rule.action)) {
      rule.action.forEach((action) => {
        if (!SUPPORTED_ACTIONS.has(action)) {
          errors.push(`row ${rowNumber} has unsupported action ${action}`);
        }
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
