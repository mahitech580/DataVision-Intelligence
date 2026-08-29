"""Dataset profiling service."""
import pandas as pd
import numpy as np
from typing import Dict, Any


def profile_dataset(df: pd.DataFrame) -> Dict[str, Any]:
    """Generate comprehensive dataset profile."""
    profile = {
        "shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
        "memory_usage": round(df.memory_usage(deep=True).sum() / 1024 / 1024, 2),
        "duplicate_rows": int(df.duplicated().sum()),
        "total_missing": int(df.isnull().sum().sum()),
        "missing_percentage": round(df.isnull().sum().sum() / (df.shape[0] * df.shape[1]) * 100, 2),
        "columns": [],
        "dtypes": {
            "numerical": df.select_dtypes(include=[np.number]).columns.tolist(),
            "categorical": df.select_dtypes(exclude=[np.number]).columns.tolist(),
        }
    }
    for col in df.columns:
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "unique_values": int(df[col].nunique()),
            "missing_count": int(df[col].isnull().sum()),
            "missing_pct": round(df[col].isnull().mean() * 100, 2),
        }
        if pd.api.types.is_numeric_dtype(df[col]):
            col_info.update({
                "mean": round(float(df[col].mean()), 4) if not df[col].isnull().all() else None,
                "median": round(float(df[col].median()), 4) if not df[col].isnull().all() else None,
                "std": round(float(df[col].std()), 4) if not df[col].isnull().all() else None,
                "min": round(float(df[col].min()), 4) if not df[col].isnull().all() else None,
                "max": round(float(df[col].max()), 4) if not df[col].isnull().all() else None,
                "q25": round(float(df[col].quantile(0.25)), 4) if not df[col].isnull().all() else None,
                "q75": round(float(df[col].quantile(0.75)), 4) if not df[col].isnull().all() else None,
            })
        profile["columns"].append(col_info)
    return profile


def detect_data_quality_issues(df: pd.DataFrame) -> Dict[str, Any]:
    """Detect data quality issues and generate recommendations."""
    issues = []
    recommendations = []
    for col in df.columns:
        miss_pct = df[col].isnull().mean() * 100
        if miss_pct > 0:
            issues.append({"type": "missing_values", "column": col, "detail": f"{miss_pct:.1f}% missing"})
            if miss_pct > 50:
                recommendations.append(f"Column '{col}' has {miss_pct:.1f}% missing values — consider dropping it.")
            else:
                recommendations.append(f"Column '{col}' has {miss_pct:.1f}% missing values — consider imputation.")
        if pd.api.types.is_numeric_dtype(df[col]):
            Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            IQR = Q3 - Q1
            outliers = ((df[col] < Q1 - 1.5 * IQR) | (df[col] > Q3 + 1.5 * IQR)).sum()
            if outliers > 0:
                issues.append({"type": "outliers", "column": col, "detail": f"{outliers} outliers detected"})
                recommendations.append(f"Column '{col}' contains {outliers} potential outliers.")
        if df[col].nunique() == 1:
            issues.append({"type": "constant_column", "column": col, "detail": "Only 1 unique value"})
            recommendations.append(f"Column '{col}' is constant — it adds no predictive value.")
        if df[col].nunique() == df.shape[0] and df.shape[0] > 10:
            issues.append({"type": "id_column", "column": col, "detail": "Likely an ID/index column"})
            recommendations.append(f"Column '{col}' may be an ID — consider excluding from modeling.")
        if pd.api.types.is_object_dtype(df[col]) and df[col].nunique() > 50:
            issues.append({"type": "high_cardinality", "column": col, "detail": f"{df[col].nunique()} unique values"})
            recommendations.append(f"Column '{col}' has high cardinality ({df[col].nunique()} values) — consider encoding carefully.")
    dup_count = df.duplicated().sum()
    if dup_count > 0:
        issues.append({"type": "duplicates", "column": "ALL", "detail": f"{dup_count} duplicate rows"})
        recommendations.append(f"Dataset contains {dup_count} duplicate rows — consider removing them.")
    return {"issues": issues, "recommendations": recommendations, "quality_score": max(0, 100 - len(issues) * 5)}
