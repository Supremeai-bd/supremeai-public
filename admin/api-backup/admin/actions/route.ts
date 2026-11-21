import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { adminAuditEvents } from "@/db/schema";
import { adminAuthConfigured, hasAdminSession } from "@/lib/admin-security";
import { callMcpTools } from "@/lib/mcp-client";

export const dynamic = "force-dynamic";

function indicatesRejectedResult(value: unknown): boolean {
  if (typeof value === "string") {
    return /\\b(rejected|failed|unable to claim|could not claim|not claimable)\\b/i.test(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const state = typeof result.status === "string" ? result.status.toLowerCase() : "";
  return result.ok === false || result.success === false || result.claimed === false ||
    (typeof result.error === "string" && result.error.length > 0) || ["error", "failed", "rejected"].includes(state);
}

export async function POST(request: NextRequest) {
  if (!adminAuthConfigured()) {
    return NextResponse.json(
      { error: "Owner access is not configured. Privileged actions remain locked." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
  if (!hasAdminSession(request)) {
    return NextResponse.json(
      { error: "An owner session is required for this action." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; issueNumber?: unknown; confirmed?: unknown }
    | null;
  if (body?.action !== "claim-work-order") {
    return NextResponse.json({ error: "This operation is not available." }, { status: 400 });
  }
  const issueNumber = body.issueNumber;
  if (!Number.isSafeInteger(issueNumber) || typeof issueNumber !== "number" || issueNumber < 1) {
    return NextResponse.json({ error: "A valid work-order number is required." }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 400 });
  }

  let eventId: number;
  try {
    const [event] = await db
      .insert(adminAuditEvents)
      .values({
        actor: "owner",
        action: "bridge.work_claim",
        target: `#${issueNumber}`,
        outcome: "pending",
        summary: "Owner-confirmed work-order claim requested.",
      })
      .returning({ id: adminAuditEvents.id });
    eventId = event.id;
  } catch {
    return NextResponse.json(
      { error: "Audit storage is unavailable; the action was not sent." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const finishAudit = async (outcome: "success" | "failed", summary: string) => {
    await db
      .update(adminAuditEvents)
      .set({ outcome, summary })
      .where(eq(adminAuditEvents.id, eventId));
  };

  try {
    const result = await callMcpTools([
      { key: "claim", name: "work_claim", arguments: { issueNumber } },
    ]);
    if (!result.claim?.ok || indicatesRejectedResult(result.claim.value)) {
      await finishAudit("failed", "The MCP Bridge did not accept the work-order claim.");
      return NextResponse.json(
        { error: "The Bridge could not complete this claim. Refresh the queue and try again." },
        { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    try {
      await finishAudit("success", "The MCP Bridge accepted the owner-confirmed claim request.");
    } catch {
      return NextResponse.json(
        {
          ok: true,
          auditWarning: true,
          message: "The claim was accepted, but its audit record could not be updated.",
        },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }
    return NextResponse.json(
      { ok: true, message: "The Bridge accepted the claim request.", eventId },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    await finishAudit("failed", "The MCP Bridge connection failed during the claim request.").catch(() => undefined);
    return NextResponse.json(
      { error: "The Bridge could not complete this claim. Refresh the queue and try again." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
