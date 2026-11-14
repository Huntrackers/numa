import { randomUUID } from 'node:crypto';
import { Store } from '../../../packages/db/src/index.js';
import { Service } from '../../api/src/service.js';
export function tick(s: Store, workerId: string = randomUUID(), at = new Date().toISOString()) {
  const service = new Service(s);
  const bookEnabled = (tenant: string) => {
    const c = s.get(tenant);
    return (
      c?.status !== 'ARCHIVED' &&
      (process.env.DEMO_ENABLED !== 'false' || c?.mode !== 'SIMULATION' || c?.personal)
    );
  };
  if (s.get('settings')?.maintenance || s.get('settings')?.pauseDemoWorker) {
    s.atomic(() =>
      s.save({
        id: 'worker-heartbeat',
        type: 'system',
        workerId,
        lastSeen: at,
        state: s.get('settings')?.maintenance ? 'MAINTENANCE' : 'PAUSED',
      }),
    );
    return;
  }
  s.atomic(() => service.promoteSalaries(at));
  const ids = s.db
    .prepare(
      "SELECT id FROM outbox WHERE (status IN ('PENDING','RETRY') AND available_at<=?) OR (status='RUNNING' AND lease_until<?) LIMIT 30",
    )
    .all(at, at) as any[];
  for (const row of ids) {
    let job: any;
    try {
      s.atomic(() => {
        job = s.db.prepare('SELECT * FROM outbox WHERE id=?').get(row.id) as any;
        if (job.status === 'DONE' || job.available_at > at) return;
        const lease = new Date(new Date(at).getTime() + 60000).toISOString();
        s.db
          .prepare(
            "UPDATE outbox SET status='RUNNING',lease_until=?,worker=?,attempts=attempts+1 WHERE id=?",
          )
          .run(lease, workerId, row.id);
        const p = JSON.parse(job.payload);
        const subject = s.get(p.obligationId || p.id);
        if (subject?.tenant && !bookEnabled(subject.tenant)) {
          s.db
            .prepare(
              "UPDATE outbox SET status='DONE',lease_until=NULL,last_error='Archived planning book' WHERE id=?",
            )
            .run(row.id);
          return;
        }
        if (job.kind === 'PAYROLL') {
          const o = s.get(p.obligationId)!;
          service.creditSalary(o);
        } else if (job.kind === 'HOLD') {
          const h = s.get(p.id)!;
          if (h.state === 'ACTIVE') service.exitHold(h);
        }
        s.db
          .prepare("UPDATE outbox SET status='DONE',lease_until=NULL,last_error=NULL WHERE id=?")
          .run(row.id);
      });
    } catch (e: any) {
      const paused = e.code === 'PAUSED';
      const attempts = (job?.attempts || 0) + 1;
      const delay = paused ? 30000 : [5000, 15000, 60000, 300000][Math.min(attempts - 1, 3)];
      s.db
        .prepare(
          'UPDATE outbox SET status=?,available_at=?,lease_until=NULL,last_error=? WHERE id=?',
        )
        .run(
          !paused && attempts >= 8 ? 'FAILED' : 'RETRY',
          new Date(Date.now() + delay + Math.floor(Math.random() * 1000)).toISOString(),
          String(e.code || e.message).slice(0, 200),
          row.id,
        );
    }
  }
  s.atomic(() => {
    for (const d of s
      .list('dca')
      .filter((d) => d.state === 'ACTIVE' && d.nextDue <= at && bookEnabled(d.tenant)))
      service.runDca(d, at);
    for (const l of s.list('loan').filter((l) => l.state === 'ACTIVE' && bookEnabled(l.tenant)))
      service.accrueLoan(l, at);
    s.save({ id: 'worker-heartbeat', type: 'system', workerId, lastSeen: at, state: 'RUNNING' });
  });
}
