# DataVision Intelligence

Advanced AI-powered data intelligence platform for turning raw datasets into explainable, actionable insights.

## What it does

DataVision Intelligence combines persistent dataset management, automated profiling, data-quality intelligence, exploratory analytics, asynchronous AutoML, model comparison, explainability signals, predictions, experiment state, and a realtime activity stream in one workspace.

Core flow:

~~~text
Upload → Profile → Quality → Insights → Train → Compare → Explain → Predict → Monitor
~~~

## Current architecture

~~~text
backend/
  main.py
  store.py
  intelligence.py
frontend/
  index.html
  app.js
  styles.css
models/
data/uploads/
tests/
~~~

Backend is FastAPI. Data work is powered by pandas and scikit-learn. The browser uses vanilla JavaScript and Chart.js.

## Realtime design

Training runs as background jobs and emits server-sent events. The browser subscribes to /api/stream, so progress appears live without manual refresh.

## Intelligence layer

The current engine automatically calculates shape, memory, missingness, duplicates, constant columns, identifier candidates, cardinality warnings, numeric summaries, categorical summaries, correlations, target recommendations, and human-readable insights.

AutoML evaluates multiple classification or regression pipelines with preprocessing inside each pipeline to avoid train/test leakage. The best pipeline is persisted and can be used immediately by the prediction interface.

## Run locally

1. Create a virtual environment.
2. Install requirements.
3. Run: uvicorn backend.main:app --reload
4. Open http://127.0.0.1:8000

API docs are available at /docs.

## Product direction

Future daily iterations can add time-series intelligence, anomaly detection, drift monitoring, richer model diagnostics, feature lineage, scheduled data refresh, natural-language analysis, and production deployment integrations.

## Portfolio positioning

DataVision Intelligence is intended to demonstrate full-stack ML engineering: data ingestion, analytics, model orchestration, explainability, asynchronous processing, realtime UI updates, persistence, testing, and product-quality UX.
