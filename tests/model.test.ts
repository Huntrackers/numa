import { describe, it, expect, vi, afterEach } from 'vitest';
import { localExplanation, modelStatus } from '../packages/agent-tools/src/local-model.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('local model boundary', () => {
  it('falls back when the model is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
    expect((await localExplanation('help', 'trusted')).available).toBe(false);
  });
  it('never sends financial context to a non-local host', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.stubEnv('OLLAMA_URL', 'https://remote.example');
    expect((await localExplanation('help', 'trusted')).available).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects model-invented numeric facts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'local',
          message: { content: JSON.stringify({ explanation: 'You have 900 dollars.' }) },
        }),
      }),
    );
    expect((await localExplanation('help', 'trusted')).explanation).toBeNull();
  });
  it('accepts explanatory prose without granting tools', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'local',
        message: {
          content: JSON.stringify({
            explanation: 'Keep a cash buffer before reserving more for investing.',
          }),
        },
      }),
    });
    vi.stubGlobal('fetch', f);
    const r = await localExplanation('help', 'trusted');
    expect(r.explanation).toContain('cash buffer');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });
});
