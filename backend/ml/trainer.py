"""AutoML trainer — trains, evaluates, and compares multiple models."""
import time, json, joblib
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, Any, Tuple

from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder, LabelEncoder
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC, SVR
from sklearn.metrics import (accuracy_score, precision_score, recall_score, f1_score,
                             roc_auc_score, mean_absolute_error, mean_squared_error, r2_score)

try:
    from xgboost import XGBClassifier, XGBRegressor
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from backend.config import MODELS_DIR


def detect_problem_type(y: pd.Series) -> str:
    if y.dtype == object or y.nunique() <= 20:
        return "classification"
    return "regression"


def build_preprocessor(df: pd.DataFrame, feature_cols: list) -> ColumnTransformer:
    num_cols = df[feature_cols].select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df[feature_cols].select_dtypes(exclude=[np.number]).columns.tolist()
    transformers = []
    if num_cols:
        transformers.append(("num", Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler())
        ]), num_cols))
    if cat_cols:
        transformers.append(("cat", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False))
        ]), cat_cols))
    return ColumnTransformer(transformers=transformers, remainder="drop")


def get_classifiers() -> Dict[str, Any]:
    models = {
        "Logistic Regression": LogisticRegression(max_iter=1000, random_state=42),
        "Decision Tree": DecisionTreeClassifier(random_state=42),
        "Random Forest": RandomForestClassifier(n_estimators=100, random_state=42),
        "KNN": KNeighborsClassifier(n_neighbors=5),
        "SVM": SVC(probability=True, random_state=42),
        "Gradient Boosting": GradientBoostingClassifier(random_state=42),
    }
    if HAS_XGB:
        models["XGBoost"] = XGBClassifier(eval_metric="logloss", random_state=42, verbosity=0)
    return models


def get_regressors() -> Dict[str, Any]:
    models = {
        "Linear Regression": LinearRegression(),
        "Decision Tree": DecisionTreeRegressor(random_state=42),
        "Random Forest": RandomForestRegressor(n_estimators=100, random_state=42),
        "Gradient Boosting": GradientBoostingRegressor(random_state=42),
        "SVR": SVR(),
    }
    if HAS_XGB:
        models["XGBoost"] = XGBRegressor(random_state=42, verbosity=0)
    return models


def evaluate_classifier(model, X_test, y_test) -> Dict[str, float]:
    y_pred = model.predict(X_test)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
    }
    try:
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(X_test)
            if proba.shape[1] == 2:
                metrics["roc_auc"] = round(float(roc_auc_score(y_test, proba[:, 1])), 4)
    except Exception:
        pass
    return metrics


def evaluate_regressor(model, X_test, y_test) -> Dict[str, float]:
    y_pred = model.predict(X_test)
    return {
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 4),
        "mse": round(float(mean_squared_error(y_test, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 4),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
    }


def run_automl(df: pd.DataFrame, target_col: str, dataset_id: int,
               test_size: float = 0.2, random_state: int = 42) -> Dict[str, Any]:
    """Run full AutoML pipeline and return results."""
    feature_cols = [c for c in df.columns if c != target_col]
    X = df[feature_cols].copy()
    y = df[target_col].copy()

    problem_type = detect_problem_type(y)
    le = None
    if problem_type == "classification":
        le = LabelEncoder()
        y = le.fit_transform(y.astype(str))

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state)

    preprocessor = build_preprocessor(df, feature_cols)
    models = get_classifiers() if problem_type == "classification" else get_regressors()

    results = []
    best_score = -np.inf
    best_pipeline = None
    best_model_name = None

    for name, estimator in models.items():
        try:
            t0 = time.time()
            pipeline = Pipeline([("preprocessor", preprocessor), ("model", estimator)])
            pipeline.fit(X_train, y_train)
            elapsed = round(time.time() - t0, 2)

            if problem_type == "classification":
                metrics = evaluate_classifier(pipeline, X_test, y_test)
                score = metrics["accuracy"]
            else:
                metrics = evaluate_regressor(pipeline, X_test, y_test)
                score = metrics["r2"]

            results.append({
                "model_name": name,
                "score": score,
                "metrics": metrics,
                "training_time": elapsed,
                "pipeline": pipeline,
            })
            if score > best_score:
                best_score = score
                best_pipeline = pipeline
                best_model_name = name
        except Exception as e:
            results.append({"model_name": name, "score": None, "error": str(e)})

    # Save best model
    model_path = str(MODELS_DIR / f"dataset_{dataset_id}_best.pkl")
    meta_path = str(MODELS_DIR / f"dataset_{dataset_id}_meta.json")
    if best_pipeline:
        joblib.dump(best_pipeline, model_path)
        meta = {
            "feature_cols": feature_cols,
            "target_col": target_col,
            "problem_type": problem_type,
            "best_model": best_model_name,
            "label_encoder": le.classes_.tolist() if le else None,
        }
        with open(meta_path, "w") as f:
            json.dump(meta, f)

    display_results = [{k: v for k, v in r.items() if k != "pipeline"} for r in results]
    return {
        "problem_type": problem_type,
        "best_model": best_model_name,
        "best_score": round(best_score, 4),
        "results": display_results,
        "feature_cols": feature_cols,
        "model_path": model_path,
    }
