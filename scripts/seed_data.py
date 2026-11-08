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
    {
        "name": "Session-Based Authentication",
        "category": ["Auth", "Backend", "Security"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/session-auth.png",
        "level": "beginner",
        "description": "Understand server-side sessions: how session IDs, cookies, and server stores keep users logged in, and when sessions beat tokens.",
    },
    {
        "name": "OAuth 2.0 and Social Login",
        "category": ["Auth", "Backend", "Security"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/oauth2.png",
        "level": "intermediate",
        "description": "Learn the OAuth 2.0 authorization framework and add Google and GitHub social login to your app the right way.",
    },
    {
        "name": "Password Security and Hashing",
        "category": ["Security", "Backend"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/password-security.png",
        "level": "beginner",
        "description": "Go deep on storing credentials safely: bcrypt, argon2, salting, peppering, and defending against brute-force and rainbow-table attacks.",
    },
    {
        "name": "Multi-Factor Authentication",
        "category": ["Auth", "Security"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/mfa.png",
        "level": "intermediate",
        "description": "Add a second layer of defense with TOTP authenticator apps, one-time codes, and recovery flows to protect accounts from stolen passwords.",
    },
    {
        "name": "API Authentication and Authorization",
        "category": ["Auth", "Backend", "Security"],
        "tag": None,
        "enrol_num": 0,
        "cover_img": "https://placeholder.com/api-auth.png",
        "level": "intermediate",
        "description": "Secure your APIs with API keys, bearer tokens, and role-based access control, and learn the difference between authentication and authorization.",
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
            "name": "Hashing and salting",
            "learning": "Learn why plaintext passwords are dangerous and how bcrypt hashing with salts mitigates it.",
            "nosql_id": "2057a4d0-f0c9-4f00-94c6-c301b1c72cbf",
            "type": "learn",
            "order": 2,
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
            "name": "Refresh token rotation",
            "learning": "Learn the refresh-token rotation pattern and why it limits token theft damage.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000004",
            "type": "learn",
            "order": 3,
        },
    ],
    # Related courses to "Basic Auth".
    "Session-Based Authentication": [
        {
            "name": "What is a session?",
            "learning": "Understand how servers remember a logged-in user across stateless HTTP requests.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "Session IDs and cookies",
            "learning": "Learn how a session ID is issued, stored in a cookie, and sent back on every request.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "Server-side session stores",
            "learning": "Compare in-memory, database, and Redis session stores and their trade-offs.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000003",
            "type": "learn",
            "order": 2,
        },
        {
            "name": "Sessions vs tokens",
            "learning": "Decide when stateful sessions beat stateless tokens for your application.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000004",
            "type": "learn",
            "order": 3,
        },
    ],
    "OAuth 2.0 and Social Login": [
        {
            "name": "Why OAuth 2.0 exists",
            "learning": "Understand the problem delegated authorization solves and why you should not handle other apps' passwords.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "OAuth roles and grant types",
            "learning": "Learn the resource owner, client, authorization server, and the common grant types.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "The authorization code flow",
            "learning": "Walk through the most common and secure OAuth flow step by step.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000003",
            "type": "learn",
            "order": 2,
        },
    ],
    "Password Security and Hashing": [
        {
            "name": "Why plaintext passwords fail",
            "learning": "See the concrete damage a database breach causes when passwords are stored in plaintext.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "Hashing with bcrypt and argon2",
            "learning": "Learn modern, slow password hashing functions and why speed is the enemy here.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "Salting and peppering",
            "learning": "Understand how salts and peppers defeat rainbow-table and precomputation attacks.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000003",
            "type": "learn",
            "order": 2,
        },
        {
            "name": "Defending against brute force",
            "learning": "Apply rate limiting, lockouts, and work factors to slow down attackers.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000004",
            "type": "learn",
            "order": 3,
        },
    ],
    "Multi-Factor Authentication": [
        {
            "name": "What is MFA?",
            "learning": "Understand the factors of authentication and why a second factor stops stolen-password attacks.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "TOTP and authenticator apps",
            "learning": "Learn how time-based one-time passwords work and how authenticator apps generate them.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "One-time codes and delivery",
            "learning": "Compare SMS, email, and push delivery of one-time codes and their security trade-offs.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000003",
            "type": "learn",
            "order": 2,
        },
        {
            "name": "Recovery and backup codes",
            "learning": "Design account recovery flows that survive a lost device without becoming a backdoor.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000004",
            "type": "learn",
            "order": 3,
        },
    ],
    "API Authentication and Authorization": [
        {
            "name": "AuthN vs AuthZ",
            "learning": "Draw the line between proving who you are and deciding what you can do.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000001",
            "type": "learn",
            "order": 0,
        },
        {
            "name": "API keys and bearer tokens",
            "learning": "Learn how to issue, transmit, and validate API keys and bearer tokens.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000002",
            "type": "learn",
            "order": 1,
        },
        {
            "name": "Role-based access control",
            "learning": "Model roles and permissions to authorize requests cleanly.",
            "nosql_id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000003",
            "type": "learn",
            "order": 2,
        },
    ],
}

# One lesson_block per lesson.
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
        "id": "fd53cb5a-6758-44f5-a29e-d24fbe9e72c2",
        "content": "",
        "summary": "",
    },
    {
        "id": "2057a4d0-f0c9-4f00-94c6-c301b1c72cbf",
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
        "id": "a1b2c3d4-e5f6-4a7b-8c9d-200000000004",
        "content": "",
        "summary": "",
    },
    # Lesson blocks for the courses related to "Basic Auth" (content TBD).
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000001", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000002", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000003", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-300000000004", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000001", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000002", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-400000000003", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000001", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000002", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000003", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-500000000004", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000001", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000002", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000003", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-600000000004", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000001", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000002", "content": "", "summary": ""},
    {"id": "a1b2c3d4-e5f6-4a7b-8c9d-700000000003", "content": "", "summary": ""},
]
