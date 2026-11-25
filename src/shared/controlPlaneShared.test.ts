import { describe, it, expect } from 'vitest';
import {
  categorizeTool,
  transformMcpToolsList,
  parseDeepDiagnoseResult,
  parseEcosystemDiagnosticsResult,
  CONTROL_PLANE_ROUTE_SPECS,
  FALLBACK_MCP_TOOLS,
} from './controlPlaneShared';

describe('controlPlaneShared', () => {
  describe('categorizeTool', () => {
    it('correctly maps tool name prefixes to their categories', () => {
      expect(categorizeTool('memory_recall')).toBe('memory');
      expect(categorizeTool('bridge_work_order')).toBe('bridge');
      expect(categorizeTool('work_claim')).toBe('bridge');
      expect(categorizeTool('github_actions_op')).toBe('github');
      expect(categorizeTool('qdrant_search')).toBe('qdrant');
      expect(categorizeTool('supabase_health')).toBe('qdrant');
      expect(categorizeTool('devtools_audit')).toBe('devtools');
      expect(categorizeTool('firecrawl_scrape')).toBe('devtools');
      expect(categorizeTool('graphify_call')).toBe('devtools');
      expect(categorizeTool('codebase_graph_query')).toBe('devtools');
      expect(categorizeTool('misc_kaggle')).toBe('compute');
      expect(categorizeTool('harness_ping')).toBe('compute');
      expect(categorizeTool('notify_send_telegram')).toBe('notifications');
      expect(categorizeTool('status')).toBe('system');
      expect(categorizeTool('unknown_custom_tool')).toBe('system');
    });
  });

  describe('transformMcpToolsList', () => {
    it('transforms raw tools from MCP Tower into structured McpToolDescriptors', () => {
      const rawTools = [
        {
          name: 'memory_recall',
          description: 'Recall memory',
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        {
          name: 'action_redis_flush',
          description: 'Flush Redis cache',
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ];
      const result = transformMcpToolsList(rawTools, 'https://test-mcp/agents/foo/mcp');

      expect(result.provenance).toBe('live-mcp');
      expect(result.endpoint).toBe('https://test-mcp/agents/foo/mcp');
      expect(result.tools).toHaveLength(2);

      expect(result.tools[0].category).toBe('memory');
      expect(result.tools[0].readOnlyHint).toBe(true);
      expect(result.tools[0].destructiveHint).toBe(false);

      expect(result.tools[1].category).toBe('system');
      expect(result.tools[1].readOnlyHint).toBe(false);
      expect(result.tools[1].destructiveHint).toBe(true);
    });

    it('handles empty or non-array inputs safely', () => {
      const result = transformMcpToolsList(null, 'https://endpoint');
      expect(result.tools).toEqual([]);
    });
  });

  describe('parseDeepDiagnoseResult', () => {
    it('parses valid MCP content text JSON payload', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'All 5 layers healthy',
              releaseGate: 'GO',
            }),
          },
        ],
      };
      const report = parseDeepDiagnoseResult(mcpResult, 'api', 'is_healthy');
      expect(report.summary).toBe('All 5 layers healthy');
      expect(report.releaseGate).toBe('GO');
      expect(report.service).toBe('api');
      expect(report.truthMatrix[0].status).toBe('pass');
    });

    it('handles degraded status and non-JSON string gracefully', () => {
      const mcpResult = {
        content: [{ type: 'text', text: 'Error in container spinup' }],
      };
      const report = parseDeepDiagnoseResult(mcpResult, 'mcp-tower', 'probe');
      expect(report.summary).toContain('Error in container spinup');
      expect(report.releaseGate).toBe('GO');
    });
  });

  describe('parseEcosystemDiagnosticsResult', () => {
    it('returns reachable status when either status or parity payload exists', () => {
      const res = parseEcosystemDiagnosticsResult({ status: 'ok' }, null, 'https://endpoint', 'https://gateway');
      expect(res.mcpReachable).toBe(true);
      expect(res.findings[0].severity).toBe('healthy');
    });

    it('returns warning status when both payloads are null', () => {
      const res = parseEcosystemDiagnosticsResult(null, null, 'https://endpoint', 'https://gateway');
      expect(res.mcpReachable).toBe(false);
      expect(res.findings[0].severity).toBe('warning');
    });
  });

  describe('CONTROL_PLANE_ROUTE_SPECS', () => {
    it('defines expected routes and flags edgeSupported correctly', () => {
      const overview = CONTROL_PLANE_ROUTE_SPECS.find((r) => r.path === 'overview');
      expect(overview).toBeDefined();
      expect(overview?.edgeSupported).toBe(true);

      const stream = CONTROL_PLANE_ROUTE_SPECS.find((r) => r.path === 'service-health/stream');
      expect(stream).toBeDefined();
      expect(stream?.edgeSupported).toBe(false);
    });
  });
});
