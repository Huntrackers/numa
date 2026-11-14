import 'dotenv/config';
import assert from 'node:assert/strict';
import { localExplanation, modelStatus } from '../packages/agent-tools/src/local-model.js';
const status = await modelStatus();
assert.ok(status.available, 'Start the local Ollama service first');
const reply = await localExplanation(
  'How should I think about my salary allocation?',
  'Available cash and savings goals are held separately. Investing has uncertainty.',
);
assert.ok(reply.available);
assert.ok(
  reply.explanation,
  'The model explanation did not pass the output guard. Deterministic finance remains available.',
);
console.log(
  JSON.stringify(
    { model: reply.model, explanation: reply.explanation, local: true, noFinancialAuthority: true },
    null,
    2,
  ),
);
