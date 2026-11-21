# Backend hardening patches (`Supremeai-bd/supremeai`)

These patches fix the three regressions found in the 2026-11-21 audit. They live
here because this session's branch belongs to the frontend repo and must not
push to another repository's branches.

Verified against backend `main` @ **`be0bacb`** (#735). Apply with `git apply`
from the backend repo root, in order.

```bash
cd /path/to/supremeai            # backend repo, on main
git checkout -b fix/audit-2026-11-21
git apply /path/to/01-ci-restore-coverage-and-guards.patch
git apply /path/to/02-mcp-tower-master-tools.patch
# or, equivalently, both at once:
# git apply /path/to/00-both-in-order.patch
```

Both patches apply cleanly to a pristine clone of `be0bacb` and were re-checked
after the rebase onto #735 (which landed mid-review and touched the same
workflow tail).

---

## 01 — restore test coverage + real typing/sprawl guards (6 files, +1224)

### The regression this fixes

`#731` deleted `full-test-suite.yml` while consolidating nine workflows into
four. The consolidation itself was correct (no duplicate PR runs). What went
with it was the only job that ran the full corpus: **every remaining tier — PR,
nightly, self-hosted, emergency — runs `config/ci/pr-battery.args`**, which is
**36 files / ~439 test functions out of 11,928 (≈3.7%)**. So nothing anywhere
proved the other 96% still passed.

| Part | What it does |
|---|---|
| `nightly-full-suite-local` | Full `tests/`, `core/tests/`, `gateway/tests/` (matrix ×3), `-m 'not (external or requires_network or hitl or e2e)'`, on the **existing `[self-hosted, local-pc]` runner → 0 cloud minutes**. |
| `nightly-full-suite-cloud` | Same matrix on `ubuntu-24.04`, only when the local runner is offline, gated by repo variable `MCP_NIGHTLY_FULL_SUITE != 'off'`. |
| `container-security.yml` | Restored verbatim from `b36a716` — Trivy lockfile CVE scan (HIGH/CRITICAL, report-only) on PR/push/weekly. `#731` deleted it along with the image workflow; the dependency gate had no replacement. |
| `scripts/ci/check_mypy_ratchet.py` + `config/ci/mypy-ratchet.txt` | `core/pyproject.toml` has declared `[tool.mypy] strict = true` forever, but **no workflow ran mypy** — 400k+ lines and 434 `# type: ignore` with zero type-level regression detection. This enforces an 8-module baseline that is *clean today*, rejects bare `# type: ignore`, and may only grow. |
| `scripts/ci/check_module_budget.py` | `core/` has 150 top-level modules (11 `config*`, 4 `health*`, 3 `intent*`). Instead of a risky merge of 230+ import sites, the count becomes **non-increasing**: new responsibility lands in an existing module. |
| `requirements-dev.txt` | pins `mypy==2.4.1` (the version the baseline was verified against). |

Both guards are wired into `fast-gate` (cloud PR path) **and** the self-hosted
heavy gate, so neither path can skip them.

**Verified:** YAML parses (23 jobs); script exits 0 on the current tree and
exits 2 when a probe module is added (`core/zz_temp_probe.py` → `151 > 150`);
mypy ratchet reports `mypy ratchet OK (8 modules type-clean)`.

### What I deliberately did *not* do

I originally flagged "11 `config*.py` modules = sprawl" and proposed merging
them. Reading the import graph changed that: `config_fields` and
`config_validation` are imported **only** by `config.py` (they are the internal
decomposition of `Settings`), and `health_policy` / `health_routes` are imported
by `app_builder.py` inside functions — a naive importer grep reports them as
dead code, which they are not. Merging would have been cosmetic churn across
230+ import sites. The budget ratchet gets the real benefit (sprawl stops
growing) at a fraction of the risk.

---

## 02 — MCP Tower master tools (6 files, +765)

Goal (your framing): **keep every capability, let any authorized agent find and
call it, and stop handing ~178 tool descriptors to the model every turn.**

`docs/TOOL-EXPOSURE.md` §8 rejected a single `supremeai(operation, …)` mega-tool
because merging schemas breaks per-tool zod validation and blurs the
tool→provider→action→R-level policy SSoT (#2429). That reasoning is right, so
this patch does **not** merge anything. It adds three descriptors that *route*:

| Tool | Returns |
|---|---|
| `tower_catalog` | Paginated, RBAC-filtered search over the **entire** registry — including tools hidden from `tools/list`. name, domain, risk, one-line summary. |
| `tower_describe` | The authoritative contract of one tool (params, types, required flags, risk, annotations), reflected from the live registration. |
| `tower_invoke` | Dispatches to the target tool's **own** governed handler: its real zod shape is parsed first, then RBAC + per-(identity,tool) rate limit + payload cap + timeout + truncation run exactly as on a direct call. |

### Why this is "real data, never invented data"

1. `tower_invoke` **never synthesizes** a payload — it returns the target's
   response verbatim, or `isError` carrying the target's own error.
2. Invalid arguments are rejected against the target's **real** schema with a
   field-level message (`serviceId: Expected string, received number`), so a
   model self-corrects instead of reporting a fake success. The handler does not
   run at all (asserted in the test).
3. Unknown tool names return the **closest real names** (Levenshtein), never an
   invented one.
4. Destructive targets require `confirm: true` at the master layer, on top of
   whatever guard the target already has.
5. Meta-tool recursion (`tower_invoke` → `tower_invoke`) is refused.
6. No second metadata source: the catalog is populated from the **same**
   interception point in `src/index.ts` that installs the governance wrapper, so
   a descriptor can never drift from what the call path enforces.

### Surfacing

- the three masters are appended to `STANDARD_CURATED_TOOLS`;
- a new `catalog` tool profile exposes masters + 8 ambient read tools
  (11 descriptors instead of ~180) for clients that want the smallest surface;
- `tower_invoke` is added to `MUTATING_TOOLS`, so the `readonly` profile cannot
  gain a write path through the router;
- rollback stays a one-env flip: `MCP_DISCOVERY_FILTER=off`.

**Verified on a pristine clone of `be0bacb`:** `npx tsc --noEmit` clean;
`test_tower_catalog.ts` passes all six groups (discovery, describe,
validation-first invoke, destructive confirm, RBAC zero-trust, and an end-to-end
run through the real MCP SDK over `InMemoryTransport`); existing
`test_tool_visibility.ts`, `test_registry.ts`, `test_summary.ts`,
`test_mcp_presence.ts` still pass.

The new test is wired into `test:unit` and `test:tower-ci`.

---

## Suggested PR split

1. `fix(ci): restore nightly full battery, container CVE gate, mypy + module ratchets`
2. `feat(mcp-tower): catalog/describe/invoke progressive disclosure (178 tools, 3 descriptors)`

The second depends on nothing in the first and can merge independently.
