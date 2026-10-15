# DataVision Intelligence

**An AI-powered data intelligence platform for turning raw datasets into explainable insights, reliable machine learning models, and actionable predictions.**

DataVision Intelligence brings data ingestion, automated profiling, data-quality analysis, exploratory analytics, AutoML, model comparison, explainability, and prediction workflows into a unified workspace.

The project demonstrates full-stack machine learning engineering with **FastAPI, pandas, scikit-learn, vanilla JavaScript, and Chart.js**.

---

## Overview

DataVision Intelligence is designed to help users move from an unfamiliar dataset to a better understanding of its quality, patterns, and predictive potential.

Instead of treating data preparation, analysis, model training, and prediction as separate tasks, the platform organizes them into a connected workflow.

```text
Upload
  ↓
Profile
  ↓
Data Quality
  ↓
Discover Insights
  ↓
Train Models
  ↓
Compare Performance
  ↓
Explain Predictions
  ↓
Generate Predictions
  ↓
Monitor Activity
```

## Key Features

### 1. Dataset Ingestion and Management

- Import structured datasets from CSV and Excel files.
- Inspect rows, columns, data types, and representative records.
- Maintain a dataset inventory.
- Associate analysis results with individual datasets.
- Support backend-managed dataset persistence.
- Export dataset data and analysis reports.

### 2. Automated Data Profiling

Automatically inspect dataset structure and summarize important characteristics, including:

- Number of rows, columns, and data cells.
- Dataset memory usage and structural information.
- Missing-value counts and percentages.
- Duplicate records and constant columns.
- Candidate identifiers and high-cardinality columns.
- Numeric descriptive statistics.
- Categorical distributions and unique-value counts.
- Potential data-quality issues.

### 3. Data Quality Intelligence

Identify issues that may affect downstream analysis and machine learning.

- Missing-data analysis.
- Duplicate-record detection.
- Empty and constant-column detection.
- Cardinality and feature-type checks.
- Human-readable quality findings.
- Warnings to help prioritize data preparation.

Data-quality findings are diagnostic signals. They do not automatically establish that a dataset is accurate, unbiased, or suitable for every modeling task.

### 4. Exploratory Data Analysis

Explore dataset characteristics before training a model.

- Numeric summaries and feature distributions.
- Categorical feature summaries.
- Numeric correlation analysis.
- Potential relationships between variables.
- Data-quality and profiling insights.
- Dataset previews and column-level information.

Chart.js supports interactive visualizations in the browser.

### 5. Automated Machine Learning

The AutoML workflow is designed to evaluate suitable candidate pipelines for classification or regression tasks.

- Select a target column.
- Determine an appropriate prediction task.
- Prepare numerical and categorical features.
- Apply preprocessing within model pipelines.
- Compare candidate estimators using evaluation metrics.
- Return the selected model and benchmark results.
- Persist trained pipelines for subsequent inference.

Preprocessing should be fitted on training data within each evaluation pipeline to reduce data leakage. Model selection and validation strategy must also be appropriate for the dataset and prediction task.

### 6. Model Comparison and Evaluation

Review model-training results in the Model Lab.

- Compare candidate pipelines.
- Inspect available performance metrics.
- Review the selected model.
- Associate model results with datasets and targets.
- Examine returned evaluation information.

The appropriate metrics depend on the task. Classification can use measures such as precision, recall, F1-score, and ROC-AUC; regression can use MAE, RMSE, and \(R^2\), where appropriate.

### 7. Model Explainability

Make model behavior easier to inspect through feature-level signals.

- Display feature-importance values returned by the model service.
- Compare relative feature contributions.
- Connect model results with their associated dataset and target.
- Present explanatory information in an accessible interface.

Feature importance describes a model-specific relationship; it should not automatically be interpreted as causation.

### 8. Prediction and Inference

Use a trained model to generate predictions from user-provided feature values.

- Generate prediction input fields from model features.
- Submit inputs to the inference service.
- Display the response in the workspace.
- Show confidence or additional information when supplied by the backend.
- Associate inference activity with the selected model.

Predictions rely on a trained, compatible model and a functioning inference endpoint.

### 9. Realtime Activity Stream

The backend is designed to publish operational events using Server-Sent Events (SSE).

- Training-job progress updates.
- Dataset ingestion events.
- Prediction activity.
- System status and job notifications.
- Browser-side event filtering and activity history.

The intended stream endpoint is:

```text
/api/stream
```

The frontend and backend must use the same endpoint and event payload format for realtime updates to work correctly.

### 10. Persistent Experiment State

The backend architecture separates data storage, analytical operations, and API handling.

This provides a foundation for maintaining datasets, training results, experiment metadata, and saved model pipelines across application sessions.

Actual persistence depends on the configured storage implementation and successful backend operations.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Backend API | Python, FastAPI |
| Data processing | pandas, NumPy |
| Machine learning | scikit-learn |
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Data visualization | Chart.js |
| Spreadsheet ingestion | SheetJS / XLSX |
| Realtime updates | Server-Sent Events |
| Model persistence | Backend-managed model storage |
| API documentation | FastAPI OpenAPI documentation |
| Testing | Python testing tools and project test suite |

## Architecture

```text
┌──────────────────────────────────────────┐
│           Browser Workspace              │
│                                          │
│  index.html · styles.css · app.js        │
│                                          │
│  Dataset Explorer · Charts · Model Lab   │
│  Predictions · Activity Stream           │
└───────────────────┬──────────────────────┘
                    │ HTTP / JSON
                    │ Multipart uploads
                    │ Server-Sent Events
                    ▼
┌──────────────────────────────────────────┐
│              FastAPI Backend             │
│                                          │
│  Request Validation · API Routes         │
│  Dataset Operations · Background Jobs    │
│  Training · Prediction · Event Streaming │
└───────────────┬──────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐  ┌───────────────────────┐
│ Data Services │  │ Intelligence Engine   │
│               │  │                       │
│ store.py      │  │ intelligence.py       │
│ Dataset State │  │ Profiling and Quality │
│ Saved Models  │  │ AutoML and Evaluation │
└───────────────┘  └───────────────────────┘
        │                │
        ▼                ▼
┌───────────────┐  ┌───────────────────────┐
│ Upload Storage│  │ scikit-learn Pipelines│
│ data/uploads/ │  │ Trained Model Artifacts│
└───────────────┘  └───────────────────────┘
```

## Project Structure

```text
DataVision-Intelligence/
│
├── backend/
│   ├── main.py
│   ├── store.py
│   ├── intelligence.py
│   └── ...
│
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
│
├── models/
│   └── ...                 # Persisted model artifacts
│
├── data/
│   └── uploads/            # Uploaded dataset storage
│
├── tests/
│   └── ...                 # Automated tests
│
├── requirements.txt
├── .gitignore
└── README.md
```

Files inside `models/` and `data/uploads/` may be generated at runtime. Avoid committing private datasets, credentials, or unnecessarily large model artifacts to version control.

## Getting Started

### Prerequisites

- Python 3.10 or a compatible version supported by the project dependencies.
- pip.
- Git.
- A modern web browser.

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd DataVision-Intelligence
```

Replace `<YOUR_REPOSITORY_URL>` with the actual Git repository URL.

### 2. Create a virtual environment

**Windows — PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Ensure `requirements.txt` contains the dependencies used by the backend, including FastAPI, Uvicorn, pandas, NumPy, scikit-learn, and any additional packages required by the project.

### 4. Start the backend

Run this command from the repository root:

```bash
uvicorn backend.main:app --reload
```

The development API should be available at:

```text
http://127.0.0.1:8000
```

### 5. Open the application

If FastAPI is configured to serve the frontend, open:

```text
http://127.0.0.1:8000
```

Otherwise, configure the FastAPI application to mount or serve the frontend directory, or use a local static-file server and configure the frontend API URL accordingly.

### 6. Explore the API

Open the interactive API documentation:

```text
http://127.0.0.1:8000/docs
```

Use the documentation to inspect the routes actually registered by the running backend and test their request and response formats.

---

## Realtime Training Architecture

The API creates a training job and returns a job ID. The client then polls job status while subscribing to the event stream for live updates.

```text
Browser
  │
  ├── POST /api/datasets/{dataset_id}/train?target=column_name
  │
  ▼
FastAPI application
  │
  ├── Create in-memory job record
  ├── Schedule a FastAPI BackgroundTask
  │
  ▼
Model training
  ├── Prepare train/test split
  ├── Evaluate candidate pipelines
  ├── Persist the best model artifact
  └── Save metrics and dataset metadata
  │
  ├── GET /api/jobs/{job_id}
  └── GET /api/stream  ─────► browser activity feed
```

The current implementation uses FastAPI `BackgroundTasks` and in-memory job/event dictionaries. It does not yet use a durable queue or persistent job store. Jobs and buffered events can be lost if the process restarts, and CPU-heavy training can compete with API requests. A production deployment should use a dedicated worker and durable queue.

The SSE endpoint streams JSON messages with fields such as `id`, `kind`, `message`, `progress`, and `job_id`. The browser should treat the job-status endpoint as the authoritative source for whether a job has completed and its results have been saved.

## API Reference

The FastAPI application currently exposes these routes:

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Serve the frontend workspace |
| GET | `/health` | Check application, SQLite, upload storage, and model-directory status |
| GET | `/docs` | Interactive OpenAPI documentation |
| GET | `/api/datasets` | List persisted dataset metadata and saved metrics |
| POST | `/api/datasets/upload` | Upload CSV/XLSX/XLS using multipart field `file` |
| GET | `/api/datasets/{dataset_id}` | Return dataset metadata, profile, and insights |
| DELETE | `/api/datasets/{dataset_id}` | Delete dataset and associated model artifact |
| POST | `/api/datasets/{dataset_id}/train?target={column}` | Queue AutoML and return a `job_id` |
| GET | `/api/jobs/{job_id}` | Poll queued/running/completed/failed job state |
| GET | `/api/datasets/{dataset_id}/importance` | Return supported feature-importance values |
| POST | `/api/datasets/{dataset_id}/predict` | Run inference using feature-name/value JSON |
| GET | `/api/stream` | Subscribe to realtime server-sent events |

### Upload request

The upload endpoint expects `multipart/form-data` with a file field named `file`. CSV, XLSX, and XLS formats are accepted, with a 50 MB request-file limit enforced by the application.

### Train request

Send a POST request to the dataset-specific route with the target column in the query string:

```http
POST /api/datasets/12/train?target=churn
```

The response returns a job identifier and initial state. Poll `GET /api/jobs/{job_id}` until the status becomes `complete` or `failed`. A completed job includes its training result and benchmark metrics.

### Prediction request

Send the feature values directly as a JSON object. The keys must match the feature names expected by the persisted model.

```json
{
  "age": 42,
  "plan": "premium",
  "monthly_usage": 18.5
}
```

The response includes the predicted value and, for supported classification estimators, confidence and ranked class probabilities.

### Frontend and dataset persistence

The root route serves `frontend/index.html`. Relative links load `/styles.css` and `/app.js` when using FastAPI, and remain compatible with the GitHub Pages project subpath. The same assets are also mounted under `/assets/`. Dataset metadata, profile summaries, training metadata, and saved model paths are stored in SQLite, while uploaded files and model artifacts live under `data/uploads/` and `models/`.

The list and detail APIs do not return complete raw dataset rows. After a browser reload, the interface restores persisted metadata and profile summaries. The browser-side row preview remains available for files uploaded during the current page session.

The current backend does not expose a separate background worker, durable queue, or persistent job-history API. Jobs and the SSE event buffer are in process memory and are cleared by a server restart.

## Live Deployment

- **Frontend:** https://mahitech580.github.io/DataVision-Intelligence/
- **FastAPI backend:** https://datavision-intelligence-api-mahitech580.onrender.com
- **Health endpoint:** https://datavision-intelligence-api-mahitech580.onrender.com/health
- **API documentation:** https://datavision-intelligence-api-mahitech580.onrender.com/docs

The frontend's `datavision-api-base` metadata is configured to use the backend origin. The backend CORS allowlist includes the GitHub Pages origin `https://mahitech580.github.io`.

The backend is deployed as a free Render web service. Its current SQLite database, uploaded files, and model artifacts live on the service filesystem. Free-service filesystems are not suitable for durable production persistence across all restarts and redeployments. For production use, configure durable database and file/model storage before relying on dataset history.

CORS is not authentication. The current API does not implement user authentication or per-user dataset authorization; do not upload confidential or personal data to this public deployment.

## Hosting the Frontend Separately

For another frontend host, change the `datavision-api-base` meta tag in `frontend/index.html` to the HTTPS backend origin. Set `DATAVISION_CORS_ORIGINS` on the backend to the exact trusted frontend origin(s), separated by commas. Keep the API base to the origin only, without a route suffix or trailing slash.

The app can also run directly from FastAPI using relative assets. Verify `/health`, dataset upload, training, prediction, and `/api/stream` after deployment.

## Interactive Exploratory Charts

The Data Workbench includes Chart.js visualizations for numerical distributions, categorical frequency, and missing-value percentages. Locally uploaded data can be charted from its in-memory records. Persisted datasets restored after a page reload expose server-generated profile summaries rather than complete raw rows, so charts use those available summaries where possible.

## Machine Learning Design

### Task selection

The engine should distinguish classification from regression based on target characteristics and the intended prediction problem. Numeric targets are not always regression targets: a numeric column may represent discrete classes.

### Preprocessing

Preprocessing should be incorporated into scikit-learn pipelines wherever practical.

This helps ensure that imputation, encoding, scaling, and other fitted transformations are learned from training folds rather than from the full dataset.

### Evaluation

The platform should report metrics suited to the problem and data. Results should include sufficient validation context to support a meaningful comparison.

### Explainability

Feature-importance information should be returned from a supported estimator or explainability method. If a model does not provide a valid explanation, the interface should report that the information is unavailable instead of inventing values.

### Persistence

A saved model should retain the transformations needed to process new inputs consistently with training. Persisted artifacts should be loaded and used only through compatible, trusted application code.

---

## Testing and Verification

Before considering a release ready, verify the following:

- [ ] Backend starts successfully.
- [ ] Health endpoint returns the expected response.
- [ ] CSV upload works with valid and invalid files.
- [ ] Excel upload works with supported worksheets.
- [ ] Profiling correctly handles empty and missing values.
- [ ] Duplicate detection returns the expected counts.
- [ ] Dataset inventory survives restarts when persistent storage is configured.
- [ ] Training jobs report success and failure states.
- [ ] Model comparison displays actual returned metrics.
- [ ] Trained models can be loaded for inference.
- [ ] Invalid prediction inputs return useful errors.
- [ ] SSE streams receive and render backend events.
- [ ] Large datasets are handled within documented resource limits.
- [ ] Frontend works at mobile, tablet, and desktop widths.
- [ ] Tests run successfully against a clean environment.

Run the project's test suite using the command defined by its test configuration. For a pytest-based setup:

```bash
pytest -q
```

A passing test suite is evidence for the tested cases, not a guarantee that every production scenario works.

## Security and Data Handling

- Validate uploaded file formats, sizes, and contents on the server.
- Apply authentication and authorization when datasets or models belong to specific users.
- Avoid exposing sensitive uploaded data through logs or event payloads.
- Do not accept arbitrary filesystem paths from client requests.
- Apply limits to training resources, upload sizes, and request durations.
- Treat serialized model files as trusted application artifacts.
- Configure CORS deliberately when the browser and API use separate origins.
- Keep credentials and secrets in environment variables, not source control.

## Current Scope and Future Roadmap

Potential future enhancements include:

- Time-series analysis and forecasting.
- Anomaly detection and outlier investigation.
- Data and prediction drift monitoring.
- Model calibration and richer diagnostic reports.
- Feature lineage and data transformation history.
- Scheduled ingestion and dataset refresh.
- Natural-language exploration of structured data.
- Background-worker queues and job recovery.
- Dataset access controls and multi-user workspaces.
- Production deployment and model-serving integrations.

These are roadmap ideas unless they are explicitly implemented and tested in the current source code.

## Portfolio Positioning

DataVision Intelligence is intended to demonstrate skills across the full-stack machine learning lifecycle:

- Python backend and REST API development.
- Structured data ingestion and processing.
- Exploratory data analysis and data-quality diagnostics.
- Scikit-learn pipelines and automated model comparison.
- Persisted model inference.
- Asynchronous job orchestration and SSE-based updates.
- Frontend integration with analytical APIs.
- Testing, error handling, and application observability.

The project emphasizes a connected, inspectable workflow in which dataset analysis, model training, evaluation, and inference work together rather than appearing as isolated demonstrations.

## License

Add a `LICENSE` file and update this section with the applicable license before distributing the project.

---

**DataVision Intelligence — From raw datasets to explainable, actionable insights.**
