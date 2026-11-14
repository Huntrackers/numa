import { ensure, hash } from '../../domain/src/index.js';
export const network = 'testnet';
let requestTail: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function rawRpc(method: string, params: any) {
  ensure(
    (process.env.NEAR_NETWORK || 'testnet') === 'testnet',
    'MAINNET_DISABLED',
    'This build only permits NEAR testnet.',
  );
  const url = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
  ensure(new URL(url).protocol === 'https:', 'INVALID_RPC', 'RPC must use HTTPS.');
  // Public providers have burst limits. Serialize reads and bound transport retries.
  const pending = requestTail.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(Math.max(0, nextRequestAt - Date.now()));
      nextRequestAt = Date.now() + 400;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: hash([method, Date.now()]), method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if ((r.status === 429 || r.status === 503) && attempt < 2) {
        await r.body?.cancel();
        const suggested = Number(r.headers?.get('retry-after')) * 1000;
        await delay(
          Math.min(3000, Math.max(1000 * 2 ** attempt, Number.isFinite(suggested) ? suggested : 0)),
        );
        continue;
      }
      ensure(
        r.ok,
        'RPC_UNAVAILABLE',
        'The testnet RPC is unavailable (HTTP ' + r.status + ').',
        503,
      );
      const j: any = await r.json();
      ensure(!j.error, 'RPC_ERROR', j.error?.message || 'Testnet RPC request failed.', 503);
      return j.result;
    }
  });
  requestTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}
const checked = new Map<string, number>();
const checking = new Map<string, Promise<void>>();
export async function assertTestnet() {
  const url = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
  if ((checked.get(url) || 0) > Date.now()) return;
  if (checking.has(url)) return checking.get(url);
  const pending = (async () => {
    const status = await rawRpc('status', []);
    ensure(
      status.chain_id === 'testnet',
      'WRONG_CHAIN',
      'The configured RPC is not NEAR testnet.',
      503,
    );
    checked.set(url, Date.now() + 30000);
  })();
  checking.set(url, pending);
  try {
    await pending;
  } finally {
    checking.delete(url);
  }
}
export async function rpc(method: string, params: any) {
  await assertTestnet();
  return rawRpc(method, params);
}
export async function operationAnchor() {
  const block = await rpc('block', { finality: 'final' });
  ensure(
    Number.isSafeInteger(block?.header?.height) && typeof block?.header?.hash === 'string',
    'RPC_UNAVAILABLE',
    'A finalized block is required before preparing a wallet operation.',
    503,
  );
  return { minimumBlockHeight: block.header.height, preparedBlockHash: block.header.hash };
}
export async function viewFinal(contract: string, method: string, args: any) {
  const result = await rpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return {
    value: JSON.parse(Buffer.from(result.result).toString()),
    blockHash: result.block_hash,
    blockHeight: result.block_height,
  };
}
export async function viewAt(contract: string, method: string, args: any, blockHash: string) {
  const result = await rpc('query', {
    request_type: 'call_function',
    block_id: blockHash,
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}
export async function view(contract: string, method: string, args: any) {
  return (await viewFinal(contract, method, args)).value;
}
export async function accountBalance(accountId: string) {
  const r = await rpc('query', {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  return {
    amount: r.amount,
    locked: r.locked,
    storageUsage: r.storage_usage,
    blockHash: r.block_hash,
  };
}
export async function verifyKey(accountId: string, publicKey: string) {
  const r = await rpc('query', {
    request_type: 'view_access_key_list',
    finality: 'final',
    account_id: accountId,
  });
  return r.keys.some(
    (k: any) => k.public_key === publicKey && k.access_key.permission === 'FullAccess',
  );
}
export async function confirmOperation(txHash: string, signerId: string, prepared: any) {
  const r = await rpc('tx', { tx_hash: txHash, sender_account_id: signerId, wait_until: 'FINAL' });
  ensure(
    r.final_execution_status === 'FINAL',
    'RECONCILIATION_REQUIRED',
    'The transaction is not final.',
    409,
  );
  ensure(
    r.transaction.signer_id === signerId && r.transaction.receiver_id === prepared.contractId,
    'TRANSACTION_MISMATCH',
    'The transaction does not match this operation.',
  );
  const actions = r.transaction.actions;
  const fc = actions?.[0]?.FunctionCall;
  ensure(
    actions.length === 1 && fc?.method_name === prepared.method,
    'TRANSACTION_MISMATCH',
    'Unexpected contract action.',
  );
  const args = JSON.parse(Buffer.from(fc.args, 'base64').toString());
  ensure(
    hash(args) === prepared.argsHash && String(fc.deposit) === prepared.deposit,
    'TRANSACTION_MISMATCH',
    'The arguments or deposit do not match.',
  );
  if (prepared.minimumBlockHeight !== undefined) {
    const inclusion = await rpc('block', { block_id: r.transaction_outcome.block_hash });
    ensure(
      Number.isSafeInteger(inclusion?.header?.height) &&
        inclusion.header.height > prepared.minimumBlockHeight,
      'TRANSACTION_MISMATCH',
      'This transaction predates the prepared operation. Verify the transaction from this wallet request.',
      409,
    );
  }
  const receipts = [r.transaction_outcome, ...(r.receipts_outcome || [])];
  // Only failure of the transaction or its initial receiver receipt proves
  // the contract call rolled back. A later transfer/callback failure can
  // follow committed effects and must remain locked for reconciliation.
  const initialReceiptId = r.transaction_outcome?.outcome?.status?.SuccessReceiptId;
  const initialReceipt =
    typeof initialReceiptId === 'string'
      ? (r.receipts_outcome || []).find((x: any) => x.id === initialReceiptId)
      : undefined;
  ensure(
    !r.transaction_outcome?.outcome?.status?.Failure && !initialReceipt?.outcome?.status?.Failure,
    'CHAIN_CALL_FAILED',
    'The contract call failed before committing changes. Review the decision before retrying.',
    409,
  );
  const hasFailedReceipt =
    receipts.some((x: any) => x.outcome.status?.Failure) || r.status?.Failure !== undefined;
  if (
    hasFailedReceipt &&
    ['request_withdrawal', 'withdraw_company_surplus'].includes(prepared.method)
  ) {
    // A failed transfer can be settled by a successful refund callback. Only
    // the matching, finalized withdrawal record proves cash was restored.
    const settled = await view(prepared.contractId, 'get_withdrawal', {
      operation_id: args.operation_id,
    });
    const matches =
      settled?.account_id === signerId &&
      settled?.amount === args.amount &&
      (settled?.company_id ?? null) ===
        (prepared.method === 'withdraw_company_surplus' ? args.company_id : null);
    ensure(
      !(matches && settled.state === 'FAILED'),
      'CHAIN_TRANSFER_REFUNDED',
      'The transfer failed and the contract restored your balance. Discard this decision and create a new withdrawal.',
      409,
    );
  }
  ensure(
    !hasFailedReceipt,
    'CHAIN_FAILURE',
    'A transaction receipt failed. Inspect the testnet explorer.',
    409,
  );
  return {
    state: 'CONFIRMED',
    txHash,
    blockHash: r.transaction_outcome.block_hash,
    logs: receipts.flatMap((x: any) => x.outcome.logs || []),
  };
}
