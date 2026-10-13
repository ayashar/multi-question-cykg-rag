"""Native JSON schema, validated locally; retry only malformed outputs once."""
from langchain_core.exceptions import OutputParserException
from langchain_core.runnables import RunnableLambda
from pydantic import ValidationError


def structured_model(model, schema):
    def validate(value):
        if value is None:
            raise OutputParserException(f'{schema.__name__}: model returned no structured output')
        return value if isinstance(value, schema) else schema.model_validate(value)

    chain = model.with_structured_output(schema, method='json_schema', strict=True)
    return (chain | RunnableLambda(validate)).with_retry(
        retry_if_exception_type=(ValidationError, OutputParserException),
        stop_after_attempt=2, wait_exponential_jitter=False)
