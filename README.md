# 🤖 AI Data Intelligence Platform

> A production-style, end-to-end AI/ML analytics platform built with Python, FastAPI, Scikit-learn, and an interactive web dashboard.

---

## 📌 Problem Statement

Data scientists and analysts spend 70–80% of their time on data preparation, model selection, and evaluation — not on insights. This platform automates the entire ML pipeline: from raw data upload to explainable predictions, in minutes.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📁 **Dataset Upload** | Upload CSV / Excel files up to 50 MB |
| 🔍 **Auto Profiling** | Types, distributions, missing %, quantiles |
| 🧹 **Data Quality** | Outlier detection, duplicates, high cardinality, recommendations |
| 📈 **EDA** | Histograms, box plots, bar charts, correlation heatmap |
| 🤖 **AutoML** | Trains 6–7 models, auto-detects classification vs regression |
| 🏆 **Model Comparison** | Side-by-side comparison table + bar chart |
| 🧠 **Explainable AI** | Feature importance + per-prediction explanation |
| 🔮 **Predictions** | Dynamic input form generated from model features |
| 🧪 **Experiment Tracking** | Every training run saved to SQLite |
| 📑 **PDF Reports** | Downloadable automated report |

---

## 🏗️ Architecture

```
ai-data-intelligence/
├── backend/
│   ├── main.py              # FastAPI app + all API routes
│   ├── config.py            # Settings & paths
│   ├── database/
│   │   └── database.py      # SQLAlchemy models + session
│   ├── ml/
│   │   ├── trainer.py       # AutoML: multi-model training
│   │   └── explainability.py# Feature importance + SHAP proxy
│   └── services/
│       ├── profiler.py      # Dataset profiling + quality
│       ├── eda.py           # Chart data generation
│       └── report.py        # PDF generation (ReportLab)
├── frontend/
│   ├── dashboard.html       # Main dashboard
│   ├── dataset.html         # Upload + profiling
│   ├── quality.html         # Data quality page
│   ├── eda.html             # EDA visualizations
│   ├── automl.html          # AutoML training + comparison
│   ├── predictions.html     # Prediction interface
│   ├── experiments.html     # Experiment history
│   ├── reports.html         # PDF report download
│   ├── css/style.css        # Full design system
│   └── js/api.js            # API client + utils
├── data/uploads/            # Uploaded datasets
├── models/                  # Saved model .pkl files
├── reports/                 # Generated PDF reports
└── tests/test_core.py       # pytest test suite
```

---

## 🧰 Tech Stack

**Backend:** Python 3.12, FastAPI, Uvicorn, SQLAlchemy, SQLite  
**ML:** Scikit-learn, XGBoost, Pandas, NumPy, SciPy  
**XAI:** Feature importance, contribution-weighted explanations  
**Reports:** ReportLab PDF  
**Frontend:** HTML5, CSS3, Vanilla JS, Chart.js  

### Models Supported

**Classification:** Logistic Regression, Decision Tree, Random Forest, KNN, SVM, Gradient Boosting, XGBoost  
**Regression:** Linear Regression, Decision Tree, Random Forest, Gradient Boosting, SVR, XGBoost

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/ai-data-intelligence.git
cd ai-data-intelligence

# 2. Virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the server
uvicorn backend.main:app --reload

# 5. Open in browser
# http://localhost:8000
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/dashboard` | Dashboard stats |
| POST | `/api/datasets/upload` | Upload dataset |
| GET | `/api/datasets` | List all datasets |
| GET | `/api/datasets/{id}/profile` | Column-level profiling |
| GET | `/api/datasets/{id}/quality` | Data quality issues |
| GET | `/api/datasets/{id}/eda` | EDA chart data |
| POST | `/api/datasets/{id}/train` | Run AutoML |
| GET | `/api/datasets/{id}/feature-importance` | Feature importance |
| GET | `/api/datasets/{id}/prediction-fields` | Input fields for prediction |
| POST | `/api/datasets/{id}/predict` | Make a prediction |
| GET | `/api/experiments` | All experiments |
| POST | `/api/datasets/{id}/report` | Download PDF report |

Full interactive docs: `http://localhost:8000/docs`

---

## 🔁 ML Workflow

```
Upload CSV/Excel
      ↓
Auto Profile (shape, dtypes, missing, stats)
      ↓
Data Quality Check (outliers, duplicates, cardinality)
      ↓
EDA (histograms, correlations, distributions)
      ↓
Select Target Column
      ↓
AutoML (auto-detect classification/regression)
      ↓
Train all models with Sklearn Pipelines (no leakage)
      ↓
Compare models (accuracy/R²)
      ↓
Best model saved → Feature Importance + Explanation
      ↓
Prediction Interface → Explainable output
      ↓
Download PDF Report
```

---

## 🗄️ Database Schema

**datasets** — id, name, filename, rows, columns, file_size, uploaded_at  
**experiments** — id, dataset_id, target, problem_type, best_model, best_score, features, created_at  
**models** — id, experiment_id, model_name, parameters, metrics, model_path, training_time  
**predictions** — id, model_id, input_data, prediction, confidence, created_at

---

## 🧪 Running Tests

```bash
pytest tests/ -v
```

---

## 🔮 Future Improvements

- [ ] SHAP waterfall charts (full SHAP integration)
- [ ] Hyperparameter tuning UI (GridSearchCV)
- [ ] User authentication
- [ ] Dataset versioning
- [ ] Time-series forecasting support
- [ ] Model deployment API endpoint
- [ ] Docker containerisation

---

## 👤 Author

Built as a production-style portfolio project demonstrating end-to-end ML engineering skills.

**Stack:** Python · FastAPI · Scikit-learn · SQLAlchemy · XGBoost · ReportLab · Chart.js
