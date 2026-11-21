type JsonRecord = Record<string, unknown>;

type ToolCall = {
  key: string;
  name: string;
  arguments?: JsonRecord;
};

export type ToolOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const DEFAULT_MCP_URL = "https://supremeai-mcp-tower-live.onrender.com/mcp";
export const STUDIO_URL = "https://supremeai-studio.pages.dev/";

function mcpEndpoint(): string {
  const configured =
    process.env.SUPREMEAI_MCP_URL?.trim() ||
    process.env.SUPREMEAI_MCP_TOWER_URL?.trim() ||
    process.env.MCP_TOWER_URL?.trim() ||
    DEFAULT_MCP_URL;
  const url = new URL(configured);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.toLowerCase().endsWith("/mcp")) {
    url.pathname = `${url.pathname}/mcp`;
  }
  return url.toString();
}

export function mcpHealthEndpoint(): string {
  const url = new URL(mcpEndpoint());
  const basePath = url.pathname.replace(/\/mcp\/?$/i, "").replace(/\/+$/, "");
  url.pathname = `${basePath}/health`;
  url.search = "";
  return url.toString();
}

function parsePayload(body: string): JsonRecord | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : null;
  } catch {
    // MCP Streamable HTTP commonly responds as an SSE message.
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .reverse();

  for (const line of dataLines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object") return parsed as JsonRecord;
    } catch {
      // Try the next SSE data event.
    }
  }
  return null;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "MCP request failed";
  return message
    .replace(/(authorization|api[_ -]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

async function sendMcpRequest(
  endpoint: string,
  body: JsonRecord,
  sessionId?: string,
): Promise<{ payload: JsonRecord | null; sessionId: string | null }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = parsePayload(await response.text());
  if (!response.ok) {
    throw new Error(`MCP returned HTTP ${response.status}`);
  }
  const rpcError = payload?.error;
  if (rpcError && typeof rpcError === "object") {
    const rpcMessage = (rpcError as JsonRecord).message;
    throw new Error(typeof rpcMessage === "string" ? rpcMessage : "MCP request was rejected");
  }

  return {
    payload,
    sessionId: response.headers.get("mcp-session-id") || sessionId || null,
  };
}

function extractToolValue(payload: JsonRecord | null): unknown {
  const result = payload?.result;
  if (!result || typeof result !== "object") {
    throw new Error("MCP returned an empty tool result");
  }
  const resultRecord = result as JsonRecord;
  if (resultRecord.isError === true) {
    const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
    const text = content
      .map((entry) => (entry && typeof entry === "object" ? (entry as JsonRecord).text : null))
      .find((entry): entry is string => typeof entry === "string");
    throw new Error(text || "MCP tool reported an error");
  }
  if (resultRecord.structuredContent !== undefined) return resultRecord.structuredContent;

  const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
  const text = content
    .map((entry) => (entry && typeof entry === "object" ? (entry as JsonRecord).text : null))
    .find((entry): entry is string => typeof entry === "string");
  if (typeof text === "string") {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return result;
}

export async function callMcpTools(calls: ToolCall[]): Promise<Record<string, ToolOutcome>> {
  const endpoint = mcpEndpoint();
  const initialize = await sendMcpRequest(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "supremeai-admin-dashboard", version: "1.0.0" },
    },
  });
  const sessionId = initialize.sessionId;
  if (!sessionId) throw new Error("MCP did not establish a session");

  let requestId = 2;
  try {
    await sendMcpRequest(
      endpoint,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      sessionId,
    );

    const entries = await Promise.all(
      calls.map(async (call): Promise<[string, ToolOutcome]> => {
        const id = requestId++;
        try {
          const response = await sendMcpRequest(
            endpoint,
            {
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: call.name, arguments: call.arguments || {} },
            },
            sessionId,
          );
          return [call.key, { ok: true, value: extractToolValue(response.payload) }];
        } catch (error) {
          return [call.key, { ok: false, error: safeError(error) }];
        }
      }),
    );
    return Object.fromEntries(entries);
  } finally {
    await fetch(endpoint, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    }).catch(() => undefined);
  }
}
