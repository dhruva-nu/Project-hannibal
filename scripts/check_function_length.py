#!/usr/bin/env python3
"""Fail if any function or method exceeds MAX_LINES lines."""
import ast
import sys
from pathlib import Path

MAX_LINES = 150


def check_directory(target: Path) -> list[str]:
    violations = []
    for path in sorted(target.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(), filename=str(path))
        except SyntaxError as exc:
            print(f"SyntaxError in {path}: {exc}", file=sys.stderr)
            sys.exit(1)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                length = node.end_lineno - node.lineno + 1
                if length > MAX_LINES:
                    violations.append(
                        f"{path}:{node.lineno}: {node.name}() is {length} lines (limit: {MAX_LINES})"
                    )
    return violations


if __name__ == "__main__":
    targets = [Path(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else [Path("app")]
    all_violations = []
    for target in targets:
        all_violations.extend(check_directory(target))

    if all_violations:
        print(f"Functions exceeding {MAX_LINES} lines:\n")
        for v in all_violations:
            print(f"  {v}")
        print(f"\n{len(all_violations)} violation(s) found.")
        sys.exit(1)

    print(f"All functions are within the {MAX_LINES}-line limit.")
