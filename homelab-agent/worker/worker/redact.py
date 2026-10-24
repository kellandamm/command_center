import re

_REDACT_PATTERNS = [
    re.compile(r"(Authorization:\s*Bearer\s+)(\S+)", re.I),
    re.compile(r"(CF-Access-[^\s:]+:\s*)(\S+)", re.I),
    re.compile(r"(\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b\s*[=:]\s*)(\S+)", re.I),
]


def redact_log_line(text: str) -> str:
    out = text
    for pattern in _REDACT_PATTERNS:
        out = pattern.sub(r"\1[REDACTED]", out)
    return out
