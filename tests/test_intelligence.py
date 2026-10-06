import pandas as pd
from backend.intelligence import generate_insights, infer_problem_type, profile_dataframe


def test_profile_counts():
    df = pd.DataFrame({"age": [20, 21, None], "segment": ["A", "A", "B"]})
    profile = profile_dataframe(df)
    assert profile["shape"] == {"rows": 3, "columns": 2}
    assert profile["missing_total"] == 1


def test_problem_type():
    assert infer_problem_type(pd.Series(["yes", "no", "yes"])) == "classification"
    assert infer_problem_type(pd.Series(range(50), dtype=float)) == "regression"


def test_insights():
    df = pd.DataFrame({"x": [1, None, 3], "y": [1, 2, 3]})
    insights = generate_insights(profile_dataframe(df))
    assert insights
    assert any("missing" in item.lower() for item in insights)
