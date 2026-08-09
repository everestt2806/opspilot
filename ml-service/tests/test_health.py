from main import SERVICE_VERSION, health


def test_health_returns_service_status() -> None:
    response = health()

    assert response.status == "ok"
    assert response.version == SERVICE_VERSION
    assert response.uptime_s >= 0
