"""Core tests for AI Data Intelligence Platform."""
import pytest
import pandas as pd
import numpy as np
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from backend.services.profiler import profile_dataset, detect_data_quality_issues
from backend.services.eda import get_histogram_data, get_correlation_matrix
from backend.ml.trainer import detect_problem_type, run_automl


@pytest.fixture
def sample_classification_df():
    np.random.seed(42)
    return pd.DataFrame({
        "age": np.random.randint(20, 65, 100),
        "salary": np.random.randint(30000, 120000, 100),
        "experience": np.random.randint(0, 20, 100),
        "target": np.random.choice(["Yes", "No"], 100),
    })


@pytest.fixture
def sample_regression_df():
    np.random.seed(42)
    X = np.random.randn(100, 3)
    return pd.DataFrame({
        "feature1": X[:, 0],
        "feature2": X[:, 1],
        "feature3": X[:, 2],
        "price": X[:, 0] * 10 + X[:, 1] * 5 + np.random.randn(100),
    })


def test_profile_shape(sample_classification_df):
    p = profile_dataset(sample_classification_df)
    assert p["shape"]["rows"] == 100
    assert p["shape"]["columns"] == 4


def test_profile_columns(sample_classification_df):
    p = profile_dataset(sample_classification_df)
    col_names = [c["name"] for c in p["columns"]]
    assert "age" in col_names and "salary" in col_names


def test_quality_no_issues_clean_data(sample_classification_df):
    q = detect_data_quality_issues(sample_classification_df)
    assert "issues" in q
    assert "recommendations" in q
    assert "quality_score" in q
    assert q["quality_score"] >= 0


def test_quality_detects_missing():
    df = pd.DataFrame({"a": [1, None, 3, None, 5], "b": ["x", "y", None, "w", "v"]})
    q = detect_data_quality_issues(df)
    types = [i["type"] for i in q["issues"]]
    assert "missing_values" in types


def test_quality_detects_constant():
    df = pd.DataFrame({"a": [1, 1, 1, 1, 1], "b": [1, 2, 3, 4, 5]})
    q = detect_data_quality_issues(df)
    types = [i["type"] for i in q["issues"]]
    assert "constant_column" in types


def test_detect_problem_type_classification(sample_classification_df):
    pt = detect_problem_type(sample_classification_df["target"])
    assert pt == "classification"


def test_detect_problem_type_regression(sample_regression_df):
    pt = detect_problem_type(sample_regression_df["price"])
    assert pt == "regression"


def test_histogram_data(sample_classification_df):
    h = get_histogram_data(sample_classification_df, "age")
    assert "labels" in h and "values" in h
    assert len(h["labels"]) == len(h["values"])


def test_correlation_matrix(sample_regression_df):
    corr = get_correlation_matrix(sample_regression_df)
    assert "columns" in corr and "matrix" in corr
    assert len(corr["columns"]) == len(corr["matrix"])


def test_automl_classification(sample_classification_df, tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "MODELS_DIR", tmp_path)
    result = run_automl(sample_classification_df, "target", dataset_id=999)
    assert result["problem_type"] == "classification"
    assert result["best_model"] is not None
    assert 0 <= result["best_score"] <= 1
    assert len(result["results"]) > 0


def test_automl_regression(sample_regression_df, tmp_path, monkeypatch):
    import backend.config as cfg
    monkeypatch.setattr(cfg, "MODELS_DIR", tmp_path)
    result = run_automl(sample_regression_df, "price", dataset_id=998)
    assert result["problem_type"] == "regression"
    assert result["best_model"] is not None
