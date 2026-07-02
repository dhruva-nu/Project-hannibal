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
