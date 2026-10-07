from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor, GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def load_dataframe(path: str | Path) -> pd.DataFrame:
    p = Path(path)
    if p.suffix.lower() == ".csv":
        return pd.read_csv(p)
    if p.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(p)
    raise ValueError("Only CSV, XLSX, and XLS files are supported.")


def _safe_float(value: Any) -> float | None:
    try:
        value = float(value)
        if np.isfinite(value):
            return round(value, 4)
    except Exception:
        pass
    return None


def infer_problem_type(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series) or pd.api.types.is_object_dtype(series) or pd.api.types.is_categorical_dtype(series):
        return "classification"
    return "classification" if series.nunique(dropna=True) <= 20 else "regression"


def profile_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    rows, columns = df.shape
    missing_total = int(df.isna().sum().sum())
    duplicate_rows = int(df.duplicated().sum())
    numerical = df.select_dtypes(include=np.number).columns.tolist()
    categorical = df.select_dtypes(include=["object", "category", "bool"]).columns.tolist()

    column_profiles: list[dict[str, Any]] = []
    for col in df.columns:
        s = df[col]
        item: dict[str, Any] = {
            "name": str(col),
            "dtype": str(s.dtype),
            "non_null": int(s.notna().sum()),
            "missing": int(s.isna().sum()),
            "missing_pct": round(float(s.isna().mean() * 100), 2),
            "unique": int(s.nunique(dropna=True)),
        }
        if pd.api.types.is_numeric_dtype(s):
            item["stats"] = {
                "mean": _safe_float(s.mean()),
                "median": _safe_float(s.median()),
                "std": _safe_float(s.std()),
                "min": _safe_float(s.min()),
                "max": _safe_float(s.max()),
            }
        else:
            item["top_values"] = [{"value": str(k), "count": int(v)} for k, v in s.value_counts(dropna=True).head(5).items()]
        column_profiles.append(item)

    identifier_candidates, high_cardinality, constant_columns, missing_alerts, outlier_alerts = [], [], [], [], []
    for col in df.columns:
        ratio = float(df[col].nunique(dropna=False) / len(df)) if len(df) else 0
        if ratio >= 0.98 and len(df) > 10:
            identifier_candidates.append(str(col))
        if not pd.api.types.is_numeric_dtype(df[col]) and df[col].nunique(dropna=True) > 50:
            high_cardinality.append(str(col))
        if df[col].nunique(dropna=False) <= 1:
            constant_columns.append(str(col))
        miss = float(df[col].isna().mean() * 100)
        if miss > 0:
            missing_alerts.append({"column": str(col), "percentage": round(miss, 2), "severity": "high" if miss >= 50 else "medium" if miss >= 10 else "low"})
        if pd.api.types.is_numeric_dtype(df[col]) and df[col].nunique(dropna=True) >= 8:
            clean = df[col].dropna()
            q1, q3 = clean.quantile([0.25, 0.75])
            iqr = float(q3 - q1)
            if iqr > 0:
                low, high = float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)
                count = int(((clean < low) | (clean > high)).sum())
                if count:
                    pct = round(count / max(len(clean), 1) * 100, 2)
                    outlier_alerts.append({"column": str(col), "count": count, "percentage": pct, "severity": "high" if pct >= 10 else "medium" if pct >= 5 else "low"})

    correlations: dict[str, Any] = {"columns": [], "matrix": []}
    if len(numerical) >= 2:
        corr = df[numerical].corr().round(3)
        correlations = {"columns": [str(c) for c in corr.columns], "matrix": corr.fillna(0).values.tolist()}

    missing_ratio = float(missing_total / max(rows * columns, 1))
    duplicate_ratio = float(duplicate_rows / max(rows, 1))
    quality_score = round(max(0.0, min(100.0, 100 - missing_ratio * 55 - duplicate_ratio * 30 - len(constant_columns) * 4 - len(high_cardinality) * 2)), 1)

    return {
        "shape": {"rows": int(rows), "columns": int(columns)},
        "memory_mb": round(float(df.memory_usage(deep=True).sum() / 1024 / 1024), 3),
        "missing_total": missing_total,
        "duplicate_rows": duplicate_rows,
        "duplicate_pct": round(duplicate_ratio * 100, 2),
        "data_quality_score": quality_score,
        "numerical_columns": [str(x) for x in numerical],
        "categorical_columns": [str(x) for x in categorical],
        "identifier_candidates": identifier_candidates,
        "high_cardinality": high_cardinality,
        "constant_columns": constant_columns,
        "missing_alerts": missing_alerts,
        "outlier_alerts": outlier_alerts,
        "columns": column_profiles,
        "correlations": correlations,
    }


def generate_insights(profile: dict[str, Any]) -> list[str]:
    insights: list[str] = []
    rows = profile["shape"]["rows"]
    cols = profile["shape"]["columns"]
    if rows >= 10000:
        insights.append("Large dataset detected; sampling and asynchronous computation are recommended.")
    elif rows < 100:
        insights.append("Small dataset detected; model validation may be sensitive to the train/test split.")
    insights.append(f"{profile['missing_total']:,} missing values need attention before high-confidence modeling." if profile["missing_total"] else "No missing values were detected across the dataset.")
    if profile["duplicate_rows"]:
        insights.append(f"{profile['duplicate_rows']:,} duplicate rows were detected and should be reviewed.")
    if profile["constant_columns"]:
        insights.append("Constant columns carry no predictive information and are candidates for removal.")
    if profile["identifier_candidates"]:
        insights.append("Potential identifier columns were detected; excluding them can reduce spurious model patterns.")
    if profile["high_cardinality"]:
        insights.append("High-cardinality categorical features may need targeted encoding or aggregation.")
    if profile.get("outlier_alerts"):
        top_outlier = profile["outlier_alerts"][0]
        insights.append(f"Potential outliers affect {top_outlier['column']} ({top_outlier['percentage']}% of non-null values); investigate before modeling.")
    insights.append(f"The dataset contains {cols} columns across {rows:,} records with {len(profile['numerical_columns'])} numeric and {len(profile['categorical_columns'])} categorical fields.")
    return insights[:8]


def _preprocessor(df: pd.DataFrame, feature_cols: list[str]) -> ColumnTransformer:
    numeric = df[feature_cols].select_dtypes(include=np.number).columns.tolist()
    categorical = [c for c in feature_cols if c not in numeric]
    transforms = []
    if numeric:
        transforms.append(("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]), numeric))
    if categorical:
        transforms.append(("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]), categorical))
    return ColumnTransformer(transformers=transforms, remainder="drop")


def _models(problem_type: str) -> dict[str, Any]:
    if problem_type == "classification":
        return {
            "Logistic Regression": LogisticRegression(max_iter=1500),
            "Random Forest": RandomForestClassifier(n_estimators=250, random_state=42, n_jobs=-1),
            "Extra Trees": ExtraTreesClassifier(n_estimators=250, random_state=42, n_jobs=-1),
            "Gradient Boosting": GradientBoostingClassifier(random_state=42),
        }
    return {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=250, random_state=42, n_jobs=-1),
        "Extra Trees": ExtraTreesRegressor(n_estimators=250, random_state=42, n_jobs=-1),
        "Gradient Boosting": GradientBoostingRegressor(random_state=42),
    }


def train_automl(df: pd.DataFrame, target: str, dataset_id: int, model_dir: str | Path, progress) -> dict[str, Any]:
    if target not in df.columns:
        raise ValueError(f"Unknown target column: {target}")
    df = df.dropna(subset=[target]).copy()
    if len(df) < 30:
        raise ValueError("At least 30 usable rows are recommended for AutoML.")
    features = [c for c in df.columns if c != target]
    if not features:
        raise ValueError("At least one feature column is required.")

    problem_type = infer_problem_type(df[target])
    y = df[target].astype(str) if problem_type == "classification" else df[target]
    stratify = None
    if problem_type == "classification" and y.nunique() > 1:
        class_counts = y.value_counts()
        if int(class_counts.min()) >= 2:
            stratify = y
    X_train, X_test, y_train, y_test = train_test_split(
        df[features], y, test_size=0.2, random_state=42, stratify=stratify
    )

    results, best = [], None
    models = _models(problem_type)
    for index, (name, estimator) in enumerate(models.items(), start=1):
        progress("training", f"Training {name} ({index}/{len(models)})", int((index - 1) / len(models) * 85))
        started = perf_counter()
        try:
            pipeline = Pipeline([("preprocessor", _preprocessor(df, features)), ("model", estimator)])
            pipeline.fit(X_train, y_train)
            pred = pipeline.predict(X_test)
            duration_ms = round((perf_counter() - started) * 1000, 1)
            if problem_type == "classification":
                metrics = {"accuracy": round(float(accuracy_score(y_test, pred)), 4), "f1": round(float(f1_score(y_test, pred, average="weighted", zero_division=0)), 4)}
                score = metrics["f1"]
            else:
                mse = mean_squared_error(y_test, pred)
                metrics = {"r2": round(float(r2_score(y_test, pred)), 4), "mae": round(float(mean_absolute_error(y_test, pred)), 4), "rmse": round(float(np.sqrt(mse)), 4)}
                score = metrics["r2"]
            item = {"model": name, "status": "completed", "score": round(float(score), 4), "metrics": metrics, "duration_ms": duration_ms}
            results.append(item)
            if best is None or score > best["score"]:
                best = {"name": name, "score": float(score), "pipeline": pipeline, "metrics": metrics}
        except Exception as exc:
            results.append({"model": name, "status": "failed", "score": None, "metrics": {}, "duration_ms": round((perf_counter() - started) * 1000, 1), "error": str(exc)[:300]})
            progress("warning", f"{name} skipped: {str(exc)[:120]}", int(index / len(models) * 85))

    if best is None:
        raise RuntimeError("No model completed successfully; inspect benchmark errors for details.")

    model_path = Path(model_dir) / f"dataset_{dataset_id}_best.joblib"
    bundle = {
        "pipeline": best["pipeline"],
        "target": target,
        "features": features,
        "feature_dtypes": {str(c): str(df[c].dtype) for c in features},
        "problem_type": problem_type,
        "benchmark": results,
    }
    joblib.dump(bundle, model_path)
    progress("complete", f"Best model: {best['name']}", 100)
    return {"problem_type": problem_type, "best_model": best["name"], "best_score": round(best["score"], 4), "metrics": {"best": best["metrics"], "benchmark": results}, "model_path": str(model_path), "features": features}


def feature_importance(model_bundle: dict[str, Any]) -> list[dict[str, Any]]:
    pipeline = model_bundle["pipeline"]
    model = pipeline.named_steps["model"]
    pre = pipeline.named_steps["preprocessor"]
    try:
        names = pre.get_feature_names_out().tolist()
    except Exception:
        names = model_bundle["features"]
    values = None
    if hasattr(model, "feature_importances_"):
        values = np.asarray(model.feature_importances_)
    elif hasattr(model, "coef_"):
        coef = np.asarray(model.coef_)
        values = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)
    if values is None:
        return []

    raw_features = model_bundle["features"]
    aggregated: dict[str, float] = {str(feature): 0.0 for feature in raw_features}
    for name, value in zip(names, values.tolist()):
        clean = str(name)
        matched = next(
            (feature for feature in sorted(raw_features, key=len, reverse=True)
             if clean == f"numeric__{feature}" or clean.startswith(f"categorical__{feature}_")),
            None,
        )
        if matched is None:
            matched = clean.split("__", 1)[-1]
        aggregated[matched] = aggregated.get(matched, 0.0) + float(value)

    pairs = sorted(aggregated.items(), key=lambda x: x[1], reverse=True)[:20]
    total = sum(value for _, value in pairs) or 1.0
    return [
        {"feature": str(name), "importance": round(float(value), 6), "importance_pct": round(float(value / total * 100), 2)}
        for name, value in pairs
    ]


def predict(model_bundle: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    features = model_bundle["features"]
    dtypes = model_bundle.get("feature_dtypes", {})
    row: dict[str, Any] = {}
    for feature in features:
        value = inputs.get(feature, None)
        dtype = dtypes.get(feature, "")
        if value == "":
            value = None
        if dtype.startswith(("int", "float")) and value is not None:
            value = pd.to_numeric(value, errors="coerce")
        row[feature] = value

    frame = pd.DataFrame([row])
    prediction = model_bundle["pipeline"].predict(frame)[0]
    result: dict[str, Any] = {"prediction": str(prediction), "target": model_bundle.get("target")}
    pipe = model_bundle["pipeline"]
    if hasattr(pipe, "predict_proba"):
        probabilities = pipe.predict_proba(frame)[0]
        classes = getattr(pipe.named_steps.get("model"), "classes_", [])
        ranked = sorted(zip(classes, probabilities), key=lambda pair: float(pair[1]), reverse=True)
        result["confidence"] = round(float(np.max(probabilities)), 4)
        result["class_probabilities"] = [
            {"class": str(label), "probability": round(float(prob), 4)}
            for label, prob in ranked[:5]
        ]
    return result
