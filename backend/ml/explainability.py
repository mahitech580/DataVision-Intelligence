"""Explainable AI — SHAP + feature importance."""
import numpy as np
import pandas as pd
import json, joblib
from pathlib import Path
from typing import Dict, Any

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False


def get_feature_importance(pipeline, feature_cols: list) -> Dict[str, Any]:
    """Extract feature importance from trained pipeline."""
    model = pipeline.named_steps["model"]
    preprocessor = pipeline.named_steps["preprocessor"]

    # Get feature names after transformation
    try:
        feature_names = preprocessor.get_feature_names_out()
    except Exception:
        feature_names = feature_cols

    importance = None
    if hasattr(model, "feature_importances_"):
        importance = model.feature_importances_
    elif hasattr(model, "coef_"):
        coef = model.coef_
        importance = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)

    if importance is None:
        return {"feature_importance": []}

    # Map back to original feature names where possible
    pairs = sorted(zip(feature_names, importance.tolist()), key=lambda x: x[1], reverse=True)
    return {
        "feature_importance": [{"feature": str(f), "importance": round(float(v), 4)} for f, v in pairs[:20]]
    }


def explain_prediction(pipeline, input_df: pd.DataFrame, problem_type: str) -> Dict[str, Any]:
    """Explain a single prediction using feature importance proxy."""
    try:
        prediction = pipeline.predict(input_df)[0]
        proba = None
        if hasattr(pipeline, "predict_proba"):
            proba = pipeline.predict_proba(input_df)[0].tolist()

        preprocessor = pipeline.named_steps["preprocessor"]
        model = pipeline.named_steps["model"]

        X_transformed = preprocessor.transform(input_df)
        try:
            feature_names = preprocessor.get_feature_names_out()
        except Exception:
            feature_names = [f"feature_{i}" for i in range(X_transformed.shape[1])]

        importance = None
        if hasattr(model, "feature_importances_"):
            importance = model.feature_importances_
        elif hasattr(model, "coef_"):
            coef = model.coef_
            importance = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)

        explanation = []
        if importance is not None:
            vals = X_transformed[0] if hasattr(X_transformed, '__getitem__') else X_transformed.toarray()[0]
            contributions = np.array(importance) * np.abs(vals)
            pairs = sorted(zip(feature_names, contributions.tolist()), key=lambda x: x[1], reverse=True)
            explanation = [{"feature": str(f), "contribution": round(float(v), 4)} for f, v in pairs[:10]]

        return {
            "prediction": str(prediction),
            "probability": proba,
            "explanation": explanation,
        }
    except Exception as e:
        return {"prediction": "Error", "error": str(e)}
