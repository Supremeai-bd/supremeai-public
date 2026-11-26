"""বাংলা মন্তব্য: queued cross-repo patch credential ছাড়া নীরবে skip নয়; secret-এর মান কখনো print নয়।"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from apply_cross_repo_patch import find_patches


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patch-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    patches = find_patches(args.patch_dir)
    if not patches:
        print("[sync-preflight] No queued patches; credential not required.")
        return 0
    print(f"[sync-preflight] Queued patch files: {len(patches)}")
    if not os.environ.get("GH_TOKEN", "").strip():
        print(
            "::error title=Cross-repo sync blocked::Queued patches exist but no usable GH_TOKEN is available. Operator must verify the configured SELF_HEAL_PAT or ORGANIZATION_SYNC_TOKEN and target-repository access. No patch was applied."
        )
        return 1
    # বাংলা মন্তব্য: token উপস্থিতি permissions-এর প্রমাণ নয়; আসল clone/PR ধাপেই সেগুলো যাচাই হবে।
    print(
        "[sync-preflight] Credential available; target access is checked by the sync step."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
