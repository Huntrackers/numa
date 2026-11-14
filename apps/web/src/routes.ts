const pages = {
  company: [
    'overview',
    'employees',
    'roles',
    'payroll',
    'treasury',
    'reports',
    'assistant',
    'settings',
    'network',
  ],
  employee: [
    'overview',
    'salary',
    'wallets',
    'rules',
    'goals',
    'dca',
    'invest',
    'portfolio',
    'money-plan',
    'flexible-payday',
    'borrow',
    'assistant',
    'network',
  ],
  admin: ['companies', 'users', 'automation', 'integrations', 'settings', 'audit', 'network'],
};

export function isKnownRoute(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return true;
  if (['login', 'trust', 'network'].includes(parts[0])) return parts.length === 1;
  if (parts[0] === 'workspaces')
    return parts.length === 1 || (parts.length === 2 && parts[1] === 'new');
  if (parts[0] === 'invite') return parts.length === 2;
  if (parts[0] === 'company')
    return parts.length >= 2 && parts.length <= 3 && pages.company.includes(parts[2] || 'overview');
  if (parts[0] === 'employee' || parts[0] === 'admin')
    return (
      parts.length <= 2 &&
      pages[parts[0]].includes(parts[1] || (parts[0] === 'admin' ? 'companies' : 'overview'))
    );
  return false;
}

// Only local, known product routes survive an identity round-trip.
export function safeReturnPath(value: string | null | undefined, fallback = '/workspaces') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value))
    return fallback;
  try {
    const url = new URL(value, 'https://numa.invalid');
    if (
      url.origin !== 'https://numa.invalid' ||
      !isKnownRoute(url.pathname) ||
      ['/', '/login'].includes(url.pathname)
    )
      return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
