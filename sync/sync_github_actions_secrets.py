#!/usr/bin/env python3
"""Sync local auth values into GitHub Actions repository secrets."""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sync.github_actions_secrets import (
    collect_default_secret_values,
    looks_like_github_token,
    pick_github_token,
    resolve_github_repo,
    sync_repo_secrets,
)
from sync.weread_env import load_dotenv

load_dotenv(ROOT_DIR)


def print_status(
    gh_pat: str,
    token_source: str,
    gh_repo: str,
    values: dict[str, str],
    api_key_source: str,
) -> None:
    print("GitHub Actions secret sync check")
    token_label = f"present ({token_source})" if gh_pat else "missing"
    print(f"- GitHub token: {token_label}")
    print(f"- GH_REPO: {'present' if gh_repo else 'missing'}")
    print(f"- API_TOKEN: {'present' if values['API_TOKEN'] else 'missing'} (.env/env)")
    print(
        f"- WEREAD_API_KEY: {'present' if values['WEREAD_API_KEY'] else 'missing'} "
        f"({api_key_source})"
    )


def prompt_for_github_token() -> tuple[str, str]:
    token = getpass.getpass("GitHub PAT (input hidden): ").strip()
    if not token:
        return "", ""
    if not looks_like_github_token(token):
        print("The value does not look like a GitHub token. Aborting.")
        return "", ""
    return token, "prompt"


def upsert_env_value(env_path: Path, key: str, value: str) -> None:
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    replaced = False
    updated = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            updated.append(f"{key}={value}")
            replaced = True
        else:
            updated.append(line)
    if not replaced:
        updated.append(f"{key}={value}")
    env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync local API_TOKEN and WEREAD_API_KEY to GitHub Actions secrets."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Only validate the local configuration without calling GitHub.",
    )
    parser.add_argument(
        "--save-token",
        action="store_true",
        help="When prompting for a PAT, save it to the repo-root .env as GH_PAT.",
    )
    args = parser.parse_args()

    gh_pat, token_source = pick_github_token()
    gh_repo = resolve_github_repo(ROOT_DIR)
    values, api_key_source = collect_default_secret_values(ROOT_DIR)

    print_status(gh_pat, token_source, gh_repo, values, api_key_source)

    missing_local = [name for name, value in values.items() if not value]
    missing_github = [
        name
        for name, value in {"GitHub token": gh_pat, "GH_REPO": gh_repo}.items()
        if not value
    ]

    if args.check:
        if missing_github or missing_local:
            if missing_github:
                print(f"Missing GitHub config: {', '.join(missing_github)}")
            if missing_local:
                print(f"Missing local values: {', '.join(missing_local)}")
            return 1
        print("Ready to sync GitHub Actions secrets.")
        return 0

    if not gh_pat and not args.check:
        print("No usable GitHub token found in GH_PAT / GH_TOKEN / GITHUB_TOKEN.")
        gh_pat, token_source = prompt_for_github_token()
        if gh_pat:
            print_status(gh_pat, token_source, gh_repo, values, api_key_source)
            missing_github = [
                name
                for name, value in {"GitHub token": gh_pat, "GH_REPO": gh_repo}.items()
                if not value
            ]
            if args.save_token:
                upsert_env_value(ROOT_DIR / ".env", "GH_PAT", gh_pat)
                print("Saved GH_PAT to .env")

    if missing_github:
        print(f"Missing GitHub config: {', '.join(missing_github)}")
        print("Set GH_PAT, GH_TOKEN, or GITHUB_TOKEN before syncing.")
        return 1

    if missing_local:
        print(f"Missing local values: {', '.join(missing_local)}")
        print("API_TOKEN and WEREAD_API_KEY come from .env/env.")
        return 1

    for name in sync_repo_secrets(gh_repo, gh_pat, values):
        print(f"Updated GitHub Actions secret: {name}")

    print(f"Done. Repository secrets synced for {gh_repo}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
