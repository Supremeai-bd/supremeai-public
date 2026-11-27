#!/usr/bin/env python3
"""Render CI quality findings into the GitHub job summary.

বাংলা: GitHub-এ কোনো warning যেন চাপা না পড়ে — ESLint-এর সব warning/error,
TypeScript error, npm audit এবং CodeQL (SARIF) ফলাফল এক জায়গায় Job Summary-তে
টেবিল আকারে দেখানো হয় (rule অনুযায়ী, ফাইল অনুযায়ী, এবং পুরো তালিকা), সাথে
প্রথম কয়েকটার inline annotation। Warning merge আটকায় না, কিন্তু দৃশ্যমান থাকে;
error থাকলে exit 1।

Usage:
  quality_summary.py eslint  <eslint.json> [--tsc tsc.log] [--audit audit.json]
  quality_summary.py sarif   <dir-with-.sarif files>

Writes markdown to $GITHUB_STEP_SUMMARY (or stdout when unset) and workflow
annotation commands to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

MAX_DETAIL_ROWS = 1500
MAX_ANNOTATIONS = 50
TSC_ERROR_RE = re.compile(r"^(?P<file>[^\s(][^(]*)\((?P<line>\d+),(?P<col>\d+)\): error (?P<code>TS\d+): (?P<msg>.*)$")


def _rel(path: str, root: str) -> str:
    try:
        return os.path.relpath(path, root) if os.path.isabs(path) else path
    except ValueError:
        return path


def _md_cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ").strip()


def _escape_annotation(text: str) -> str:
    return str(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def parse_eslint(report: list[dict], root: str) -> list[dict]:
    findings = []
    for file_result in report:
        rel = _rel(file_result.get("filePath", ""), root)
        for msg in file_result.get("messages", []):
            findings.append(
                {
                    "file": rel,
                    "line": int(msg.get("line") or 1),
                    "rule": msg.get("ruleId")
                    or (
                        "parse-error"
                        if msg.get("fatal")
                        else "unused-eslint-disable"
                        if str(msg.get("message", "")).startswith("Unused eslint-disable")
                        else "eslint"
                    ),
                    "severity": "error" if msg.get("severity") == 2 else "warning",
                    "message": msg.get("message", ""),
                }
            )
    return findings


def parse_tsc(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        m = TSC_ERROR_RE.match(line.strip())
        if m:
            out.append(
                {
                    "file": m["file"].strip(),
                    "line": int(m["line"]),
                    "rule": m["code"],
                    "severity": "error",
                    "message": m["msg"],
                }
            )
    return out


def parse_audit(data: dict) -> dict[str, int]:
    vulns = (data.get("metadata") or {}).get("vulnerabilities") or {}
    return {k: int(vulns.get(k, 0)) for k in ("critical", "high", "moderate", "low", "info")}


_SARIF_LINK = re.compile(r"\[([^\]]+)\]\((\d+)\)")


def _resolve_sarif_links(text: str, related: list[dict]) -> str:
    """Turn CodeQL's ``[file data](1)`` placeholders into ``file data (path:line)``."""
    where: dict[int, str] = {}
    for rel in related or []:
        phys = rel.get("physicalLocation") or {}
        uri = (phys.get("artifactLocation") or {}).get("uri")
        line = (phys.get("region") or {}).get("startLine")
        if uri and rel.get("id") is not None:
            where[int(rel["id"])] = f"{uri}:{line}" if line else uri

    def _sub(m: re.Match) -> str:
        loc = where.get(int(m.group(2)))
        return f"{m.group(1)} ({loc})" if loc else m.group(1)

    return _SARIF_LINK.sub(_sub, text)


def parse_sarif_dir(directory: Path) -> list[dict]:
    findings = []
    for sarif in sorted(directory.rglob("*.sarif")):
        data = json.loads(sarif.read_text(encoding="utf-8"))
        for run in data.get("runs", []):
            rules = {}
            for rule in ((run.get("tool") or {}).get("driver") or {}).get("rules", []) or []:
                sev = (rule.get("properties") or {}).get("security-severity")
                rules[rule.get("id")] = {
                    "name": (rule.get("shortDescription") or {}).get("text") or rule.get("id"),
                    "security": sev,
                }
            for res in run.get("results", []):
                loc = ((res.get("locations") or [{}])[0].get("physicalLocation") or {})
                rule_id = res.get("ruleId") or "codeql"
                level = res.get("level") or "warning"
                findings.append(
                    {
                        "file": (loc.get("artifactLocation") or {}).get("uri", "?"),
                        "line": int((loc.get("region") or {}).get("startLine") or 1),
                        "rule": rule_id,
                        "severity": "error" if level == "error" else "warning",
                        "message": _resolve_sarif_links(
                            (res.get("message") or {}).get("text", ""),
                            res.get("relatedLocations") or [],
                        ),
                        "security": (rules.get(rule_id) or {}).get("security"),
                    }
                )
    return findings


def render_findings(title: str, findings: list[dict], extra: list[str] | None = None) -> str:
    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = len(findings) - errors
    icon = "❌" if errors else ("⚠️" if warnings else "✅")
    lines = [f"## {icon} {title}", "", f"**{errors} error(s) · {warnings} warning(s)**", ""]
    if extra:
        lines += extra + [""]
    if not findings:
        lines.append("No findings. 🎉")
        return "\n".join(lines) + "\n"

    by_rule = Counter((f["rule"], f["severity"]) for f in findings)
    lines += ["### By rule", "", "| Rule | Severity | Count |", "|---|---|---:|"]
    for (rule, sev), n in by_rule.most_common():
        lines.append(f"| `{_md_cell(rule)}` | {sev} | {n} |")

    by_file = Counter(f["file"] for f in findings)
    lines += ["", "### By file (top 40)", "", "| File | Count |", "|---|---:|"]
    for file, n in by_file.most_common(40):
        lines.append(f"| `{_md_cell(file)}` | {n} |")

    ordered = sorted(findings, key=lambda f: (f["severity"] != "error", f["file"], f["line"]))
    lines += [
        "",
        f"<details><summary>All findings ({len(findings)})</summary>",
        "",
        "| Severity | Location | Rule | Message |",
        "|---|---|---|---|",
    ]
    for f in ordered[:MAX_DETAIL_ROWS]:
        lines.append(
            f"| {f['severity']} | `{_md_cell(f['file'])}:{f['line']}` | `{_md_cell(f['rule'])}` | {_md_cell(f['message'])[:300]} |"
        )
    if len(ordered) > MAX_DETAIL_ROWS:
        lines.append(f"| … | {len(ordered) - MAX_DETAIL_ROWS} more | | |")
    lines += ["", "</details>"]
    return "\n".join(lines) + "\n"


def _round_robin_by_rule(findings: list[dict]) -> list[dict]:
    """Interleave rules so one noisy rule cannot fill GitHub's 10-warnings-per-step cap."""
    buckets: dict[str, list[dict]] = {}
    for f in findings:
        buckets.setdefault(f["rule"], []).append(f)
    out: list[dict] = []
    while any(buckets.values()):
        for rule in list(buckets):
            if buckets[rule]:
                out.append(buckets[rule].pop(0))
    return out


def annotations(findings: list[dict], limit: int = MAX_ANNOTATIONS) -> list[str]:
    errors = [f for f in findings if f["severity"] == "error"]
    others = [f for f in findings if f["severity"] != "error"]
    ordered = _round_robin_by_rule(errors) + _round_robin_by_rule(others)
    return [
        f"::{f['severity']} file={f['file']},line={f['line']},title={_escape_annotation(f['rule'])}::{_escape_annotation(f['message'])}"
        for f in ordered[:limit]
    ]


def _write_summary(markdown: str) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(markdown + "\n")
    else:
        sys.stdout.write(markdown + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_es = sub.add_parser("eslint")
    p_es.add_argument("report")
    p_es.add_argument("--tsc")
    p_es.add_argument("--audit")
    p_sa = sub.add_parser("sarif")
    p_sa.add_argument("directory")
    args = parser.parse_args(argv)
    root = os.getcwd()

    if args.cmd == "sarif":
        directory = Path(args.directory)
        findings = parse_sarif_dir(directory) if directory.exists() else []
        extra = ["Full details: **Security → Code scanning** tab."]
        high = [f for f in findings if f.get("security") and float(f["security"]) >= 7.0]
        if high:
            extra.append(f"🔴 **{len(high)} high/critical security-severity finding(s).**")
        _write_summary(render_findings("CodeQL Security Analysis", findings, extra))
        for line in annotations(findings):
            print(line)
        return 0  # Code scanning alerts gate merges; the summary is for visibility.

    report = json.loads(Path(args.report).read_text(encoding="utf-8") or "[]")
    findings = parse_eslint(report, root)
    if args.tsc and Path(args.tsc).exists():
        findings += parse_tsc(Path(args.tsc).read_text(encoding="utf-8", errors="replace"))
    extra = []
    if args.audit and Path(args.audit).exists():
        try:
            counts = parse_audit(json.loads(Path(args.audit).read_text(encoding="utf-8") or "{}"))
            extra.append(
                "**npm audit (production deps):** "
                + " · ".join(f"{k}: {v}" for k, v in counts.items())
            )
        except json.JSONDecodeError:
            extra.append("**npm audit:** report unavailable")
    _write_summary(render_findings("Code Quality (ESLint + TypeScript)", findings, extra))
    for line in annotations(findings):
        print(line)
    return 1 if any(f["severity"] == "error" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
