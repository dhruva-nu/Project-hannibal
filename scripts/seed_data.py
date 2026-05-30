"""Human-readable seed data for Project Hannibal.

Edit this file to extend or change the seed dataset.
The runner (seed.py) imports and applies it automatically.
"""

USERS = [
    {
        "email": "admin@hannibal.dev",
        "password": "Admin1234!",
        "role": "admin",
        "provider": "local",
    },
    {
        "email": "student@hannibal.dev",
        "password": "Student1234!",
        "role": "student",
        "provider": "local",
    },
]

TAGS = [
    {
        "name": "Best Seller",
        "description": "The courses that are selling the best",
    },
    {
        "name": "Beginner Friendly",
        "description": "These courses are very easy to clear and understand",
    },
    {
        "name": "Security",
        "description": "Courses focused on application security practices",
    },
    {
        "name": "Backend",
        "description": "Server-side development and API design",
    },
    {
        "name": "Python",
        "description": "Python programming language courses",
    },
]

# Each course references a tag by name (must match a TAGS entry) or None.
# lesson_count is computed automatically from LESSONS.
COURSES = [
    {
        "name": "Build a production grade Auth",
        "category": ["Auth", "Security"],
        "tag": "Beginner Friendly",
        "enrol_num": 100,
        "cover_img": "https://storage.googleapis.com/prd-engineering-asset/2022/01/b149e9f6-1642663391365.jpg",
        "level": "beginner",
        "description": "Learn about auth, what is it?, why do we need it? and how to build it?",
    },
    {
        "name": "Basic Auth",
        "category": ["security", "backend"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/basic-auth.png",
        "level": "beginner",
        "description": "Learn authentication from scratch — why it matters, how to build it, and how to harden it with hashing and salting.",
    },
    {
        "name": "JWT Authentication Deep Dive",
        "category": ["Auth", "Backend", "Security"],
        "tag": "Security",
        "enrol_num": 42,
        "cover_img": "https://placeholder.com/jwt-auth.png",
        "level": "intermediate",
        "description": "Master JSON Web Tokens: structure, signing algorithms, access/refresh token patterns, and HttpOnly cookie delivery.",
    },
]

# Keyed by course name. nosql_id links each lesson to its MongoDB document.
LESSONS: dict[str, list[dict]] = {
    "Build a production grade Auth": [
        {
            "name": "What is Auth?",
            "learning": "what is auth and why we need it",
            "nosql_id": "3fa85f64-5717-4562-b3fc-2c963f66afa0",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "Auth in depth",
            "learning": "what is auth and why we need it",
            "nosql_id": "bfd529c6-8cc1-4aba-aa5b-357456a8fcc5",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "Sessions vs Tokens",
            "learning": "Understand the difference between cookie-session and stateless JWT approaches.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-100000000001",
            "type": "learn",
            "order": 2,
        },
        {
            "name": "Build a JWT login endpoint",
            "learning": "Implement /login, /refresh, and /logout endpoints with HttpOnly cookie delivery.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-100000000002",
            "type": "build",
            "order": 3,
        },
    ],
    "Basic Auth": [
        {
            "name": "Why auth is needed and what is auth",
            "learning": "Understand authentication fundamentals: identity, trust, and why unsecured systems fail.",
            "nosql_id": "fd53cb5a-6758-44f5-a29e-d24fbe9e72c2",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "Build a simple username and password auth",
            "learning": "Implement a basic login flow with plaintext credentials to see the full request lifecycle.",
            "nosql_id": "bceb7645-03be-4fed-add0-eb390da03fd7",
            "type": "build",
            "order": 1,
        },
        {
            "name": "Hashing and salting",
            "learning": "Learn why plaintext passwords are dangerous and how bcrypt hashing with salts mitigates it.",
            "nosql_id": "2057a4d0-f0c9-4f00-94c6-c301b1c72cbf",
            "type": "learn",
            "order": 2,
        },
        {
            "name": "Upgrade created system to hash and salt",
            "learning": "Refactor the auth system built in lesson 2 to store and verify bcrypt-hashed passwords.",
            "nosql_id": "f24434ff-4f0b-4d39-b3df-a92677eb2e6c",
            "type": "build",
            "order": 3,
        },
    ],
    "JWT Authentication Deep Dive": [
        {
            "name": "Anatomy of a JWT",
            "learning": "Break down the header, payload, and signature of a JSON Web Token.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "Signing algorithms: HS256 vs RS256",
            "learning": "Compare symmetric and asymmetric signing and when to use each.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "Build a token verifier",
            "learning": "Implement decode and verify functions for HS256-signed JWTs using PyJWT.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000003",
            "type": "build",
            "order": 2,
        },
        {
            "name": "Refresh token rotation",
            "learning": "Learn the refresh-token rotation pattern and why it limits token theft damage.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000004",
            "type": "learn",
            "order": 3,
        },
    ],
}

# One lesson_block per lesson (all types). Build lessons get empty content here;
# their real content lives in BUILD_BLOCKS.
LESSON_BLOCKS = [
    {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa0",
        "content": "",
        "summary": "",
    },
    {
        "id": "bfd529c6-8cc1-4aba-aa5b-357456a8fcc5",
        "content": (
            "# Lesson 1: What is Authentication and Why Do We Need It?\n\n"
            "## Introduction\n\n"
            "Before building login systems, sessions, JWTs, passwords, or multi-factor authentication, "
            "we need to understand one core idea:\n\n"
            "> **Authentication is the process of verifying who a user is.**\n\n"
            "Every secure application on the internet depends on authentication.\n\n"
            "When you log into your email, banking app, gaming account, or company dashboard, "
            "authentication is happening behind the scenes.\n\n"
            "This lesson explains:\n"
            "- What authentication is\n"
            "- Why it exists\n"
            "- The problems it solves\n"
            "- Real-world examples\n"
            "- The difference between authentication and authorization\n\n"
            "---\n\n"
            "# What is Authentication?\n\n"
            "Authentication (Auth) is the process of proving identity.\n\n"
            "In simple terms:\n\n"
            "> Are you really who you claim to be?\n\n"
            "When a user provides:\n"
            "- Email + password\n"
            "- OTP code\n"
            "- Fingerprint\n"
            "- Passkey\n"
            "- Magic link\n\n"
            "...the system checks whether the user is legitimate.\n\n"
            "If the proof is correct:\n"
            "✅ Access is granted\n\n"
            "If not:\n"
            "❌ Access is denied"
        ),
        "summary": "this is the summary",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-100000000001",
        "content": "",
        "summary": "",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-100000000002",
        "content": "",
        "summary": "",
    },
    {
        "id": "fd53cb5a-6758-44f5-a29e-d24fbe9e72c2",
        "content": "",
        "summary": "",
    },
    {
        "id": "bceb7645-03be-4fed-add0-eb390da03fd7",
        "content": "",
        "summary": "",
    },
    {
        "id": "2057a4d0-f0c9-4f00-94c6-c301b1c72cbf",
        "content": "",
        "summary": "",
    },
    {
        "id": "f24434ff-4f0b-4d39-b3df-a92677eb2e6c",
        "content": "",
        "summary": "",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000001",
        "content": "",
        "summary": "",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000002",
        "content": "",
        "summary": "",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000003",
        "content": "",
        "summary": "",
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000004",
        "content": "",
        "summary": "",
    },
]

BUILD_BLOCKS = [
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-100000000002",
        "instructions": (
            "Implement encode_token() to create an HS256-signed JWT containing a 'sub' claim, "
            "and decode_token() to verify the signature and return the payload. "
            "Use PyJWT. Raise jwt.ExpiredSignatureError for expired tokens and "
            "jwt.InvalidTokenError for bad signatures."
        ),
        "input": "sub: str\nsecret: str\nexpires_in_seconds: int = 3600",
        "output": "encode_token: str  (the signed JWT)\ndecode_token: dict  (the decoded payload)",
        "code_template": (
            "import jwt\n"
            "import datetime\n\n\n"
            "SECRET = 'supersecret'\n\n\n"
            "def encode_token(sub: str, secret: str, expires_in_seconds: int = 3600) -> str:\n"
            "    # TODO: build payload with 'sub' and 'exp', sign with HS256\n"
            "    pass\n\n\n"
            "def decode_token(token: str, secret: str) -> dict:\n"
            "    # TODO: verify signature and return the decoded payload\n"
            "    pass\n"
        ),
        "test_code": (
            "import jwt\n"
            "import sys\n\n"
            "--user-code--\n\n"
            "failures = 0\n\n\n"
            "def run_test(name, fn):\n"
            "    global failures\n"
            "    try:\n"
            "        fn()\n"
            "        print(f'\\u2713 {name}')\n"
            "    except AssertionError as e:\n"
            "        print(f'\\u2717 {name}: {e}')\n"
            "        failures += 1\n\n\n"
            "def test_encode_returns_string():\n"
            "    token = encode_token('user-1', SECRET)\n"
            "    assert isinstance(token, str) and len(token) > 0\n\n\n"
            "def test_decode_returns_sub():\n"
            "    token = encode_token('user-1', SECRET)\n"
            "    payload = decode_token(token, SECRET)\n"
            "    assert payload['sub'] == 'user-1'\n\n\n"
            "def test_wrong_secret_raises():\n"
            "    token = encode_token('user-1', SECRET)\n"
            "    try:\n"
            "        decode_token(token, 'wrong-secret')\n"
            "        assert False, 'expected InvalidTokenError'\n"
            "    except jwt.InvalidTokenError:\n"
            "        pass\n\n\n"
            "run_test('encode returns string', test_encode_returns_string)\n"
            "run_test('decode returns sub', test_decode_returns_sub)\n"
            "run_test('wrong secret raises', test_wrong_secret_raises)\n\n"
            "sys.exit(failures)\n"
        ),
        "type": "simple_run",
        "tests": [
            {"name": "encode returns string", "description": "Token must be a non-empty string"},
            {"name": "decode returns sub", "description": "Decoded payload must contain the original sub claim"},
            {"name": "wrong secret raises", "description": "Decoding with wrong secret must raise InvalidTokenError"},
        ],
    },
    {
        "id": "bceb7645-03be-4fed-add0-eb390da03fd7",
        "instructions": (
            "Implement register() and authenticate() using a plain dict as the user store. "
            "register() adds the username→password entry. authenticate() looks up the username and "
            "compares the password. Return True on match, False otherwise. "
            "No hashing yet — focus on the full request lifecycle."
        ),
        "input": (
            "username: str\n"
            "password: str\n"
            "user_store: dict[str, str]  # maps username → plaintext password"
        ),
        "output": (
            "register: None  (mutates user_store in place)\n"
            "authenticate: bool  (True if credentials match, False otherwise)"
        ),
        "code_template": (
            "\n"
            "def register(username: str, password: str) -> None:\n"
            "    # TODO: store the username and password in user_store\n"
            "    # use db.store(key, value) to store the key and value \n"
            "    pass\n"
            "\n"
            "def authenticate(username: str, password: str) -> bool:\n"
            "    # TODO: look up the username and verify the password\n"
            "    # use db.get(key) to get the value of the key\n"
            "    pass"
        ),
        "test_code": (
            "class Database:\n"
            "    def __init__(self):\n"
            "        self.data = {}\n"
            "    def store(self, key, value):\n"
            "        self.data[key] = value\n"
            "    def get(self, key):\n"
            "        return self.data[key]\n"
            "\n"
            "db = Database()\n"
            "\n"
            "--user-code--\n"
            "\n"
            "import sys\n"
            "failures = 0\n"
            "\n"
            "def run_test(name, fn):\n"
            "    global failures\n"
            "    try:\n"
            "        fn()\n"
            "        print(f'\\u2713 {name}')\n"
            "    except AssertionError as e:\n"
            "        print(f'\\u2717 {name}: {e}')\n"
            "        failures += 1\n"
            "\n"
            "def test_register_adds_user():\n"
            "    register('alice', 'secret')\n"
            "    assert db.get('alice') == 'secret'\n"
            "\n"
            "def test_authenticate_valid():\n"
            "    assert authenticate('alice', 'secret') is True\n"
            "\n"
            "def test_authenticate_wrong_password():\n"
            "    assert authenticate('alice', 'wrong') is False\n"
            "\n"
            "def test_authenticate_unknown_user():\n"
            "    assert authenticate('nobody', 'x') is False\n"
            "\n"
            "run_test('register adds user', test_register_adds_user)\n"
            "run_test('authenticate valid', test_authenticate_valid)\n"
            "run_test('authenticate wrong password', test_authenticate_wrong_password)\n"
            "run_test('authenticate unknown user', test_authenticate_unknown_user)\n"
            "\n"
            "sys.exit(failures)\n"
        ),
        "type": "simple_run",
        "tests": [
            {"name": "register adds user", "description": "Test if the user is added to db"},
            {"name": "authenticate_valid", "description": "Test if a valid user can authenticate"},
            {"name": "authenticate_wrong_password", "description": "Test if authentication fails with wrong password"},
            {"name": "authenticate_unknown_user", "description": "Tests if unknow user can log in"},
        ],
    },
    {
        "id": "f24434ff-4f0b-4d39-b3df-a92677eb2e6c",
        "instructions": (
            "Refactor register() to hash the password with bcrypt before storing it, and update "
            "authenticate() to use bcrypt.checkpw() for verification. The user_store now maps "
            "username → hashed bytes. Do not store plaintext passwords anywhere."
        ),
        "input": (
            "username: str\n"
            "password: str  (plaintext, provided by the user)\n"
            "user_store: dict[str, bytes]  # maps username → bcrypt hash"
        ),
        "output": (
            "register: None  (stores bcrypt hash in user_store)\n"
            "authenticate: bool  (True if bcrypt.checkpw passes, False otherwise)"
        ),
        "code_template": (
            "import bcrypt\n\n\n"
            "def register(username: str, password: str, user_store: dict) -> None:\n"
            "    # TODO: hash the password with bcrypt and store the hash\n"
            "    pass\n\n\n"
            "def authenticate(username: str, password: str, user_store: dict) -> bool:\n"
            "    # TODO: retrieve the hash and verify with bcrypt.checkpw\n"
            "    pass"
        ),
        "test_code": (
            "import bcrypt\n\n"
            "def test_register_stores_hash():\n"
            "    store = {}\n"
            "    register('alice', 'secret', store)\n"
            "    assert 'alice' in store\n"
            "    assert bcrypt.checkpw(b'secret', store['alice'])\n\n"
            "def test_register_does_not_store_plaintext():\n"
            "    store = {}\n"
            "    register('alice', 'secret', store)\n"
            "    assert store['alice'] != b'secret'\n\n"
            "def test_authenticate_valid():\n"
            "    store = {}\n"
            "    register('alice', 'secret', store)\n"
            "    assert authenticate('alice', 'secret', store) is True\n\n"
            "def test_authenticate_wrong_password():\n"
            "    store = {}\n"
            "    register('alice', 'secret', store)\n"
            "    assert authenticate('alice', 'wrong', store) is False\n\n"
            "def test_authenticate_unknown_user():\n"
            "    store = {}\n"
            "    assert authenticate('nobody', 'x', store) is False"
        ),
        "type": "simple_run",
        "tests": [],
    },
    {
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000003",
        "instructions": (
            "Implement verify_token(token, secret) that decodes and validates an HS256-signed JWT. "
            "Return the payload dict if valid. Return None if the signature is invalid or the token "
            "is expired. Do not raise exceptions — callers check the return value."
        ),
        "input": "token: str\nsecret: str",
        "output": "dict | None  (payload on success, None on any error)",
        "code_template": (
            "import jwt\n\n\n"
            "def verify_token(token: str, secret: str) -> dict | None:\n"
            "    # TODO: decode the JWT with HS256, return payload or None\n"
            "    pass\n"
        ),
        "test_code": (
            "import jwt\n"
            "import datetime\n"
            "import sys\n\n"
            "--user-code--\n\n"
            "failures = 0\n"
            "SECRET = 'test-secret'\n\n\n"
            "def run_test(name, fn):\n"
            "    global failures\n"
            "    try:\n"
            "        fn()\n"
            "        print(f'\\u2713 {name}')\n"
            "    except AssertionError as e:\n"
            "        print(f'\\u2717 {name}: {e}')\n"
            "        failures += 1\n\n\n"
            "def make_token(sub='user1', delta_seconds=3600):\n"
            "    payload = {\n"
            "        'sub': sub,\n"
            "        'exp': datetime.datetime.utcnow() + datetime.timedelta(seconds=delta_seconds),\n"
            "    }\n"
            "    return jwt.encode(payload, SECRET, algorithm='HS256')\n\n\n"
            "def test_valid_token_returns_payload():\n"
            "    token = make_token()\n"
            "    result = verify_token(token, SECRET)\n"
            "    assert result is not None\n"
            "    assert result['sub'] == 'user1'\n\n\n"
            "def test_invalid_secret_returns_none():\n"
            "    token = make_token()\n"
            "    assert verify_token(token, 'wrong') is None\n\n\n"
            "def test_expired_token_returns_none():\n"
            "    token = make_token(delta_seconds=-1)\n"
            "    assert verify_token(token, SECRET) is None\n\n\n"
            "run_test('valid token returns payload', test_valid_token_returns_payload)\n"
            "run_test('invalid secret returns None', test_invalid_secret_returns_none)\n"
            "run_test('expired token returns None', test_expired_token_returns_none)\n\n"
            "sys.exit(failures)\n"
        ),
        "type": "simple_run",
        "tests": [
            {"name": "valid token returns payload", "description": "A valid token should return a payload with the correct sub"},
            {"name": "invalid secret returns None", "description": "A token verified with wrong secret must return None"},
            {"name": "expired token returns None", "description": "An expired token must return None"},
        ],
    },
]
