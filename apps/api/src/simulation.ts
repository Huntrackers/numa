import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Store, acct } from '../../../packages/db/src/index.js';
import { ensure, hash } from '../../../packages/domain/src/index.js';
import { Service, type Actor } from './service.js';
import type { CommandAction } from '../../../packages/api-contracts/src/index.js';
export class PersonalSimulation {
  service: Service;
  constructor(public s: Store) {
    this.service = new Service(s);
  }
  actor(a: Actor): Actor {
    const u = this.service.user(a);
    ensure(
      a.mode === 'TESTNET' && !u.demo && u.accountId,
      'WALLET_AUTH_REQUIRED',
      'Verify your NEAR identity to open a personal planning book.',
      403,
    );
    const profile = this.s.get('simulation-profile:' + a.id);
    const userId = 'planning-' + hash([a.id, profile?.epoch || 1]).slice(0, 24);
    const tenant = 'simulation-' + userId;
    if (!this.s.get(userId))
      this.s.save({
        id: userId,
        type: 'user',
        name: u.name,
        accountId: u.accountId,
        role: 'employee',
        demo: true,
        verifiedOwner: a.id,
      });
    if (!this.s.get(tenant))
      this.s.atomic(() => {
        this.s.save({
          id: tenant,
          tenant,
          type: 'company',
          owner: userId,
          name: 'Your personal simulation',
          mode: 'SIMULATION',
          unit: 'demoUSD',
          timezone: 'UTC',
          status: 'ACTIVE',
          personal: true,
        });
        this.s.save({
          id: tenant + '-employee',
          type: 'employee',
          tenant,
          owner: userId,
          name: u.name,
          accountId: u.accountId,
          status: 'ACTIVE',
          salary: '0',
          cadence: 'monthly',
          anchor: new Date(Date.now() + 86400000).toISOString(),
          scheduleId: randomUUID(),
          demoIdentity: true,
        });
        this.s.save({
          type: 'policy',
          tenant,
          owner: userId,
          cashFloor: '0',
          legs: [{ id: 'cash', type: 'cash', bps: 10000 }],
        });
      });
    return { id: userId, mode: 'DEMO' };
  }
  state(a: Actor) {
    const b = this.actor(a);
    return {
      ...this.service.state(b, 'employee'),
      personalSimulation: true,
      verifiedIdentity: true,
    };
  }
  command(a: Actor, action: string, payload: unknown, key: string) {
    const resetKey = 'personal-reset:' + a.id + ':' + key;
    if (action === 'simulation.reset') {
      const prior = this.s.db
        .prepare('SELECT * FROM requests WHERE key=? AND actor=?')
        .get(resetKey, a.id) as any;
      if (prior) {
        ensure(
          prior.input_hash === hash(payload),
          'IDEMPOTENCY_CONFLICT',
          'The request input changed.',
          409,
        );
        return JSON.parse(prior.result);
      }
    }
    const b = this.actor(a),
      e = this.service.employee(b);
    if (action === 'simulation.reset') {
      z.object({ confirmation: z.literal('RESET SIMULATION') })
        .strict()
        .parse(payload);
      return this.s.atomic(() => {
        const profile = this.s.get('simulation-profile:' + a.id);
        this.s.save({
          id: 'simulation-profile:' + a.id,
          type: 'simulation-profile',
          owner: a.id,
          epoch: (profile?.epoch || 1) + 1,
        });
        for (const d of this.s.list('dca', e.tenant, b.id)) this.s.save({ ...d, state: 'PAUSED' });
        this.s.save({ ...this.s.get(e.tenant)!, status: 'ARCHIVED' });
        this.s.audit(a.id, e.tenant, 'simulation.reset', b.id);
        const result = { reset: true, previousBook: e.tenant };
        this.s.db
          .prepare('INSERT INTO requests VALUES(?,?,?,?)')
          .run(resetKey, a.id, hash(payload), JSON.stringify(result));
        return result;
      });
    }
    if (action === 'simulation.schedule') {
      const p = z
        .object({
          amount: z.string().regex(/^[1-9][0-9]{0,15}$/),
          earned: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
          dueAt: z.iso.datetime(),
        })
        .strict()
        .parse(payload);
      ensure(
        BigInt(p.earned) <= BigInt(p.amount),
        'INVALID_AMOUNT',
        'Earned salary cannot exceed the scenario salary.',
      );
      ensure(
        Date.parse(p.dueAt) > Date.now() && Date.parse(p.dueAt) <= Date.now() + 31 * 86400000,
        'INVALID_DATE',
        'Choose a future payday within 31 days.',
      );
      const requestKey = 'personal-schedule:' + b.id + ':' + key,
        inputHash = hash(p);
      return this.s.atomic(() => {
        const prior = this.s.db
          .prepare('SELECT * FROM requests WHERE key=? AND actor=?')
          .get(requestKey, a.id) as any;
        if (prior) {
          ensure(
            prior.input_hash === inputHash,
            'IDEMPOTENCY_CONFLICT',
            'The request input changed.',
            409,
          );
          return JSON.parse(prior.result);
        }
        this.s.transfer(
          'demoUSD',
          e.tenant,
          requestKey + ':fund',
          'SCENARIO_INPUT',
          'User-entered future salary and earned-work assumption; no employer verification',
          acct('scenario-input'),
          acct(e.tenant, 'payroll'),
          p.amount,
          true,
        );
        const o = this.s.save({
          type: 'obligation',
          tenant: e.tenant,
          owner: b.id,
          employeeId: e.id,
          amount: p.amount,
          earned: p.earned,
          earlyGross: '0',
          dueAt: p.dueAt,
          state: 'RESERVED',
          mode: 'SIMULATION',
          earnedSource: 'SELF_REPORTED_SCENARIO',
        });
        this.s.enqueue('PAYROLL', 'payroll:' + o.id, { obligationId: o.id }, o.dueAt);
        this.s.audit(a.id, e.tenant, 'simulation.schedule', o.id, {
          source: 'SELF_REPORTED_SCENARIO',
        });
        this.s.db
          .prepare('INSERT INTO requests VALUES(?,?,?,?)')
          .run(requestKey, a.id, inputHash, JSON.stringify(o));
        return o;
      });
    }
    if (action === 'simulation.credit') {
      const p = z
        .object({
          amount: z.string().regex(/^[1-9][0-9]{0,15}$/),
          sourceId: z.string().max(100).optional(),
          bonusReserve: z
            .string()
            .regex(/^(0|[1-9][0-9]{0,15})$/)
            .default('0'),
        })
        .strict()
        .parse(payload);
      if (p.sourceId)
        ensure(
          this.s
            .list('chain-obligation')
            .some(
              (o) =>
                o.chainId === p.sourceId &&
                o.owner === this.service.user(a).accountId &&
                o.snapshot.credited,
            ),
          'SOURCE_NOT_FOUND',
          'Choose one of your credited NEAR salary obligations.',
        );
      const requestKey = 'personal-credit:' + b.id + ':' + key,
        inputHash = hash(p);
      return this.s.atomic(() => {
        const prior = this.s.db
          .prepare('SELECT * FROM requests WHERE key=? AND actor=?')
          .get(requestKey, a.id) as any;
        if (prior) {
          ensure(
            prior.input_hash === inputHash,
            'IDEMPOTENCY_CONFLICT',
            'The request input changed.',
            409,
          );
          return JSON.parse(prior.result);
        }
        const eventKey = p.sourceId ? 'linked-salary:' + b.id + ':' + p.sourceId : requestKey;
        ensure(
          !this.s.list('obligation', e.tenant, b.id).some((o) => o.sourceKey === eventKey),
          'ALREADY_LINKED',
          'This salary already has a scenario allocation.',
          409,
        );
        this.s.transfer(
          'demoUSD',
          e.tenant,
          eventKey + ':fund',
          'SCENARIO_INPUT',
          'User-entered scenario salary. No conversion from testNEAR.',
          acct('scenario-input'),
          acct(e.tenant, 'payroll'),
          p.amount,
          true,
        );
        if (p.bonusReserve !== '0')
          this.s.transfer(
            'demoUSD',
            e.tenant,
            eventKey + ':bonus',
            'SCENARIO_INPUT',
            'Prefunded hypothetical employer bonus reserve',
            acct('scenario-input'),
            acct(e.tenant, 'bonus'),
            p.bonusReserve,
            true,
          );
        const o = this.s.save({
          type: 'obligation',
          tenant: e.tenant,
          owner: b.id,
          employeeId: e.id,
          amount: p.amount,
          earned: p.amount,
          earlyGross: '0',
          dueAt: new Date().toISOString(),
          state: 'RESERVED',
          sourceKey: eventKey,
          linkedTestnetObligation: p.sourceId || null,
          mode: 'SIMULATION',
        });
        const result = this.service.creditSalary(o);
        this.s.save({ ...e, salary: p.amount });
        this.s.audit(a.id, e.tenant, 'simulation.credit', o.id, {
          source: 'EXPLICIT_SCENARIO_INPUT',
          unit: 'demoUSD',
        });
        this.s.db
          .prepare('INSERT INTO requests VALUES(?,?,?,?)')
          .run(requestKey, a.id, inputHash, JSON.stringify(result));
        return result;
      });
    }
    ensure(
      [
        'preview.create',
        'preview.apply',
        'goal.save',
        'goal.pause',
        'goal.release',
        'allocation.release',
        'destination.save',
        'destination.archive',
        'dca.save',
        'dca.pause',
        'dca.fund',
        'dca.run',
        'money-plan.save',
        'hold.exit',
        'earn.open',
        'earn.exit',
        'loan.spend',
        'loan.repay',
        'employee.withdraw',
        'notification.read',
        'loan.plan',
        'loan.reserve-release',
      ].includes(action),
      'FORBIDDEN',
      'This command is outside your personal planning book.',
      403,
    );
    return this.service.command(b, action as CommandAction, payload, undefined, 'personal:' + key);
  }
}
