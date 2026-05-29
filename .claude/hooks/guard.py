"""Claude Code PreToolUse guard — blocks destructive Bash commands.

Reads the PreToolUse hook JSON from stdin. If the Bash command matches a
destructive pattern, exits 2 (PreToolUse block) with a reason on stderr so
Claude must get explicit operator approval before re-running. Otherwise exits 0.

Runtime-free (Python only; no Node required).
"""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if data.get("tool_name") != "Bash":
    sys.exit(0)

cmd = (data.get("tool_input") or {}).get("command", "") or ""

PATTERNS = [
    r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f",   # rm -rf / -fr variants
    r"\brm\s+-[a-zA-Z]*f[a-zA-Z]*r",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\s+-[a-zA-Z]*f",
    r"\bgit\s+push\b[^\n]*--force",
    r"\bgit\s+push\b[^\n]*\s-f(\s|$)",
    r"--no-verify\b",
    r"\bgit\s+restore\s+\.",
    r"\bgit\s+checkout\s+--\s",
]

for p in PATTERNS:
    if re.search(p, cmd):
        print(
            f"Blocked by .claude/hooks/guard.py: command matches destructive "
            f"pattern /{p}/. This requires explicit operator approval before "
            f"re-running.",
            file=sys.stderr,
        )
        sys.exit(2)

sys.exit(0)
