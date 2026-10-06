import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "uploads"
MODEL_DIR = BASE_DIR / "models"
DB_PATH = BASE_DIR / "data" / "datavision.sqlite3"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                original_name TEXT NOT NULL,
                path TEXT NOT NULL,
                rows INTEGER NOT NULL,
                columns INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                target TEXT,
                problem_type TEXT,
                model_path TEXT,
                model_name TEXT,
                metrics_json TEXT,
                insights_json TEXT
            )
            """
        )
        conn.commit()


def create_dataset(record: dict[str, Any]) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO datasets
            (name, original_name, path, rows, columns, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["name"],
                record["original_name"],
                record["path"],
                record["rows"],
                record["columns"],
                record["size_bytes"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_datasets() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM datasets ORDER BY id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_dataset(dataset_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
    return dict(row) if row else None


def update_dataset_analysis(
    dataset_id: int,
    target: str,
    problem_type: str,
    model_path: str,
    model_name: str,
    metrics: dict[str, Any],
    insights: list[str],
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE datasets
            SET target=?, problem_type=?, model_path=?, model_name=?,
                metrics_json=?, insights_json=?
            WHERE id=?
            """,
            (
                target,
                problem_type,
                model_path,
                model_name,
                json.dumps(metrics),
                json.dumps(insights),
                dataset_id,
            ),
        )
        conn.commit()
