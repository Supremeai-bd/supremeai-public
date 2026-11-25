/**
 * বাংলা মন্তব্য: SupremeAI VS Code Extension-এর ক্যানোনিকাল মডেল কন্ট্রাক্ট ও রিয়েল-টাইম ৪-প্ল্যাটফর্ম সিঙ্ক টেস্ট স্যুট।
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { DEFAULT_LIVE_MCP_TOWER_URL, McpBridge } from '../mcp_bridge';
import {
  FOUNDATION_MODELS,
  LIVE_THEMES,
  MODEL_TIERS,
  SYSTEM_ROLES,
  buildEffectiveSystemInstruction,
  modelToTier,
  tierToModel,
} from '../models';
import { VsCodeSyncEngine, VsCodeSyncEnvelope } from '../sync_client';

async function runTests(): Promise<void> {
  console.log('=== SupremeAI VS Code Extension & 4-Platform Sync Tests ===');

  const pkgPath = path.resolve(__dirname, '../../package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  assert.strictEqual(pkg.name, 'supremeai-vscode');
  assert.strictEqual(pkg.publisher, 'supremeai');
  assert.strictEqual(pkg.main, './out/extension.js');
  assert.strictEqual(
    pkg.contributes?.configuration?.properties?.['supremeai.towerUrl']?.default,
    DEFAULT_LIVE_MCP_TOWER_URL
  );
  const commandIds = pkg.contributes.commands.map((c: { command: string }) => c.command);
  for (const requiredCmd of [
    'supremeai.dispatchTask',
    'supremeai.viewRunway',
    'supremeai.emergencyStop',
    'supremeai.selectModel',
    'supremeai.selectRole',
    'supremeai.syncNow',
    'supremeai.checkUpdates',
  ]) {
    assert.ok(commandIds.includes(requiredCmd), `Missing command ${requiredCmd}`);
  }
  console.log('  ✓ package.json contributes all required commands, synced options & live MCP Tower URL');

  // Verify contract sync with root packages/contracts
  const rootContractsDir = path.resolve(__dirname, '../../../contracts');
  const localContractsDir = path.resolve(__dirname, '../contracts');
  for (const file of ['models.json', 'roles.json', 'themes.json', 'sync-protocol.json']) {
    const rootRaw = fs.readFileSync(path.join(rootContractsDir, file), 'utf-8');
    const localRaw = fs.readFileSync(path.join(localContractsDir, file), 'utf-8');
    assert.strictEqual(localRaw, rootRaw, `Contract drift detected in ${file}`);
  }
  console.log('  ✓ Embedded VSIX contracts match canonical packages/contracts/* 1:1');

  // Verify MCP Bridge offline resilience & input validation
  const bridge = new McpBridge('http://127.0.0.1:9999/mcp', 500);
  const health = await bridge.fetchHealth();
  assert.strictEqual(health.status, 'offline');
  assert.strictEqual(health.activeAgents, 0);
  const runway = await bridge.fetchRunway();
  assert.deepStrictEqual(runway, []);

  const invalidDispatch = await bridge.dispatchTask({
    repo: '',
    title: '',
    scopePaths: [],
    description: '',
  });
  assert.strictEqual(invalidDispatch.success, false);
  const invalidKill = await bridge.triggerEmergencyKill('12');
  assert.strictEqual(invalidKill, false);

  // Verify canonical models, aliases, roles, and themes match Web/Desktop/Mobile
  assert.strictEqual(FOUNDATION_MODELS.length, 6);
  assert.strictEqual(MODEL_TIERS.length, 7); // auto + 6 foundation models
  assert.strictEqual(SYSTEM_ROLES.length, 5);
  assert.strictEqual(LIVE_THEMES.length, 11);
  assert.strictEqual(tierToModel('auto'), 'auto');
  assert.strictEqual(tierToModel('supreme-core'), 'supreme-core');
  assert.strictEqual(tierToModel('supreme-spark'), 'supreme-spark');
  assert.strictEqual(tierToModel('supreme-reason'), 'supreme-reason');
  assert.strictEqual(tierToModel('supreme-deep'), 'supreme-deep');
  assert.strictEqual(tierToModel('supremeai-web'), 'supremeai-web');
  assert.strictEqual(tierToModel('supreme-web'), 'supremeai-web');
  assert.strictEqual(tierToModel('supremeai-api'), 'supremeai-api');
  assert.strictEqual(tierToModel('supreme-api'), 'supremeai-api');
  assert.strictEqual(tierToModel('fast'), 'supreme-spark');
  assert.strictEqual(tierToModel('balanced'), 'supreme-core');
  assert.strictEqual(tierToModel('pro'), 'supreme-reason');
  assert.strictEqual(modelToTier('auto'), 'auto');
  assert.strictEqual(modelToTier('supreme-reason'), 'supreme-reason');

  const bnPrompt = buildEffectiveSystemInstruction('supreme-architect', 'Use clean diagrams', 'bn');
  assert.ok(bnPrompt.includes('SupremeAI Lead Architect'));
  assert.ok(bnPrompt.includes('Use clean diagrams'));
  assert.ok(bnPrompt.includes('বাংলা'));
  console.log('  ✓ All 6 foundation models + Auto, 5 personas, and 11 themes match Web/Desktop/Mobile');

  // Verify Gateway Chat + Bidirectional Real-Time Cross-Platform Sync over HTTP/SSE
  const postedSyncEnvelopes: VsCodeSyncEnvelope[] = [];
  const postedPreferences: Array<Record<string, unknown>> = [];
  let sseResponse: http.ServerResponse | null = null;

  const mockServer = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'POST' && urlObj.pathname === '/v1/chat/completions') {
        assert.strictEqual(req.headers['x-supremeai-key'], 'test-key-123');
        const parsed = JSON.parse(rawBody);
        assert.strictEqual(parsed.model, 'supreme-reason');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'pong' } }],
          })
        );
        return;
      }

      if (req.method === 'GET' && urlObj.pathname === '/api/v1/user/preferences') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            user_id: 'dev@supremeai.studio',
            preferences: {
              studio_settings: {
                language: 'bn',
                defaultModel: 'supreme-deep',
                autoModelRouting: false,
              },
              chat_prefs: {
                selectedModelId: 'supreme-deep',
                autoModelRouting: false,
                activeRoleId: 'supreme-security',
                customInstruction: 'Audit OWASP top 10',
                runSettings: {
                  thinkingLevel: 'HIGH',
                  temperature: 0.3,
                  enableSearchGrounding: true,
                },
              },
            },
          })
        );
        return;
      }

      if (req.method === 'POST' && urlObj.pathname === '/api/v1/user/preferences') {
        postedPreferences.push(JSON.parse(rawBody || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.method === 'GET' && urlObj.pathname === '/api/v1/sync/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', envelopes: postedSyncEnvelopes }));
        return;
      }

      if (req.method === 'POST' && urlObj.pathname === '/api/v1/sync/state') {
        postedSyncEnvelopes.push(JSON.parse(rawBody));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', synced: true }));
        return;
      }

      if (req.method === 'GET' && urlObj.pathname === '/api/v1/sync/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        sseResponse = res;
        res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const engine = new VsCodeSyncEngine({
    syncUrl: baseUrl,
    gatewayUrl: baseUrl,
    apiKey: 'sk-test-sync-token-1234567890',
    syncEnabled: true,
    deviceId: 'dev-vsix-unit',
    pollIntervalMs: 0,
  });

  try {
    // 1. Gateway chat check with concrete model
    const chatRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SupremeAI-Key': 'test-key-123',
      },
      body: JSON.stringify({
        model: tierToModel('supreme-reason'),
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      }),
    });
    assert.strictEqual(chatRes.status, 200);
    const chatData = (await chatRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    assert.strictEqual(chatData.choices?.[0]?.message?.content, 'pong');

    // 2. Start sync engine -> hydrates from Web/Mobile remote preferences
    await engine.start();
    const hydrated = engine.getState();
    assert.strictEqual(hydrated.selectedModelId, 'supreme-deep');
    assert.strictEqual(hydrated.autoModelRouting, false);
    assert.strictEqual(hydrated.activeRoleId, 'supreme-security');
    assert.strictEqual(hydrated.language, 'bn');
    assert.strictEqual(hydrated.thinkingLevel, 'HIGH');
    assert.strictEqual(hydrated.temperature, 0.3);

    // 3. Change model + thinking level in VS Code -> pushes to sync/state & user/preferences
    await engine.updateOptions({
      selectedModelId: 'supremeai-web',
      thinkingLevel: 'XHIGH',
    });
    assert.ok(postedSyncEnvelopes.some((e) => e.domain === 'models' && e.platform === 'vsix'));
    assert.ok(postedPreferences.length >= 1);

    // 4. Simulate live SSE event arriving from Android Mobile App -> updates VS Code immediately
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(sseResponse, 'SSE stream should be connected');
    const mobileEnvelope: VsCodeSyncEnvelope = {
      protocolVersion: '1.0.0',
      deviceId: 'dev-android-mobile',
      platform: 'android',
      domain: 'models',
      updatedAt: Date.now() + 1000,
      revision: 2,
      payload: {
        selectedModelId: 'supreme-spark',
        autoModelRouting: false,
        runSettings: { thinkingLevel: 'LOW', temperature: 0.5 },
      },
    };
    (sseResponse as http.ServerResponse).write(
      `event: sync\ndata: ${JSON.stringify(mobileEnvelope)}\n\n`
    );
    await new Promise((r) => setTimeout(r, 50));

    const afterMobilePush = engine.getState();
    assert.strictEqual(afterMobilePush.selectedModelId, 'supreme-spark');
    assert.strictEqual(afterMobilePush.thinkingLevel, 'LOW');
    assert.strictEqual(afterMobilePush.temperature, 0.5);
    console.log('  ✓ Real-time bidirectional sync (Web/Desktop/Android <-> VSIX) verified');
  } finally {
    engine.dispose();
    if (sseResponse) {
      (sseResponse as http.ServerResponse).end();
    }
    mockServer.close();
  }

  console.log('ALL EXTENSION & UNIFIED VSIX TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
