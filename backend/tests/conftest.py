"""Global test configuration.

The required, credential-bearing settings (SECRET_KEY, DATABASE_URL,
MONGO_URL, RABBITMQ_URL) have no defaults — a missing value fails loudly at
startup. Tests never touch real infrastructure (DB/queue access is mocked),
so inject throwaway values here before anything imports app.core.config.
Uses setdefault so a real environment (local shell or CI secrets) still wins.
"""

import os

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("MONGO_URL", "mongodb://test:test@localhost:27017")
os.environ.setdefault("RABBITMQ_URL", "amqp://test:test@localhost:5672/")
