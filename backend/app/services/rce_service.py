import sys
from app.services.rce import stdio

sys.modules[__name__] = stdio
