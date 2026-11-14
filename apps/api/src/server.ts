import { release } from '../../../packages/domain/src/release.js';
import { intentPreviewSchema } from './intents.js';
import { registerReviewRoutes } from './review.js';
import { guardExecution } from '../../../packages/near-adapter/src/safety.js';
import { verifyOperationCandidate } from '../../../packages/near-adapter/src/reconcile.js';
import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../../../packages/db/src/index.js';
import { Service, type Actor } from './service.js';
import { ScenarioCatalog } from './catalog.js';
import { seed } from './seed.js';
import { LiveService, liveSchemas } from './live.js';
import { PersonalSimulation } from './simulation.js';
import {
  DomainError,
  ensure,
  hash,
  occurrences,
  obligationId,
} from '../../../packages/domain/src/index.js';
import {
  command,
  schemas,
  chainArgs,
  chainCalendar,
} from '../../../packages/api-contracts/src/index.js';
import { localExplanation, modelStatus } from '../../../packages/agent-tools/src/local-model.js';
import { challenge, verify, createSession, tokenHash } from './auth.js';
import {
  ApprovalRequired,
  DecisionApprovals,
  liveLocalDecisions,
  unsignedDecisions,
} from './approvals.js';
import { workspaceDirectory, invitationSummary } from './onboarding.js';
import {
  accountBalance,
  view,
  confirmOperation,
  assertTestnet,
  operationAnchor,
} from '../../../packages/near-adapter/src/rpc.js';
export async function buildApp(store?: Store) {
  const s = store || new Store();
  if (process.env.DEMO_ENABLED === 'true') seed(s);
  if (!s.get('settings'))
    s.save({
      id: 'settings',
      type: 'settings',
      maxEmployees: 50,
      maintenance: false,
      network: 'testnet',
      publicCatalogEnabled: true,
      priceTtlSeconds: 30,
      quoteTtlSeconds: 30,
      quoteScenario: 'NORMAL',
      modelEnabled: true,
      disabledAssets: [],
    });
  const service = new Service(s);
  const live = new LiveService(s);
  const simulation = new PersonalSimulation(s);
  const approvals = new DecisionApprovals(s);
  const app = Fastify({
    logger: process.env.LOG_LEVEL === 'silent' ? false : { level: 'info' },
    bodyLimit: 1_100_000,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    enableCSPNonces: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          'https://rsms.me',
          'https://fonts.cdnfonts.com',
        ],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'data:', 'https://rsms.me', 'https://fonts.cdnfonts.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: [
          "'self'",
          'https://rpc.testnet.near.org',
          'https://test.rpc.fastnear.com',
          'https://mc.meteorwallet.app',
          'wss://mc.meteorwallet.app',
          'https://wallet.meteorwallet.app',
        ],
        frameSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api/'),
  });
  const actor = (req: any): Actor => {
    const session = s.db
      .prepare('SELECT * FROM sessions WHERE hash=? AND expires_at>?')
      .get(tokenHash(req.cookies.noma_session || ''), new Date().toISOString()) as any;
    ensure(session, 'UNAUTHORIZED', 'Sign in to your workspace.', 401);
    ensure(
      session.mode !== 'DEMO' ||
        (process.env.DEMO_ENABLED === 'true' && process.env.NODE_ENV !== 'production'),
      'DEMO_DISABLED',
      'Sample sessions are disabled. Verify your NEAR identity.',
      401,
    );
    req.nomaSession = session;
    return { id: session.user_id, mode: session.mode };
  };
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers.host;
      let sameOrigin = false;
      try {
        sameOrigin =
          !!origin && new URL(origin).origin === new URL(req.protocol + '://' + host).origin;
      } catch {}
      ensure(sameOrigin, 'INVALID_ORIGIN', 'This request did not originate from numa.', 403);
      if (
        ![
          '/api/v1/auth/demo',
          '/api/v1/auth/challenges',
          '/api/v1/auth/verify',
          '/api/v1/intents/preview',
        ].includes(req.url)
      ) {
        actor(req);
        ensure(
          req.headers['x-csrf-token'] === (req as any).nomaSession.csrf,
          'CSRF_INVALID',
          'Refresh the page and try again.',
          403,
        );
      }
    }
  });
  app.setErrorHandler((err: any, req, reply) => {
    const validation = err instanceof z.ZodError;
    const status =
      err instanceof DomainError ? err.status : validation ? 400 : err.statusCode || 500;
    if (status >= 500) req.log.error({ err }, 'Request failed');
    reply.code(status).send({
      code: err.code || (validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
      message: validation
        ? 'Check the highlighted request fields.'
        : status >= 500 &&
            !(err instanceof DomainError && /^(INTENTS_|QUOTE_|PROVIDER_RESPONSE_)/.test(err.code))
          ? 'The service could not complete this request.'
          : err.message,
      requestId: req.id,
      ...(validation ? { fieldErrors: err.issues } : {}),
      ...(err instanceof ApprovalRequired ? { approval: err.approval } : {}),
    });
  });
  registerReviewRoutes(app, s);
  app.get('/api/v1/health', () => ({
    status: 'ok',
    name: 'numa',
    version: release.version,
    network: 'testnet',
    worker: s.get('worker-heartbeat')?.lastSeen || null,
  }));
  app.get('/api/v1/config', () => ({
    demoEnabled: process.env.DEMO_ENABLED === 'true' && process.env.NODE_ENV !== 'production',
    contractId: process.env.NEAR_CONTRACT_ID || null,
    network: 'testnet',
    mainnetEnabled: false,
  }));
  app.post('/api/v1/auth/demo', async (req, reply) => {
    ensure(
      process.env.DEMO_ENABLED === 'true' && process.env.NODE_ENV !== 'production',
      'DEMO_DISABLED',
      'Demo sign-in is disabled.',
      403,
    );
    const p = z
      .object({
        userId: z.enum([
          'new-employee',
          'owner',
          'maya',
          'accountant',
          'observer',
          'admin',
          'other-owner',
          'noah',
          'lena',
          'eli',
          'amara',
        ]),
      })
      .strict()
      .parse(req.body);
    const x = createSession(s, p.userId, 'DEMO');
    reply.setCookie('noma_session', x.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 28800,
    });
    return { csrf: x.csrf, userId: p.userId, mode: 'DEMO' };
  });
  app.post('/api/v1/auth/challenges', (req) => {
    const p = z
      .object({ walletId: z.literal('meteor-wallet').optional() })
      .strict()
      .parse(req.body || {});
    return challenge(
      s,
      req.headers.host!,
      p.walletId ? undefined : req.protocol + '://' + req.headers.host + '/login',
    );
  });
  app.post('/api/v1/auth/verify', async (req, reply) => {
    const p = z
      .object({
        challengeId: z.string().max(100),
        accountId: z.string().max(64),
        publicKey: z.string().max(100),
        signature: z.string().max(200),
      })
      .strict()
      .parse(req.body);
    const id = await verify(s, p, req.headers.host!);
    const x = createSession(s, id, 'TESTNET');
    reply.setCookie('noma_session', x.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 28800,
    });
    return { csrf: x.csrf, userId: id, mode: 'TESTNET' };
  });
  app.get('/api/v1/me', (req) => {
    const a = actor(req);
    const u = service.user(a);
    return {
      user: { id: u.id, name: u.name, role: u.role, accountId: u.accountId },
      mode: a.mode,
      csrf: (req as any).nomaSession.csrf,
    };
  });
  app.post('/api/v1/auth/logout', (req, reply) => {
    s.db
      .prepare('DELETE FROM sessions WHERE hash=?')
      .run(tokenHash(req.cookies.noma_session || ''));
    reply.clearCookie('noma_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/state', (req) => {
    const q = z
      .object({ scope: z.enum(['company', 'employee', 'admin']), companyId: z.string().optional() })
      .parse(req.query);
    return service.state(actor(req), q.scope, q.companyId);
  });
  app.get('/api/v1/simulation/state', (req) => simulation.state(actor(req)));
  const approved = <T>(
    req: any,
    a: Actor,
    action: string,
    companyId: string | undefined,
    key: string,
    execute: () => T | Promise<T>,
    basis?: unknown,
  ) =>
    approvals.run(
      {
        actor: a,
        sessionHash: req.nomaSession.hash,
        accountId: service.user(a).accountId || '',
        endpoint: req.url,
        recipient: req.headers.host,
        key,
        action,
        companyId,
        body: req.body,
        basis,
        proof: req.headers['x-numa-approval'],
      },
      execute,
    );
  const previewBasis = (a: Actor, payload: unknown, companyId?: string) => {
    const preview = service.own(a, (payload as any)?.previewId, 'preview');
    if (['salary-change', 'payroll'].includes(preview.kind)) {
      ensure(preview.tenant === companyId, 'NOT_FOUND', 'Decision not found in this company.', 404);
      service.company(a, preview.tenant, true);
    }
    return {
      id: preview.id,
      tenant: preview.tenant,
      kind: preview.kind,
      inputHash: preview.inputHash,
      input: preview.input,
      fingerprint: preview.fingerprint,
      effects: preview.effects,
      expiresAt: preview.expiresAt,
    };
  };
  const importBasis = (a: Actor, payload: unknown, companyId: string | undefined) => {
    service.company(a, companyId || '', true);
    const imported = service.own(a, (payload as any)?.previewId, 'import');
    ensure(imported.tenant === companyId, 'NOT_FOUND', 'Import not found in this workspace.', 404);
    return {
      id: imported.id,
      rows: imported.rows,
      fingerprint: imported.fingerprint,
      expiresAt: imported.expiresAt,
      tenant: imported.tenant,
    };
  };
  const memberAcceptanceBasis = (a: Actor, payload: unknown) => {
    const user = live.identity(a);
    const invitation = s
      .list('member-invitation')
      .find((entry) => entry.tokenHash === hash((payload as any)?.token));
    ensure(
      invitation &&
        invitation.state === 'PENDING' &&
        invitation.expiresAt > new Date().toISOString() &&
        invitation.accountId === user.accountId,
      'INVALID_INVITATION',
      'Use the invited NEAR account before this invitation expires.',
      403,
    );
    const company = s.get(invitation.tenant);
    ensure(
      company?.mode === 'TESTNET' && company.status === 'ACTIVE',
      'COMPANY_SUSPENDED',
      'This company invitation is not currently available.',
      403,
    );
    return {
      invitationId: invitation.id,
      invitationVersion: invitation.version,
      state: invitation.state,
      expiresAt: invitation.expiresAt,
      accountId: invitation.accountId,
      access: invitation.access,
      companyId: company.id,
      companyName: company.name,
      companyVersion: company.version,
      companyStatus: company.status,
    };
  };
  app.get('/api/v1/approvals', (req) => approvals.proofs(actor(req)));
  app.post('/api/v1/simulation/commands', (req) => {
    const p = z
      .object({ action: z.string().max(100), payload: z.unknown() })
      .strict()
      .parse(req.body);
    const a = actor(req),
      key = z.string().min(8).max(150).parse(req.headers['idempotency-key']);
    const planningActor = simulation.actor(a);
    const planningEmployee = service.employee(planningActor);
    const profileEpoch = s.get('simulation-profile:' + a.id)?.epoch || 1;
    const execute = () => {
      ensure(
        (s.get('simulation-profile:' + a.id)?.epoch || 1) === profileEpoch,
        'PREVIEW_STALE',
        'Your planning book changed. Review the decision again.',
        409,
      );
      return simulation.command(a, p.action, p.payload, key);
    };
    const basis = {
      planningBook: planningEmployee.tenant,
      planningIdentity: planningActor.id,
      profileEpoch,
      ...(p.action === 'preview.apply' ? { preview: previewBasis(planningActor, p.payload) } : {}),
    };
    return unsignedDecisions.has(p.action)
      ? execute()
      : approved(req, a, p.action, undefined, key, execute, basis);
  });
  app.get('/api/v1/workspaces', (req) => {
    const a = actor(req);
    service.user(a);
    return s
      .list('membership', undefined, a.id)
      .filter((m) => m.status === 'ACTIVE')
      .flatMap((m) => {
        const c = s.get(m.tenant);
        if (
          !c ||
          c.type !== 'company' ||
          (a.mode === 'TESTNET' ? c.mode !== 'TESTNET' : c.mode === 'TESTNET')
        )
          return [];
        return [
          {
            id: m.id,
            tenant: m.tenant,
            access: m.access,
            status: m.status,
            company: {
              id: c.id,
              name: c.name,
              timezone: c.timezone,
              mode: c.mode,
              status: c.status,
              chainState: c.chainState,
            },
          },
        ];
      });
  });
  app.get('/api/v1/onboarding', (req) => workspaceDirectory(s, live, actor(req)));
  app.get('/api/v1/invitations/:token', (req) => {
    const a = actor(req);
    const token = z
      .string()
      .min(20)
      .max(200)
      .safeParse((req.params as any).token);
    return token.success ? invitationSummary(s, live, a, token.data) : { status: 'INVALID' };
  });
  app.post('/api/v1/commands', (req) => {
    const p = command.parse(req.body);
    const key = z.string().min(8).max(150).parse(req.headers['idempotency-key']);
    const a = actor(req),
      execute = () => service.command(a, p.action, p.payload, p.companyId, key);
    if (p.action.startsWith('admin.')) service.admin(a);
    const basis =
      p.action === 'preview.apply'
        ? previewBasis(a, p.payload, p.companyId)
        : p.action === 'import.commit'
          ? importBasis(a, p.payload, p.companyId)
          : undefined;
    return unsignedDecisions.has(p.action)
      ? execute()
      : approved(req, a, p.action, p.companyId, key, execute, basis);
  });
  app.get('/api/v1/reports/export.csv', (req, reply) => {
    const q = z
      .object({
        scope: z.enum(['company', 'employee']),
        companyId: z.string().optional(),
        book: z.literal('simulation').optional(),
      })
      .parse(req.query);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="noma-ledger.csv"');
    const a = actor(req);
    ensure(
      !q.book || q.scope === 'employee',
      'FORBIDDEN',
      'Personal export requires employee scope.',
      403,
    );
    return service.exportCsv(
      q.book && a.mode === 'TESTNET' ? simulation.actor(a) : a,
      q.scope,
      q.companyId,
    );
  });
  app.post('/api/v1/admin/catalog-refresh', async (req) => {
    const a = actor(req);
    service.admin(a);
    const key = z.string().min(8).max(150).parse(req.headers['idempotency-key']);
    return approved(req, a, 'admin.catalog-refresh', undefined, key, async () => {
      const result = await new ScenarioCatalog(s).refresh();
      s.audit(a.id, '', 'admin.catalog-refresh', 'catalog', result);
      return result;
    });
  });
  app.get('/api/v1/agent/status', async (req) => {
    actor(req);
    return modelStatus();
  });
  app.post('/api/v1/agent/messages', async (req) => {
    const a = actor(req);
    const p = z
      .object({
        scope: z.enum(['company', 'employee']),
        book: z.literal('simulation').optional(),
        companyId: z.string().optional(),
        message: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    const grounded =
      a.mode === 'TESTNET' && p.scope === 'company'
        ? await live.assistant(a, p.message, p.companyId || 'forma')
        : service.assistant(
            a.mode === 'TESTNET' ? simulation.actor(a) : a,
            p.scope,
            p.message,
            p.companyId,
          );
    const local =
      s.get('settings')?.modelEnabled === false
        ? { available: false, explanation: null, model: null }
        : await localExplanation(p.message, grounded.message);
    return {
      ...grounded,
      explanation: local.explanation || null,
      engine:
        local.available && local.explanation
          ? 'Local language model + deterministic finance'
          : grounded.engine,
      model: local.available ? local.model : null,
      modelStatus: local.available ? 'AVAILABLE' : 'OFFLINE',
    };
  });
  app.get('/api/v1/openapi.json', () => ({
    openapi: '3.1.0',
    info: { title: 'numa API', version: release.version },
    paths: {
      '/api/v1/onboarding': {
        get: {
          summary:
            'Authenticated NEAR workspace directory with owner-only resumable registration plans',
          responses: {
            '200': { description: 'Authorized company memberships and personal employments' },
            '401': { description: 'Verified session required' },
          },
        },
      },
      '/api/v1/invitations/{token}': {
        get: {
          summary: 'Invitation details released only to the exact invited NEAR account',
          parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description:
                'Typed invitation status; invalid or wrong-account links expose no company or salary data',
            },
            '401': { description: 'Verified session required' },
          },
        },
      },
      '/api/v1/approvals': {
        get: {
          summary:
            'Own most recent 50 NEP-413 signed local decision proofs; not settlement receipts',
          responses: {
            '200': {
              description:
                'Account, command hash, message, nonce, public signature and decision outcome',
            },
            '401': { description: 'Authenticated session required' },
          },
        },
      },
      '/api/v1/simulation/commands': {
        post: {
          summary:
            'Personal demoUSD planning commands; sensitive decisions require a bound NEAR message signature',
          parameters: [
            {
              in: 'header',
              name: 'Idempotency-Key',
              required: true,
              schema: { type: 'string', minLength: 8, maxLength: 150 },
            },
            {
              in: 'header',
              name: 'X-Numa-Approval',
              schema: { type: 'string' },
              description: 'base64url JSON of challengeId, accountId, publicKey, signature',
            },
          ],
          responses: {
            '200': { description: 'Simulation result; no real investment or transfer' },
            '428': {
              description:
                'APPROVAL_REQUIRED with a bound, five-minute NEP-413 approval challenge; retry the exact body and key with X-Numa-Approval',
            },
            '401': { description: 'Invalid, expired or consumed approval or session' },
            '403': { description: 'Mismatched identity, session, domain or decision' },
            '409': { description: 'Stale decision or conflicting idempotency key' },
          },
        },
      },
      '/api/v1/review/claims': {
        get: {
          summary:
            'Download the claim-to-evidence map for independent review; no private data or self-issued score',
          responses: {
            '200': { description: 'Public product claims, commands and verification boundaries' },
          },
        },
      },
      '/api/v1/review/evidence': {
        get: {
          summary: 'Public finalized deployment evidence without tenant data',
          responses: {
            '200': {
              description: 'Observed deployment, telemetry freshness and recorded receipts',
            },
          },
        },
      },
      '/api/v1/review/policy-lab': {
        get: {
          summary: 'Unsigned deterministic policy drills using the shared evaluator',
          responses: {
            '200': { description: 'One allowed and eight blocked synthetic scenarios' },
          },
        },
      },
      '/api/v1/intents/tokens': {
        get: {
          summary: 'Public read-only 1Click token catalog',
          responses: {
            '200': { description: 'Supported catalog tokens with provider asset IDs' },
            '503': { description: 'Provider unavailable' },
          },
        },
      },
      '/api/v1/intents/preview': {
        post: {
          summary: 'Signed dry quote preview; same-origin, no wallet session or execution',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: z.toJSONSchema(intentPreviewSchema) } },
          },
          responses: {
            '200': {
              description: 'Verified read-only quote with exact amounts, provider fees and expiry',
            },
            '400': { description: 'Invalid or additional input fields' },
            '403': { description: 'Invalid origin' },
            '422': { description: 'No provider route' },
            '502': { description: 'Untrusted provider response rejected' },
            '503': { description: 'Provider unavailable' },
          },
        },
      },
      '/api/v1/live/state': {
        get: {
          summary: 'Authenticated NEAR testnet workspace and finalized balances',
          parameters: [
            {
              in: 'query',
              name: 'scope',
              required: true,
              schema: { enum: ['company', 'employee'] },
            },
            { in: 'query', name: 'companyId', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description:
                'Private workspace metadata, contract balances, decisions and operations',
            },
            '403': { description: 'Wallet identity or company access required' },
          },
        },
      },
      '/api/v1/live/commands': {
        post: {
          summary:
            'Idempotent real testnet product commands; financial actions return a decision before wallet signing',
          parameters: [
            {
              in: 'header',
              name: 'Idempotency-Key',
              required: true,
              schema: { type: 'string', minLength: 8, maxLength: 150 },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: Object.entries(liveSchemas).map(([action, schema]) => ({
                    type: 'object',
                    required: ['action', 'payload'],
                    additionalProperties: false,
                    properties: {
                      action: { const: action },
                      companyId: { type: 'string' },
                      payload: z.toJSONSchema(schema),
                    },
                  })),
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Result or unsigned decision with input hash, expiry and contract steps',
            },
            '409': { description: 'Stale preview, active decision or conflicting idempotency key' },
            '403': { description: 'Insufficient authority' },
            '428': {
              description:
                'Sensitive local metadata decision requires the returned NEP-413 challenge signed by the verified account; retry the exact request with X-Numa-Approval',
            },
          },
        },
      },
      ...Object.fromEntries(
        Object.entries({
          prepare: z.object({ planId: z.string(), index: z.number().int().min(0) }).strict(),
          dispatch: z.object({ operationId: z.string() }).strict(),
          declined: z.object({ operationId: z.string() }).strict(),
          confirm: z
            .object({ operationId: z.string(), txHash: z.string().min(20).max(100) })
            .strict(),
        }).map(([name, schema]) => [
          '/api/v1/live/' + name,
          {
            post: {
              summary: (
                {
                  prepare: 'Prepare the next validated contract call',
                  dispatch: 'Record that the wallet request is being opened',
                  declined: 'Record an explicit wallet rejection without a transaction',
                  confirm: 'Verify the final signer, contract, method, arguments and deposit',
                } as Record<string, string>
              )[name],
              requestBody: {
                required: true,
                content: { 'application/json': { schema: z.toJSONSchema(schema) } },
              },
              responses: {
                '200': { description: 'Operation state' },
                '409': { description: 'Stale, unknown, out-of-order or already applied operation' },
                ...(name === 'prepare'
                  ? {
                      '428': {
                        description:
                          'A local-only salary or employment update requires a bound NEP-413 decision signature',
                      },
                    }
                  : {}),
              },
            },
          },
        ]),
      ),
      '/api/v1/live/export.csv': {
        get: {
          summary: 'Authorized testnet obligation export in atomic testNEAR units',
          parameters: [
            {
              in: 'query',
              name: 'scope',
              required: true,
              schema: { enum: ['company', 'employee'] },
            },
            { in: 'query', name: 'companyId', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'CSV report',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
          },
        },
      },

      '/api/v1/commands': {
        post: {
          summary: 'Validated idempotent commands',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  oneOf: Object.entries(schemas).map(([action, schema]) => ({
                    type: 'object',
                    required: ['action', 'payload'],
                    additionalProperties: false,
                    properties: {
                      action: { const: action },
                      companyId: { type: 'string' },
                      payload: z.toJSONSchema(schema),
                    },
                  })),
                },
              },
            },
          },
          responses: {
            '200': { description: 'Command result' },
            '409': { description: 'Stale or conflicting decision' },
            '428': {
              description:
                'Verified TESTNET admin/local decisions require a bound NEP-413 approval challenge; demo personas are explicitly exempt',
            },
          },
        },
      },
    },
  }));
  app.get('/api/v1/chain/context', async (req) => {
    const a = actor(req),
      u = service.user(a);
    const contractId = process.env.NEAR_CONTRACT_ID || null;
    let chain = null,
      balance = null,
      companies: any[] = [],
      employments: any[] = [],
      obligations: any[] = [],
      error = null;
    if (contractId && u.accountId)
      try {
        [chain, companies, employments, obligations, balance] = await Promise.all([
          view(contractId, 'get_account', { account_id: u.accountId }),
          view(contractId, 'list_companies', { owner_id: u.accountId }),
          view(contractId, 'list_employments', { account_id: u.accountId }),
          view(contractId, 'list_obligations', {
            account_id: u.accountId,
            from_index: 0,
            limit: 100,
          }),
          accountBalance(u.accountId),
        ]);
      } catch (e: any) {
        error = e.code || 'RPC_UNAVAILABLE';
      }
    return {
      network: 'testnet',
      contractId,
      accountId: u.accountId || null,
      mode: a.mode,
      chain,
      companies,
      employments,
      obligations,
      error,
      balance,
    };
  });
  app.post('/api/v1/chain/payroll-preview', async (req) => {
    const a = actor(req);
    ensure(a.mode === 'TESTNET', 'WALLET_AUTH_REQUIRED', 'Connect a testnet wallet.', 403);
    const u = service.user(a);
    const p = chainCalendar.parse(req.body);
    const contract = process.env.NEAR_CONTRACT_ID;
    ensure(contract, 'CONTRACT_UNCONFIGURED', 'Configure the testnet contract.');
    const company = await view(contract, 'get_company', { company_id: p.companyId });
    ensure(
      company?.owner === u.accountId,
      'FORBIDDEN',
      'Only the company owner can prepare this mandate.',
      403,
    );
    const from = new Date().toISOString(),
      until = new Date(Date.now() + p.days * 86400000).toISOString();
    const dates = occurrences(p.cadence, p.anchor, from, until, p.timezone);
    ensure(
      dates.length > 0 && dates.length <= 20,
      'BATCH_LIMIT',
      'Choose a window with one to twenty payments.',
    );
    const obligations = dates.map((d) => ({
      id: obligationId(p.companyId, p.employeeId, p.scheduleId, d.index),
      employee_id: p.employeeId,
      amount: p.amount,
      due_at: (BigInt(new Date(d.dueAt).getTime()) * 1000000n).toString(),
    }));
    const existing = await Promise.all(
      obligations.map((o) => view(contract, 'get_obligation', { obligation_id: o.id })),
    );
    const fresh = obligations.filter((_, i) => !existing[i]);
    ensure(
      fresh.length > 0,
      'NO_NEW_OBLIGATIONS',
      'This schedule window is already authorized. Reuse the same schedule ID for subsequent windows.',
    );
    const total = (BigInt(p.amount) * BigInt(fresh.length)).toString();
    ensure(
      BigInt(company.free) >= BigInt(total),
      'FULL_PREFUNDING_REQUIRED',
      'Fund the full schedule before authorizing.',
    );
    return {
      mode: 'TESTNET',
      unit: 'testNEAR',
      total,
      rows: fresh,
      transaction: {
        method: 'authorize_mandate',
        args: {
          company_id: p.companyId,
          obligations: fresh,
          execution_not_after: (BigInt(Date.now() + 31 * 86400000 - 60000) * 1000000n).toString(),
        },
      },
    };
  });
  app.post('/api/v1/chain/prepare', async (req) => {
    const a = actor(req);
    ensure(
      a.mode === 'TESTNET',
      'WALLET_AUTH_REQUIRED',
      'Connect and verify your testnet wallet first.',
      403,
    );
    const u = service.user(a);
    const contractId = process.env.NEAR_CONTRACT_ID;
    ensure(
      contractId,
      'CONTRACT_UNCONFIGURED',
      'A deployed testnet contract must be configured before signing.',
      409,
    );
    const p = z
      .object({
        method: z.enum([
          'register_company',
          'register_employee',
          'accept_employment',
          'fund_treasury',
          'authorize_mandate',
          'execute_due',
          'claim_due',
          'set_goal_policy',
          'pause_goal',
          'release_goal',
          'request_withdrawal',
          'withdraw_company_surplus',
          'pause_mandate',
        ]),
        args: z.record(z.string(), z.unknown()),
        deposit: z
          .string()
          .regex(/^(0|[1-9][0-9]{0,59})$/)
          .default('0'),
      })
      .strict()
      .parse(req.body);
    (chainArgs[p.method] as z.ZodType).parse(p.args);
    ensure(
      p.deposit === '0' || p.method === 'fund_treasury',
      'INVALID_DEPOSIT',
      'Only treasury funding can attach a deposit.',
    );
    await assertTestnet();
    await guardExecution(s, {
      method: p.method,
      deposit: p.deposit,
      receiver: contractId,
      owner: a.id,
    });
    const anchor = await operationAnchor();
    const operation = s.save({
      ...anchor,
      type: 'chain-operation',
      owner: a.id,
      tenant: 'testnet',
      contractId,
      method: p.method,
      args: p.args,
      argsHash: hash(p.args),
      deposit: p.deposit,
      state: 'PREPARED',
      accountId: u.accountId,
    });
    return {
      operationId: operation.id,
      ...operation,
      transaction: {
        receiverId: contractId,
        signerId: u.accountId,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: p.method,
              args: p.args,
              gas: '100000000000000',
              deposit: p.deposit,
            },
          },
        ],
      },
    };
  });
  app.post('/api/v1/chain/operations', async (req) => {
    const a = actor(req);
    const p = z
      .object({ operationId: z.string(), txHash: z.string().min(20).max(100) })
      .strict()
      .parse(req.body);
    const op = service.own(a, p.operationId, 'chain-operation');
    const result = await verifyOperationCandidate(s, op.id, p.txHash, confirmOperation);
    return s.atomic(() => s.save({ ...s.get(op.id)!, ...result }));
  });
  app.get('/api/v1/operations/:id', (req) =>
    service.own(actor(req), (req.params as any).id, 'chain-operation'),
  );

  app.get('/api/v1/live/state', (req) => {
    const q = z
      .object({ scope: z.enum(['company', 'employee']), companyId: z.string().optional() })
      .parse(req.query);
    return live.state(actor(req), q.scope, q.companyId);
  });
  app.post('/api/v1/live/commands', (req) => {
    const p = z
      .object({ action: z.string(), payload: z.unknown(), companyId: z.string().optional() })
      .strict()
      .parse(req.body);
    const a = actor(req),
      key = z.string().min(8).max(150).parse(req.headers['idempotency-key']);
    liveSchemas[p.action]?.parse(p.payload);
    const execute = () => live.command(a, p.action, p.payload, p.companyId, key);
    // An accepted invitation changes its own state. Return the command's
    // already persisted idempotent result before rebuilding a new approval.
    if (s.db.prepare('SELECT 1 FROM requests WHERE key=? AND actor=?').get(key, a.id))
      return execute();
    const basis = p.action === 'member.accept' ? memberAcceptanceBasis(a, p.payload) : undefined;
    if (basis && p.companyId)
      ensure(
        p.companyId === basis.companyId,
        'INVALID_INVITATION',
        'Choose the invited company workspace.',
        403,
      );
    return liveLocalDecisions.has(p.action)
      ? approved(req, a, p.action, basis?.companyId || p.companyId, key, execute, basis)
      : execute();
  });
  app.post('/api/v1/live/prepare', async (req) => {
    const p = z
      .object({ planId: z.string(), index: z.number().int().min(0) })
      .strict()
      .parse(req.body);
    const a = actor(req),
      plan = service.own(a, p.planId, 'live-plan'),
      step = plan.steps[p.index];
    ensure(step, 'STEP_ORDER', 'Choose a valid plan step.', 409);
    if (!step.method.startsWith('local_'))
      await guardExecution(s, {
        method: step.method,
        deposit: step.deposit,
        receiver: plan.contractId,
        owner: a.id,
      });
    if (step.method.startsWith('local_')) {
      return approved(
        req,
        a,
        step.method,
        plan.tenant,
        'step:' + p.planId + ':' + p.index,
        () => live.prepare(a, p.planId, p.index),
        {
          inputHash: plan.inputHash,
          step: { method: step.method, args: step.args, deposit: step.deposit, label: step.label },
          commit: plan.commit,
          effects: plan.effects,
        },
      );
    }
    return live.prepare(a, p.planId, p.index);
  });
  app.post('/api/v1/live/dispatch', async (req) => {
    const p = z.object({ operationId: z.string() }).strict().parse(req.body);
    const a = actor(req),
      op = service.own(a, p.operationId, 'chain-operation');
    await guardExecution(s, {
      method: op.method,
      deposit: op.deposit,
      receiver: op.contractId,
      owner: a.id,
    });
    return live.dispatch(a, p.operationId);
  });
  app.post('/api/v1/live/declined', (req) => {
    const p = z.object({ operationId: z.string() }).strict().parse(req.body);
    return live.declined(actor(req), p.operationId);
  });
  app.post('/api/v1/live/confirm', (req) => {
    const p = z
      .object({ operationId: z.string(), txHash: z.string().min(20).max(100) })
      .strict()
      .parse(req.body);
    return live.confirm(actor(req), p.operationId, p.txHash);
  });
  app.get('/api/v1/live/export.csv', async (req, reply) => {
    const q = z
      .object({
        scope: z.enum(['company', 'employee']),
        companyId: z.string().optional(),
        kind: z.enum(['payroll', 'journal']).optional(),
        from: z.union([z.iso.date(), z.literal('')]).optional(),
        to: z.union([z.iso.date(), z.literal('')]).optional(),
        roleId: z.string().max(100).optional(),
        search: z.string().max(200).optional(),
      })
      .parse(req.query);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="numa-testnet-payroll.csv"')
      .send(await live.export(actor(req), q.scope, q.companyId, q));
  });

  const web = resolve('dist/web');
  if (existsSync(web)) {
    app.addHook('onSend', async (_req, reply, payload) => {
      if (!String(reply.getHeader('content-type') || '').includes('text/html')) return payload;
      const html = readFileSync(resolve(web, 'index.html'), 'utf8').replace(
        '<head>',
        '<head><meta name="numa-csp-nonce" content="' + reply.cspNonce.script + '">',
      );
      reply.removeHeader('content-length');
      reply.header('Cache-Control', 'no-store');
      return html;
    });
    await app.register(fastifyStatic, { root: web, prefix: '/', list: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/'))
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'API route not found.' });
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    if (!store) s.close();
  });
  return app;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server.ts')) {
  const app = await buildApp();
  await app.listen({
    port: Number(process.env.PORT || 4310),
    host: process.env.HOST || '127.0.0.1',
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
