/**
 * Import-statement parsing for the editor's package intelligence.
 *
 * Two jobs: locate the package token the cursor is currently typing (for
 * autocomplete), and list every imported package with its source range (for
 * the existence linter). Deliberately lightweight — a full parse isn't needed
 * to find import specifiers.
 */

export interface CompletionSpot {
  /** Absolute document offset where the package name starts. */
  from: number;
  /** What the user has typed so far. */
  prefix: string;
}

export interface ImportedPackage {
  /** Normalised top-level package name (what we verify). */
  name: string;
  from: number;
  to: number;
}

// Cursor sitting in a package position: `import re▮`, `from re▮` (Python).
const PY_COMPLETION = /(?:^|\n)[ \t]*(?:import|from)[ \t]+([A-Za-z0-9_]*)$/;
// `require('ax▮`, `import 'ax▮`, `... from 'ax▮`, `import('ax▮` (JS).
const JS_COMPLETION =
  /(?:require\(\s*|import\(\s*|import\s+|from\s+)['"]([^'"]*)$/;

/** Where the cursor is typing a package name, or null if it isn't. */
export function importCompletionSpot(
  textBeforeCursor: string,
  language: string,
): CompletionSpot | null {
  const pattern = language === "python" ? PY_COMPLETION : JS_COMPLETION;
  const match = textBeforeCursor.match(pattern);
  if (!match) return null;
  const prefix = match[1];
  return { from: textBeforeCursor.length - prefix.length, prefix };
}

function pythonTopLevel(name: string): string {
  return name.split(".")[0];
}

function jsPackage(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

const PY_IMPORT = /(?:^|\n)[ \t]*import[ \t]+([^\n#]+)/g;
const PY_FROM = /(?:^|\n)[ \t]*from[ \t]+([A-Za-z0-9_.]+)[ \t]+import\b/g;
const JS_SPECIFIER =
  /(?:require\(\s*|import\(\s*|import\s+|from\s+)['"]([^'"]+)['"]/g;

/** Every imported package in the source, with the range to underline. */
export function listImportedPackages(
  code: string,
  language: string,
): ImportedPackage[] {
  return language === "python"
    ? pythonImports(code)
    : jsImports(code);
}

function pythonImports(code: string): ImportedPackage[] {
  const found: ImportedPackage[] = [];

  for (const match of code.matchAll(PY_IMPORT)) {
    const clause = match[1];
    const clauseStart = match.index + match[0].length - clause.length;
    let offset = 0;
    for (const segment of clause.split(",")) {
      const nameToken = segment.match(/[A-Za-z0-9_.]+/);
      if (nameToken && nameToken.index !== undefined) {
        const tokenStart = clauseStart + offset + nameToken.index;
        const top = pythonTopLevel(nameToken[0]);
        found.push({ name: top, from: tokenStart, to: tokenStart + top.length });
      }
      offset += segment.length + 1; // +1 for the comma
    }
  }

  for (const match of code.matchAll(PY_FROM)) {
    const pkg = match[1];
    if (pkg.startsWith(".")) continue; // relative import — no package
    const start = match.index + match[0].indexOf(pkg);
    const top = pythonTopLevel(pkg);
    found.push({ name: top, from: start, to: start + top.length });
  }

  return found;
}

function jsImports(code: string): ImportedPackage[] {
  const found: ImportedPackage[] = [];
  for (const match of code.matchAll(JS_SPECIFIER)) {
    const specifier = match[1];
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    const start = match.index + match[0].indexOf(specifier);
    found.push({
      name: jsPackage(specifier),
      from: start,
      to: start + specifier.length,
    });
  }
  return found;
}
