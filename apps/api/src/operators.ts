// Configuration is authoritative on every privileged request, including an existing session.
export function operatorAccount(accountId?: string) {
  return (
    !!accountId &&
    (process.env.NUMA_ADMIN_ACCOUNTS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .includes(accountId)
  );
}
