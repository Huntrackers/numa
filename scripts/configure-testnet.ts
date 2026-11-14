import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const m = JSON.parse(readFileSync('docs/TESTNET_DEPLOYMENT.json', 'utf8'));
let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
const settings: Record<string, string> = {
  NEAR_NETWORK: 'testnet',
  NEAR_RPC_URL: 'https://test.rpc.fastnear.com',
  NEAR_CONTRACT_ID: m.contractId,
  NEAR_EXECUTOR_ACCOUNT: m.executor,
  NEAR_EXECUTOR_KEY_FILE: './data/testnet-keys/executor.json',
  OLLAMA_MODEL: 'qwen2.5:1.5b',
};
for (const [key, value] of Object.entries(settings)) {
  const line = key + '=' + value;
  const regex = new RegExp('^' + key + '=.*$', 'm');
  env = regex.test(env) ? env.replace(regex, line) : env + '\n' + line;
}
writeFileSync('.env', env);
console.log(
  'Configured testnet contract, separate executor key file and local model. No private key was printed.',
);
