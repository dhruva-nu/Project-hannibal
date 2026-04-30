# OTP Plan — Generation, Validation, Twilio Delivery

---

## 1. OTP Generation Strategies

### A. Random Numeric (Stateful — SMS style)
```
function generate_otp(length = 6):
    code = random_integer(100000, 999999)   // cryptographically secure
    return code as string padded to length
```

### B. HOTP — Counter-Based (RFC 4226)
```
function hotp(secret, counter, digits = 6):
    msg      = counter as 8-byte big-endian
    h        = HMAC-SHA1(secret, msg)
    offset   = last byte of h AND 0x0F
    truncated = 4 bytes of h starting at offset
    code     = (truncated AND 0x7FFFFFFF) MOD 10^digits
    return code zero-padded to digits
```

### C. TOTP — Time-Based (RFC 6238, Google Authenticator)
```
function totp(secret, digits = 6, window = 30):
    counter = floor(unix_timestamp() / window)
    return hotp(secret, counter, digits)
```

---

## 2. Storage

```
// Use Redis — built-in TTL, fast, no manual cleanup

function store_otp(phone, code, ttl_seconds = 300):
    hashed = SHA256(code)
    redis.set(
        key      = "otp:{phone}",
        value    = { hash: hashed, attempts: 0 },
        expiry   = ttl_seconds
    )

function get_otp_entry(phone):
    return redis.get("otp:{phone}")

function delete_otp(phone):
    redis.delete("otp:{phone}")
```

---

## 3. Sending via Twilio

```
// Prerequisites:
//   TWILIO_ACCOUNT_SID  — from Twilio dashboard
//   TWILIO_AUTH_TOKEN   — from Twilio dashboard
//   TWILIO_FROM_NUMBER  — your purchased Twilio number

function send_otp_sms(phone, code):
    client = TwilioClient(ACCOUNT_SID, AUTH_TOKEN)
    client.messages.create(
        to   = phone,
        from = TWILIO_FROM_NUMBER,
        body = "Your OTP is {code}. Valid for 5 minutes. Do not share it."
    )
```

---

## 4. Full Request Flow

```
// Step 1 — User requests OTP

POST /auth/otp/request
  body: { phone }

  VALIDATE phone format
  CHECK redis: if "otp:{phone}" exists AND age < 60s → reject (rate limit)
  code = generate_otp()
  store_otp(phone, code, ttl = 300)
  send_otp_sms(phone, code)
  RETURN 200 OK


// Step 2 — User submits OTP

POST /auth/otp/verify
  body: { phone, code }

  entry = get_otp_entry(phone)
  IF entry is null → RETURN 400 "OTP expired or not found"

  entry.attempts += 1
  IF entry.attempts > 3 → delete_otp(phone), RETURN 429 "Too many attempts"

  IF NOT constant_time_compare(SHA256(code), entry.hash):
      update attempts in redis
      RETURN 400 "Invalid OTP"

  delete_otp(phone)   // one-time use
  issue JWT or session
  RETURN 200 OK
```

---

## 5. Validation Rules

```
function validate_otp(entry, submitted_code):

    // Rule 1 — existence
    IF entry is null:
        RETURN error "OTP not found or already used"

    // Rule 2 — expiry (handled by Redis TTL, but double-check)
    IF current_time > entry.expiry:
        delete_otp(phone)
        RETURN error "OTP expired"

    // Rule 3 — brute force
    IF entry.attempts >= 3:
        delete_otp(phone)
        RETURN error "Too many failed attempts"

    // Rule 4 — constant-time comparison (prevents timing attacks)
    IF NOT constant_time_compare(SHA256(submitted_code), entry.hash):
        increment entry.attempts
        RETURN error "Invalid OTP"

    // Rule 5 — one-time use
    delete_otp(phone)
    RETURN success
```

---

## 6. TOTP Validation (stateless — authenticator app)

```
function validate_totp(user_secret, submitted_code, drift = 1):
    counter = floor(unix_timestamp() / 30)

    // Check current window ± drift to handle clock skew
    FOR delta IN [-drift .. +drift]:
        expected = hotp(user_secret, counter + delta)
        IF constant_time_compare(expected, submitted_code):
            RETURN success

    RETURN error "Invalid TOTP"
```

---

## 7. Security Checklist

```
[ ] Use secrets/os.urandom — never Math.random or stdlib random
[ ] Hash OTP before storing — never store plaintext
[ ] constant_time_compare for all code checks — prevents timing attacks
[ ] Redis TTL = 5 min for SMS, 30s window for TOTP
[ ] Rate limit: 1 request per phone per 60s
[ ] Max 3 verification attempts, then invalidate
[ ] Delete OTP immediately on successful verify (one-time use)
[ ] Log attempts (not the code) for audit trail
[ ] HTTPS only — OTP in body, never in URL
```

---

## 8. Choosing a Strategy

```
IF user has no authenticator app AND you need simplicity:
    → Random Numeric OTP + Redis + Twilio SMS

IF user has authenticator app AND you want stateless:
    → TOTP (RFC 6238) — no SMS cost, no storage

IF you need both (2FA on top of password):
    → Password login first → TOTP or SMS OTP as second factor
```
