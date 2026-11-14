import { api, type ApprovalChallenge } from './api';
import { Buffer } from 'buffer';
import type { NearConnector, WalletManifest } from '@hot-labs/near-connect';
if (!('Buffer' in globalThis)) Object.assign(globalThis, { Buffer });
// The upstream wallet executor is pinned locally. See docs/WALLET_DEPENDENCY.md for provenance and review limits.
const meteor: WalletManifest = {
  id: 'meteor-wallet',
  name: 'Meteor Wallet',
  version: '1.1.1-numa-pinned',
  executor: '/wallet/meteor.js',
  type: 'sandbox',
  icon: '/near.svg',
  description: 'Connect your NEAR testnet account',
  website: 'https://meteorwallet.app/',
  platform: ['web'],
  features: {
    signMessage: true,
    signTransaction: false,
    signAndSendTransaction: true,
    signAndSendTransactions: true,
    signInWithoutAddKey: true,
    signInAndSignMessage: true,
    signInWithFunctionCallKey: false,
    signDelegateActions: false,
    mainnet: false,
    testnet: true,
  },
  permissions: {
    storage: true,
    allowsOpen: [
      'https://wallet.meteorwallet.app',
      'https://meteorwallet.app',
      'meteorwallet://',
      'meteorwalletdev://',
    ],
    external: ['meteorCom', 'meteorComV2'],
  },
};
let connectorPromise: Promise<NearConnector> | undefined;
let walletRequestActive = false;
export function selector() {
  return (connectorPromise ||= import('@hot-labs/near-connect').then(
    ({ NearConnector }) =>
      new NearConnector({
        network: 'testnet',
        autoConnect: false,
        manifest: { wallets: [meteor], version: 'numa-1' },
        features: { testnet: true, signMessage: true, signInWithoutAddKey: true },
        providers: { testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'] },
        cspNonce: document.querySelector<HTMLMetaElement>('meta[name="numa-csp-nonce"]')?.content,
        footerBranding: null,
      }),
  ));
}
async function walletCall<T>(call: () => Promise<T>): Promise<T> {
  if (walletRequestActive) throw new Error('Another wallet request is already in progress.');
  walletRequestActive = true;
  // HOT mounts its sandbox outside React. Native modal dialogs otherwise cover
  // that popup regardless of z-index. Suspend them while the wallet owns focus.
  const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog.dialog[open]'));
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = document.getElementById('root');
  const wasInert = root?.inert || false;
  for (const dialog of dialogs) dialog.close();
  if (root) root.inert = true;
  try {
    return await call();
  } catch (e: any) {
    throw Object.assign(
      new Error(
        e?.message ||
          (typeof e === 'string' ? e : 'Meteor could not complete this request. Please retry.'),
      ),
      { ...(e?.code !== undefined ? { code: e.code } : {}), ...(e?.type ? { type: e.type } : {}) },
    );
  } finally {
    if (root) root.inert = wasInert;
    walletRequestActive = false;
    for (const dialog of dialogs) if (dialog.isConnected && !dialog.open) dialog.showModal();
    requestAnimationFrame(() => {
      const top = dialogs.filter((dialog) => dialog.isConnected && dialog.open).at(-1);
      if (
        previousFocus?.isConnected &&
        top?.contains(previousFocus) &&
        !previousFocus.matches(':disabled')
      )
        previousFocus.focus();
    });
  }
}
export async function connectWallet() {
  const connector = await selector();
  const wallet = await walletCall(() => connector.connect({ walletId: 'meteor-wallet' }));
  const accounts = await wallet.getAccounts({ network: 'testnet' });
  const accountId = accounts.find((a) => a.accountId)?.accountId;
  if (!accountId) throw new Error('Meteor did not return a NEAR testnet account.');
  return accountId;
}
export async function disconnectWallet() {
  await (await selector()).disconnect();
}
export async function signInWallet() {
  const accountId = await connectWallet();
  const wallet = await (await selector()).wallet('meteor-wallet');
  const c = await api('/auth/challenges', {
    method: 'POST',
    body: JSON.stringify({ walletId: 'meteor-wallet' }),
  });
  const result = await walletCall(() =>
    wallet.signMessage({
      message: c.message,
      recipient: c.recipient,
      nonce: Buffer.from(c.nonce, 'base64'),
      network: 'testnet',
      signerId: accountId,
    }),
  );
  if (result.accountId !== accountId)
    throw new Error('The signing account changed. Connect again.');
  return api('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      challengeId: c.id,
      accountId: result.accountId,
      publicKey: result.publicKey,
      signature: result.signature,
    }),
  });
}
export async function signDecisionApproval(c: ApprovalChallenge) {
  if (c.network !== 'testnet' || c.recipient !== location.host)
    throw new Error('The approval recipient or network does not match this application.');
  if (!Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= Date.now())
    throw new Error('This approval expired. Review the decision again.');
  if (Buffer.from(c.nonce, 'base64').length !== 32)
    throw new Error('The approval nonce is invalid.');
  const accountId = await connectWallet();
  if (accountId !== c.accountId)
    throw new Error('Connect ' + c.accountId + ' to approve this decision.');
  const wallet = await (await selector()).wallet('meteor-wallet');
  const result = await walletCall(() =>
    wallet.signMessage({
      message: c.message,
      recipient: c.recipient,
      nonce: Buffer.from(c.nonce, 'base64'),
      network: 'testnet',
      signerId: accountId,
    }),
  );
  if (result.accountId !== accountId)
    throw new Error('The signing account changed. Review this decision again.');
  // The signature is carried only on this request, never in a URL or browser storage.
  return Buffer.from(
    JSON.stringify({
      challengeId: c.id,
      accountId: result.accountId,
      publicKey: result.publicKey,
      signature: result.signature,
    }),
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
// Compatibility with a pending sign-in created before the Meteor migration.
export async function completeWalletCallback() {
  const params = new URLSearchParams(location.hash.slice(1));
  const challengeId = sessionStorage.getItem('noma-challenge');
  if (!challengeId || !params.has('signature')) return null;
  const result = await api('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      challengeId,
      accountId: params.get('accountId'),
      publicKey: params.get('publicKey'),
      signature: params.get('signature'),
    }),
  });
  history.replaceState({}, '', location.pathname);
  sessionStorage.removeItem('noma-challenge');
  return result;
}
export async function sendTransaction(transaction: {
  signerId: string;
  receiverId: string;
  actions: {
    type: 'FunctionCall';
    params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
  }[];
}) {
  if (transaction.actions.length !== 1 || transaction.actions[0].type !== 'FunctionCall')
    throw new Error('Only a single prepared contract call is supported.');
  const accountId = await connectWallet();
  if (accountId !== transaction.signerId)
    throw new Error('Select the NEAR account that approved this operation.');
  const wallet = await (await selector()).wallet('meteor-wallet');
  return walletCall(() => wallet.signAndSendTransaction({ ...transaction, network: 'testnet' }));
}
