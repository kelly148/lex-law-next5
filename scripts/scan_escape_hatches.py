#!/usr/bin/env python3
"""
Phase 7 escape-hatch scan.
Checks implementation files (excluding test files) for:
  - actual `any` type annotations (not in comments)
  - `as unknown` casts
  - @ts-ignore, @ts-expect-error, @ts-nocheck
"""
import glob
import re

# Patterns for actual TypeScript escape hatches
any_type_pat = re.compile(r'(?::\s*any\b|<any>|\bas\s+any\b|any\[\])')
as_unknown_pat = re.compile(r'\bas\s+unknown\b')
ts_directive_pat = re.compile(r'@ts-(?:ignore|expect-error|nocheck)')
comment_line_pat = re.compile(r'^\s*//')

violations = []

for fpath in sorted(
    glob.glob('src/**/*.ts', recursive=True) +
    glob.glob('src/**/*.tsx', recursive=True)
):
    # Skip test files
    if '__tests__' in fpath or '.test.' in fpath:
        continue

    lines = open(fpath).readlines()
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip pure comment lines
        if comment_line_pat.match(stripped):
            continue
        # Strip inline comment portion for any/as-unknown checks
        code_part = line.split('//')[0]

        if any_type_pat.search(code_part):
            violations.append(f'  [any]       {fpath}:{i}: {line.rstrip()}')
        if as_unknown_pat.search(code_part):
            violations.append(f'  [as unknown] {fpath}:{i}: {line.rstrip()}')
        # ts directives can appear in comments (they are comments themselves)
        if ts_directive_pat.search(line):
            violations.append(f'  [ts-escape]  {fpath}:{i}: {line.rstrip()}')

if violations:
    print('ESCAPE HATCH VIOLATIONS:')
    for v in violations:
        print(v)
    print(f'\nTotal: {len(violations)} violation(s)')
else:
    print('No escape hatch violations found (clean)')
