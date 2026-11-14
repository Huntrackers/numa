import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { amount, ensure } from '../../domain/src/index.js';
export type Entity = {
  id: string;
  type: string;
  tenant: string;
  owner: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
};
export class Store {
  db: DatabaseSync;
  constructor(file = resolve(process.env.NOMA_DATA_DIR || 'data', 'noma.sqlite')) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    // A consistent snapshot precedes a versioned schema change, including WAL data.
    const hasMigrations = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'")
      .get();
    if (hasMigrations) {
      const version =
        (this.db.prepare('SELECT MAX(version) AS version FROM migrations').get() as any)?.version ||
        0;
      if (version < 5) {
        const dir = join(dirname(file), 'backups');
        mkdirSync(dir, { recursive: true });
        const dest = join(dir, 'numa-pre-migration-' + Date.now() + '.sqlite');
        this.db.prepare('VACUUM INTO ?').run(dest);
      }
    }
    this.migrate();
  }
  migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,type TEXT NOT NULL,tenant TEXT NOT NULL,owner TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));' +
        'CREATE INDEX IF NOT EXISTS entities_scope ON entities(type,tenant,owner);' +
        'CREATE TABLE IF NOT EXISTS ledger_entries(id TEXT PRIMARY KEY,book TEXT NOT NULL,tenant TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL);' +
        "CREATE TABLE IF NOT EXISTS ledger_lines(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES ledger_entries(id),account TEXT NOT NULL,side TEXT NOT NULL CHECK(side IN ('DEBIT','CREDIT')),amount TEXT NOT NULL CHECK(length(amount)>0 AND amount NOT GLOB '*[^0-9]*'));" +
        'CREATE INDEX IF NOT EXISTS ledger_account ON ledger_lines(account);' +
        "CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;" +
        "CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;" +
        "CREATE TRIGGER IF NOT EXISTS lines_no_update BEFORE UPDATE ON ledger_lines BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;" +
        "CREATE TRIGGER IF NOT EXISTS lines_no_delete BEFORE DELETE ON ledger_lines BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;" +
        'CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,dedup_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,lease_until TEXT,worker TEXT,last_error TEXT);' +
        'CREATE TABLE IF NOT EXISTS requests(key TEXT NOT NULL,actor TEXT NOT NULL,input_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(key,actor));' +
        'CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at TEXT NOT NULL,mode TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,nonce TEXT NOT NULL,message TEXT NOT NULL,recipient TEXT NOT NULL,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);' +
        "INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));",
    );
    if (
      !(this.db.prepare('PRAGMA table_info(challenges)').all() as any[]).some(
        (c) => c.name === 'callback_url',
      )
    )
      this.db.exec('ALTER TABLE challenges ADD COLUMN callback_url TEXT');
    this.db.exec(
      "CREATE TRIGGER IF NOT EXISTS chain_events_no_update BEFORE UPDATE ON entities WHEN OLD.type='chain-event' BEGIN SELECT RAISE(ABORT,'Finalized chain events are immutable'); END; CREATE TRIGGER IF NOT EXISTS chain_events_no_delete BEFORE DELETE ON entities WHEN OLD.type='chain-event' BEGIN SELECT RAISE(ABORT,'Finalized chain events are immutable'); END; INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'));",
    );
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS entity_identity_update BEFORE UPDATE ON entities
      WHEN NEW.id<>OLD.id OR NEW.type<>OLD.type OR (NEW.tenant<>OLD.tenant AND NOT(OLD.tenant='' AND NEW.type='company' AND NEW.tenant=NEW.id))
      BEGIN SELECT RAISE(ABORT,'Entity identity and tenant are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS entity_json_insert_v4 BEFORE INSERT ON entities
      WHEN json_extract(NEW.data,'$.id') IS NOT NEW.id OR json_extract(NEW.data,'$.type') IS NOT NEW.type OR json_extract(NEW.data,'$.tenant') IS NOT NEW.tenant OR json_extract(NEW.data,'$.owner') IS NOT NEW.owner
      BEGIN SELECT RAISE(ABORT,'Entity columns and JSON differ'); END;
      CREATE TRIGGER IF NOT EXISTS entity_json_update_v4 BEFORE UPDATE ON entities
      WHEN json_extract(NEW.data,'$.id') IS NOT NEW.id OR json_extract(NEW.data,'$.type') IS NOT NEW.type OR json_extract(NEW.data,'$.tenant') IS NOT NEW.tenant OR json_extract(NEW.data,'$.owner') IS NOT NEW.owner
      BEGIN SELECT RAISE(ABORT,'Entity columns and JSON differ'); END;
      CREATE TRIGGER IF NOT EXISTS role_tenant_insert BEFORE INSERT ON entities
      WHEN NEW.type IN ('role','employee','membership') AND NOT EXISTS(SELECT 1 FROM entities c WHERE c.id=NEW.tenant AND c.type='company')
      BEGIN SELECT RAISE(ABORT,'Company reference is missing'); END;
      CREATE TRIGGER IF NOT EXISTS employee_role_insert BEFORE INSERT ON entities
      WHEN NEW.type='employee' AND json_extract(NEW.data,'$.roleId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities r WHERE r.id=json_extract(NEW.data,'$.roleId') AND r.type='role' AND r.tenant=NEW.tenant)
      BEGIN SELECT RAISE(ABORT,'Employee role tenant mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS employee_role_update BEFORE UPDATE ON entities
      WHEN NEW.type='employee' AND json_extract(NEW.data,'$.roleId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities r WHERE r.id=json_extract(NEW.data,'$.roleId') AND r.type='role' AND r.tenant=NEW.tenant)
      BEGIN SELECT RAISE(ABORT,'Employee role tenant mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS employee_reference_insert BEFORE INSERT ON entities
      WHEN NEW.type IN ('invitation','obligation','pay-agreement') AND json_extract(NEW.data,'$.employeeId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities e WHERE e.id=json_extract(NEW.data,'$.employeeId') AND e.type='employee' AND e.tenant=NEW.tenant)
      BEGIN SELECT RAISE(ABORT,'Employee reference tenant mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS payroll_outbox_insert BEFORE INSERT ON outbox
      WHEN NEW.kind='PAYROLL' AND NOT EXISTS(SELECT 1 FROM entities o WHERE o.id=json_extract(NEW.payload,'$.obligationId') AND o.type='obligation')
      BEGIN SELECT RAISE(ABORT,'Payroll outbox obligation is missing'); END;
      CREATE TRIGGER IF NOT EXISTS ledger_book_insert BEFORE INSERT ON ledger_lines
      WHEN NOT EXISTS(SELECT 1 FROM ledger_entries e WHERE e.id=NEW.entry_id AND substr(NEW.account,1,length(e.book)+1)=e.book||':')
      BEGIN SELECT RAISE(ABORT,'Ledger book mismatch'); END;
      INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'));
      CREATE TRIGGER IF NOT EXISTS employee_reference_update BEFORE UPDATE ON entities
      WHEN NEW.type IN ('invitation','obligation','pay-agreement') AND json_extract(NEW.data,'$.employeeId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities e WHERE e.id=json_extract(NEW.data,'$.employeeId') AND e.type='employee' AND e.tenant=NEW.tenant)
      BEGIN SELECT RAISE(ABORT,'Employee reference tenant mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS company_reference_delete BEFORE DELETE ON entities
      WHEN OLD.type='company' AND EXISTS(SELECT 1 FROM entities e WHERE e.tenant=OLD.id AND e.id<>OLD.id)
      BEGIN SELECT RAISE(ABORT,'Company with referenced records cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS role_reference_delete BEFORE DELETE ON entities
      WHEN OLD.type='role' AND EXISTS(SELECT 1 FROM entities e WHERE e.type='employee' AND json_extract(e.data,'$.roleId')=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Role is referenced by employees'); END;
      CREATE TRIGGER IF NOT EXISTS employee_reference_delete BEFORE DELETE ON entities
      WHEN OLD.type='employee' AND EXISTS(SELECT 1 FROM entities e WHERE e.type IN ('invitation','obligation','pay-agreement') AND json_extract(e.data,'$.employeeId')=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Employee has financial or invitation records'); END;
      CREATE TRIGGER IF NOT EXISTS payroll_outbox_update BEFORE UPDATE ON outbox
      WHEN NEW.kind='PAYROLL' AND NOT EXISTS(SELECT 1 FROM entities o WHERE o.id=json_extract(NEW.payload,'$.obligationId') AND o.type='obligation')
      BEGIN SELECT RAISE(ABORT,'Payroll outbox obligation is missing'); END;
      INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'));
      CREATE TABLE IF NOT EXISTS decision_approvals(
        id TEXT PRIMARY KEY,request_key TEXT NOT NULL,actor TEXT NOT NULL,
        session_hash TEXT NOT NULL,account_id TEXT NOT NULL,endpoint TEXT NOT NULL,
        action TEXT NOT NULL,company_id TEXT NOT NULL,input_hash TEXT NOT NULL,request_hash TEXT,
        nonce TEXT NOT NULL,message TEXT NOT NULL,recipient TEXT NOT NULL,
        expires_at TEXT NOT NULL,state TEXT NOT NULL,
        public_key TEXT,signature TEXT,approved_at TEXT,result TEXT
      );
      CREATE INDEX IF NOT EXISTS decision_approvals_request
        ON decision_approvals(actor,endpoint,request_key);
      CREATE TRIGGER IF NOT EXISTS approval_proof_no_update BEFORE UPDATE ON decision_approvals
      WHEN OLD.state='APPLIED'
      BEGIN SELECT RAISE(ABORT,'Applied decision proofs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS approval_proof_no_delete BEFORE DELETE ON decision_approvals
      WHEN OLD.approved_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT,'Verified decision proofs are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS approval_content_no_update BEFORE UPDATE ON decision_approvals
      WHEN OLD.approved_at IS NOT NULL AND (
        NEW.message IS NOT OLD.message OR NEW.nonce IS NOT OLD.nonce OR
        NEW.public_key IS NOT OLD.public_key OR NEW.signature IS NOT OLD.signature OR
        NEW.input_hash IS NOT OLD.input_hash OR NEW.request_hash IS NOT OLD.request_hash OR NEW.actor IS NOT OLD.actor OR
        NEW.account_id IS NOT OLD.account_id OR NEW.session_hash IS NOT OLD.session_hash OR
        NEW.recipient IS NOT OLD.recipient OR NEW.approved_at IS NOT OLD.approved_at
      )
      BEGIN SELECT RAISE(ABORT,'Verified decision content is immutable'); END;
      INSERT OR IGNORE INTO migrations VALUES(5,datetime('now'));
    `);
    if (
      !(this.db.prepare('PRAGMA table_info(decision_approvals)').all() as any[]).some(
        (column) => column.name === 'request_hash',
      )
    )
      this.db.exec('ALTER TABLE decision_approvals ADD COLUMN request_hash TEXT');
  }
  atomic<T>(fn: () => T): T {
    const nested = this.db.isTransaction;
    const savepoint = 'numa_' + randomUUID().replaceAll('-', '');
    this.db.exec(nested ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec(nested ? 'RELEASE SAVEPOINT ' + savepoint : 'COMMIT');
      return r;
    } catch (e) {
      this.db.exec(nested ? 'ROLLBACK TO SAVEPOINT ' + savepoint : 'ROLLBACK');
      if (nested) this.db.exec('RELEASE SAVEPOINT ' + savepoint);
      throw e;
    }
  }
  get(id: string) {
    const r = this.db.prepare('SELECT data FROM entities WHERE id=?').get(id) as any;
    return r ? (JSON.parse(r.data) as Entity) : undefined;
  }
  list(type: string, tenant?: string, owner?: string): Entity[] {
    const q =
      'SELECT data FROM entities WHERE type=?' +
      (tenant !== undefined ? ' AND tenant=?' : '') +
      (owner !== undefined ? ' AND owner=?' : '') +
      ' ORDER BY rowid';
    const args = [
      type,
      ...(tenant !== undefined ? [tenant] : []),
      ...(owner !== undefined ? [owner] : []),
    ];
    return (this.db.prepare(q).all(...args) as any[]).map((r) => JSON.parse(r.data));
  }
  save(input: Partial<Entity> & { type: string }): Entity {
    const old = input.id ? this.get(input.id) : undefined;
    const now = new Date().toISOString();
    const e = {
      tenant: '',
      owner: '',
      ...old,
      ...input,
      id: input.id || randomUUID(),
      version: (old?.version || 0) + 1,
      createdAt: old?.createdAt || now,
      updatedAt: now,
    } as Entity;
    this.db
      .prepare(
        'INSERT INTO entities(id,type,tenant,owner,version,data) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,tenant=excluded.tenant,owner=excluded.owner,version=excluded.version,data=excluded.data',
      )
      .run(e.id, e.type, e.tenant, e.owner, e.version, JSON.stringify(e));
    return e;
  }
  balance(account: string) {
    const rows = this.db
      .prepare('SELECT side,amount FROM ledger_lines WHERE account=?')
      .all(account) as any[];
    return rows.reduce((s, r) => s + (r.side === 'DEBIT' ? 1n : -1n) * BigInt(r.amount), 0n);
  }
  post(
    book: string,
    tenant: string,
    eventKey: string,
    kind: string,
    description: string,
    lines: { account: string; side: 'DEBIT' | 'CREDIT'; amount: string }[],
    occurredAt?: string,
  ): boolean {
    if (!this.db.isTransaction)
      return this.atomic(() =>
        this.post(book, tenant, eventKey, kind, description, lines, occurredAt),
      );
    if (this.db.prepare('SELECT id FROM ledger_entries WHERE event_key=?').get(eventKey))
      return false;
    let d = 0n,
      c = 0n;
    for (const l of lines) {
      const n = amount(l.amount);
      if (l.side === 'DEBIT') d += n;
      else c += n;
    }
    ensure(d === c && d > 0n, 'UNBALANCED_ENTRY', 'Ledger entry must balance.');
    ensure(
      lines.every((l) => l.account.startsWith(book + ':')),
      'BOOK_MISMATCH',
      'Books cannot be mixed.',
    );
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO ledger_entries VALUES(?,?,?,?,?,?,?,?)'.replace(
          '?,?,?,?,?,?,?,?',
          '?,?,?,?,?,?,?',
        ),
      )
      .run(id, book, tenant, eventKey, kind, description, occurredAt || new Date().toISOString());
    const s = this.db.prepare('INSERT INTO ledger_lines VALUES(?,?,?,?,?)');
    for (const l of lines) s.run(randomUUID(), id, l.account, l.side, l.amount);
    return true;
  }
  transfer(
    book: string,
    tenant: string,
    key: string,
    kind: string,
    description: string,
    from: string,
    to: string,
    value: string,
    allowOverdraft = false,
  ): boolean {
    if (!this.db.isTransaction)
      return this.atomic(() =>
        this.transfer(book, tenant, key, kind, description, from, to, value, allowOverdraft),
      );
    if (this.db.prepare('SELECT id FROM ledger_entries WHERE event_key=?').get(key)) return false;
    const n = amount(value);
    if (n === 0n) return false;
    if (!allowOverdraft)
      ensure(this.balance(from) >= n, 'INSUFFICIENT_FUNDS', 'The available balance is too low.');
    return this.post(book, tenant, key, kind, description, [
      { account: from, side: 'CREDIT', amount: value },
      { account: to, side: 'DEBIT', amount: value },
    ]);
  }
  ledger(tenant?: string) {
    const rows = (
      tenant
        ? this.db
            .prepare('SELECT * FROM ledger_entries WHERE tenant=? ORDER BY created_at DESC')
            .all(tenant)
        : this.db.prepare('SELECT * FROM ledger_entries ORDER BY created_at DESC').all()
    ) as any[];
    return rows.map((r) => ({
      ...r,
      lines: this.db
        .prepare('SELECT account,side,amount FROM ledger_lines WHERE entry_id=?')
        .all(r.id),
    }));
  }
  enqueue(kind: string, key: string, payload: any, at = new Date().toISOString()) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO outbox(id,dedup_key,kind,payload,status,available_at) VALUES(?,?,?,?,?,?)',
      )
      .run(randomUUID(), key, kind, JSON.stringify(payload), 'PENDING', at);
  }
  audit(actor: string, tenant: string, action: string, ref: string, details: any = {}) {
    return this.save({ type: 'audit', tenant, owner: actor, action, ref, details });
  }
  close() {
    this.db.close();
  }
}
export const acct = (owner: string, pocket = 'cash', book = 'demoUSD') =>
  book + ':' + owner + ':' + pocket;
