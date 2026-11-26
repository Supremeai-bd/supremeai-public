# বাংলা মন্তব্য: stdlib-only preflight regression; network/real credential/DB write নেই।
from __future__ import annotations

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_sync_prerequisites as check


class TestSyncPrerequisites(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def run_check(self, token: str = ""):
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"GH_TOKEN": token}),
            contextlib.redirect_stdout(output),
        ):
            code = check.main(["--patch-dir", str(self.directory)])
        return code, output.getvalue()

    def test_empty_queue_needs_no_credential(self):
        self.assertEqual(self.run_check()[0], 0)

    def test_absent_directory_needs_no_credential(self):
        self.directory = self.directory / "absent"
        self.assertEqual(self.run_check()[0], 0)

    def test_ignores_non_patch_files_and_directories(self):
        (self.directory / "notes.md").write_text("notes")
        (self.directory / "folder.patch").mkdir()
        self.assertEqual(self.run_check()[0], 0)

    def test_queued_patch_without_credential_fails_visibly(self):
        (self.directory / "queued.patch").write_text("diff")
        code, output = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("::error", output)
        self.assertIn("No patch was applied", output)

    def test_whitespace_token_is_not_usable(self):
        (self.directory / "queued.diff").write_text("diff")
        self.assertEqual(self.run_check("  \n")[0], 1)

    def test_present_token_passes_but_never_echoes_it(self):
        (self.directory / "queued.PATCH").write_text("diff")
        token = "unit-test-sensitive-sentinel"
        code, output = self.run_check(token)
        self.assertEqual(code, 0)
        self.assertNotIn(token, output)
        self.assertIn("target access is checked", output)

    def test_cli_returns_nonzero_without_printing_environment(self):
        (self.directory / "queued.patch").write_text("diff")
        env = {**os.environ, "GH_TOKEN": "", "PRIVATE_SENTINEL": "do-not-print-this"}
        result = subprocess.run(
            [
                sys.executable,
                str(Path(check.__file__)),
                "--patch-dir",
                str(self.directory),
            ],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(env["PRIVATE_SENTINEL"], result.stdout + result.stderr)

    def test_workflow_checks_before_the_conditionally_skipped_apply(self):
        workflow = (
            Path(__file__).resolve().parents[2]
            / ".github/workflows/unified-pipeline.yml"
        )
        text = workflow.read_text()
        group = text[
            text.index("  sync-cross-repo-patches:") : text.index(
                "  server-budget-report:"
            )
        ]
        marker = "      - name: Check queued sync prerequisites"
        self.assertIn(marker, group)
        preflight = group[
            group.index(marker) : group.index(
                "      - name: Apply patches to supremeai"
            )
        ]
        self.assertNotIn("        if:", preflight)
        self.assertIn(
            "secrets.SELF_HEAL_PAT || secrets.ORGANIZATION_SYNC_TOKEN", preflight
        )
        self.assertIn(
            "python scripts/ci/check_sync_prerequisites.py --patch-dir .patches/private",
            preflight,
        )


if __name__ == "__main__":
    unittest.main()
