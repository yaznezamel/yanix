# Yanix API

FastAPI backend for Yanix. Managed with [uv](https://docs.astral.sh/uv/).

```sh
uv sync                                   # create .venv from uv.lock
uv run fastapi dev src/yanix/main.py      # http://localhost:8000/api/v1/docs
uv run pytest                             # tests
uv run ruff check && uv run ruff format --check
uv run pyright                            # strict type check
```

Configuration (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `YANIX_CORS_ORIGINS` | `http://localhost:3000` | Comma separated browser origins allowed to call the API |
