"use strict";

/* =========================================================
   DATAVISION INTELLIGENCE — APP.JS
   Dataset ingestion • Profiling • Charts • AutoML • SSE
   ========================================================= */

/*
  BACKEND CONFIGURATION

  By default, the application tries API routes on the same origin.
  For a separate backend, configure the API base URL before this
  script executes:

  window.DATAVISION_API_BASE = "https://your-backend.onrender.com";

  Default API routes:
  GET  /api/health
  GET  /health
  POST /api/datasets       multipart/form-data field: file
  POST /api/train          JSON
  POST /api/predict        JSON
  GET  /api/events         Server-Sent Events

  Adapt the ENDPOINTS object below to match your Flask/FastAPI routes.
*/

const API_BASE = String(window.DATAVISION_API_BASE || "").replace(/\/+$/, "");

const ENDPOINTS = {
  health: ["/health", "/api/health"],
  datasets: "/api/datasets",
  upload: "/api/datasets/upload",
  train: "/api/datasets",
  predict: "/api/datasets",
  importance: "/api/datasets",
  events: ["/api/stream"]
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 10;
const MAX_CORRELATION_ROWS = 2500;
const MAX_LOCAL_TRAIN_ROWS = 20000;
const MAX_FEED_ITEMS = 100;
const MAX_TABLE_COLUMNS = 20;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

const state = {
  datasets: [],
  activeDatasetId: null,
  models: [],
  activeModel: null,
  predictionFeatures: [],
  events: [],
  streamEventsReceived: 0,
  streamLastEventAt: null,
  streamFilter: "all",
  stream: null,
  streamEndpointIndex: 0,
  backendOnline: false,
  databaseOnline: null,
  training: false,
  trainingJob: null,
  toastTimer: null,
  confirmAction: null,
  charts: {},
  feedSequence: 0
};

const VIEW_TITLES = {
  overview: "Operational overview",
  datasets: "Data Workbench",
  models: "Model Lab",
  stream: "Live event stream"
};

/* =========================================================
   GENERAL UTILITIES
   ========================================================= */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, decimals = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: decimals
  }).format(number);
}

function formatPercent(value, decimals = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return `${number.toFixed(decimals)}%`;
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;

  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function slugify(value) {
  return String(value || "dataset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "dataset";
}

function createId(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadText(text, filename, type = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), filename);
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setHTML(selector, html) {
  const element = $(selector);
  if (element) element.innerHTML = html;
}

function setHidden(selector, hidden) {
  const element = $(selector);
  if (element) element.hidden = Boolean(hidden);
}

function setBadge(selector, text, type = "") {
  const element = $(selector);
  if (!element) return;

  element.textContent = text;
  element.className = `tag${type ? ` ${type}` : ""}`;
}

function showToast(message, type = "") {
  const toast = $("#toast");
  if (!toast) return;

  clearTimeout(state.toastTimer);

  toast.textContent = message;
  toast.className = `toast visible${type ? ` ${type}` : ""}`;

  state.toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4000);
}

function setButtonLoading(button, loading, loadingText = "Processing...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${escapeHTML(loadingText)}`;
  } else {
    button.disabled = false;

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function createEmptyState(title, description, symbol = "⌁") {
  return `
    <div class="empty-state">
      <span class="empty-icon">${escapeHTML(symbol)}</span>
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(description)}</p>
    </div>`;
}

/* =========================================================
   NOTIFICATIONS / CONFIRMATION
   ========================================================= */

function confirmAction({
  title = "Confirm action",
  message = "Are you sure you want to continue?",
  confirmText = "Confirm",
  onConfirm = null
} = {}) {
  const modal = $("#confirmModal");

  if (!modal) {
    if (window.confirm(message) && typeof onConfirm === "function") {
      onConfirm();
    }
    return;
  }

  state.confirmAction = onConfirm;

  setText("#confirmModalTitle", title);
  setText("#confirmModalMessage", message);
  setText("#acceptConfirmBtn", confirmText);

  modal.hidden = false;
  modal.classList.add("open");

  $("#acceptConfirmBtn")?.focus();
}

function closeConfirmModal() {
  const modal = $("#confirmModal");
  if (modal) {
    modal.hidden = true;
    modal.classList.remove("open");
  }

  state.confirmAction = null;
}

function initializeConfirmation() {
  $("#closeConfirmModal")?.addEventListener("click", closeConfirmModal);
  $("#cancelConfirmBtn")?.addEventListener("click", closeConfirmModal);

  $("#acceptConfirmBtn")?.addEventListener("click", () => {
    const action = state.confirmAction;
    closeConfirmModal();

    if (typeof action === "function") {
      action();
    }
  });

  $("#confirmModal")?.addEventListener("click", event => {
    if (event.target === $("#confirmModal")) {
      closeConfirmModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeConfirmModal();
      $("#sidebar")?.classList.remove("open");
    }
  });
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function showView(viewName) {
  const name = VIEW_TITLES[viewName] ? viewName : "overview";

  $$(".view").forEach(view => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });

  $$(".nav[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  setText("#pageTitle", VIEW_TITLES[name]);
  setText("#breadcrumb", `DATAVISION / ${name.toUpperCase()}`);

  $("#sidebar")?.classList.remove("open");

  if (name === "datasets") {
    renderDatasetList();
  }

  if (name === "models") {
    renderModels();
    renderImportance();
    renderPredictionPanel();
  }

  if (name === "stream") {
    renderFullFeed();
  }

  if (name === "overview") {
    renderMetrics();
    renderActivityFeed();
    renderLatestSignal();
    renderReadiness();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.showView = showView;

function initializeNavigation() {
  $$("[data-view]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      showView(button.dataset.view);
    });
  });

  $("#mobileMenuBtn")?.addEventListener("click", () => {
    $("#sidebar")?.classList.toggle("open");
  });

  document.addEventListener("click", event => {
    const sidebar = $("#sidebar");
    const menuButton = $("#mobileMenuBtn");

    if (
      sidebar?.classList.contains("open") &&
      !sidebar.contains(event.target) &&
      !menuButton?.contains(event.target)
    ) {
      sidebar.classList.remove("open");
    }
  });

  $$('a[href="#overview"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      showView("overview");
    });
  });
}

/* =========================================================
   LOCAL CSV PARSER
   ========================================================= */

function parseCSV(text) {
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];

  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;

      row.push(field);
      field = "";

      if (row.some(value => String(value).trim() !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);

    if (row.some(value => String(value).trim() !== "")) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    throw new Error("The file contains no usable CSV rows.");
  }

  const headers = makeUniqueHeaders(rows[0]);

  const data = rows.slice(1).map(values => {
    const record = {};

    headers.forEach((header, index) => {
      record[header] = parseCSVValue(values[index] ?? "");
    });

    return record;
  });

  return { headers, rows: data };
}

function makeUniqueHeaders(values) {
  const used = new Map();

  return values.map((value, index) => {
    let base = String(value ?? "").trim() || `column_${index + 1}`;
    let name = base;
    let suffix = 2;

    while (used.has(name.toLowerCase())) {
      name = `${base}_${suffix++}`;
    }

    used.set(name.toLowerCase(), true);
    return name;
  });
}

function parseCSVValue(value) {
  const text = String(value ?? "").trim();

  if (!text) return null;

  if (/^(true|false)$/i.test(text)) {
    return text.toLowerCase() === "true";
  }

  // Preserve identifiers such as 00123 rather than converting them to 123.
  if (/^[+-]?0\d+$/.test(text)) {
    return text;
  }

  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }

  return text;
}

/* =========================================================
   EXCEL PARSER
   ========================================================= */

async function parseFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();

  if (extension === "csv") {
    const text = await file.text();
    return parseCSV(text);
  }

  if (extension === "xlsx" || extension === "xls") {
    if (!window.XLSX) {
      throw new Error("Excel support could not load. Check your internet connection.");
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true
    });

    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error("The workbook contains no worksheets.");
    }

    const sheet = workbook.Sheets[sheetName];

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false
    });

    if (!matrix.length) {
      throw new Error("The worksheet is empty.");
    }

    const headers = makeUniqueHeaders(matrix[0]);

    const rows = matrix.slice(1).map(values => {
      const record = {};

      headers.forEach((header, index) => {
        const value = values[index];

        record[header] =
          value instanceof Date
            ? value.toISOString()
            : value === "" ? null : value ?? null;
      });

      return record;
    });

    return { headers, rows, sheetName };
  }

  throw new Error("Unsupported file type. Choose CSV, XLSX, or XLS.");
}

/* =========================================================
   DATA HELPERS
   ========================================================= */

function getColumnNames(dataset) {
  if (!dataset) return [];

  if (Array.isArray(dataset.columns)) {
    return dataset.columns.map(column =>
      typeof column === "string" ? column : column?.name
    ).filter(Boolean);
  }

  return dataset.rows?.length ? Object.keys(dataset.rows[0]) : [];
}

function getActiveDataset() {
  return state.datasets.find(dataset => dataset.id === state.activeDatasetId) || null;
}

function getColumnValues(dataset, column) {
  return (dataset?.rows || []).map(row => row[column]);
}

function isEmptyValue(value) {
  return value === null || value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }

  return null;
}

function isNumericColumn(values) {
  const nonEmpty = values.filter(value => !isEmptyValue(value));

  if (!nonEmpty.length) return false;

  return nonEmpty.every(value => numericValue(value) !== null);
}

function getNumericColumns(dataset) {
  return getColumnNames(dataset).filter(column =>
    isNumericColumn(getColumnValues(dataset, column))
  );
}

function getColumnType(values) {
  const nonEmpty = values.filter(value => !isEmptyValue(value));

  if (!nonEmpty.length) return "Empty";

  if (nonEmpty.every(value => typeof value === "boolean")) {
    return "Boolean";
  }

  if (nonEmpty.every(value => numericValue(value) !== null)) {
    return "Numeric";
  }

  if (nonEmpty.every(value =>
    value instanceof Date ||
    (typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
  )) {
    return "Date / time";
  }

  const unique = new Set(nonEmpty.map(String));

  if (unique.size <= Math.min(15, Math.max(2, nonEmpty.length * 0.1))) {
    return "Categorical";
  }

  return "Text";
}

function calculateMean(values) {
  const numbers = values
    .map(numericValue)
    .filter(value => value !== null);

  if (!numbers.length) return null;

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function calculateMedian(values) {
  const numbers = values
    .map(numericValue)
    .filter(value => value !== null)
    .sort((a, b) => a - b);

  if (!numbers.length) return null;

  const middle = Math.floor(numbers.length / 2);

  return numbers.length % 2
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
}

function calculateStdDev(values) {
  const numbers = values
    .map(numericValue)
    .filter(value => value !== null);

  if (numbers.length < 2) return null;

  const mean = calculateMean(numbers);

  const variance = numbers.reduce(
    (sum, value) => sum + Math.pow(value - mean, 2),
    0
  ) / numbers.length;

  return Math.sqrt(variance);
}

function countDuplicates(rows, columns) {
  const seen = new Set();
  let duplicates = 0;

  rows.forEach(row => {
    const signature = JSON.stringify(columns.map(column => row[column]));

    if (seen.has(signature)) {
      duplicates++;
    } else {
      seen.add(signature);
    }
  });

  return duplicates;
}

function analyzeDataset(dataset) {
  const columns = getColumnNames(dataset);
  const rows = dataset.rows || [];

  const cells = rows.length * columns.length;
  let missingCells = 0;

  const columnStats = columns.map(column => {
    const values = getColumnValues(dataset, column);
    const nonEmpty = values.filter(value => !isEmptyValue(value));
    const missing = values.length - nonEmpty.length;
    const unique = new Set(nonEmpty.map(value => String(value))).size;
    const numeric = isNumericColumn(values);

    missingCells += missing;

    const numbers = numeric
      ? nonEmpty.map(numericValue).filter(value => value !== null)
      : [];

    return {
      name: column,
      type: getColumnType(values),
      total: values.length,
      missing,
      missingPct: values.length ? missing / values.length * 100 : 0,
      unique,
      uniquePct: nonEmpty.length ? unique / nonEmpty.length * 100 : 0,
      numeric,
      min: numbers.length ? Math.min(...numbers.slice(0, 100000)) : null,
      max: numbers.length ? Math.max(...numbers.slice(0, 100000)) : null,
      mean: numbers.length ? calculateMean(numbers) : null,
      median: numbers.length ? calculateMedian(numbers) : null,
      std: numbers.length ? calculateStdDev(numbers) : null
    };
  });

  const duplicates = countDuplicates(rows, columns);
  const missingPct = cells ? missingCells / cells * 100 : 0;

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    columnStats,
    cells,
    missingCells,
    missingPct,
    duplicates,
    duplicatePct: rows.length ? duplicates / rows.length * 100 : 0,
    numericCount: columnStats.filter(item => item.numeric).length,
    emptyColumns: columnStats.filter(item => item.unique === 0).length,
    constantColumns: columnStats.filter(item =>
      item.unique === 1 && item.total > 0
    ).length
  };
}

/* =========================================================
   DATASET INGESTION
   ========================================================= */

function initializeUploader() {
  const fileInput = $("#fileInput");
  const dropzone = $("#dropzone");

  $("#uploadBtn")?.addEventListener("click", () => {
    showView("datasets");
    fileInput?.click();
  });

  dropzone?.addEventListener("click", () => fileInput?.click());

  dropzone?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput?.click();
    }
  });

  fileInput?.addEventListener("change", async event => {
    const file = event.target.files?.[0];

    if (file) await ingestFile(file);

    event.target.value = "";
  });

  if (dropzone) {
    ["dragenter", "dragover"].forEach(name => {
      dropzone.addEventListener(name, event => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach(name => {
      dropzone.addEventListener(name, event => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove("dragover");
      });
    });

    dropzone.addEventListener("drop", async event => {
      const file = event.dataTransfer?.files?.[0];
      if (file) await ingestFile(file);
    });
  }

  $("#refreshBtn")?.addEventListener("click", refreshWorkspace);

  $("#downloadCleanedBtn")?.addEventListener("click", exportActiveDatasetCSV);
  $("#exportDatasetBtn")?.addEventListener("click", exportDatasetReport);

  $("#deleteDatasetBtn")?.addEventListener("click", () => {
    const dataset = getActiveDataset();

    if (!dataset) {
      showToast("Select a dataset first.", "error");
      return;
    }

    confirmAction({
      title: "Delete dataset?",
      message: `Remove "${dataset.name}" from this browser session? This cannot be undone.`,
      confirmText: "Delete dataset",
      onConfirm: () => deleteActiveDataset()
    });
  });
}

async function ingestFile(file) {
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    showToast("File exceeds the 50 MB browser import limit.", "error");
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();

  if (!["csv", "xlsx", "xls"].includes(extension)) {
    showToast("Choose a CSV or Excel file.", "error");
    return;
  }

  const dropzone = $("#dropzone");

  if (dropzone) {
    dropzone.setAttribute("aria-busy", "true");
    dropzone.style.opacity = "0.75";
  }

  try {
    showToast(`Reading ${file.name}...`);

    const parsed = await parseFile(file);

    if (!parsed.headers.length) {
      throw new Error("No columns were found in this file.");
    }

    if (!parsed.rows.length) {
      throw new Error("The file contains headers but no data rows.");
    }

    const dataset = {
      id: createId("dataset"),
      name: file.name,
      size: file.size,
      type: extension.toUpperCase(),
      rows: parsed.rows,
      columns: parsed.headers,
      createdAt: new Date().toISOString(),
      serverId: null,
      analysis: null,
      backendUpload: "pending"
    };

    dataset.analysis = analyzeDataset(dataset);

    state.datasets.unshift(dataset);
    state.activeDatasetId = dataset.id;

    recordEvent(
      "ingestion",
      "Dataset loaded",
      `${dataset.name}: ${formatNumber(dataset.rows.length)} records and ${formatNumber(dataset.columns.length)} columns.`,
      "▦"
    );

    renderAll();

    showView("datasets");
    renderDatasetProfile(dataset);

    showToast(
      `${dataset.name} loaded successfully. Profiling is ready.`,
      "success"
    );

    // Upload to configured backend independently of local profiling.
    uploadDatasetToBackend(file, dataset).catch(error => {
      dataset.backendUpload = "failed";
      dataset.backendError = error.message;
      console.warn("Backend ingestion unavailable:", error.message);
      updateConnectionUI();
    });

  } catch (error) {
    console.error("Dataset ingestion failed:", error);
    showToast(error.message || "Could not read this dataset.", "error");
  } finally {
    if (dropzone) {
      dropzone.removeAttribute("aria-busy");
      dropzone.style.opacity = "";
    }
  }
}

/* =========================================================
   BACKEND API
   ========================================================= */

function endpointURL(path) {
  return `${API_BASE}${path}`;
}

async function apiRequest(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpointURL(path), {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers
      }
    });

    const contentType = response.headers.get("content-type") || "";
    let payload;

    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      const message =
        typeof payload === "object"
          ? payload?.detail || payload?.error || payload?.message
          : payload;

      throw new Error(
        message || `Server returned HTTP ${response.status}.`
      );
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The server request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function tryEndpoints(paths, options = {}, timeout = 6000) {
  let lastError;

  for (const path of paths) {
    try {
      const result = await apiRequest(path, options, timeout);

      return {
        ok: true,
        path,
        data: result
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    error: lastError || new Error("No endpoint responded.")
  };
}

async function uploadDatasetToBackend(file, dataset) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await apiRequest(
      ENDPOINTS.upload,
      { method: "POST", body: formData },
      60000
    );

    const data = response?.dataset || response?.data || response;
    const serverId = response?.id ?? data?.id ?? data?.dataset_id ?? data?.datasetId;

    if (serverId === null || serverId === undefined) {
      throw new Error("The upload endpoint did not return a dataset ID.");
    }

    dataset.serverId = serverId;
    dataset.serverProfile = data?.profile || response?.profile || null;
    dataset.serverInsights = Array.isArray(data?.insights)
      ? data.insights
      : Array.isArray(response?.insights)
        ? response.insights
        : [];
    dataset.backendUpload = "success";
    dataset.serverResponse = data;

    if (dataset.serverProfile) {
      dataset.analysis = normalizeServerProfile(dataset.serverProfile, dataset.rows || []);
      dataset.columns = dataset.analysis.columns;
    }

    recordEvent(
      "ingestion",
      "Backend ingestion complete",
      `${dataset.name} was persisted by the backend (dataset ID ${serverId}).`,
      "✓"
    );

    renderDatasetList();
    renderMetrics();

    if (dataset.id === state.activeDatasetId) {
      renderDatasetProfile(dataset);
    }

    updateConnectionUI();
    return data;
  } catch (error) {
    dataset.backendUpload = "failed";
    dataset.backendError = error.message;
    updateConnectionUI();

    console.warn(
      "The file is available for browser-side profiling, but backend ingestion failed:",
      error.message
    );

    throw error;
  }
}

function normalizeServerProfile(profile, localRows = []) {
  const shape = profile?.shape || {};
  const serverColumns = Array.isArray(profile?.columns) ? profile.columns : [];
  const names = serverColumns.map(column => String(column.name ?? column.column ?? "")).filter(Boolean);
  const rowCount = safeNumber(shape.rows, localRows.length);
  const columnCount = safeNumber(shape.columns, names.length);
  const cells = rowCount * columnCount;
  const missingCells = safeNumber(profile?.missing_total, 0);
  const duplicateRows = safeNumber(profile?.duplicate_rows, 0);
  const numericNames = new Set(profile?.numerical_columns || []);
  const emptyColumns = new Set(profile?.empty_columns || []);
  const constantColumns = new Set(profile?.constant_columns || []);

  const columnStats = serverColumns.map(column => {
    const name = String(column.name ?? column.column ?? "");
    const missing = safeNumber(column.missing, 0);
    const unique = safeNumber(column.unique, 0);
    const dtype = String(column.dtype || column.type || "Unknown");
    const stats = column.stats || {};
    const numeric = numericNames.has(name) || /int|float|number|decimal/i.test(dtype);

    return {
      name,
      type: numeric ? "Numeric" : dtype,
      total: rowCount,
      missing,
      missingPct: safeNumber(column.missing_pct, rowCount ? missing / rowCount * 100 : 0),
      unique,
      uniquePct: rowCount ? unique / Math.max(1, rowCount - missing) * 100 : 0,
      numeric,
      mean: stats.mean ?? null,
      median: stats.median ?? null,
      std: stats.std ?? null,
      min: stats.min ?? null,
      max: stats.max ?? null,
      topValues: column.top_values || []
    };
  });

  return {
    rowCount,
    columnCount,
    columns: names,
    columnStats,
    cells,
    missingCells,
    missingPct: safeNumber(
      cells ? missingCells / cells * 100 : 0,
      0
    ),
    duplicates: duplicateRows,
    duplicatePct: safeNumber(profile?.duplicate_pct, rowCount ? duplicateRows / rowCount * 100 : 0),
    numericCount: numericNames.size || columnStats.filter(column => column.numeric).length,
    emptyColumns: emptyColumns.size,
    constantColumns: constantColumns.size,
    memoryMB: safeNumber(profile?.memory_mb, 0),
    qualityScore: profile?.data_quality_score ?? null,
    identifierCandidates: profile?.identifier_candidates || [],
    highCardinality: profile?.high_cardinality || [],
    serverProfile: profile
  };
}

async function checkBackendHealth() {
  const result = await tryEndpoints(ENDPOINTS.health, { method: "GET" }, 5000);

  state.backendOnline = result.ok;

  if (result.ok) {
    const payload = result.data || {};

    const databaseStatus =
      payload.database_status ??
      payload.database ??
      payload.postgres ??
      payload.services?.database ??
      payload.checks?.database;

    if (typeof databaseStatus === "boolean") {
      state.databaseOnline = databaseStatus;
    } else if (typeof databaseStatus === "string") {
      state.databaseOnline = /ok|healthy|connected|online|ready/i.test(databaseStatus);
    } else if (databaseStatus && typeof databaseStatus === "object") {
      state.databaseOnline =
        databaseStatus.healthy ??
        databaseStatus.connected ??
        databaseStatus.ok ??
        null;
    } else {
      state.databaseOnline = null;
    }

    recordConnectionState(true);
  } else {
    state.databaseOnline = null;
    recordConnectionState(false);
  }

  updateConnectionUI();

  if (state.backendOnline) {
    initializeEventStream();
  } else {
    disconnectEventStream();
  }

  return result;
}

function recordConnectionState(online) {
  if (state.lastBackendStatus === online) return;

  state.lastBackendStatus = online;

  recordEvent(
    "system",
    online ? "Backend connected" : "Backend unavailable",
    online
      ? "The configured health endpoint responded successfully."
      : "No configured health endpoint responded. Browser-side data profiling remains available.",
    online ? "✓" : "!"
  );
}

function updateConnectionUI() {
  const indicator = $("#connectionIndicator");

  if (indicator) {
    indicator.classList.toggle("offline", !state.backendOnline);
  }

  setText(
    "#systemStatus",
    state.backendOnline ? "Backend online" : "UI active"
  );

  setText(
    "#systemSubStatus",
    state.backendOnline
      ? "Health endpoint responding"
      : "Backend not confirmed"
  );

  setText(
    "#apiStatusLabel",
    state.backendOnline ? "Connected" : "Unavailable"
  );

  setBadge(
    "#backendServiceBadge",
    state.backendOnline ? "Connected" : "Unavailable",
    state.backendOnline ? "green" : "yellow"
  );

  const databaseText =
    state.databaseOnline === true
      ? "Healthy"
      : state.databaseOnline === false
        ? "Unavailable"
        : "Unknown";

  setBadge(
    "#databaseServiceBadge",
    databaseText,
    state.databaseOnline === true
      ? "green"
      : state.databaseOnline === false
        ? "yellow"
        : ""
  );

  setBadge(
    "#streamServiceBadge",
    state.stream ? "Connected" : "Inactive",
    state.stream ? "green" : "yellow"
  );

  setText(
    "#diagnosticBackend",
    state.backendOnline ? "Responding" : "Unavailable"
  );

  setText(
    "#diagnosticConnection",
    state.stream ? "Connected" : "Disconnected"
  );

  setText(
    "#streamConnectionValue",
    state.stream ? "Live" : "Offline"
  );

  setText(
    "#streamHeaderStatus",
    state.stream ? "Connected to event stream" : "Event stream unavailable"
  );

  setBadge(
    "#diagnosticStatusBadge",
    state.stream ? "Connected" : "Disconnected",
    state.stream ? "green" : "yellow"
  );
}

async function refreshWorkspace() {
  const button = $("#refreshBtn");

  setButtonLoading(button, true, "Refreshing");

  try {
    await checkBackendHealth();

    if (state.backendOnline) {
      await syncPersistedDatasets();
    }

    renderAll();

    showToast(
      state.backendOnline
        ? "Workspace refreshed from the backend."
        : "Workspace refreshed locally; backend is unavailable.",
      state.backendOnline ? "success" : ""
    );
  } finally {
    setButtonLoading(button, false);
  }
}

/* =========================================================
   SERVER-SENT EVENTS
   ========================================================= */

function disconnectEventStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }

  state.streamConnected = false;
  updateConnectionUI();
}

function initializeEventStream() {
  if (!state.backendOnline || !("EventSource" in window)) {
    disconnectEventStream();
    return;
  }

  if (state.stream) return;

  openEventEndpoint(0);
}

function openEventEndpoint(index) {
  if (index >= ENDPOINTS.events.length) {
    state.stream = null;
    state.streamConnected = false;
    updateConnectionUI();
    renderFullFeed();
    return;
  }

  const endpoint = ENDPOINTS.events[index];
  let confirmed = false;

  const connection = new EventSource(endpointURL(endpoint));
  state.stream = connection;

  connection.onopen = () => {
    confirmed = true;
    state.streamConnected = true;
    state.streamEndpointIndex = index;

    updateConnectionUI();

    recordEvent(
      "system",
      "Realtime stream connected",
      `Subscribed to ${endpoint}.`,
      "≋"
    );
  };

  connection.onmessage = event => {
    confirmed = true;

    let payload = event.data;

    try {
      payload = JSON.parse(event.data);
    } catch {
      // Text payloads are supported as well.
    }

    handleStreamMessage(payload);
  };

  connection.onerror = () => {
    connection.close();

    if (state.stream === connection) {
      state.stream = null;
    }

    state.streamConnected = false;
    updateConnectionUI();

    // Try the alternate configured endpoint only before any connection.
    if (!confirmed && index + 1 < ENDPOINTS.events.length) {
      openEventEndpoint(index + 1);
    } else {
      renderFullFeed();
    }
  };
}

function classifyEventType(value) {
  const text = String(value || "").toLowerCase();

  if (/predict|inference|forecast/.test(text)) return "prediction";
  if (/train|model|automl|benchmark|fit|job|complete|warning/.test(text)) return "training";
  if (/ingest|upload|dataset|profile|import/.test(text)) return "ingestion";

  return "system";
}

function handleStreamMessage(payload) {
  const item =
    payload && typeof payload === "object"
      ? payload
      : { message: String(payload) };

  const kind = item.kind || item.type || item.event || item.category || item.name;
  const type = classifyEventType(`${kind || ""} ${item.message || ""}`);

  const title =
    item.title ||
    item.name ||
    item.event ||
    item.kind ||
    item.type ||
    "Backend event";

  const message =
    item.message ||
    item.description ||
    item.detail ||
    JSON.stringify(item);

  state.streamEventsReceived++;
  state.streamLastEventAt = new Date();

  if (state.trainingJob && item.job_id && item.job_id === state.trainingJob.id) {
    const progress = Number.isFinite(Number(item.progress)) ? Number(item.progress) : 0;
    updateTrainingProgress(progress, item.message || "Training in progress", item.kind || "running");
  }

  recordEvent(type, title, message, "≋", true);

  setText("#streamEventCount", formatNumber(state.streamEventsReceived));
  setText("#streamLastEvent", formatTime(state.streamLastEventAt));
  setText("#streamUpdatedAt", `Updated ${formatTime(state.streamLastEventAt)}`);
  setText("#diagnosticLastEvent", formatTimestamp(state.streamLastEventAt));

  setBadge(
    "#streamEventBadge",
    `${state.events.length} events`,
    "purple"
  );

  renderFullFeed();
  renderActivityFeed();
}

/* =========================================================
   EVENT HISTORY
   ========================================================= */

function recordEvent(type, title, message, icon = "⌁", fromStream = false) {
  const event = {
    id: createId("event"),
    type,
    title: String(title || "Workspace event"),
    message: String(message || ""),
    icon,
    createdAt: new Date(),
    fromStream
  };

  state.events.unshift(event);

  if (state.events.length > MAX_FEED_ITEMS) {
    state.events.length = MAX_FEED_ITEMS;
  }

  state.feedSequence++;

  renderActivityFeed();
  renderFullFeed();
}

function eventMatchesFilter(event, filter) {
  if (filter === "all") return true;
  return event.type === filter;
}

function renderActivityFeed() {
  const target = $("#activityFeed");
  if (!target) return;

  const events = state.events.slice(0, 6);

  if (!events.length) {
    target.innerHTML = createEmptyState(
      "No activity recorded",
      "Import a dataset or connect the backend to see operational events.",
      "≋"
    );
    return;
  }

  target.innerHTML = events.map(event => `
    <article class="feed-item">
      <span class="feed-symbol">${escapeHTML(event.icon)}</span>
      <div class="feed-content">
        <strong>${escapeHTML(event.title)}</strong>
        <p>${escapeHTML(event.message)}</p>
      </div>
      <time class="feed-time">${escapeHTML(formatTime(event.createdAt))}</time>
    </article>
  `).join("");
}

function renderFullFeed() {
  const target = $("#fullFeed");
  if (!target) return;

  const events = state.events.filter(event =>
    eventMatchesFilter(event, state.streamFilter)
  );

  if (!events.length) {
    target.innerHTML = createEmptyState(
      "Waiting for incoming events",
      "Import data or connect your backend to display ingestion, training, prediction, and system events.",
      "≋"
    );
    return;
  }

  target.innerHTML = events.map(event => `
    <article class="stream-event">
      <time>${escapeHTML(formatTimestamp(event.createdAt))}</time>
      <span class="tag ${event.type === "system" ? "" : event.type === "prediction" ? "green" : event.type === "training" ? "purple" : "yellow"}">
        ${escapeHTML(event.type)}
      </span>
      <p>
        <strong>${escapeHTML(event.title)}</strong><br>
        ${escapeHTML(event.message)}
      </p>
    </article>
  `).join("");
}

function initializeStreamControls() {
  $("#clearStreamBtn")?.addEventListener("click", () => {
    state.events = [];
    renderFullFeed();
    renderActivityFeed();
    setBadge("#streamEventBadge", "0 events");
    showToast("Event history cleared from this browser view.");
  });

  $("#streamFilters")?.addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    state.streamFilter = button.dataset.filter || "all";

    $$("#streamFilters [data-filter]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderFullFeed();
  });
}

/* =========================================================
   DATASET INVENTORY RENDERING
   ========================================================= */

function renderDatasetList() {
  const target = $("#datasetList");
  if (!target) return;

  if (!state.datasets.length) {
    target.innerHTML = createEmptyState(
      "Your inventory is empty",
      "Import a CSV or Excel file to begin exploring your data.",
      "▦"
    );
  } else {
    target.innerHTML = state.datasets.map(dataset => {
      const analysis = dataset.analysis || analyzeDataset(dataset);
      const selected = dataset.id === state.activeDatasetId;
      const extension = dataset.type || "DATA";

      const backendTag = dataset.serverId !== null && dataset.serverId !== undefined
        ? `<span class="tag green">Persisted</span>`
        : `<span class="tag yellow">Local</span>`;

      return `
        <button
          type="button"
          class="dataset-item${selected ? " selected" : ""}"
          data-dataset-id="${escapeHTML(dataset.id)}"
          aria-pressed="${selected}"
        >
          <span class="dataset-file-icon">${escapeHTML(extension.slice(0, 4))}</span>
          <span class="dataset-main">
            <strong title="${escapeHTML(dataset.name)}">${escapeHTML(dataset.name)}</strong>
            <small>
              ${formatNumber(analysis.rowCount)} rows ·
              ${formatNumber(analysis.columnCount)} columns ·
              ${escapeHTML(formatBytes(dataset.size))}
            </small>
          </span>
          ${backendTag}
          <span class="dataset-arrow">›</span>
        </button>`;
    }).join("");
  }

  setText("#inventoryCount", `${state.datasets.length} item${state.datasets.length === 1 ? "" : "s"}`);
  setText("#datasetNavCount", formatNumber(state.datasets.length));
}

async function syncPersistedDatasets() {
  if (!state.backendOnline) return;

  let response;

  try {
    response = await apiRequest(ENDPOINTS.datasets, { method: "GET" }, 15000);
  } catch (error) {
    console.warn("Could not synchronize the persisted dataset inventory:", error.message);
    return;
  }

  const records = Array.isArray(response?.datasets)
    ? response.datasets
    : Array.isArray(response)
      ? response
      : [];

  const remoteIds = new Set();

  for (const record of records) {
    if (record?.id === null || record?.id === undefined) continue;

    const serverId = record.id;
    remoteIds.add(String(serverId));

    let dataset = state.datasets.find(item =>
      String(item.serverId) === String(serverId)
    );

    if (!dataset) {
      const originalName = record.original_name || record.name || `dataset-${serverId}`;
      const extension = originalName.includes(".")
        ? originalName.split(".").pop().toUpperCase()
        : "DATA";

      dataset = {
        id: createId("remote"),
        serverId,
        name: originalName,
        type: extension,
        size: safeNumber(record.size_bytes, 0),
        rows: [],
        columns: [],
        createdAt: record.created_at || new Date().toISOString(),
        remoteOnly: true,
        backendUpload: "success",
        analysis: {
          rowCount: safeNumber(record.rows, 0),
          columnCount: safeNumber(record.columns, 0),
          columns: [],
          columnStats: [],
          cells: 0,
          missingCells: 0,
          missingPct: 0,
          duplicates: 0,
          duplicatePct: 0,
          numericCount: 0,
          emptyColumns: 0,
          constantColumns: 0
        }
      };

      state.datasets.push(dataset);
    }

    dataset.serverId = serverId;
    dataset.size = safeNumber(record.size_bytes, dataset.size || 0);
    dataset.name = record.original_name || record.name || dataset.name;
    dataset.type = dataset.name.includes(".")
      ? dataset.name.split(".").pop().toUpperCase()
      : dataset.type;
    dataset.remoteOnly = dataset.remoteOnly || dataset.rows.length === 0;
    dataset.serverInsights = Array.isArray(record.insights) ? record.insights : [];

    if (record.metrics && typeof record.metrics === "object") {
      dataset.savedMetrics = record.metrics;
    }

    if (record.model_name) {
      dataset.savedModelName = record.model_name;
      dataset.savedTarget = record.target;
      dataset.savedProblemType = record.problem_type;
    }
  }

  // Load each persisted profile. Profile responses deliberately contain
  // aggregate metadata, not the original data rows.
  const remoteDatasets = state.datasets.filter(dataset =>
    remoteIds.has(String(dataset.serverId))
  );

  await Promise.all(remoteDatasets.map(async dataset => {
    try {
      const detail = await apiRequest(
        `${ENDPOINTS.datasets}/${encodeURIComponent(dataset.serverId)}`,
        { method: "GET" },
        15000
      );

      const profile = detail?.profile || detail?.dataset?.profile || null;

      if (profile) {
        dataset.serverProfile = profile;
        dataset.analysis = normalizeServerProfile(profile, dataset.rows || []);
        dataset.columns = dataset.analysis.columns;
      }

      if (Array.isArray(detail?.insights)) {
        dataset.serverInsights = detail.insights;
      }

      dataset.remoteOnly = !(dataset.rows && dataset.rows.length);
    } catch (error) {
      console.warn(`Profile for dataset ${dataset.serverId} could not be loaded:`, error.message);
    }
  }));

  // Rehydrate saved benchmark metadata so model history survives a reload.
  for (const dataset of remoteDatasets) {
    const metrics = dataset.savedMetrics;
    const benchmark = Array.isArray(metrics?.benchmark) ? metrics.benchmark : [];

    if (!dataset.savedModelName || !dataset.savedTarget) continue;

    const normalized = benchmark.map((entry, index) => normalizeModel({
      ...entry,
      name: entry.model || entry.model_name || entry.name,
      problem_type: dataset.savedProblemType,
      target: dataset.savedTarget
    }, index, dataset, dataset.savedTarget));

    let best = normalized.find(model => model.name === dataset.savedModelName);

    if (!best) {
      best = {
        id: null,
        name: dataset.savedModelName,
        target: dataset.savedTarget,
        task: dataset.savedProblemType || "unknown",
        datasetId: dataset.id,
        serverDatasetId: dataset.serverId,
        metrics: metrics?.best || {},
        score: metrics?.best?.accuracy ?? metrics?.best?.f1 ?? metrics?.best?.r2 ?? null,
        features: getColumnNames(dataset).filter(column => column !== dataset.savedTarget),
        featureImportance: null,
        status: "completed"
      };
    } else {
      best.metrics = metrics?.best || best.metrics;
      best.datasetId = dataset.id;
      best.serverDatasetId = dataset.serverId;
    }

    const existingForDataset = state.models.filter(model =>
      String(model.serverDatasetId ?? "") !== String(dataset.serverId)
    );

    state.models = [...existingForDataset, ...normalized];

    if (!state.models.some(model =>
      model.datasetId === dataset.id && model.name === best.name
    )) {
      state.models.push(best);
    }

    if (!state.activeModel) {
      state.activeModel = best;
      state.predictionFeatures = getModelFeatureNames(best, dataset, best.target);
    }
  }

  if (!state.activeDatasetId && state.datasets.length) {
    state.activeDatasetId = state.datasets[0].id;
  }

  renderDatasetList();
  renderMetrics();

  const activeDataset = getActiveDataset();

  if (activeDataset && activeDataset.serverProfile) {
    renderDatasetProfile(activeDataset);
  }

  if (state.activeModel) {
    renderModels();
    renderImportance();
    renderPredictionPanel();
  }

  recordEvent(
    "system",
    "Persisted inventory synchronized",
    `${records.length} dataset record(s) returned by the backend.`,
    "✓"
  );
}

function initializeDatasetListClicks() {
  $("#datasetList")?.addEventListener("click", event => {
    const button = event.target.closest("[data-dataset-id]");
    if (!button) return;

    const dataset = state.datasets.find(item =>
      item.id === button.dataset.datasetId
    );

    if (!dataset) return;

    state.activeDatasetId = dataset.id;

    renderDatasetList();
    renderDatasetProfile(dataset);

    showView("datasets");
  });
}

/* =========================================================
   PROFILE SUMMARY
   ========================================================= */

function renderDatasetProfile(dataset = getActiveDataset()) {
  const panel = $("#analysisPanel");

  if (!dataset) {
    if (panel) panel.hidden = true;
    return;
  }

  const analysis = dataset.analysis || analyzeDataset(dataset);
  dataset.analysis = analysis;

  if (panel) panel.hidden = false;

  setText("#analysisTitle", dataset.name);
  setText(
    "#analysisSubtitle",
    `${formatNumber(analysis.rowCount)} records · ${formatNumber(analysis.columnCount)} columns · Imported ${formatTimestamp(new Date(dataset.createdAt))}`
  );

  setBadge(
    "#datasetStatusBadge",
    dataset.serverId ? "Backend synced" : "Browser profile",
    dataset.serverId ? "green" : "purple"
  );

  const stats = [
    {
      label: "Total records",
      value: formatNumber(analysis.rowCount),
      footnote: "Rows available for profiling"
    },
    {
      label: "Features",
      value: formatNumber(analysis.columnCount),
      footnote: "Columns in this dataset"
    },
    {
      label: "Missing values",
      value: formatNumber(analysis.missingCells),
      footnote: formatPercent(analysis.missingPct) + " of all cells"
    },
    {
      label: "Duplicate rows",
      value: formatNumber(analysis.duplicates),
      footnote: formatPercent(analysis.duplicatePct) + " of records"
    }
  ];

  setHTML("#profileSummary", stats.map(stat => `
    <div class="profile-stat">
      <span>${escapeHTML(stat.label)}</span>
      <strong>${escapeHTML(stat.value)}</strong>
      <small>${escapeHTML(stat.footnote)}</small>
    </div>
  `).join(""));

  renderPreviewTable(dataset);
  renderColumnProfile(dataset);
  renderQualityProfile(dataset);
  renderInsights(dataset);
  renderCorrelations(dataset);
  renderExplorationCharts(dataset);
  populateTargetOptions(dataset);
  renderLatestSignal();
  renderDatasetList();
  renderMetrics();
}

/* =========================================================
   DATA PREVIEW
   ========================================================= */

function renderPreviewTable(dataset) {
  const table = $("#previewTable");
  if (!table) return;

  const columns = getColumnNames(dataset);
  const rows = dataset.rows || [];
  const visibleColumns = columns.slice(0, MAX_TABLE_COLUMNS);
  const visibleRows = rows.slice(0, MAX_PREVIEW_ROWS);

  const bodyHTML = visibleRows.length
    ? visibleRows.map(row => `
        <tr>
          ${visibleColumns.map(column =>
            `<td title="${escapeHTML(row[column] ?? "")}">${escapeHTML(row[column] ?? "—")}</td>`
          ).join("")}
          ${columns.length > MAX_TABLE_COLUMNS ? `<td>+${columns.length - MAX_TABLE_COLUMNS}</td>` : ""}
        </tr>
      `).join("")
    : `<tr><td colspan="${Math.max(1, visibleColumns.length + (columns.length > MAX_TABLE_COLUMNS ? 1 : 0))}">${escapeHTML(
        dataset.remoteOnly
          ? "This dataset is persisted on the server. The API returns profile metadata rather than raw row values."
          : "No preview rows are available."
      )}</td></tr>`;

  table.innerHTML = `
    <thead>
      <tr>
        ${visibleColumns.map(column => `<th>${escapeHTML(column)}</th>`).join("")}
        ${columns.length > MAX_TABLE_COLUMNS ? "<th>More columns</th>" : ""}
      </tr>
    </thead>
    <tbody>${bodyHTML}</tbody>
  `;

  setText(
    "#previewRecordCount",
    dataset.remoteOnly && !rows.length
      ? `${formatNumber(dataset.analysis?.rowCount || 0)} stored records · preview not returned by API`
      : `Showing ${formatNumber(visibleRows.length)} of ${formatNumber(rows.length)} records`
  );

  setText(
    "#previewPageLabel",
    columns.length > MAX_TABLE_COLUMNS
      ? `First ${MAX_TABLE_COLUMNS} columns displayed`
      : `${columns.length} columns`
  );
}

/* =========================================================
   COLUMN PROFILE
   ========================================================= */

function renderColumnProfile(dataset) {
  const target = $("#columnProfile");
  if (!target) return;

  const analysis = dataset.analysis;
  if (!analysis) return;

  if (!analysis.columnStats.length) {
    target.innerHTML = createEmptyState(
      "No columns to profile",
      "This dataset has no recognizable columns."
    );
    return;
  }

  target.innerHTML = analysis.columnStats.map(column => {
    const missingClass =
      column.missingPct > 20 ? "red" :
      column.missingPct > 0 ? "yellow" : "green";

    return `
      <div class="column-item">
        <div class="column-info">
          <strong title="${escapeHTML(column.name)}">${escapeHTML(column.name)}</strong>
          <small>
            ${escapeHTML(column.type)} ·
            ${formatNumber(column.unique)} unique ·
            ${formatNumber(column.missing)} missing
          </small>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width:${Math.max(0, Math.min(100, 100 - column.missingPct))}%"
            ></div>
          </div>
        </div>
        <span class="tag ${missingClass}">
          ${formatPercent(column.missingPct)}
        </span>
      </div>`;
  }).join("");
}

/* =========================================================
   QUALITY REPORT
   ========================================================= */

function renderQualityProfile(dataset) {
  const target = $("#qualityProfile");
  if (!target) return;

  const analysis = dataset.analysis || analyzeDataset(dataset);

  const emptyColumns = analysis.emptyColumns;
  const constantColumns = analysis.constantColumns;

  const items = [
    {
      label: "Missing cells",
      value: `${formatNumber(analysis.missingCells)} (${formatPercent(analysis.missingPct)})`,
      type: analysis.missingCells ? "yellow" : "green"
    },
    {
      label: "Duplicate rows",
      value: `${formatNumber(analysis.duplicates)} (${formatPercent(analysis.duplicatePct)})`,
      type: analysis.duplicates ? "yellow" : "green"
    },
    {
      label: "Completely empty columns",
      value: formatNumber(emptyColumns),
      type: emptyColumns ? "red" : "green"
    },
    {
      label: "Constant columns",
      value: formatNumber(constantColumns),
      type: constantColumns ? "yellow" : "green"
    },
    {
      label: "Numeric features",
      value: formatNumber(analysis.numericCount),
      type: "purple"
    }
  ];

  target.innerHTML = items.map(item => `
    <div class="quality-row">
      <strong>${escapeHTML(item.label)}</strong>
      <span class="tag ${item.type}">${escapeHTML(item.value)}</span>
    </div>
  `).join("");
}

/* =========================================================
   DATA QUALITY INSIGHTS
   ========================================================= */

function renderInsights(dataset) {
  const target = $("#insights");
  if (!target) return;

  const analysis = dataset.analysis || analyzeDataset(dataset);
  const findings = [];

  if (analysis.missingCells) {
    findings.push({
      title: "Missing values detected",
      message: `${formatNumber(analysis.missingCells)} cells are empty. Inspect the affected columns before training a model.`,
      type: "yellow"
    });
  } else {
    findings.push({
      title: "No missing cells detected",
      message: "All inspected cells contain values. This does not establish that values are valid or accurate.",
      type: "green"
    });
  }

  if (analysis.duplicates) {
    findings.push({
      title: "Duplicate records detected",
      message: `${formatNumber(analysis.duplicates)} repeated rows were found using all columns as the row signature.`,
      type: "yellow"
    });
  } else {
    findings.push({
      title: "No exact duplicate rows detected",
      message: "No records matched exactly across every column.",
      type: "green"
    });
  }

  if (analysis.numericCount >= 2) {
    findings.push({
      title: "Numerical analysis available",
      message: `${analysis.numericCount} numeric columns are available for distribution analysis and correlation checks.`,
      type: "purple"
    });
  } else {
    findings.push({
      title: "Limited numeric features",
      message: "Correlation analysis requires at least two numeric columns.",
      type: "yellow"
    });
  }

  const highMissing = analysis.columnStats.filter(
    column => column.missingPct >= 30
  );

  if (highMissing.length) {
    findings.push({
      title: "Columns with substantial missingness",
      message: highMissing.slice(0, 5)
        .map(column => `${column.name}: ${formatPercent(column.missingPct)}`)
        .join(" · "),
      type: "red"
    });
  }

  (Array.isArray(dataset.serverInsights) ? dataset.serverInsights : [])
    .slice(0, 6)
    .forEach((message, index) => {
      if (typeof message !== "string" || !message.trim()) return;
      findings.push({
        title: `Backend insight ${index + 1}`,
        message,
        type: "purple"
      });
    });

  target.innerHTML = findings.map(item => `
    <div class="insight-card">
      <div class="inline-actions">
        <strong>${escapeHTML(item.title)}</strong>
        <span class="tag ${item.type}">${escapeHTML(item.type)}</span>
      </div>
      <p>${escapeHTML(item.message)}</p>
    </div>
  `).join("");
}

/* =========================================================
   CORRELATION ANALYSIS
   ========================================================= */

function pearsonCorrelation(a, b) {
  const pairs = [];

  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    const x = numericValue(a[i]);
    const y = numericValue(b[i]);

    if (x !== null && y !== null) {
      pairs.push([x, y]);
    }
  }

  if (pairs.length < 3) return null;

  const xMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const yMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;

  let numerator = 0;
  let xSum = 0;
  let ySum = 0;

  pairs.forEach(([x, y]) => {
    const dx = x - xMean;
    const dy = y - yMean;

    numerator += dx * dy;
    xSum += dx * dx;
    ySum += dy * dy;
  });

  const denominator = Math.sqrt(xSum * ySum);

  if (!denominator) return null;

  return numerator / denominator;
}

function renderCorrelations(dataset) {
  const target = $("#correlation");
  if (!target) return;

  const columns = getNumericColumns(dataset);

  if (columns.length < 2) {
    target.innerHTML = createEmptyState(
      "Not enough numeric columns",
      "At least two numeric columns are required to calculate correlations.",
      "↗"
    );
    return;
  }

  const sampleRows = (dataset.rows || []).slice(0, MAX_CORRELATION_ROWS);
  const results = [];

  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const correlation = pearsonCorrelation(
        sampleRows.map(row => row[columns[i]]),
        sampleRows.map(row => row[columns[j]])
      );

      if (correlation !== null) {
        results.push({
          a: columns[i],
          b: columns[j],
          value: correlation
        });
      }
    }
  }

  results.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (!results.length) {
    target.innerHTML = createEmptyState(
      "Correlations unavailable",
      "There were not enough valid numeric pairs for a correlation estimate."
    );
    return;
  }

  target.innerHTML = results.slice(0, 8).map(item => {
    const magnitude = Math.abs(item.value);
    const strength = magnitude >= 0.7
      ? "Strong"
      : magnitude >= 0.4
        ? "Moderate"
        : "Weak";

    const color = magnitude >= 0.7
      ? "green"
      : magnitude >= 0.4
        ? "purple"
        : "";

    return `
      <div class="correlation-item">
        <div class="correlation-label">
          <span>${escapeHTML(item.a)} ↔ ${escapeHTML(item.b)}</span>
          <span class="correlation-value">${item.value.toFixed(3)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${magnitude * 100}%"></div>
        </div>
        <div class="signal-detail">${strength} linear association · ${formatNumber(sampleRows.length)} sampled records</div>
      </div>`;
  }).join("");
}

/* =========================================================
   INTERACTIVE EXPLORATORY CHARTS
   ========================================================= */

function destroyChart(name) {
  if (state.charts[name] && typeof state.charts[name].destroy === "function") {
    state.charts[name].destroy();
  }
  delete state.charts[name];
}

function chartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: "easeOutQuart" },
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151c2a",
        titleColor: "#edf2fb",
        bodyColor: "#c9d3e3",
        borderColor: "rgba(132,151,181,.24)",
        borderWidth: 1,
        padding: 10
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: "rgba(132,151,181,.16)" },
        ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 }, maxRotation: 35 }
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(132,151,181,.10)" },
        border: { display: false },
        ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 } }
      }
    },
    ...extra
  };
}

function chartStats(dataset) {
  return dataset?.analysis?.columnStats || [];
}

function numericChartColumns(dataset) {
  return chartStats(dataset).filter(column => column.numeric).map(column => column.name);
}

function categoricalChartColumns(dataset) {
  return chartStats(dataset)
    .filter(column => !column.numeric && column.type !== "Empty" && column.unique > 0)
    .map(column => column.name);
}

function configureChartSelect(select, values, placeholder) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = [
    `<option value="">${escapeHTML(placeholder)}</option>`,
    ...values.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
  select.value = values.includes(previous) ? previous : (values[0] || "");
}

function renderExplorationCharts(dataset) {
  configureChartSelect($("#numericChartSelect"), numericChartColumns(dataset), "Select a numeric feature");
  configureChartSelect($("#categoricalChartSelect"), categoricalChartColumns(dataset), "Select a categorical feature");
  renderNumericDistributionChart(dataset, $("#numericChartSelect")?.value || "");
  renderCategoryDistributionChart(dataset, $("#categoricalChartSelect")?.value || "");
  renderMissingnessChart(dataset);
}

function renderNumericDistributionChart(dataset, column) {
  destroyChart("numericDistribution");
  const canvas = $("#numericDistributionChart");
  const note = $("#numericChartNote");
  if (!canvas || !window.Chart) {
    if (note) note.textContent = "Chart.js is unavailable. Check the chart library script.";
    return;
  }

  const rows = dataset.rows || [];
  const stat = chartStats(dataset).find(item => item.name === column);
  let labels = [];
  let values = [];
  let summaryOnly = false;

  if (rows.length && column) {
    const numbers = rows.map(row => numericValue(row[column])).filter(value => value !== null);
    if (!numbers.length) {
      if (note) note.textContent = "No valid numeric values were found in this feature.";
      return;
    }

    const min = Math.min(...numbers);
    const max = Math.max(...numbers);

    if (min === max) {
      labels = [String(min)];
      values = [numbers.length];
    } else {
      const binCount = Math.max(5, Math.min(12, Math.round(Math.sqrt(numbers.length))));
      const step = (max - min) / binCount;
      const counts = new Array(binCount).fill(0);

      numbers.forEach(value => {
        counts[Math.min(binCount - 1, Math.floor((value - min) / step))]++;
      });

      labels = counts.map((_, index) => {
        const start = min + index * step;
        const end = index === binCount - 1 ? max : min + (index + 1) * step;
        return `${formatNumber(start, 2)}–${formatNumber(end, 2)}`;
      });
      values = counts;
    }

    if (note) note.textContent = `Histogram of ${formatNumber(numbers.length)} non-missing values for ${column}.`;
  } else if (stat) {
    // Persisted inventory responses contain aggregates rather than raw rows.
    labels = ["Minimum", "Median", "Mean", "Maximum"];
    values = [stat.min, stat.median, stat.mean, stat.max].map(value =>
      value === null || value === undefined ? 0 : safeNumber(value)
    );
    summaryOnly = true;
    if (note) note.textContent = "This dataset is persisted on the server; the chart uses profile summary statistics because raw rows are not returned by the inventory API.";
  } else {
    if (note) note.textContent = "Select a dataset with numeric columns to view a distribution.";
    return;
  }

  state.charts.numericDistribution = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: summaryOnly ? "Summary statistic" : "Frequency",
        data: values,
        backgroundColor: "rgba(167,139,250,.60)",
        hoverBackgroundColor: "rgba(196,181,253,.88)",
        borderColor: "#a78bfa",
        borderWidth: 1,
        borderRadius: 5,
        maxBarThickness: 36
      }]
    },
    options: chartOptions({
      scales: {
        x: { grid: { display: false }, border: { color: "rgba(132,151,181,.16)" }, ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 }, maxRotation: 35 } },
        y: { beginAtZero: true, grid: { color: "rgba(132,151,181,.10)" }, border: { display: false }, ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 } } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#151c2a", titleColor: "#edf2fb", bodyColor: "#c9d3e3",
          borderColor: "rgba(132,151,181,.24)", borderWidth: 1, padding: 10,
          callbacks: {
            label: context => summaryOnly
              ? `Value: ${formatNumber(context.parsed.y, 3)}`
              : `Frequency: ${formatNumber(context.parsed.y)}`
          }
        }
      }
    })
  });
}

function renderCategoryDistributionChart(dataset, column) {
  destroyChart("categoryDistribution");
  const canvas = $("#categoryDistributionChart");
  const note = $("#categoryChartNote");

  if (!canvas || !window.Chart) {
    if (note) note.textContent = "Chart.js is unavailable. Check the chart library script.";
    return;
  }

  const rows = dataset.rows || [];
  const stat = chartStats(dataset).find(item => item.name === column);
  let labels = [];
  let values = [];

  if (rows.length && column) {
    const counts = new Map();
    rows.forEach(row => {
      const value = row[column];
      const key = isEmptyValue(value) ? "(Missing)" : String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    labels = ranked.map(([name]) => name);
    values = ranked.map(([, count]) => count);
    if (note) note.textContent = `Top ${ranked.length} values out of ${formatNumber(counts.size)} distinct categories.`;
  } else if (stat?.topValues?.length) {
    const ranked = stat.topValues.slice(0, 10);
    labels = ranked.map(item => String(item.value));
    values = ranked.map(item => safeNumber(item.count));
    if (note) note.textContent = "Showing category counts returned by the server-side profile.";
  } else {
    if (note) note.textContent = "No category counts are available for this feature.";
    return;
  }

  state.charts.categoryDistribution = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Records",
        data: values,
        backgroundColor: labels.map((_, index) => index % 2 ? "rgba(103,232,249,.44)" : "rgba(103,232,249,.68)"),
        hoverBackgroundColor: "#67e8f9",
        borderColor: "rgba(103,232,249,.85)",
        borderWidth: 1,
        borderRadius: 5,
        maxBarThickness: 34
      }]
    },
    options: chartOptions({
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(132,151,181,.10)" }, border: { display: false }, ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 }, precision: 0 } },
        y: { grid: { display: false }, border: { color: "rgba(132,151,181,.16)" }, ticks: { color: "#aebbd0", font: { family: "DM Sans", size: 9 } } }
      }
    })
  });
}

function renderMissingnessChart(dataset) {
  destroyChart("missingness");
  const canvas = $("#missingnessChart");
  const note = $("#missingChartNote");
  const badge = $("#missingChartBadge");

  if (!canvas || !window.Chart) {
    if (note) note.textContent = "Chart.js is unavailable. Check the chart library script.";
    return;
  }

  const columns = chartStats(dataset)
    .filter(column => column.total > 0)
    .sort((a, b) => b.missingPct - a.missingPct)
    .slice(0, 15);

  if (!columns.length) {
    if (note) note.textContent = "No column-level completeness statistics are available.";
    if (badge) badge.textContent = "No profile";
    return;
  }

  const withMissing = columns.filter(column => column.missing > 0).length;
  if (badge) {
    badge.textContent = withMissing ? `${withMissing} columns with missing values` : "No missing values";
    badge.className = `tag ${withMissing ? "yellow" : "green"}`;
  }
  if (note) {
    note.textContent = columns.length === 15
      ? "Showing the 15 columns with the highest missing-value percentages."
      : "Each bar shows the percentage of missing values in a column.";
  }

  state.charts.missingness = new Chart(canvas, {
    type: "bar",
    data: {
      labels: columns.map(column => column.name),
      datasets: [{
        label: "Missing values (%)",
        data: columns.map(column => column.missingPct),
        backgroundColor: columns.map(column =>
          column.missingPct >= 30 ? "rgba(251,113,133,.62)"
            : column.missingPct > 0 ? "rgba(250,204,117,.62)"
              : "rgba(85,223,164,.35)"
        ),
        borderColor: columns.map(column =>
          column.missingPct >= 30 ? "#fb7185"
            : column.missingPct > 0 ? "#facc75"
              : "#55dfa4"
        ),
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 27
      }]
    },
    options: chartOptions({
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, max: 100, grid: { color: "rgba(132,151,181,.10)" }, border: { display: false }, ticks: { color: "#8d9bb0", font: { family: "DM Sans", size: 9 }, callback: value => `${value}%` } },
        y: { grid: { display: false }, border: { color: "rgba(132,151,181,.16)" }, ticks: { color: "#aebbd0", font: { family: "DM Sans", size: 9 } } }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#151c2a", titleColor: "#edf2fb", bodyColor: "#c9d3e3",
          borderColor: "rgba(132,151,181,.24)", borderWidth: 1, padding: 10,
          callbacks: { label: context => `Missing: ${formatPercent(context.parsed.x)}` }
        }
      }
    })
  });
}

function initializeExplorationCharts() {
  $("#numericChartSelect")?.addEventListener("change", () => {
    const dataset = getActiveDataset();
    if (dataset) renderNumericDistributionChart(dataset, $("#numericChartSelect").value);
  });

  $("#categoricalChartSelect")?.addEventListener("change", () => {
    const dataset = getActiveDataset();
    if (dataset) renderCategoryDistributionChart(dataset, $("#categoricalChartSelect").value);
  });
}



function inferTaskType(dataset, target) {
  const values = getColumnValues(dataset, target).filter(
    value => !isEmptyValue(value)
  );

  if (!values.length) return "unknown";

  if (isNumericColumn(values)) {
    const distinct = new Set(values.map(String)).size;

    if (distinct <= 10 && distinct <= values.length * 0.05) {
      return "classification";
    }

    return "regression";
  }

  return "classification";
}

function populateTargetOptions(dataset) {
  const select = $("#targetSelect");
  if (!select) return;

  const previous = select.value;
  const columns = getColumnNames(dataset);

  select.innerHTML = `
    <option value="">Select target column</option>
    ${columns.map(column =>
      `<option value="${escapeHTML(column)}">${escapeHTML(column)}</option>`
    ).join("")}
  `;

  if (columns.includes(previous)) {
    select.value = previous;
  }

  setText(
    "#jobStageLabel",
    columns.length
      ? `${columns.length} candidate target columns`
      : "No target columns available"
  );
}

/* =========================================================
   DATASET DELETION
   ========================================================= */

async function deleteActiveDataset() {
  const dataset = getActiveDataset();
  if (!dataset) return;

  if (dataset.serverId !== null && dataset.serverId !== undefined) {
    try {
      await apiRequest(
        `${ENDPOINTS.datasets}/${encodeURIComponent(dataset.serverId)}`,
        { method: "DELETE" },
        20000
      );
    } catch (error) {
      showToast(`Backend deletion failed: ${error.message}`, "error");
      return;
    }
  }

  state.datasets = state.datasets.filter(item => item.id !== dataset.id);
  state.activeDatasetId = state.datasets[0]?.id || null;

  if (state.activeModel?.datasetId === dataset.id) {
    state.activeModel = null;
    state.models = state.models.filter(model => model.datasetId !== dataset.id);
    state.predictionFeatures = [];
  }

  recordEvent(
    "ingestion",
    "Dataset removed",
    `${dataset.name} was removed from the browser session and backend storage when it had a server ID.`,
    "×"
  );

  renderAll();

  const nextDataset = getActiveDataset();

  if (nextDataset) {
    renderDatasetProfile(nextDataset);
  } else {
    setHidden("#analysisPanel", true);
  }

  showToast("Dataset removed.", "success");
}

/* =========================================================
   METRICS / OVERVIEW
   ========================================================= */

function renderMetrics() {
  const target = $("#metrics");
  if (!target) return;

  const datasetCount = state.datasets.length;

  const totalRows = state.datasets.reduce(
    (sum, dataset) => sum + safeNumber(dataset.analysis?.rowCount, dataset.rows?.length || 0),
    0
  );

  const modelCount = state.models.length;
  const activeDataset = getActiveDataset();

  const pipelineLabel =
    state.training
      ? "Training"
      : state.backendOnline
        ? "Connected"
        : "Local mode";

  const metrics = [
    {
      label: "Datasets",
      icon: "▦",
      value: formatNumber(datasetCount),
      foot: datasetCount ? "Available in this session" : "Awaiting ingestion",
      color: ""
    },
    {
      label: "Data records",
      icon: "⌘",
      value: formatNumber(totalRows),
      foot: datasetCount ? "Across loaded datasets" : "No records loaded",
      color: "cyan"
    },
    {
      label: "Trained models",
      icon: "◇",
      value: formatNumber(modelCount),
      foot: modelCount ? "Models returned by the API" : "No benchmark results",
      color: "blue"
    },
    {
      label: "Pipeline status",
      icon: "⌁",
      value: pipelineLabel,
      foot: activeDataset
        ? `Latest dataset: ${activeDataset.name}`
        : "Waiting for input data",
      color: "green"
    }
  ];

  target.innerHTML = metrics.map(metric => `
    <article class="metric">
      <div class="metric-top">
        <span class="metric-label">${escapeHTML(metric.label)}</span>
        <span class="metric-icon">${escapeHTML(metric.icon)}</span>
      </div>
      <div class="metric-value">${escapeHTML(metric.value)}</div>
      <div class="metric-bottom">${escapeHTML(metric.foot)}</div>
    </article>
  `).join("");

  setText("#landscapeDatasetCount", `${datasetCount} dataset${datasetCount === 1 ? "" : "s"}`);
  setText("#datasetNavCount", formatNumber(datasetCount));
  setText("#modelNavCount", formatNumber(modelCount));
}

function renderLatestSignal() {
  const target = $("#latestSignal");
  if (!target) return;

  const dataset = getActiveDataset();

  if (!dataset) {
    target.innerHTML = `
      <div class="signal-empty">
        <span class="empty-icon">⌁</span>
        <strong>Awaiting your first dataset</strong>
        <span>Upload structured data to activate profiling, quality checks, and analytical signals.</span>
        <button type="button" class="ghost small" data-view="datasets">Go to Data Workbench →</button>
      </div>`;
    return;
  }

  const analysis = dataset.analysis || analyzeDataset(dataset);

  target.innerHTML = `
    <div class="signal-line">
      <div>
        <strong>${escapeHTML(dataset.name)}</strong>
        <small>Active dataset · ${escapeHTML(dataset.type)}</small>
      </div>
      <span class="tag green">Profiled</span>
    </div>
    <div class="signal-line">
      <div>
        <strong>${formatNumber(analysis.rowCount)} records</strong>
        <small>${formatNumber(analysis.columnCount)} columns</small>
      </div>
      <span class="tag purple">${formatNumber(analysis.numericCount)} numeric</span>
    </div>
    <div class="signal-line">
      <div>
        <strong>${formatNumber(analysis.missingCells)} missing cells</strong>
        <small>Across all dataset fields</small>
      </div>
      <span class="tag ${analysis.missingCells ? "yellow" : "green"}">${formatPercent(analysis.missingPct)}</span>
    </div>
    <div class="signal-line">
      <div>
        <strong>Explore full profile</strong>
        <small>Inspect column-level statistics and relationships.</small>
      </div>
      <button type="button" class="ghost small" data-view="datasets">Open →</button>
    </div>
  `;
}

function renderReadiness() {
  const target = $("#modelReadiness");
  if (!target) return;

  const dataset = getActiveDataset();

  if (state.activeModel) {
    const name = state.activeModel.name || state.activeModel.model_name || "Trained model";

    target.innerHTML = `
      <div class="signal-line">
        <div>
          <strong>${escapeHTML(name)}</strong>
          <small>A model-training result is available in this session.</small>
        </div>
        <span class="tag green">Ready</span>
      </div>
      <button class="ghost small" type="button" data-view="models">Review model →</button>
    `;
    return;
  }

  if (dataset) {
    target.innerHTML = `
      <div class="signal-line">
        <div>
          <strong>Dataset profiled</strong>
          <small>${escapeHTML(dataset.name)} is ready for target selection.</small>
        </div>
        <span class="tag purple">Step 2 / 4</span>
      </div>
      <button type="button" class="ghost small" data-view="datasets">Choose a target →</button>
    `;
  } else {
    target.innerHTML = `
      <div class="signal-empty readiness-message">
        <span>Train a model after inspecting your dataset to activate model metrics and prediction workflows.</span>
      </div>
    `;
  }
}

/* =========================================================
   AUTOML
   ========================================================= */

function initializeTraining() {
  $("#trainBtn")?.addEventListener("click", runAutoML);
}

async function runAutoML() {
  if (state.training) {
    showToast("A training job is already running.");
    return;
  }

  const dataset = getActiveDataset();
  const targetColumn = $("#targetSelect")?.value;
  const button = $("#trainBtn");

  if (!dataset) {
    showToast("Import and select a dataset first.", "error");
    return;
  }

  if (!targetColumn) {
    showToast("Choose the target column you want to predict.", "error");
    $("#targetSelect")?.focus();
    return;
  }

  if (dataset.serverId === null || dataset.serverId === undefined) {
    showToast(
      "This dataset has not been persisted by the backend yet. Wait for upload to finish or check the API connection.",
      "error"
    );
    return;
  }

  if (!dataset.rows?.length && !dataset.serverProfile) {
    showToast("The selected dataset has no readable records or server profile.", "error");
    return;
  }

  state.training = true;
  state.trainingJob = null;
  setButtonLoading(button, true, "Queueing job");
  setHidden("#jobProgress", false);
  updateTrainingProgress(0, "Submitting AutoML job", "Queued");

  recordEvent(
    "training",
    "Model training requested",
    `Target: ${targetColumn}. Dataset: ${dataset.name}.`,
    "◇"
  );

  renderMetrics();

  try {
    const url = `${ENDPOINTS.train}/${encodeURIComponent(dataset.serverId)}/train?target=${encodeURIComponent(targetColumn)}`;

    const queued = await apiRequest(
      url,
      { method: "POST" },
      30000
    );

    const jobId = queued?.job_id || queued?.id;

    if (!jobId) {
      throw new Error("The backend did not return a training job ID.");
    }

    state.trainingJob = { id: String(jobId), datasetId: dataset.id, target: targetColumn };
    updateTrainingProgress(2, "Job queued", "Waiting for background worker");
    setButtonLoading(button, true, "Training model");

    const completedJob = await pollTrainingJob(String(jobId));

    if (completedJob.status !== "complete") {
      throw new Error(completedJob.message || "The training job did not complete.");
    }

    updateTrainingProgress(94, "Interpreting benchmark results", "Normalizing backend response");

    const result = normalizeTrainingResponse(completedJob, dataset, targetColumn);

    if (!result.models.length && !result.bestModel) {
      throw new Error("The completed job did not contain any model benchmark results.");
    }

    state.models = result.models;
    state.activeModel = result.bestModel || result.models[0];
    state.predictionFeatures = getModelFeatureNames(
      state.activeModel,
      dataset,
      targetColumn
    );

    state.activeModel.serverDatasetId = dataset.serverId;

    updateTrainingProgress(100, "Training completed", "Model and metrics received");

    recordEvent(
      "training",
      "Training completed",
      `${result.models.length} benchmark result(s) returned for target "${targetColumn}".`,
      "✓"
    );

    await loadFeatureImportance(dataset);

    renderAll();
    renderModels();
    renderImportance();
    renderPredictionPanel();

    showView("models");
    showToast("AutoML training completed successfully.", "success");

  } catch (error) {
    console.error("AutoML request failed:", error);

    updateTrainingProgress(0, "Training failed", error.message);

    recordEvent(
      "training",
      "Training request failed",
      error.message,
      "!"
    );

    showToast(error.message || "Model training failed.", "error");
  } finally {
    state.training = false;
    state.trainingJob = null;
    setButtonLoading(button, false);
    renderMetrics();
  }
}

async function pollTrainingJob(jobId) {
  const maxAttempts = 240;
  const delayMs = 1500;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await apiRequest(
      `/api/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
      12000
    );

    const progress = Number.isFinite(Number(job.progress))
      ? Number(job.progress)
      : Math.min(90, Math.round((attempt + 1) / maxAttempts * 90));

    updateTrainingProgress(
      progress,
      job.message || `Training status: ${job.status || "running"}`,
      job.status || "running"
    );

    if (job.status === "complete" || job.status === "failed") {
      return job;
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error("Training job timed out while waiting for the backend.");
}

function updateTrainingProgress(percent, message, stage) {
  const progress = Math.max(0, Math.min(100, Number(percent) || 0));

  const bar = $("#progressBar");

  if (bar) {
    bar.style.width = `${progress}%`;
  }

  setText("#progressPct", `${progress}%`);
  setText("#jobMessage", message);
  setText("#jobElapsedLabel", stage);
  setText("#jobStageLabel", message);
}

/* =========================================================
   NORMALIZE BACKEND MODEL RESPONSES
   ========================================================= */

function normalizeTrainingResponse(response, dataset, target) {
  const root = response?.result || response?.data || response;
  const metricsRoot = root?.metrics || {};

  const benchmarkList =
    root?.models ||
    root?.benchmarks ||
    root?.results ||
    root?.candidates ||
    metricsRoot?.benchmark ||
    [];

  const models = Array.isArray(benchmarkList)
    ? benchmarkList.map((model, index) => normalizeModel(model, index, dataset, target))
    : [];

  let best = root?.best_model || root?.bestModel || root?.model || null;
  const bestMetrics = metricsRoot?.best || root?.best_metrics || {};

  if (typeof best === "string") {
    best = models.find(model => model.name === best) || {
      id: null,
      name: best,
      target,
      datasetId: dataset.id,
      serverDatasetId: dataset.serverId,
      task: root?.problem_type || inferTaskType(dataset, target),
      metrics: bestMetrics,
      score: root?.best_score ?? null,
      features: root?.features || getModelFeatureNames(null, dataset, target),
      featureImportance: null,
      status: "completed"
    };
  } else if (best && typeof best === "object") {
    best = normalizeModel(best, -1, dataset, target);
    best.metrics = bestMetrics && Object.keys(bestMetrics).length
      ? bestMetrics
      : best.metrics;
    best.score = root?.best_score ?? best.score;
  }

  if (!best && models.length) {
    const sorted = models.filter(model => model.status !== "failed");
    best = sorted[0] || models[0];
  }

  if (best) {
    best.serverDatasetId = dataset.serverId;
    best.datasetId = dataset.id;
    best.target = best.target || target;
    best.features = root?.features || best.features ||
      getModelFeatureNames(null, dataset, target);
    best.metrics = best.metrics || bestMetrics;
  }

  if (best && !models.some(model => model.name === best.name)) {
    models.unshift(best);
  }

  models.forEach(model => {
    model.serverDatasetId = dataset.serverId;
    model.datasetId = dataset.id;
  });

  return { models, bestModel: best };
}

function normalizeModel(model, index, dataset, target) {
  const item =
    model && typeof model === "object"
      ? model
      : { name: String(model || `Model ${index + 1}`) };

  return {
    id: item.id ?? item.model_id ?? item.modelId ?? null,
    name: item.name || item.model_name || item.model || item.algorithm || `Model ${index + 1}`,
    target: item.target || item.target_column || target,
    datasetId: dataset.id,
    serverDatasetId: dataset.serverId,
    metrics: item.metrics || item.scores || item.evaluation || {},
    score: item.score ?? item.accuracy ?? item.r2 ?? item.f1 ?? null,
    status: item.status || "completed",
    features: item.features || item.feature_names || null,
    featureImportance:
      item.feature_importance ||
      item.featureImportance ||
      item.importance ||
      null,
    task: item.task || item.problem_type || inferTaskType(dataset, target),
    raw: item
  };
}

/* =========================================================
   MODEL LAB RENDERING
   ========================================================= */

function renderModels() {
  const target = $("#modelTable");
  if (!target) return;

  if (!state.models.length) {
    target.innerHTML = createEmptyState(
      "No benchmark results yet",
      "Train a model using a configured backend to populate this ranking.",
      "◇"
    );
  } else {
    target.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Task</th>
              <th>Primary metric</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${state.models.map((model, index) => `
              <tr>
                <td>
                  <strong>${escapeHTML(model.name)}</strong>
                  ${index === 0 ? '<span class="tag purple">Best returned</span>' : ""}
                </td>
                <td>${escapeHTML(model.task || "—")}</td>
                <td>${escapeHTML(formatModelScore(model))}</td>
                <td><span class="tag green">Returned</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  renderModelMetrics();
  setText("#modelNavCount", formatNumber(state.models.length));
}

function formatModelScore(model) {
  if (model.score !== null && model.score !== undefined) {
    return String(model.score);
  }

  const metrics = model.metrics || {};

  const keys = [
    "accuracy",
    "f1",
    "f1_score",
    "r2",
    "r2_score",
    "roc_auc",
    "rmse",
    "mae",
    "mse"
  ];

  for (const key of keys) {
    if (Number.isFinite(Number(metrics[key]))) {
      return `${key}: ${Number(metrics[key]).toFixed(4)}`;
    }
  }

  return "See metrics";
}

function renderModelMetrics() {
  const target = $("#modelMetrics");
  if (!target) return;

  const model = state.activeModel;
  const metrics = model?.metrics || {};
  const score = model ? formatModelScore(model) : "—";
  const valueTarget = model?.target || "—";

  target.innerHTML = `
    <article class="metric">
      <div class="metric-top">
        <span class="metric-label">Trained pipelines</span>
        <span class="metric-icon">◇</span>
      </div>
      <div class="metric-value">${formatNumber(state.models.length)}</div>
      <div class="metric-bottom">Results received from backend</div>
    </article>
    <article class="metric">
      <div class="metric-top">
        <span class="metric-label">Best returned metric</span>
        <span class="metric-icon">↗</span>
      </div>
      <div class="metric-value">${escapeHTML(score)}</div>
      <div class="metric-bottom">${model ? escapeHTML(model.name) : "No evaluation yet"}</div>
    </article>
    <article class="metric">
      <div class="metric-top">
        <span class="metric-label">Latest target</span>
        <span class="metric-icon">⌕</span>
      </div>
      <div class="metric-value">${escapeHTML(valueTarget)}</div>
      <div class="metric-bottom">${model ? "Training target" : "No target selected"}</div>
    </article>
    <article class="metric">
      <div class="metric-top">
        <span class="metric-label">Inference status</span>
        <span class="metric-icon">⌁</span>
      </div>
      <div class="metric-value">${state.activeModel ? "Ready" : "Idle"}</div>
      <div class="metric-bottom">${state.activeModel ? "Model response available" : "No model available"}</div>
    </article>
  `;
}

function getModelFeatureNames(model, dataset, target) {
  const features =
    model?.features ||
    model?.raw?.features ||
    model?.raw?.feature_names ||
    model?.raw?.input_features;

  if (Array.isArray(features)) {
    return features.map(feature =>
      typeof feature === "string" ? feature : feature?.name
    ).filter(Boolean);
  }

  if (features && typeof features === "object") {
    return Object.keys(features);
  }

  return getColumnNames(dataset).filter(column => column !== target);
}

/* =========================================================
   FEATURE IMPORTANCE
   ========================================================= */

function normalizeImportance(model) {
  const raw =
    model?.featureImportance ||
    model?.raw?.feature_importance ||
    model?.raw?.featureImportance ||
    model?.raw?.importance ||
    model?.metrics?.feature_importance ||
    null;

  if (Array.isArray(raw)) {
    return raw.map(item => ({
      name: item.feature || item.name || item.column || "Feature",
      value: numericValue(item.importance ?? item.value ?? item.score) ?? 0
    })).sort((a, b) => b.value - a.value);
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([name, value]) => ({
        name,
        value: numericValue(
          typeof value === "object"
            ? value.importance ?? value.value ?? value.score
            : value
        ) ?? 0
      }))
      .sort((a, b) => b.value - a.value);
  }

  return [];
}

async function loadFeatureImportance(dataset = getActiveDataset()) {
  if (!dataset?.serverId || !state.activeModel) return;

  try {
    const response = await apiRequest(
      `${ENDPOINTS.importance}/${encodeURIComponent(dataset.serverId)}/importance`,
      { method: "GET" },
      15000
    );

    const items = response?.feature_importance || response?.importance || [];
    state.activeModel.featureImportance = items;

    const current = state.models.find(model => model.name === state.activeModel.name);
    if (current) current.featureImportance = items;
  } catch (error) {
    console.warn("Feature importance is unavailable:", error.message);
  }
}

function renderImportance() {
  const target = $("#importance");
  if (!target) return;

  const features = normalizeImportance(state.activeModel);

  if (!state.activeModel || !features.length) {
    target.innerHTML = createEmptyState(
      "Explanatory signals unavailable",
      "The trained estimator must return feature importance or coefficients for this view.",
      "⌁"
    );
    return;
  }

  const maxValue = Math.max(...features.map(item => Math.abs(item.value)), 1);

  target.innerHTML = features.slice(0, 12).map(item => `
    <div class="importance-item">
      <div class="importance-label">
        <span>${escapeHTML(item.name)}</span>
        <span class="importance-value">${formatNumber(item.value, 4)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.abs(item.value) / maxValue * 100}%"></div>
      </div>
    </div>
  `).join("");
}



/* =========================================================
   PREDICTION INPUTS
   ========================================================= */

function renderPredictionPanel() {
  const panel = $("#predictPanel");
  const fields = $("#predictFields");

  if (!panel || !fields) return;

  if (!state.activeModel) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  const dataset = state.datasets.find(item =>
    item.id === state.activeModel.datasetId
  ) || getActiveDataset();

  const features = state.predictionFeatures.length
    ? state.predictionFeatures
    : dataset
      ? getModelFeatureNames(state.activeModel, dataset, state.activeModel.target)
      : [];

  if (!features.length) {
    fields.innerHTML = createEmptyState(
      "Model features unavailable",
      "Your backend should return input features or a model schema for inference."
    );
    return;
  }

  setText(
    "#predictionModelSummary strong",
    state.activeModel.name || "Selected model"
  );

  setText(
    "#predictionModelSummary small",
    `${features.length} input features · target: ${state.activeModel.target || "not specified"}`
  );

  fields.innerHTML = features.slice(0, 50).map((feature, index) => {
    const info = dataset?.analysis?.columnStats?.find(
      column => column.name === feature
    );

    const numeric = info?.numeric === true;

    return `
      <div class="field">
        <label for="prediction-field-${index}">${escapeHTML(feature)}</label>
        <input
          class="form-control"
          id="prediction-field-${index}"
          data-predict-feature="${escapeHTML(feature)}"
          type="${numeric ? "number" : "text"}"
          ${numeric ? 'step="any"' : ""}
          placeholder="${numeric ? "Enter numeric value" : "Enter feature value"}"
          autocomplete="off"
        >
      </div>`;
  }).join("");

  const result = $("#predictionResult");
  if (result) result.innerHTML = "";

  const button = $("#predictBtn");
  if (button) button.disabled = false;
}

function initializePrediction() {
  $("#predictBtn")?.addEventListener("click", runPrediction);
}

async function runPrediction() {
  const button = $("#predictBtn");
  const inputs = $$("[data-predict-feature]");
  const model = state.activeModel;

  if (!model) {
    showToast("No trained model is available.", "error");
    return;
  }

  const dataset = state.datasets.find(item => item.id === model.datasetId) || getActiveDataset();
  const serverDatasetId = model.serverDatasetId ?? dataset?.serverId;

  if (serverDatasetId === null || serverDatasetId === undefined) {
    showToast("This model is not linked to a persisted backend dataset.", "error");
    return;
  }

  if (!inputs.length) {
    showToast("No input features are available for this model.", "error");
    return;
  }

  const features = {};
  const missing = [];

  inputs.forEach(input => {
    const key = input.dataset.predictFeature;
    const value = input.value.trim();

    if (value === "") {
      missing.push(key);
    } else if (input.type === "number") {
      const number = Number(value);

      if (!Number.isFinite(number)) {
        missing.push(key);
      } else {
        features[key] = number;
      }
    } else {
      features[key] = value;
    }
  });

  if (missing.length) {
    showToast(
      `Complete or correct these feature fields: ${missing.slice(0, 3).join(", ")}`,
      "error"
    );
    return;
  }

  setButtonLoading(button, true, "Generating");

  try {
    // The FastAPI prediction route expects the feature-name/value object directly.
    const response = await apiRequest(
      `${ENDPOINTS.predict}/${encodeURIComponent(serverDatasetId)}/predict`,
      {
        method: "POST",
        body: JSON.stringify(features)
      },
      30000
    );

    const prediction = normalizePredictionResponse(response);

    renderPredictionResult(prediction);

    recordEvent(
      "prediction",
      "Prediction response received",
      `Inference completed using ${model.name}.`,
      "↗"
    );

    showToast("Prediction response received.", "success");

  } catch (error) {
    console.error("Prediction request failed:", error);

    showToast(error.message || "Prediction failed.", "error");

    recordEvent(
      "prediction",
      "Prediction request failed",
      error.message,
      "!"
    );
  } finally {
    setButtonLoading(button, false);
  }
}

function normalizePredictionResponse(response) {
  const root =
    response?.result ??
    response?.data ??
    response;

  if (
    root === null ||
    typeof root === "string" ||
    typeof root === "number" ||
    typeof root === "boolean" ||
    Array.isArray(root)
  ) {
    return { prediction: root, raw: response };
  }

  const value =
    root?.prediction ??
    root?.predictions ??
    root?.output ??
    root?.result ??
    root?.value;

  return {
    prediction: value === undefined ? root : value,
    confidence: root?.confidence ?? root?.probability ?? null,
    details: root?.details ?? root?.explanation ?? null,
    raw: response
  };
}

function renderPredictionResult(result) {
  const target = $("#predictionResult");
  if (!target) return;

  let value;

  if (result.prediction === undefined) {
    value = JSON.stringify(result.raw, null, 2);
  } else if (
    result.prediction !== null &&
    typeof result.prediction === "object"
  ) {
    value = JSON.stringify(result.prediction, null, 2);
  } else {
    value = String(result.prediction ?? "No prediction value returned.");
  }

  target.innerHTML = `
    <div class="prediction-card">
      <div class="eyebrow">MODEL RESPONSE</div>
      <div class="prediction-value">${escapeHTML(value)}</div>
      ${
        result.confidence !== null && result.confidence !== undefined
          ? `<div class="prediction-note">Returned confidence: ${escapeHTML(String(result.confidence))}</div>`
          : ""
      }
      ${
        result.details
          ? `<div class="prediction-note">${escapeHTML(typeof result.details === "string" ? result.details : JSON.stringify(result.details))}</div>`
          : ""
      }
      <div class="prediction-note">Result received from the configured inference endpoint.</div>
    </div>
  `;
}

/* =========================================================
   EXPORT DATASET
   ========================================================= */

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const text = value instanceof Date ? value.toISOString() : String(value);

  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function datasetToCSV(dataset) {
  const columns = getColumnNames(dataset);

  const header = columns.map(csvEscape).join(",");

  const rows = dataset.rows.map(row =>
    columns.map(column => csvEscape(row[column])).join(",")
  );

  return [header, ...rows].join("\r\n");
}

function exportActiveDatasetCSV() {
  const dataset = getActiveDataset();

  if (!dataset) {
    showToast("Select a dataset to export.", "error");
    return;
  }

  const csv = datasetToCSV(dataset);
  const filename = `${slugify(dataset.name.replace(/\.[^.]+$/, ""))}-export.csv`;

  downloadText(csv, filename, "text/csv;charset=utf-8");

  recordEvent(
    "ingestion",
    "Dataset exported",
    `${dataset.name} was exported as a CSV file.`,
    "↓"
  );

  showToast("Dataset exported as CSV.", "success");
}

function exportDatasetReport() {
  const dataset = getActiveDataset();

  if (!dataset) {
    showToast("Select a dataset to export a report.", "error");
    return;
  }

  const report = {
    application: "DataVision Intelligence",
    exported_at: new Date().toISOString(),
    dataset: {
      name: dataset.name,
      id: dataset.id,
      backend_id: dataset.serverId,
      imported_at: dataset.createdAt,
      bytes: dataset.size,
      type: dataset.type
    },
    profile: dataset.analysis || analyzeDataset(dataset),
    columns: dataset.analysis?.columnStats || [],
    models: state.models.filter(model => model.datasetId === dataset.id)
  };

  downloadText(
    JSON.stringify(report, null, 2),
    `${slugify(dataset.name.replace(/\.[^.]+$/, ""))}-report.json`,
    "application/json;charset=utf-8"
  );

  showToast("Dataset profile report exported.", "success");
}

/* =========================================================
   CLOCK
   ========================================================= */

function updateClock() {
  const clock = $("#systemClock");
  if (!clock) return;

  clock.innerHTML = `
    <span class="clock-dot"></span>
    <span>${escapeHTML(formatTimestamp(new Date()))}</span>
  `;
}

/* =========================================================
   RENDER ALL
   ========================================================= */

function renderAll() {
  state.datasets.forEach(dataset => {
    if (!dataset.analysis) {
      dataset.analysis = analyzeDataset(dataset);
    }
  });

  renderDatasetList();
  renderMetrics();
  renderActivityFeed();
  renderFullFeed();
  renderLatestSignal();
  renderReadiness();
  renderModels();
  renderImportance();

  const dataset = getActiveDataset();

  if (dataset && !$("#analysisPanel")?.hidden) {
    renderDatasetProfile(dataset);
  }

  if (state.activeModel) {
    renderPredictionPanel();
  }
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initializeApp() {
  initializeNavigation();
  initializeConfirmation();
  initializeUploader();
  initializeDatasetListClicks();
  initializeStreamControls();
  initializeExplorationCharts();
  initializeTraining();
  initializePrediction();

  updateClock();
  setInterval(updateClock, 1000);

  setText("#systemStatus", "UI active");
  setText("#systemSubStatus", "Checking backend connection");
  setText("#apiStatusLabel", "Checking");

  renderAll();

  recordEvent(
    "system",
    "DataVision initialized",
    "The analytics workspace loaded. Backend functionality is verified separately.",
    "✓"
  );

  await checkBackendHealth();

  if (state.backendOnline) {
    await syncPersistedDatasets();
  }

  renderAll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp, { once: true });
} else {
  initializeApp();
}
