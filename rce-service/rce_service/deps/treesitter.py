"""A grammar-based import detector, reusable across tree-sitter languages.

One instance per language: it parses source with that language's tree-sitter
grammar and runs a query that captures import *specifiers* — the string literal
after ``import`` / ``require`` / ``#include`` — under the ``@spec`` capture. A
per-language ``normalise`` callback reduces a specifier to a package name (or
``None`` to ignore it, e.g. a relative path).

Adding C++ or Java later is a new query + normaliser; this class is unchanged.
tree-sitter parses error-tolerantly, so malformed student code never raises —
the parseable imports are still found and the rest reaches the sandbox as-is.
"""

from collections.abc import Callable

from tree_sitter import Parser, Query, QueryCursor
from tree_sitter_language_pack import get_language

_SPECIFIER_CAPTURE = "spec"


class TreeSitterImportDetector:
    def __init__(
        self,
        grammar: str,
        query: str,
        normalise: Callable[[str], str | None],
    ):
        self._language = get_language(grammar)
        self._query = Query(self._language, query)
        self._normalise = normalise

    def detect(self, code: str) -> list[str]:
        # A fresh Parser/QueryCursor per call keeps detection free of shared
        # mutable state, so concurrent executions never race on this instance.
        root = Parser(self._language).parse(code.encode()).root_node
        packages: list[str] = []
        for _index, captures in QueryCursor(self._query).matches(root):
            for node in captures.get(_SPECIFIER_CAPTURE, ()):
                package = self._normalise(node.text.decode())
                if package is not None:
                    packages.append(package)
        return packages
