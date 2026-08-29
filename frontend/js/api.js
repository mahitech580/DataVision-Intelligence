const API = "http://localhost:8000/api";

async function apiFetch(url, options = {}) {
  const res = await fetch(API + url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Request failed");
  }
  return res;
}

async function apiJSON(url, options = {}) {
  const res = await apiFetch(url, options);
  return res.json();
}

function showToast(msg, type = "success") {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === "success" ? "✓" : "✕"}</span>${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showLoading(msg = "Processing...") {
  const ol = document.getElementById("loading-overlay");
  if (ol) { ol.querySelector("p").textContent = msg; ol.style.display = "flex"; }
}
function hideLoading() {
  const ol = document.getElementById("loading-overlay");
  if (ol) ol.style.display = "none";
}

function formatNumber(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n === "number") return n >= 1000 ? n.toLocaleString() : n.toFixed ? n.toFixed(4).replace(/\.?0+$/, "") : n;
  return n;
}

function pct(v) { return v !== null && v !== undefined ? (v * 100).toFixed(1) + "%" : "—"; }
function score(v, type) {
  if (v === null || v === undefined) return "—";
  return type === "regression" ? v.toFixed(4) : (v * 100).toFixed(1) + "%";
}

// Sidebar active link
document.querySelectorAll && document.querySelectorAll(".sidebar-nav a").forEach(a => {
  if (a.href === location.href || location.pathname.endsWith(a.getAttribute("href"))) a.classList.add("active");
});
