"""Settings, read from .env next to the project root (keys are case-insensitive)."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

_env = os.path.join(ROOT, ".env")
if os.path.exists(_env):
    for line in open(_env, encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip().upper(), v.strip().strip('"').strip("'"))


def env(name, default=None):
    return os.environ.get(name, default)


GEMINI_API_KEY = env("GEMINI_API_KEY") or env("GOOGLE_API_KEY")
# Answers, drift, lens, editor studio. gemini-3.5-flash with thinking off answers grounded questions
# ~7x faster than gemini-3.8-flash with thinking (2 s vs 14 s measured); set GEMINI_MODEL /
# GEMINI_THINKING in .env to trade speed for deeper reasoning.
GEMINI_MODEL = env("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_FAST_MODEL = env("GEMINI_FAST_MODEL", "gemini-3.5-flash")
# Thinking-token budget for text generation: 0 = off (fastest). Empty = the model's default.
GEMINI_THINKING = env("GEMINI_THINKING", "0")
GEMINI_EMBED_MODEL = env("GEMINI_EMBED_MODEL", "gemini-embedding-2")
EMBED_DIM = int(env("EMBED_DIM", 768))

DB = dict(host=env("DB_HOST", "127.0.0.1"), port=int(env("DB_PORT", 3309)),
          user=env("DB_USER", "palimpsest"), password=env("DB_PASSWORD", "palimpsest"),
          database=env("DB_NAME", "palimpsest"))
