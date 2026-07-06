"""Typed sandbox failures raised inside the RCE worker.

Moved out of the monolith's ``app.exception.rce_exception`` when RCE became a
standalone service. ``UnpermittedDependency`` and ``DependencyInstallError`` are
turned into structured ``dependency_error`` payloads (see ``dependency_errors``)
and never leave the worker as exceptions; ``UnsupportedLanguage`` guards the
provider registry.
"""


class UnsupportedLanguage(Exception):
    def __init__(self, message: str, language: str):
        super().__init__(message)
        self.lang = language

    def __str__(self):
        return f"{self.lang} is not supported yet, please try another language"


class UnpermittedDependency(Exception):
    def __init__(self, package: str, language: str):
        super().__init__(package)
        self.package = package
        self.language = language

    def __str__(self):
        return (
            f"'{self.package}' is not on the allowed {self.language} "
            f"package list for this sandbox"
        )


class DependencyInstallError(Exception):
    def __init__(self, packages: list[str], language: str, reason: str):
        super().__init__(reason)
        self.packages = packages
        self.language = language
        self.reason = reason

    def __str__(self):
        return (
            f"could not install {', '.join(repr(p) for p in self.packages)} "
            f"for {self.language}: {self.reason}"
        )
