"""Shared model routing. No network or credential output during configuration."""
import os

from langchain_openai import ChatOpenAI


def model_identity():
    """Public, serializable settings for the frozen evaluation contract."""
    provider = os.environ.get('LLM_PROVIDER', 'openrouter').strip().lower()
    if provider not in ('openrouter', 'openai', 'deepseek'):
        raise ValueError('LLM_PROVIDER must be openrouter, openai, or deepseek')
    default = {
        'openrouter': 'openai/gpt-5-mini',
        'openai': 'gpt-5-mini',
        'deepseek': 'deepseek-flash',
    }[provider]
    model = os.environ.get('LLM_MODEL_NAME') or default
    fast = os.environ.get('FAST_LLM_MODEL_NAME') or model
    dynamic = provider == 'openrouter' and 'openrouter/free' in (model, fast)
    effort = os.environ.get('LLM_REASONING_EFFORT', 'none' if provider == 'deepseek' else 'low')
    if effort not in ('auto', 'none', 'minimal', 'low', 'medium', 'high'):
        raise ValueError('LLM_REASONING_EFFORT must be auto, none, minimal, low, medium, or high')
    if provider == 'openrouter' and any('/' not in m for m in (model, fast)):
        raise ValueError('OpenRouter requires provider/model IDs, such as openrouter/free')
    if provider == 'deepseek' and any('/' in m for m in (model, fast)):
        raise ValueError('DeepSeek requires a direct model ID, such as deepseek-flash')
    reasoning_effort = None if effort == 'auto' else effort
    return {'provider': provider,
            'base_url': {'openrouter': 'https://openrouter.ai/api/v1',
                         'openai': 'https://api.openai.com/v1',
                         'deepseek': 'https://api.deepseek.com'}[provider],
            'model': model, 'fast_model': fast, 'reasoning_effort': reasoning_effort,
            'dynamic_model_selection': dynamic,
            'structured_output': 'tool_call_strict' if provider == 'deepseek' else 'json_schema_strict',
            'format_attempts': 2,
            'temperature': None, 'endpoint': 'chat_completions'}


def require_model_credentials():
    config = model_identity()
    key = {'openrouter': 'OPENROUTER_API_KEY',
           'openai': 'OPENAI_API_KEY',
           'deepseek': 'DEEPSEEK_API_KEY'}[config['provider']]
    if not os.environ.get(key, '').strip():
        raise ValueError(f'{key} is not set. Add it to the project .env before live execution; do not paste it into chat.')


def build_chat_model(*, fast=False):
    config = model_identity()
    key = {'openrouter': 'OPENROUTER_API_KEY',
           'openai': 'OPENAI_API_KEY',
           'deepseek': 'DEEPSEEK_API_KEY'}[config['provider']]
    # Preserve offline imports. Live runners check the credential before any DB work.
    # Never fall back to an OpenAI key when sending requests to OpenRouter.
    kwargs = dict(model=config['fast_model' if fast else 'model'],
                  base_url=config['base_url'], api_key=os.environ.get(key) or 'sk-not-configured',
                  temperature=None, use_responses_api=False, timeout=45, max_retries=1)
    if config['provider'] == 'openrouter':
        kwargs['extra_body'] = {'provider': {'require_parameters': True}}
    # The free router chooses heterogeneous models; do not require a
    # GPT-specific reasoning setting unless the user explicitly requests it.
    # The free router can select different providers per request. Some of
    # those providers reject reasoning options even when the selected model
    # supports them, so keep the dynamic route provider-neutral.
    if config['reasoning_effort'] is not None and not config['dynamic_model_selection']:
        if config['provider'] == 'openrouter':
            kwargs['extra_body']['reasoning'] = {'effort': config['reasoning_effort']}
        else:
            kwargs['reasoning_effort'] = config['reasoning_effort']
    return ChatOpenAI(**kwargs)


if __name__ == '__main__':
    import json
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / '.env')
    print(json.dumps(model_identity(), indent=2))
    try:
        require_model_credentials()
    except ValueError as exc:
        raise SystemExit(str(exc))
    print('Credential is configured; no API request was made and access is not yet verified.')
