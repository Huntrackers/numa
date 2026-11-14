import { describe, expect, it } from 'vitest';
import { isKnownRoute, safeReturnPath } from '../apps/web/src/routes';

describe('wallet identity return routes', () => {
  it('preserves tenant, invitation and employee book intent', () => {
    for (const route of [
      '/workspaces',
      '/workspaces/new',
      '/company/opaque-id/payroll',
      '/invite/once-only-token',
      '/employee/dca?book=simulation',
      '/admin/network',
    ]) {
      expect(safeReturnPath(route)).toBe(route);
    }
  });
  it('rejects external, malformed, unknown and recursive access routes', () => {
    for (const route of [
      undefined,
      null,
      '',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/',
      '/login?next=/login',
      '/workspaces/fake',
      '/company/a/no-page',
      '/employee/overview\n',
    ]) {
      expect(safeReturnPath(route)).toBe('/workspaces');
    }
    expect(isKnownRoute('/workspaces/new/fake')).toBe(false);
  });
});
