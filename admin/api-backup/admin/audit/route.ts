import { NextResponse } from "next/server";
import { callMcpTools, STUDIO_URL, type ToolOutcome } from "@/lib/mcp-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function shortText(value: unknown, max = 300): string | null {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || null : null;
}

function report(outcomes: Record<string, ToolOutcome> | null, key: string) {
  const outcome = outcomes?.[key];
  if (!outcome?.ok) return { available: false, ok: false, reason: "The MCP audit tool is temporarily unavailable." };
  const value = record(outcome.value);
  const headers = record(value.securityHeaders);
  return {
    available: typeof value.available === "boolean" ? value.available : true,
    ok: typeof value.ok === "boolean" ? value.ok : undefined,
    degraded: typeof value.degraded === "boolean" ? value.degraded : undefined,
    mode: shortText(value.mode, 60),
    status: typeof value.status === "number" ? value.status : undefined,
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : undefined,
    verdict: shortText(value.verdict, 60),
    summary: shortText(value.summary, 400),
    reason: shortText(value.reason, 400),
    hint: shortText(value.hint, 300),
    securityHeaders:
      Object.keys(headers).length > 0
        ? {
            strictTransportSecurity: headers.strictTransportSecurity === true,
            contentSecurityPolicy: headers.contentSecurityPolicy === true,
            xFrameOptions: headers.xFrameOptions === true,
            xContentTypeOptions: headers.xContentTypeOptions === true,
          }
        : undefined,
  };
}

export async function POST() {
  let outcomes: Record<string, ToolOutcome> | null = null;
  try {
    outcomes = await callMcpTools([
      { key: "http", name: "devtools_audit", arguments: { url: STUDIO_URL, device: "desktop" } },
      {
        key: "performance",
        name: "devtools_performance_trace",
        arguments: { url: STUDIO_URL, waitMs: 1000, timeoutMs: 8000 },
      },
      {
        key: "console",
        name: "devtools_console_errors",
        arguments: { url: STUDIO_URL, waitMs: 1000, timeoutMs: 8000 },
      },
      {
        key: "network",
        name: "devtools_network_failures",
        arguments: { url: STUDIO_URL, waitMs: 1000, slowMs: 1500, timeoutMs: 8000 },
      },
    ]);
  } catch {
    return NextResponse.json(
      { available: false, error: "The MCP audit connection could not be established." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    {
      target: STUDIO_URL,
      checkedAt: new Date().toISOString(),
      http: report(outcomes, "http"),
      performance: report(outcomes, "performance"),
      console: report(outcomes, "console"),
      network: report(outcomes, "network"),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
