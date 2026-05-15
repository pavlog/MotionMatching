# Security And Portability Checklist

Created: 2026-05-14

Run this checklist before any commit, export, zip, share, release, or handoff.

## Sensitive Data

Check for:

- API keys
- Tokens
- Passwords
- Private certificates
- Private keys
- SSH keys
- OAuth credentials
- Emails
- Personal names or usernames where not intended
- Absolute local paths
- Machine-local settings
- Private repository URLs
- Internal/private URLs
- Generated logs containing local paths or user data
- Unity/editor caches containing local paths
- License-sensitive assets

## Portable Workspace Rules

Portable MotionMatching Studio workspaces should include:

- Workspace manifest JSON files.
- Character manifest JSON files.
- Visual source assets copied into the workspace.
- Clip source assets copied into the workspace.
- Tag/role/settings manifests.

Portable workspaces should not require:

- Derived build outputs.
- Preview/import caches.
- Operation logs.
- Machine-local export targets.
- Recent workspace lists.
- Absolute paths to original imported files.

## Suggested Search Commands

Run broad pattern searches before sharing:

```bash
rg -n --hidden --glob '!/.git/**' --glob '!**/node_modules/**' --glob '!**/Library/**' --glob '!**/Temp/**' --glob '!**/Derived/**' \
  '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(/Users/[^[:space:]]+)|(C:\\\\Users\\\\[^[:space:]]+)|(BEGIN (RSA|OPENSSH|PRIVATE) KEY)|(api[_-]?key|token|password|secret|client[_-]?secret)' .
```

Check git status before sharing:

```bash
git status --short
```

Review untracked files intentionally. Do not assume untracked files are safe.

## Generated Artifacts

Generated files are allowed during local work, but should be reviewed before sharing:

- Build reports
- Operation logs
- Preview caches
- Imported asset metadata
- Unity-generated metadata

If a generated artifact can be reproduced programmatically and may contain local machine data, prefer excluding it from portable zips and commits.

## Machine-Local Settings

Machine-local settings must not be part of portable project state. Examples:

- External Unity export targets
- Recent workspace paths
- Local backend port overrides
- User-specific editor preferences

If machine-local settings are stored in the repo during development, they must be ignored or clearly separated from portable manifests.

For MotionMatching Studio dev mode, `.motionstudio/` is machine-local and must not be committed.

## Before Commit/Export

Never commit or push unless the user explicitly asks for that action.

1. Run the sensitive-data search.
2. Check `git status --short`.
3. Inspect every untracked file or directory.
4. Confirm portable manifests do not contain absolute paths.
5. Confirm generated logs/reports do not contain sensitive paths or credentials.
6. Confirm derived caches/build outputs are intentionally included or excluded.
7. Update `05-session-handoff.md` if the next agent needs context.
