import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hash } from '../packages/domain/src/index.js';
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEAR_NETWORK', 'testnet');
  vi.stubEnv('NEAR_RPC_URL', 'https://rpc-fixture.example');
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const response = (result: unknown) => ({ ok: true, json: async () => ({ result }) });
const finalTx = () => ({
  final_execution_status: 'FINAL',
  status: { SuccessValue: '' },
  transaction: {
    signer_id: 'employee.testnet',
    receiver_id: 'vault.testnet',
    actions: [
      {
        FunctionCall: {
          method_name: 'claim_due',
          args: Buffer.from(JSON.stringify({ obligation_id: 'o1' })).toString('base64'),
          deposit: '0',
        },
      },
    ],
  },
  transaction_outcome: {
    block_hash: 'block',
    outcome: { status: { SuccessReceiptId: 'receipt' }, logs: [] },
  },
  receipts_outcome: [{ outcome: { status: { SuccessValue: '' }, logs: [] } }],
});
const prepared = {
  contractId: 'vault.testnet',
  method: 'claim_due',
  argsHash: hash({ obligation_id: 'o1' }),
  deposit: '0',
};
function failedWithdrawal(company = false) {
  const args = {
    amount: '25',
    operation_id: 'withdrawal-1',
    ...(company ? { company_id: 'company-1' } : {}),
  };
  const method = company ? 'withdraw_company_surplus' : 'request_withdrawal';
  const tx: any = finalTx();
  tx.transaction.actions[0].FunctionCall = {
    method_name: method,
    args: Buffer.from(JSON.stringify(args)).toString('base64'),
    deposit: '0',
  };
  tx.status = { SuccessValue: Buffer.from('false').toString('base64') };
  tx.receipts_outcome = [
    { id: 'receipt', outcome: { status: { SuccessReceiptId: 'callback' }, logs: [] } },
    { id: 'transfer', outcome: { status: { Failure: { ActionError: {} } }, logs: [] } },
    { id: 'callback', outcome: { status: tx.status, logs: [] } },
  ];
  return { tx, op: { ...prepared, method, argsHash: hash(args) } };
}
describe('testnet RPC and finalized receipt boundary', () => {
  it('rejects mainnet before sending a request', async () => {
    vi.stubEnv('NEAR_NETWORK', 'mainnet');
    const { rpc } = await import('../packages/near-adapter/src/rpc.js');
    await expect(rpc('query', {})).rejects.toThrow('only permits NEAR testnet');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a provider that reports another chain', async () => {
    fetcher.mockResolvedValue(response({ chain_id: 'mainnet' }));
    const { rpc } = await import('../packages/near-adapter/src/rpc.js');
    await expect(rpc('query', {})).rejects.toThrow('not NEAR testnet');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('verifies a provider once during the short cache and keeps finality final', async () => {
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response({ result: [123, 125] }));
    const { view } = await import('../packages/near-adapter/src/rpc.js');
    await view('vault.testnet', 'get_state', {});
    await view('vault.testnet', 'get_state', {});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[2][1].body).params.finality).toBe('final');
  });
  it('rejects a final transaction with a changed recipient', async () => {
    const tx = finalTx();
    tx.transaction.receiver_id = 'other.testnet';
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response(tx));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toThrow(
      'does not match',
    );
  });
  it('rejects a changed deposit despite a successful transaction', async () => {
    const tx = finalTx();
    tx.transaction.actions[0].FunctionCall.deposit = '1';
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response(tx));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toThrow(
      'deposit do not match',
    );
  });
  it.each([99, 100])('rejects a matching receipt at stale block height %s', async (height) => {
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValueOnce(response(finalTx()))
      .mockResolvedValueOnce(response({ header: { height } }));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(
      confirmOperation('hash', 'employee.testnet', { ...prepared, minimumBlockHeight: 100 }),
    ).rejects.toMatchObject({ code: 'TRANSACTION_MISMATCH' });
  });
  it('accepts a matching receipt after the finalized preparation anchor', async () => {
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValueOnce(response(finalTx()))
      .mockResolvedValueOnce(response({ header: { height: 101 } }));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(
      confirmOperation('hash', 'employee.testnet', { ...prepared, minimumBlockHeight: 100 }),
    ).resolves.toMatchObject({ state: 'CONFIRMED' });
    expect(JSON.parse(fetcher.mock.calls[2][1].body).params).toEqual({ block_id: 'block' });
  });
  it('uses a finalized chain block instead of the server clock for preparation', async () => {
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValueOnce(response({ header: { height: 100, hash: 'prepared-block' } }));
    const { operationAnchor } = await import('../packages/near-adapter/src/rpc.js');
    await expect(operationAnchor()).resolves.toEqual({
      minimumBlockHeight: 100,
      preparedBlockHash: 'prepared-block',
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).params).toEqual({ finality: 'final' });
  });
  it('rejects failed downstream receipts and accepts a matching final transaction', async () => {
    const bad: any = finalTx();
    bad.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValueOnce(response(bad))
      .mockResolvedValue(response(finalTx()));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toThrow(
      'receipt failed',
    );
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).resolves.toMatchObject({
      state: 'CONFIRMED',
      blockHash: 'block',
    });
  });

  it('identifies rollback only when the initial receiver receipt failed', async () => {
    const tx: any = finalTx();
    tx.status = { Failure: { ActionError: {} } };
    tx.receipts_outcome = [
      {
        id: 'receipt',
        outcome: {
          executor_id: 'vault.testnet',
          status: { Failure: { ActionError: {} } },
          logs: [],
        },
      },
    ];
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response(tx));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toMatchObject({
      code: 'CHAIN_CALL_FAILED',
    });
  });

  it('keeps a callback failure distinct from a rolled-back initial contract call', async () => {
    const tx: any = finalTx();
    tx.status = { Failure: { ActionError: {} } };
    tx.receipts_outcome = [
      { id: 'receipt', outcome: { status: { SuccessReceiptId: 'callback' }, logs: [] } },
      { id: 'transfer', outcome: { status: { SuccessValue: '' }, logs: [] } },
      { id: 'callback', outcome: { status: { Failure: { ActionError: {} } }, logs: [] } },
    ];
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response(tx));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toMatchObject({
      code: 'CHAIN_FAILURE',
    });
  });

  it('never assumes rollback when the initial receipt linkage is missing', async () => {
    const tx: any = finalTx();
    tx.transaction_outcome.outcome.status = { SuccessValue: '' };
    tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: {} } };
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response(tx));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', prepared)).rejects.toMatchObject({
      code: 'CHAIN_FAILURE',
    });
  });

  it.each([false, true])(
    'recognizes a finalized, matching withdrawal refund (company=%s)',
    async (company) => {
      const { tx, op } = failedWithdrawal(company);
      fetcher
        .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
        .mockResolvedValueOnce(response(tx))
        .mockResolvedValueOnce(
          response({
            result: Array.from(
              Buffer.from(
                JSON.stringify({
                  account_id: 'employee.testnet',
                  amount: '25',
                  company_id: company ? 'company-1' : null,
                  state: 'FAILED',
                }),
              ),
            ),
          }),
        );
      const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
      await expect(confirmOperation('hash', 'employee.testnet', op)).rejects.toMatchObject({
        code: 'CHAIN_TRANSFER_REFUNDED',
      });
      expect(JSON.parse(fetcher.mock.calls[2][1].body).params).toMatchObject({
        finality: 'final',
        method_name: 'get_withdrawal',
      });
    },
  );

  it.each([
    ['pending callback', { state: 'PENDING' }],
    ['successful transfer', { state: 'SUCCEEDED' }],
    ['wrong amount', { amount: '26' }],
    ['wrong beneficiary', { account_id: 'another.testnet' }],
    ['wrong source', { company_id: 'company-1' }],
    ['missing record', null],
  ])('keeps withdrawal recovery locked for %s', async (_name, change) => {
    const { tx, op } = failedWithdrawal();
    const value =
      change === null
        ? null
        : {
            account_id: 'employee.testnet',
            amount: '25',
            company_id: null,
            state: 'FAILED',
            ...change,
          };
    fetcher
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValueOnce(response(tx))
      .mockResolvedValueOnce(response({ result: Array.from(Buffer.from(JSON.stringify(value))) }));
    const { confirmOperation } = await import('../packages/near-adapter/src/rpc.js');
    await expect(confirmOperation('hash', 'employee.testnet', op)).rejects.toMatchObject({
      code: 'CHAIN_FAILURE',
    });
  });

  it('shares concurrent network verification instead of sending a burst of status requests', async () => {
    fetcher.mockImplementation(async (_url, init) =>
      response(
        JSON.parse(init.body).method === 'status'
          ? { chain_id: 'testnet' }
          : { result: [123, 125] },
      ),
    );
    const { view } = await import('../packages/near-adapter/src/rpc.js');
    await Promise.all([
      view('vault.testnet', 'get_state', {}),
      view('vault.testnet', 'get_state', {}),
    ]);
    expect(
      fetcher.mock.calls.filter((call) => JSON.parse(call[1].body).method === 'status'),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retries a rate limit within a bound and then uses the verified response', async () => {
    vi.useFakeTimers();
    fetcher
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
        body: { cancel: vi.fn(async () => {}) },
      })
      .mockResolvedValueOnce(response({ chain_id: 'testnet' }))
      .mockResolvedValue(response({ healthy: true }));
    const { rpc } = await import('../packages/near-adapter/src/rpc.js');
    const result = rpc('health', []);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ healthy: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
