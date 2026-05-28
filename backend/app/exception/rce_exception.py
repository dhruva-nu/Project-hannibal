class UnsupportedLanguage(Exception):
    def __init__(self, message: str, language: str):
        super().__init__(message)
        self.lang = language

    def __str__(self):
        return f"{self.lang} is not supported yet, please try another language"
