"""Provider-compatible structured output, validated locally."""
import json
import os
from typing import Any

from json_repair import repair_json
from langchain_core.exceptions import OutputParserException
from langchain_core.runnables import RunnableLambda
from pydantic import ValidationError


def _coerce_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        raise OutputParserException(f"Structured arguments must be an object, got {type(value).__name__}")
    text = value.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        try:
            parsed = repair_json(text, return_objects=True)
        except (TypeError, ValueError) as exc:
            raise OutputParserException("Structured arguments are neither valid JSON nor repairable JSON") from exc
    if not isinstance(parsed, dict):
        raise OutputParserException("Structured arguments must be an object")
    return parsed


def _raw_tool_arguments(raw: Any) -> Any:
    for calls in (
        getattr(raw, "tool_calls", None),
        getattr(raw, "invalid_tool_calls", None),
        getattr(raw, "additional_kwargs", {}).get("tool_calls", []),
    ):
        for call in calls or []:
            if "args" in call:
                return call["args"]
            function = call.get("function", {})
            if "arguments" in function:
                return function["arguments"]
    return None


def structured_model(model, schema):
    def validate(value):
        if value is None:
            raise OutputParserException(f'{schema.__name__}: model returned no structured output')
        return value if isinstance(value, schema) else schema.model_validate(value)

    provider = os.environ.get('LLM_PROVIDER', 'openrouter').strip().lower()
    method = 'function_calling' if provider == 'deepseek' else 'json_schema'
    chain = model.with_structured_output(
        schema,
        method=method,
        strict=True,
        include_raw=provider == 'deepseek',
    )

    def recover_deepseek(value):
        if not isinstance(value, dict) or "raw" not in value or "parsed" not in value:
            return validate(value)
        if value["parsed"] is not None:
            return validate(value["parsed"])
        arguments = _raw_tool_arguments(value["raw"])
        if arguments is None:
            error = value.get("parsing_error")
            raise OutputParserException(f"{schema.__name__}: model returned no recoverable tool arguments") from error
        return validate(_coerce_arguments(arguments))

    return (chain | RunnableLambda(recover_deepseek)).with_retry(
        retry_if_exception_type=(ValidationError, OutputParserException),
        stop_after_attempt=2, wait_exponential_jitter=False)
