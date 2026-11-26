// @vitest-environment node
// বাংলা মন্তব্য: Edge catalog ও Node gateway cache injection-এর বিদ্যমান আচরণ অক্ষত রাখার টেস্ট।
import { describe, expect, it, vi } from 'vitest';
import { createApiApp } from './app';
import { CANONICAL_SERVER_MODELS, DEFAULT_MODEL_ID } from '../shared/platformCatalog';
import { onRequest } from '../../functions/api/models';

const URL = 'https://supremeai-studio.pages.dev/api/models';

describe('একীভূত models contract', () => {
  it('Edge-এ gateway ছাড়া canonical catalog দেয়', async () => {
    const edge = await onRequest({ request: new Request(URL) });
    expect(await edge.json()).toEqual({
      models: CANONICAL_SERVER_MODELS,
      defaultModel: DEFAULT_MODEL_ID,
      source: 'edge-studio',
    });
    const hono = await createApiApp().request(URL);
    expect(hono.status).toBe(200);
    expect(await hono.json()).toEqual({
      models: CANONICAL_SERVER_MODELS,
      defaultModel: DEFAULT_MODEL_ID,
      source: 'edge-studio',
    });
  });

  it('Node-এ gateway merge ও defaultModel রাখে; মূল canonical map mutate করে না', async () => {
    const original = structuredClone(CANONICAL_SERVER_MODELS);
    const gateway = vi.fn(async () => ({
      models: { auto: { name: 'Gateway Auto' }, custom: { name: 'Custom' } },
      defaultModel: 'custom',
    }));
    const app = createApiApp({ fetchGatewayJson: gateway });
    const res = await app.request(URL);
    const body = await res.json();
    expect(gateway).toHaveBeenCalledWith('/api/v1/models');
    expect(body.source).toBe('gateway+canonical');
    expect(body.defaultModel).toBe('custom');
    expect(body.models.auto.name).toBe('Gateway Auto');
    expect(body.models.custom.name).toBe('Custom');
    expect(Object.keys(body.models).length).toBe(Object.keys(original).length + 1);
    expect(CANONICAL_SERVER_MODELS).toEqual(original);
  });

  it('gateway-এর legacy default_model সমর্থন করে', async () => {
    const app = createApiApp({
      fetchGatewayJson: async () => ({ models: {}, default_model: 'legacy' }),
    });
    expect((await (await app.request(URL)).json()).defaultModel).toBe('legacy');
  });

  it.each([null, {}, { models: [] }, { models: 'invalid' }])(
    'অবৈধ gateway payload %j হলে canonical fallback দেয়',
    async (remote) => {
      const app = createApiApp({ fetchGatewayJson: async () => remote });
      expect(await (await app.request(URL)).json()).toEqual({
        models: CANONICAL_SERVER_MODELS,
        defaultModel: DEFAULT_MODEL_ID,
        source: 'canonical',
      });
    }
  );

  it('gateway callback ব্যর্থ হলেও 200 canonical fallback দেয়', async () => {
    const app = createApiApp({
      fetchGatewayJson: async () => {
        throw new Error('offline');
      },
    });
    const res = await app.request(URL);
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('canonical');
  });

  it('HEAD-এ body নেই এবং POST-এ 405', async () => {
    const app = createApiApp();
    const head = await app.request(URL, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await app.request(URL, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('app-গুলোর injected gateway ও Edge catalog আলাদা থাকে', async () => {
    const first = createApiApp({
      fetchGatewayJson: async () => ({ models: {}, defaultModel: 'one' }),
    });
    const second = createApiApp({
      fetchGatewayJson: async () => ({ models: {}, defaultModel: 'two' }),
    });
    expect((await (await first.request(URL)).json()).defaultModel).toBe('one');
    expect((await (await second.request(URL)).json()).defaultModel).toBe('two');
    expect((await (await createApiApp().request(URL)).json()).defaultModel).toBe(DEFAULT_MODEL_ID);
  });
});
