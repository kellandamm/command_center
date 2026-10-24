import hashlib
import hmac


def sign_payload(ts: int | str, nonce: str, raw_body: str) -> str:
    return f"{ts}|{nonce}|{raw_body}"


def queue_hmac_sign(key: str, ts: int | str, nonce: str, raw_body: str) -> str:
    msg = sign_payload(ts, nonce, raw_body).encode("utf-8")
    return hmac.new(key.encode("utf-8"), msg, hashlib.sha256).hexdigest()
