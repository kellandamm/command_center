import json
from types import SimpleNamespace

from worker.loop import run_tool_loop
from worker.tools import validate_tool_args


class FakeCompletions:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        payload = self._responses.pop(0)
        return payload


def test_reasoning_content_echoed_when_tools_present():
    first = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    reasoning_content="think step",
                    tool_calls=[
                        SimpleNamespace(
                            id="tc1",
                            function=SimpleNamespace(name="host_health", arguments="{}"),
                        )
                    ],
                )
            )
        ],
        usage=SimpleNamespace(total_tokens=10),
    )
    second = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="done", tool_calls=None))],
        usage=SimpleNamespace(total_tokens=5),
    )
    client = FakeCompletions([first, second])
    summary, tokens, _approval = run_tool_loop(
        client,
        "model",
        "check host",
        "task-1",
        queue=object(),
        max_turns=6,
    )
    assert summary == "done"
    assert tokens == 15
    second_call = client.calls[1]
    assistant_msgs = [m for m in second_call["messages"] if m.get("role") == "assistant"]
    assert assistant_msgs[0].get("reasoning_content") == "think step"


def test_max_turns_cap():
    repeating = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    tool_calls=[
                        SimpleNamespace(
                            id="tc",
                            function=SimpleNamespace(name="host_health", arguments="{}"),
                        )
                    ],
                )
            )
        ],
        usage=SimpleNamespace(total_tokens=1),
    )
    client = FakeCompletions([repeating] * 8)
    summary, _tokens, _ = run_tool_loop(client, "m", "task", "id", queue=object(), max_turns=3)
    assert summary == "max_turns reached"
    assert len(client.calls) == 3


def test_validate_tool_args():
    validate_tool_args("notify_kellan", {"text": "hi"})
    try:
        validate_tool_args("notify_kellan", {"text": ""})
        assert False
    except ValueError:
        pass
