from worker.redact import redact_log_line


def test_redact_secrets():
    line = "Authorization: Bearer s3cr3t-value CF-Access-Client-Secret: abc LLM_API_KEY=xyz"
    out = redact_log_line(line)
    assert "s3cr3t-value" not in out
    assert " abc" not in out
    assert "xyz" not in out
