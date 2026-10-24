from worker.hmac import queue_hmac_sign, sign_payload

# Must match apps/server/test/agent-queue.test.ts HMAC_CROSS_CHECK vector
KEY = "k" * 32
TS = 1_700_000_000
NONCE = "nonce-abc"
BODY = '{"text":"hello"}'
EXPECTED = "b79eb948e0ca666f5e7517d99ea427b3c849a795c302e2a44eb6cf301131cae5"


def test_sign_payload_format():
    assert sign_payload(TS, NONCE, BODY) == '1700000000|nonce-abc|{"text":"hello"}'


def test_cross_check_vector():
    sig = queue_hmac_sign(KEY, TS, NONCE, BODY)
    assert sig == EXPECTED
