from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
APP_JS = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
BACKEND = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")


def test_frontend_uses_relative_assets_for_github_pages():
    assert 'href="./styles.css"' in HTML
    assert 'src="./app.js"' in HTML
    assert 'href="/assets/styles.css"' not in HTML
    assert 'src="/assets/app.js"' not in HTML


def test_fastapi_serves_relative_frontend_assets_at_root():
    assert 'def frontend_stylesheet():' in BACKEND
    assert 'def frontend_script():' in BACKEND
    assert '@app.get("/styles.css", include_in_schema=False)' in BACKEND
    assert '@app.get("/app.js", include_in_schema=False)' in BACKEND


def test_browser_endpoints_match_implemented_fastapi_routes():
    expected_routes = [
        'health: ["/health", "/api/health"]',
        'datasets: "/api/datasets"',
        'upload: "/api/datasets/upload"',
        'events: ["/api/stream"]',
    ]
    for route in expected_routes:
        assert route in APP_JS

    backend_routes = [
        '@app.get("/health")',
        '@app.get("/api/datasets")',
        '@app.post("/api/datasets/upload")',
        '@app.get("/api/stream")',
    ]
    for route in backend_routes:
        assert route in BACKEND

    assert 'async function pollTrainingJob(jobId)' in APP_JS
    assert '"/api/jobs/' in APP_JS
    assert '"/importance' in APP_JS or '}/importance' in APP_JS
    assert '}/predict' in APP_JS


def test_eda_chart_controls_have_matching_renderers():
    chart_ids = [
        "numericDistributionChart",
        "categoryDistributionChart",
        "missingnessChart",
        "numericChartSelect",
        "categoricalChartSelect",
    ]
    for element_id in chart_ids:
        assert f'id="{element_id}"' in HTML

    for renderer in [
        "renderNumericDistributionChart",
        "renderCategoryDistributionChart",
        "renderMissingnessChart",
    ]:
        assert re.search(rf"function {renderer}\\(", APP_JS)
