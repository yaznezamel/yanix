import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # Browser origins allowed to call the API directly (comma separated).
    cors_origins: tuple[str, ...]


def load_settings() -> Settings:
    raw = os.environ.get("YANIX_CORS_ORIGINS", "http://localhost:3000")
    return Settings(cors_origins=tuple(o.strip() for o in raw.split(",") if o.strip()))
