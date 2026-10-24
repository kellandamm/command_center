import logging
import os
import random
import time

from .loop import make_openai_client, run_tool_loop
from .queue_client import QueueClient
from .redact import redact_log_line

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("homelab-worker")


def main() -> None:
    queue_url = os.environ["QUEUE_URL"]
    hmac_key = os.environ["QUEUE_HMAC_KEY_WORKER"]
    cf_id = os.environ["CF_ACCESS_CLIENT_ID"]
    cf_secret = os.environ["CF_ACCESS_CLIENT_SECRET"]
    llm_base = os.environ.get("LLM_BASE_URL", "https://api.commandcode.ai/provider/v1")
    llm_key = os.environ["LLM_API_KEY"]
    model = os.environ.get("LLM_MODEL", "deepseek/deepseek-v4-flash")
    poll_min = int(os.environ.get("POLL_INTERVAL_MIN_SEC", "30"))
    poll_max = int(os.environ.get("POLL_INTERVAL_MAX_SEC", "60"))

    queue = QueueClient(queue_url, hmac_key, cf_id, cf_secret)
    client = make_openai_client(llm_base, llm_key)

    logger.info(redact_log_line("homelab worker started"))

    while True:
        try:
            task = queue.claim_next()
            if task:
                task_id = task["id"]
                summary, tokens, approval = run_tool_loop(
                    client.chat.completions,
                    model,
                    task.get("text", ""),
                    task_id,
                    queue,
                )
                queue.post_result(
                    task_id,
                    {
                        "status": "approval_needed" if approval else "done",
                        "summary": summary,
                        "tokens_used": tokens,
                    },
                )
        except Exception as exc:
            logger.warning(redact_log_line(f"poll error: {exc}"))
        time.sleep(random.randint(poll_min, poll_max))


if __name__ == "__main__":
    main()
