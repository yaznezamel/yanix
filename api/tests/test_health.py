from fastapi.testclient import TestClient

from yanix.main import create_app
from yanix.settings import Settings


def make_client() -> TestClient:
    return TestClient(create_app(Settings(cors_origins=("http://localhost:3000",))))


def test_health_returns_ok() -> None:
    response = make_client().get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)


def test_health_is_only_served_under_versioned_prefix() -> None:
    assert make_client().get("/health").status_code == 404


def test_cors_allows_configured_origin() -> None:
    response = make_client().get("/api/v1/health", headers={"Origin": "http://localhost:3000"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
