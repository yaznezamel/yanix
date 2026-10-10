from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from yanix import __version__

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok"]
    version: str


@router.get("/health")
def get_health() -> Health:
    """Liveness check. Returns 200 while the process can serve requests."""
    return Health(status="ok", version=__version__)
