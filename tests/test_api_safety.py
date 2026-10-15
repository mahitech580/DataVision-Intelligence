from time import time

from backend.main import JOBS, job_progress, public_dataset, public_job


def test_public_dataset_does_not_expose_internal_file_paths():
    item = public_dataset(
        {
            "id": 7,
            "name": "sales",
            "original_name": "sales.csv",
            "path": "/srv/private/uploads/internal-name.csv",
            "model_path": "/srv/private/models/model.joblib",
            "rows": 120,
            "columns": 4,
            "size_bytes": 4096,
            "created_at": "2026-10-15T00:00:00+00:00",
            "target": "revenue",
            "problem_type": "regression",
            "model_name": "Random Forest",
            "metrics_json": '{"best":{"r2":0.91},"benchmark":[]}',
            "insights_json": '["No missing values were detected."]',
        }
    )

    assert item["id"] == 7
    assert item["metrics"]["best"]["r2"] == 0.91
    assert item["insights"] == ["No missing values were detected."]
    assert "path" not in item
    assert "model_path" not in item
    assert "metrics_json" not in item
    assert "insights_json" not in item


def test_training_progress_does_not_mark_job_complete_before_result_exists():
    job_id = "test-completion-race"
    JOBS[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Queued",
        "created_at": time(),
    }

    try:
        job_progress(job_id)("complete", "Best model selected", 100)

        assert JOBS[job_id]["status"] == "running"
        assert "result" not in JOBS[job_id]

        # The runner owns the final state transition after saving metrics.
        JOBS[job_id] = {
            **JOBS[job_id],
            "status": "complete",
            "result": {"best_model": "Random Forest"},
        }

        assert JOBS[job_id]["status"] == "complete"
        assert JOBS[job_id]["result"]["best_model"] == "Random Forest"
    finally:
        JOBS.pop(job_id, None)



def test_public_job_omits_internal_model_artifact_path():
    safe = public_job(
        {
            "id": "job-123",
            "dataset_id": 7,
            "status": "complete",
            "progress": 100,
            "message": "Training finished",
            "created_at": 123.0,
            "result": {
                "problem_type": "classification",
                "best_model": "Extra Trees",
                "best_score": 0.92,
                "metrics": {"best": {"f1": 0.92}, "benchmark": []},
                "features": ["age", "segment"],
                "model_path": "/srv/private/models/dataset_7_best.joblib",
            },
        }
    )

    assert safe["status"] == "complete"
    assert safe["result"]["best_model"] == "Extra Trees"
    assert safe["result"]["features"] == ["age", "segment"]
    assert "model_path" not in safe["result"]
