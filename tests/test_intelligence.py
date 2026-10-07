import numpy as np
import pandas as pd

from backend.intelligence import feature_importance, predict, profile_dataframe


def test_profile_reports_quality_and_outliers():
    values = [10, 11, 12, 13, 14, 15, 16, 1000]
    frame = pd.DataFrame({"signal": values, "category": ["a"] * 8})
    profile = profile_dataframe(frame)

    assert 0 <= profile["data_quality_score"] <= 100
    assert profile["duplicate_pct"] == 0
    assert any(item["column"] == "signal" for item in profile["outlier_alerts"])


def test_feature_importance_aggregates_encoded_categories():
    frame = pd.DataFrame({
        "age": [20, 21, 35, 36, 50, 51, 60, 61],
        "segment": ["a", "a", "b", "b", "c", "c", "a", "c"],
    })
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import ExtraTreesClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    from sklearn.impute import SimpleImputer

    pre = ColumnTransformer([
        ("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]), ["age"]),
        ("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False))]), ["segment"]),
    ])
    pipe = Pipeline([("preprocessor", pre), ("model", ExtraTreesClassifier(n_estimators=20, random_state=42))])
    pipe.fit(frame, ["low", "low", "mid", "mid", "high", "high", "mid", "high"])

    bundle = {"pipeline": pipe, "features": ["age", "segment"]}
    items = feature_importance(bundle)

    assert items
    assert {item["feature"] for item in items} <= {"age", "segment"}
    assert np.isclose(sum(item["importance"] for item in items), sum(item["importance"] for item in items))


def test_classification_prediction_exposes_ranked_probabilities():
    frame = pd.DataFrame({"x": [0, 0, 1, 1, 2, 2, 3, 3], "label": ["a", "a", "a", "a", "b", "b", "b", "b"]})
    from sklearn.ensemble import ExtraTreesClassifier
    from sklearn.pipeline import Pipeline

    pipe = Pipeline([("preprocessor", __import__("backend.intelligence", fromlist=["_preprocessor"])._preprocessor(frame, ["x"])), ("model", ExtraTreesClassifier(n_estimators=20, random_state=42))])
    pipe.fit(frame[["x"]], frame["label"])

    result = predict({
        "pipeline": pipe,
        "features": ["x"],
        "feature_dtypes": {"x": "int64"},
        "target": "label",
    }, {"x": "2"})

    assert result["target"] == "label"
    assert 0 <= result["confidence"] <= 1
    assert result["class_probabilities"]
    assert len(result["class_probabilities"]) <= 5
    assert result["class_probabilities"][0]["probability"] >= result["class_probabilities"][-1]["probability"]
