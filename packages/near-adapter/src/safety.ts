import { ensure } from '../../domain/src/index.js';
import { Store } from '../../db/src/index.js';
import { rpc } from './rpc.js';
export const reviewedDeployment = {
  contractId: 'noma-vault-mw4ab6ev.testnet',
  codeHash: 'EM4NqrNoxHhDHQkPvVzxvwgrTkjt8mNjHduQqNUHoyvW',
};
const humanMethods = new Set([
  'register_company',
  'register_employee',
  'accept_employment',
  'fund_treasury',
  'fund_treasury_once',
  'authorize_mandate',
  'renew_mandate',
  'replace_future_obligations',
  'pause_mandate',
  'cancel_future_obligation',
  'claim_due',
  'set_goal_policy',
  'set_goal_policy_v2',
  'pause_goal',
  'release_goal',
  'request_withdrawal',
  'withdraw_company_surplus',
  'execute_due',
]);
const exits = new Set(['claim_due', 'release_goal', 'request_withdrawal']);
export type SafetyInput = {
  network: string;
  receiver: string;
  expectedReceiver: string;
  method: string;
  deposit: string;
  agent: boolean;
  limitedKey: boolean;
  keyMethods: string[];
  expectedCodeHash?: string;
  observedCodeHash?: string;
  observedAt: string;
  reconciliation: string;
  paused: boolean;
  now?: number;
};
export function evaluateExecution(input: SafetyInput) {
  const reasons: string[] = [],
    warnings: string[] = [];
  const now = input.now ?? Date.now();
  if (input.network !== 'testnet') reasons.push('WRONG_NETWORK');
  if (!input.receiver || input.receiver !== input.expectedReceiver)
    reasons.push('RECEIVER_NOT_ALLOWED');
  if (!humanMethods.has(input.method) || (input.agent && input.method !== 'execute_due'))
    reasons.push('METHOD_NOT_ALLOWED');
  if (
    !/^(0|[1-9][0-9]{0,59})$/.test(input.deposit) ||
    (input.deposit !== '0' &&
      (!['fund_treasury', 'fund_treasury_once'].includes(input.method) || input.agent))
  )
    reasons.push('ATTACHED_DEPOSIT_NOT_ALLOWED');
  if (
    input.agent &&
    (!input.limitedKey || input.keyMethods.length !== 1 || input.keyMethods[0] !== 'execute_due')
  )
    reasons.push('UNBOUNDED_AGENT_KEY');
  if (
    !Number.isFinite(Date.parse(input.observedAt)) ||
    now - Date.parse(input.observedAt) > 20000 ||
    Date.parse(input.observedAt) > now + 5000 ||
    !input.observedCodeHash
  )
    reasons.push('CONTRACT_OBSERVATION_STALE');
  if (input.expectedCodeHash && input.expectedCodeHash !== input.observedCodeHash)
    reasons.push('CONTRACT_CODE_CHANGED');
  if (!input.expectedCodeHash) (input.agent ? reasons : warnings).push('CONTRACT_PIN_REQUIRED');
  if (input.reconciliation === 'BLOCKED' && !exits.has(input.method))
    reasons.push('ACCOUNTING_BLOCKED');
  if (input.agent && input.reconciliation !== 'HEALTHY') reasons.push('ACCOUNTING_NOT_READY');
  if (input.paused && (input.agent || !exits.has(input.method))) reasons.push('AUTOMATION_PAUSED');
  return {
    decision: reasons.length ? 'BLOCK' : warnings.length ? 'WARN' : 'ALLOW',
    reasons,
    warnings,
    humanSignatureRequired: !input.agent,
    observedAt: input.observedAt,
    policyVersion: 'numa-execution-v2',
  } as const;
}
export async function observeContract(s: Store, query = rpc) {
  const contract = process.env.NEAR_CONTRACT_ID || '';
  const cached = s.get('contract-observation:' + contract);
  if (cached && Date.now() - Date.parse(cached.observedAt) < 5000) return cached;
  const observed = await query('query', {
    request_type: 'view_account',
    account_id: contract,
    finality: 'final',
  });
  const expected =
    process.env.NEAR_EXPECTED_CODE_HASH ||
    (contract === reviewedDeployment.contractId ? reviewedDeployment.codeHash : undefined);
  return s.atomic(() =>
    s.save({
      id: 'contract-observation:' + contract,
      type: 'system',
      contractId: contract,
      observedCodeHash: observed.code_hash,
      expectedCodeHash: expected,
      blockHash: observed.block_hash,
      blockHeight: observed.block_height,
      observedAt: new Date().toISOString(),
    }),
  );
}
export async function guardExecution(
  s: Store,
  args: { method: string; deposit?: string; receiver?: string; agent?: boolean; owner?: string },
  query = rpc,
) {
  const observation = await observeContract(s, query);
  const key = s.get('testnet-executor'),
    settings = s.get('settings');
  const input: SafetyInput = {
    network: process.env.NEAR_NETWORK || 'testnet',
    receiver: args.receiver || observation.contractId,
    expectedReceiver: process.env.NEAR_CONTRACT_ID || '',
    method: args.method,
    deposit: args.deposit || '0',
    agent: !!args.agent,
    limitedKey: key?.limited === true,
    keyMethods: key?.methods || [],
    expectedCodeHash: observation.expectedCodeHash,
    observedCodeHash: observation.observedCodeHash,
    observedAt: observation.observedAt,
    reconciliation: s.get('chain-sync:' + observation.contractId)?.state || 'UNKNOWN',
    paused: !!(settings?.maintenance || (args.agent && settings?.pauseTestnetWorker)),
  };
  const result = evaluateExecution(input);
  s.atomic(() =>
    s.save({
      type: 'safety-check',
      owner: args.owner || 'system',
      tenant: 'testnet',
      method: args.method,
      receiver: input.receiver,
      agent: input.agent,
      decision: result.decision,
      reasons: result.reasons,
      warnings: result.warnings,
      policyVersion: result.policyVersion,
      codeHash: input.observedCodeHash,
      checkedAt: new Date().toISOString(),
    }),
  );
  ensure(
    result.decision !== 'BLOCK',
    'EXECUTION_POLICY_BLOCKED',
    'Execution blocked by policy: ' + result.reasons.join(', '),
    409,
  );
  return result;
}
export function policyDrills() {
  const base: SafetyInput = {
    network: 'testnet',
    receiver: 'vault.testnet',
    expectedReceiver: 'vault.testnet',
    method: 'execute_due',
    deposit: '0',
    agent: true,
    limitedKey: true,
    keyMethods: ['execute_due'],
    expectedCodeHash: 'reviewed-code',
    observedCodeHash: 'reviewed-code',
    observedAt: new Date().toISOString(),
    reconciliation: 'HEALTHY',
    paused: false,
  };
  const cases = [
    { id: 'authorized-payday', title: 'A fully bounded payday', patch: {} },
    {
      id: 'injected-receiver',
      title: 'Prompt injection redirects the recipient',
      patch: { receiver: 'attacker.testnet', method: 'request_withdrawal' },
    },
    {
      id: 'code-drift',
      title: 'Vault code changes after review',
      patch: { observedCodeHash: 'unexpected-code' },
    },
    {
      id: 'full-access',
      title: 'Agent is given a full-access key',
      patch: { limitedKey: false, keyMethods: [] },
    },
    { id: 'mainnet', title: 'Agent attempts a mainnet payment', patch: { network: 'mainnet' } },
    { id: 'deposit', title: 'Agent tries to attach NEAR', patch: { deposit: '1' } },
    { id: 'paused', title: 'Operator pauses automation', patch: { paused: true } },
    {
      id: 'mismatch',
      title: 'Accounting reconciliation finds a mismatch',
      patch: { reconciliation: 'BLOCKED' },
    },
    {
      id: 'unreviewed',
      title: 'No reviewed contract hash is configured',
      patch: { expectedCodeHash: undefined },
    },
  ];
  return cases.map((c) => ({
    id: c.id,
    title: c.title,
    ...evaluateExecution({ ...base, ...c.patch } as SafetyInput),
    kind: 'DETERMINISTIC_POLICY_DRILL',
    signed: false,
  }));
}
