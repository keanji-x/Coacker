import os
import tomllib
from typing import Optional

_DEFAULT_CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.toml")

_config = None

def load_config(path: Optional[str] = None) -> dict:
    global _config
    if _config is not None:
        return _config

    config_path = path or _DEFAULT_CONFIG_PATH
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "rb") as f:
        _config = tomllib.load(f)
    return _config

def get_llm_kwargs() -> dict:
    """Return kwargs suitable for ChatOpenAI / compatible constructors."""
    cfg = load_config()
    llm = cfg.get("llm", {})

    kwargs = {"model": llm.get("model", "gpt-4o")}

    api_key = llm.get("api_key", "") or os.environ.get("OPENAI_API_KEY", "")
    if api_key:
        kwargs["api_key"] = api_key

    base_url = llm.get("base_url", "")
    if base_url:
        kwargs["base_url"] = base_url

    return kwargs

def get_temperature(agent_name: str) -> float:
    """Get the temperature override for a specific agent."""
    cfg = load_config()
    temps = cfg.get("llm", {}).get("temperature", {})
    defaults = {"intention": 0.7, "implementation": 0.2, "reviewer": 0.1, "attacker": 0.3}
    return temps.get(agent_name, defaults.get(agent_name, 0.3))

def get_sandbox_config() -> dict:
    cfg = load_config()
    return cfg.get("sandbox", {})

def get_output_config() -> dict:
    cfg = load_config()
    return cfg.get("output", {})

def get_review_config() -> dict:
    cfg = load_config()
    return cfg.get("review", {})
