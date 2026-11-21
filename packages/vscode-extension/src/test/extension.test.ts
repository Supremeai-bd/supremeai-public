/**
 * Test Battery for unified packages/vscode-extension
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { DEFAULT_LIVE_MCP_TOWER_URL, McpBridge } from '../mcp_bridge';
import { MODEL_TIERS, modelToTier, tierToModel } from '../models';

async function runTests(): Promise<void> {
  console.log('=== SupremeAI VS Code Extension Tests ===');

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
  assert.ok(commandIds.includes('supremeai.dispatchTask'));
  assert.ok(commandIds.includes('supremeai.viewRunway'));
  assert.ok(commandIds.includes('supremeai.emergencyStop'));
  assert.ok(commandIds.includes('supremeai.checkUpdates'));
  console.log('  ✓ package.json contributes all required commands & live MCP Tower URL');

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

  assert.strictEqual(MODEL_TIERS.length, 4);
  assert.strictEqual(tierToModel('fast'), 'llama-3.1-8b-instant');
  assert.strictEqual(tierToModel('balanced'), 'gpt-4o-mini');
  assert.strictEqual(tierToModel('pro'), 'claude-sonnet-4-5');
  assert.strictEqual(modelToTier('gpt-4o-mini'), 'balanced');

  const mockServer = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.url, '/v1/chat/completions');
      assert.strictEqual(req.headers['x-supremeai-key'], 'test-key-123');
      const parsed = JSON.parse(rawBody);
      assert.strictEqual(parsed.model, 'gpt-4o-mini');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'pong' } }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SupremeAI-Key': 'test-key-123',
      },
      body: JSON.stringify({
        model: tierToModel('balanced'),
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    assert.strictEqual(data.choices?.[0]?.message?.content, 'pong');
  } finally {
    mockServer.close();
  }

  console.log('ALL EXTENSION & UNIFIED VSIX TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
