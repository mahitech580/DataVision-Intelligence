"""EDA — generate chart-ready data for the frontend."""
import pandas as pd
import numpy as np
from typing import Dict, Any


def get_histogram_data(df: pd.DataFrame, col: str, bins: int = 20) -> Dict[str, Any]:
    if not pd.api.types.is_numeric_dtype(df[col]):
        return {}
    counts, edges = np.histogram(df[col].dropna(), bins=bins)
    labels = [f"{edges[i]:.2f}-{edges[i+1]:.2f}" for i in range(len(edges)-1)]
    return {"labels": labels, "values": counts.tolist(), "type": "histogram"}


def get_bar_data(df: pd.DataFrame, col: str, top_n: int = 15) -> Dict[str, Any]:
    vc = df[col].value_counts().head(top_n)
    return {"labels": [str(x) for x in vc.index.tolist()], "values": vc.values.tolist(), "type": "bar"}


def get_boxplot_data(df: pd.DataFrame, col: str) -> Dict[str, Any]:
    s = df[col].dropna()
    if not pd.api.types.is_numeric_dtype(s):
        return {}
    Q1, Q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
    IQR = Q3 - Q1
    return {
        "min": float(s.min()), "q1": Q1, "median": float(s.median()),
        "q3": Q3, "max": float(s.max()),
        "lower_fence": float(max(s.min(), Q1 - 1.5 * IQR)),
        "upper_fence": float(min(s.max(), Q3 + 1.5 * IQR)),
        "type": "boxplot"
    }


def get_scatter_data(df: pd.DataFrame, x_col: str, y_col: str, sample: int = 500) -> Dict[str, Any]:
    sub = df[[x_col, y_col]].dropna().sample(min(sample, len(df)))
    return {
        "x": sub[x_col].tolist(), "y": sub[y_col].tolist(),
        "x_label": x_col, "y_label": y_col, "type": "scatter"
    }


def get_correlation_matrix(df: pd.DataFrame) -> Dict[str, Any]:
    num_df = df.select_dtypes(include=[np.number])
    if num_df.shape[1] < 2:
        return {}
    corr = num_df.corr().round(3)
    return {
        "columns": corr.columns.tolist(),
        "matrix": corr.values.tolist(),
        "type": "heatmap"
    }


def get_all_eda(df: pd.DataFrame) -> Dict[str, Any]:
    result = {"columns": df.columns.tolist(), "charts": {}}
    for col in df.columns[:10]:  # limit for performance
        if pd.api.types.is_numeric_dtype(df[col]):
            result["charts"][col] = {
                "histogram": get_histogram_data(df, col),
                "boxplot": get_boxplot_data(df, col),
            }
        else:
            result["charts"][col] = {"bar": get_bar_data(df, col)}
    result["correlation"] = get_correlation_matrix(df)
    return result
