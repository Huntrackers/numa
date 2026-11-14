import { Store } from './index.js';
export function acquireLease(s: Store, id: string, owner: string, at = Date.now(), ttl = 60000) {
  return s.atomic(() => {
    const previous = s.get(id);
    if (previous?.holder !== owner && Date.parse(previous?.leaseUntil || '') > at) return false;
    s.save({
      id,
      type: 'worker-lease',
      holder: owner,
      leaseUntil: new Date(at + ttl).toISOString(),
    });
    return true;
  });
}
export function releaseLease(s: Store, id: string, owner: string) {
  s.atomic(() => {
    const l = s.get(id);
    if (l?.holder === owner) s.save({ ...l, leaseUntil: new Date(0).toISOString() });
  });
}
