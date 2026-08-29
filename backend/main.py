from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.datasets import router as dataset_router
from backend.database.database import create_tables


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


# Create all database tables.
create_tables()


app = FastAPI(
    title="AI Data Intelligence Platform",
    description="Professional Python AI/ML Data Intelligence Platform",
    version="1.0.0",
)


# API routes
app.include_router(dataset_router)


# Frontend assets
if (FRONTEND_DIR / "css").exists():
    app.mount(
        "/css",
        StaticFiles(directory=FRONTEND_DIR / "css"),
        name="css",
    )

if (FRONTEND_DIR / "js").exists():
    app.mount(
        "/js",
        StaticFiles(directory=FRONTEND_DIR / "js"),
        name="js",
    )


@app.get("/")
def home():
    index_file = FRONTEND_DIR / "index.html"

    if index_file.exists():
        return FileResponse(index_file)

    return {
        "status": "running",
        "message": "AI Data Intelligence Platform API",
    }


@app.get("/dashboard.html")
def dashboard():
    dashboard_file = FRONTEND_DIR / "dashboard.html"

    if dashboard_file.exists():
        return FileResponse(dashboard_file)

    return {
        "error": "dashboard.html not found",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "AI Data Intelligence Platform",
    }
