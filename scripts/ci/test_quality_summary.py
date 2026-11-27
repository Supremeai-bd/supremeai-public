import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import quality_summary as qs  # noqa: E402


ESLINT = [
    {
        "filePath": "/repo/src/a.ts",
        "messages": [
            {"ruleId": "no-unused-vars", "severity": 1, "message": "x is unused", "line": 3},
            {"ruleId": "no-undef", "severity": 2, "message": "y | undefined", "line": 9},
        ],
    },
    {"filePath": "/repo/src/b.ts", "messages": [{"ruleId": "no-unused-vars", "severity": 1, "message": "z", "line": 1}]},
]


class QualitySummaryTest(unittest.TestCase):
    def test_eslint_findings_grouped_and_every_warning_listed(self):
        findings = qs.parse_eslint(ESLINT, "/repo")
        self.assertEqual(len(findings), 3)
        md = qs.render_findings("Code Quality", findings)
        self.assertIn("**1 error(s) · 2 warning(s)**", md)
        self.assertIn("| `no-unused-vars` | warning | 2 |", md)
        self.assertIn("`src/a.ts:3`", md)
        self.assertIn("`src/b.ts:1`", md)
        self.assertIn("y \\| undefined", md)  # pipes escaped for the table

    def test_tsc_errors_parsed(self):
        log = "src/x.ts(12,5): error TS2322: Type 'a' is not assignable.\nnoise\n"
        found = qs.parse_tsc(log)
        self.assertEqual(found[0]["rule"], "TS2322")
        self.assertEqual(found[0]["line"], 12)

    def test_annotations_errors_first_and_capped(self):
        findings = qs.parse_eslint(ESLINT, "/repo")
        ann = qs.annotations(findings, limit=2)
        self.assertEqual(len(ann), 2)
        self.assertTrue(ann[0].startswith("::error file=src/a.ts,line=9"))

    def test_main_exit_code_and_summary_file(self):
        with tempfile.TemporaryDirectory() as d:
            rep = Path(d, "eslint.json")
            summary = Path(d, "summary.md")
            warn_only = [{"filePath": "src/c.ts", "messages": [{"ruleId": "r", "severity": 1, "message": "m", "line": 2}]}]
            rep.write_text(json.dumps(warn_only))
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), mock.patch("sys.stdout"):
                self.assertEqual(qs.main(["eslint", str(rep)]), 0)  # warnings never block
                rep.write_text(json.dumps(ESLINT))
                self.assertEqual(qs.main(["eslint", str(rep)]), 1)  # errors block
            self.assertIn("warning(s)", summary.read_text())

    def test_sarif_summary(self):
        sarif = {
            "runs": [
                {
                    "tool": {"driver": {"rules": [{"id": "js/xss", "properties": {"security-severity": "7.8"}}]}},
                    "results": [
                        {
                            "ruleId": "js/xss",
                            "level": "error",
                            "message": {"text": "XSS"},
                            "locations": [{"physicalLocation": {"artifactLocation": {"uri": "src/x.ts"}, "region": {"startLine": 4}}}],
                        }
                    ],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as d:
            Path(d, "js.sarif").write_text(json.dumps(sarif))
            findings = qs.parse_sarif_dir(Path(d))
            self.assertEqual(findings[0]["file"], "src/x.ts")
            summary = Path(d, "s.md")
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), mock.patch("sys.stdout"):
                self.assertEqual(qs.main(["sarif", d]), 0)
            self.assertIn("high/critical", summary.read_text())

    def test_sarif_links_resolve_to_locations(self):
        related = [
            {"id": 1, "physicalLocation": {"artifactLocation": {"uri": "src/a.ts"}, "region": {"startLine": 9}}},
        ]
        self.assertEqual(
            qs._resolve_sarif_links("Request depends on [file data](1) and [x](2).", related),
            "Request depends on file data (src/a.ts:9) and x.",
        )


if __name__ == "__main__":
    unittest.main()
