from __future__ import annotations

import asyncio
import json
import threading
import uuid
from collections import deque
from pathlib import Path

import joblib
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.intelligence import feature_importance, generate_insights, load_dataframe, predict, profile_dataframe, train_automl
from backend.store import DATA_DIR, MODEL_DIR, create_dataset, get_conn, get_dataset, init_db, list_datasets, update_dataset_analysis

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="DataVision Intelligence", version="2.0.0", description="Advanced realtime AI-powered data intelligence platform.")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")
init_db()

EVENTS = deque(maxlen=250)
EVENT_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}


def emit(kind: str, message: str, progress: int | None = None, job_id: str | None = None):
    event = {"id": uuid.uuid4().hex, "kind": kind, "message": message, "progress": progress, "job_id": job_id}
    with EVENT_LOCK:
        EVENTS.append(event)
    return event


def job_progress(job_id: str):
    def callback(kind: str, message: str, progress: int):
        JOBS[job_id] = {**JOBS.get(job_id, {}), "status": "running" if kind != "complete" else "complete", "message": message, "progress": progress}
        emit(kind, message, progress, job_id)
    return callback


@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "healthy", "service": "DataVision Intelligence", "version": "2.0.0"}


@app.get("/api/stream")
async def stream():
    async def events():
        last_sent = None
        while True:
            with EVENT_LOCK:
                snapshot = list(EVENTS)
            pending = []
            if snapshot:
                if last_sent is None:
                    pending = snapshot[-10:]
                else:
                    ids = [e["id"] for e in snapshot]
                    if last_sent in ids:
                        pending = snapshot[ids.index(last_sent) + 1:]
                    else:
                        pending = snapshot[-10:]
            for item in pending:
                last_sent = item["id"]
                yield "data: " + json.dumps(item) + "\n\n"
            if not pending:
                yield ": heartbeat\n\n"
            await asyncio.sleep(1.5)
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/datasets")
def datasets():
    rows = list_datasets()
    clean = []
    for row in rows:
        row["metrics"] = json.loads(row["metrics_json"]) if row.get("metrics_json") else None
        row["insights"] = json.loads(row["insights_json"]) if row.get("insights_json") else []
        row.pop("metrics_json", None)
        row.pop("insights_json", None)
        clean.append(row)
    return {"datasets": clean}


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Choose a dataset file.")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".csv", ".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Supported formats: CSV, XLSX, XLS.")
    raw = await file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Maximum upload size is 50 MB.")

    path = DATA_DIR / (uuid.uuid4().hex + suffix)
    path.write_bytes(raw)
    try:
        df = load_dataframe(path)
        profile = profile_dataframe(df)
        insights = generate_insights(profile)
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Dataset could not be parsed: {exc}") from exc

    dataset_id = create_dataset({"name": Path(file.filename).stem, "original_name": file.filename, "path": str(path), "rows": profile["shape"]["rows"], "columns": profile["shape"]["columns"], "size_bytes": len(raw)})
    emit("dataset", f"Dataset '{file.filename}' ingested successfully.")
    emit("profile", f"Profile ready: {profile['shape']['rows']:,} rows × {profile['shape']['columns']} columns.")
    return {"id": dataset_id, "dataset": {"id": dataset_id, "name": Path(file.filename).stem, "original_name": file.filename, "profile": profile, "insights": insights}}


@app.get("/api/datasets/{dataset_id}")
def dataset_detail(dataset_id: int):
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    df = load_dataframe(row["path"])
    profile = profile_dataframe(df)
    return {"dataset": row, "profile": profile, "insights": generate_insights(profile)}


@app.post("/api/datasets/{dataset_id}/train")
def train(dataset_id: int, target: str, background_tasks: BackgroundTasks):
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"id": job_id, "dataset_id": dataset_id, "status": "queued", "progress": 0, "message": "Queued"}
    emit("job", f"AutoML job queued for dataset #{dataset_id}.", 0, job_id)

    def runner():
        try:
            df = load_dataframe(row["path"])
            result = train_automl(df, target, dataset_id, MODEL_DIR, job_progress(job_id))
            insights = generate_insights(profile_dataframe(df))
            update_dataset_analysis(dataset_id, target, result["problem_type"], result["model_path"], result["best_model"], result["metrics"], insights)
            JOBS[job_id] = {**JOBS[job_id], "status": "complete", "result": result, "progress": 100}
            emit("model", f"{result['best_model']} selected as best model.", 100, job_id)
        except Exception as exc:
            JOBS[job_id] = {**JOBS[job_id], "status": "failed", "message": str(exc)}
            emit("error", str(exc), None, job_id)

    background_tasks.add_task(runner)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    item = JOBS.get(job_id)
    if not item:
        raise HTTPException(status_code=404, detail="Job not found.")
    return item


@app.get("/api/datasets/{dataset_id}/importance")
def importance(dataset_id: int):
    row = get_dataset(dataset_id)
    if not row or not row.get("model_path"):
        raise HTTPException(status_code=404, detail="Train a model for this dataset first.")
    return {"feature_importance": feature_importance(joblib.load(row["model_path"]))}


@app.post("/api/datasets/{dataset_id}/predict")
def prediction(dataset_id: int, payload: dict):
    row = get_dataset(dataset_id)
    if not row or not row.get("model_path"):
        raise HTTPException(status_code=404, detail="Train a model for this dataset first.")
    try:
        return predict(joblib.load(row["model_path"]), payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Prediction failed: {exc}") from exc


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int):
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    Path(row["path"]).unlink(missing_ok=True)
    if row.get("model_path"):
        Path(row["model_path"]).unlink(missing_ok=True)
    with get_conn() as conn:
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()
    emit("dataset", f"Dataset #{dataset_id} removed.")
    return {"success": True}
