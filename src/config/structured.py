"""Provider-compatible structured output, validated locally."""
import ast
import json
import os
from typing import Any

from langchain_core.exceptions import OutputParserException
from langchain_core.runnables import RunnableLambda
from pydantic import ValidationError


def _pythonize_json_literals(value: str) -> str:
    """Make JSON booleans/nulls readable by ``ast.literal_eval``.

    DeepSeek can occasionally return a Python-looking dict as tool arguments
    (single quotes plus JSON ``true``/``false``). Replace literals only while
    outside quoted strings so the model's reasoning text is preserved.
    """
    replacements = {"true": "True", "false": "False", "null": "None"}
    output: list[str] = []
    quote: str | None = None
    escaped = False
    index = 0
    while index < len(value):
        char = value[index]
        if quote:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char in ("'", '"'):
            quote = char
            output.append(char)
            index += 1
            continue
        matched = next(
            (name for name in replacements if value.startswith(name, index)), None
        )
        if matched and (index == 0 or not (value[index - 1].isalnum() or value[index - 1] == "_")):
            end = index + len(matched)
            if end == len(value) or not (value[end].isalnum() or value[end] == "_"):
                output.append(replacements[matched])
                index = end
                continue
        output.append(char)
        index += 1
    return "".join(output)


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
            parsed = ast.literal_eval(_pythonize_json_literals(text))
        except (SyntaxError, ValueError) as exc:
            raise OutputParserException("Structured arguments are neither valid JSON nor a Python dict") from exc
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
