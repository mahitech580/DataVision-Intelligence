import json
import uuid
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from backend.config import ALLOWED_EXTENSIONS, DATA_DIR, MAX_FILE_SIZE
from backend.database.database import Dataset, get_db


router = APIRouter(
    prefix="/api/datasets",
    tags=["Datasets"],
)


def load_dataframe(file_path: Path):
    extension = file_path.suffix.lower()

    if extension == ".csv":
        return pd.read_csv(file_path)

    if extension in {".xlsx", ".xls"}:
        return pd.read_excel(file_path)

    raise ValueError("Unsupported file type.")


def analyze_dataset(file_path: Path):
    df = load_dataframe(file_path)

    column_info = []

    for column in df.columns:
        series = df[column]

        column_info.append({
            "name": str(column),
            "dtype": str(series.dtype),
            "missing": int(series.isna().sum()),
            "missing_percentage": round(
                float(series.isna().mean() * 100),
                2,
            ),
            "unique": int(series.nunique()),
        })

    return {
        "rows": int(df.shape[0]),
        "columns": int(df.shape[1]),
        "missing_values": int(df.isna().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
        "column_info": column_info,
    }


@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No file selected.",
        )

    extension = Path(file.filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files are allowed.",
        )

    file_content = await file.read()

    if len(file_content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="File exceeds the 50MB limit.",
        )

    unique_filename = f"{uuid.uuid4().hex}{extension}"
    file_path = DATA_DIR / unique_filename

    try:
        file_path.write_bytes(file_content)

        analysis = analyze_dataset(file_path)

        dataset = Dataset(
            name=Path(file.filename).stem,
            filename=file.filename,
            rows=analysis["rows"],
            columns=analysis["columns"],
            file_size=len(file_content),
        )

        db.add(dataset)
        db.commit()
        db.refresh(dataset)

        return {
            "success": True,
            "message": "Dataset uploaded successfully.",
            "dataset": {
                "id": dataset.id,
                "name": dataset.name,
                "filename": dataset.filename,
                "rows": dataset.rows,
                "columns": dataset.columns,
                "file_size": dataset.file_size,
                "missing_values": analysis["missing_values"],
                "duplicate_rows": analysis["duplicate_rows"],
                "column_info": analysis["column_info"],
                "uploaded_at": dataset.uploaded_at,
            },
        }

    except pd.errors.EmptyDataError:
        db.rollback()

        if file_path.exists():
            file_path.unlink()

        raise HTTPException(
            status_code=400,
            detail="The uploaded dataset is empty.",
        )

    except Exception as exc:
        db.rollback()

        if file_path.exists():
            file_path.unlink()

        raise HTTPException(
            status_code=500,
            detail=f"Dataset processing failed: {exc}",
        )


@router.get("/")
def get_datasets(
    db: Session = Depends(get_db),
):
    datasets = (
        db.query(Dataset)
        .order_by(Dataset.uploaded_at.desc())
        .all()
    )

    return {
        "success": True,
        "count": len(datasets),
        "datasets": [
            {
                "id": dataset.id,
                "name": dataset.name,
                "filename": dataset.filename,
                "rows": dataset.rows,
                "columns": dataset.columns,
                "file_size": dataset.file_size,
                "uploaded_at": dataset.uploaded_at,
            }
            for dataset in datasets
        ],
    }


@router.get("/{dataset_id}")
def get_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .first()
    )

    if dataset is None:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found.",
        )

    return {
        "success": True,
        "dataset": {
            "id": dataset.id,
            "name": dataset.name,
            "filename": dataset.filename,
            "rows": dataset.rows,
            "columns": dataset.columns,
            "file_size": dataset.file_size,
            "uploaded_at": dataset.uploaded_at,
        },
    }


@router.get("/{dataset_id}/profile")
def dataset_profile(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .first()
    )

    if dataset is None:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found.",
        )

    # Find uploaded file.
    matching_files = list(
        DATA_DIR.glob(f"*{Path(dataset.filename).suffix.lower()}")
    )

    # Prefer the most recent file when names are not stored.
    if not matching_files:
        raise HTTPException(
            status_code=404,
            detail="Uploaded dataset file not found.",
        )

    file_path = max(
        matching_files,
        key=lambda path: path.stat().st_mtime,
    )

    try:
        df = load_dataframe(file_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not read dataset: {exc}",
        )

    numerical_columns = df.select_dtypes(
        include="number"
    ).columns.tolist()

    categorical_columns = df.select_dtypes(
        include=["object", "category", "bool"]
    ).columns.tolist()

    columns = []

    for column in df.columns:
        series = df[column]

        item = {
            "name": str(column),
            "dtype": str(series.dtype),
            "non_null": int(series.notna().sum()),
            "missing": int(series.isna().sum()),
            "missing_percentage": round(
                float(series.isna().mean() * 100),
                2,
            ),
            "unique": int(series.nunique()),
        }

        if pd.api.types.is_numeric_dtype(series):
            item["statistics"] = {
                "mean": round(float(series.mean()), 4)
                if series.notna().any()
                else None,
                "median": round(float(series.median()), 4)
                if series.notna().any()
                else None,
                "std": round(float(series.std()), 4)
                if series.notna().sum() > 1
                else None,
                "min": float(series.min())
                if series.notna().any()
                else None,
                "max": float(series.max())
                if series.notna().any()
                else None,
            }

        columns.append(item)

    # Potential identifier columns.
    identifier_columns = []

    for column in df.columns:
        unique_ratio = (
            df[column].nunique(dropna=False) / len(df)
            if len(df) > 0
            else 0
        )

        if unique_ratio >= 0.95:
            identifier_columns.append(str(column))

    # Constant columns.
    constant_columns = [
        str(column)
        for column in df.columns
        if df[column].nunique(dropna=False) <= 1
    ]

    # Missing-value warnings.
    missing_warnings = []

    for column in df.columns:
        percentage = float(df[column].isna().mean() * 100)

        if percentage >= 50:
            severity = "high"
        elif percentage >= 10:
            severity = "medium"
        elif percentage > 0:
            severity = "low"
        else:
            continue

        missing_warnings.append({
            "column": str(column),
            "percentage": round(percentage, 2),
            "severity": severity,
        })

    # Memory usage.
    memory_mb = round(
        float(df.memory_usage(deep=True).sum() / 1024 / 1024),
        4,
    )

    return {
        "success": True,
        "dataset": {
            "id": dataset.id,
            "name": dataset.name,
            "filename": dataset.filename,
            "rows": int(df.shape[0]),
            "columns": int(df.shape[1]),
            "memory_mb": memory_mb,
            "duplicate_rows": int(df.duplicated().sum()),
            "missing_values": int(df.isna().sum().sum()),
            "numerical_columns": numerical_columns,
            "categorical_columns": categorical_columns,
            "identifier_columns": identifier_columns,
            "constant_columns": constant_columns,
            "missing_warnings": missing_warnings,
            "columns_info": columns,
        },
    }
