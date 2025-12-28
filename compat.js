const dom = {
  refreshBtn: document.getElementById("refreshBtn"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  copyCsvBtn: document.getElementById("copyCsvBtn"),
  compatStatus: document.getElementById("compatStatus"),
  activeFilters: document.getElementById("activeFilters"),

  browserFilter: document.getElementById("browserFilter"),
  osFilter: document.getElementById("osFilter"),
  countryFilter: document.getElementById("countryFilter"),
  deviceFilter: document.getElementById("deviceFilter"),
  cpuFilter: document.getElementById("cpuFilter"),

  fWebgpuAvailable: document.getElementById("fWebgpuAvailable"),
  fWebgl2Available: document.getElementById("fWebgl2Available"),
  fWebgl1Available: document.getElementById("fWebgl1Available"),
  fAppleSilicon: document.getElementById("fAppleSilicon"),
  fWebgpuFeature: document.getElementById("fWebgpuFeature"),
  fWebgl2Ext: document.getElementById("fWebgl2Ext"),
  fWebgl1Ext: document.getElementById("fWebgl1Ext"),

  groupBy: document.getElementById("groupBy"),
  usage: document.getElementById("usage"),
  limit: document.getElementById("limit"),
  minTested: document.getElementById("minTested"),
  excludeUnknown: document.getElementById("excludeUnknown"),

  matrixSummary: document.getElementById("matrixSummary"),
  compatThead: document.getElementById("compatThead"),
  compatTbody: document.getElementById("compatTbody"),
  rawJson: document.getElementById("rawJson"),
  toastContainer: document.getElementById("toastContainer"),
};

/** @type {any} */
let lastCompat = null;
let optionUniverse = { browsers: [], os: [], countries: [], deviceTypes: [], cpuArch: [] };
let refreshAbort = null;

const COMPAT_STATE_KEY = "hdrDetection.compatState.v1";

function safeStorageGet(key) {
  try {
    return globalThis.localStorage ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    if (!globalThis.localStorage) return false;
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

function stringifySafe(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uniqueSorted(values) {
  const seen = new Set();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    seen.add(s);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function pct(n, d) {
  const nn = Number(n || 0);
  const dd = Number(d || 0);
  if (!dd) return 0;
  return Math.round((nn / dd) * 100);
}

function setStatus(state, text) {
  if (!dom.compatStatus) return;
  const base = "badge";
  const className =
    state === "good"
      ? `${base} badge--good`
      : state === "bad"
      ? `${base} badge--bad`
      : state === "warn"
      ? `${base} badge--warn`
      : `${base} badge--accent`;
  dom.compatStatus.className = className;
  dom.compatStatus.textContent = text;
}

function showToast(type, title, message, duration = 3500) {
  if (!dom.toastContainer) return;
  const toast = document.createElement("div");
  const baseClasses = "flex items-start gap-3 py-3.5 px-4 rounded-xl border backdrop-blur-lg shadow-card-sm animate-toast-in";
  const typeClasses =
    type === "success" ? "bg-good/15 border-good/30 text-good" : "bg-bad/15 border-bad/30 text-bad";
  toast.className = `${baseClasses} ${typeClasses}`;
  toast.innerHTML = `
    <div class="flex flex-col gap-0.5 min-w-0">
      <div class="font-semibold text-sm">${escapeHtml(title)}</div>
      ${message ? `<div class="text-xs opacity-80 break-words">${escapeHtml(message)}</div>` : ""}
    </div>
  `;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove("animate-toast-in");
    toast.classList.add("animate-toast-out");
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function setSelectOptions(selectEl, values, currentValue) {
  if (!selectEl) return;
  const normalized = uniqueSorted(values);
  const chosen = currentValue != null ? String(currentValue) : "";
  const opts = [`<option value="">All</option>`].concat(
    normalized.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
  );
  selectEl.innerHTML = opts.join("");
  selectEl.value = normalized.includes(chosen) ? chosen : "";
}

function populateFilterOptionsFromResponse(resp) {
  const b = resp?.breakdown || {};
  optionUniverse = {
    browsers: uniqueSorted((b.browsers || []).map((it) => it.name)),
    os: uniqueSorted((b.os || []).map((it) => it.name)),
    countries: uniqueSorted((b.countries || []).map((it) => it.name)),
    deviceTypes: uniqueSorted((b.deviceTypes || []).map((it) => it.name)),
    cpuArch: uniqueSorted((b.cpuArch || []).map((it) => it.name)),
  };

  setSelectOptions(dom.browserFilter, optionUniverse.browsers, dom.browserFilter?.value);
  setSelectOptions(dom.osFilter, optionUniverse.os, dom.osFilter?.value);
  setSelectOptions(dom.countryFilter, optionUniverse.countries, dom.countryFilter?.value);
  setSelectOptions(dom.deviceFilter, optionUniverse.deviceTypes, dom.deviceFilter?.value);
  setSelectOptions(dom.cpuFilter, optionUniverse.cpuArch, dom.cpuFilter?.value);
}

function truthy(v) {
  return ["1", "true", "t", "yes", "y", "on"].includes(String(v || "").toLowerCase());
}

function getSelectionParamsFromControls() {
  const params = new URLSearchParams();

  const browser = dom.browserFilter?.value || "";
  const os = dom.osFilter?.value || "";
  const country = dom.countryFilter?.value || "";
  const deviceType = dom.deviceFilter?.value || "";
  const cpuArch = dom.cpuFilter?.value || "";

  if (browser) params.set("browser", browser);
  if (os) params.set("os", os);
  if (country) params.set("country", country);
  if (deviceType) params.set("deviceType", deviceType);
  if (cpuArch) params.set("cpuArch", cpuArch);

  if (dom.fAppleSilicon?.checked) params.set("appleSilicon", "1");
  if (dom.fWebgpuAvailable?.checked) params.set("webgpuAvailable", "1");
  if (dom.fWebgl2Available?.checked) params.set("webgl2Available", "1");
  if (dom.fWebgl1Available?.checked) params.set("webgl1Available", "1");

  const webgpuFeature = (dom.fWebgpuFeature?.value || "").trim();
  if (webgpuFeature) params.append("webgpuFeature", webgpuFeature);

  const webgl2Ext = (dom.fWebgl2Ext?.value || "").trim();
  if (webgl2Ext) params.append("webgl2Ext", webgl2Ext);

  const webgl1Ext = (dom.fWebgl1Ext?.value || "").trim();
  if (webgl1Ext) params.append("webgl1Ext", webgl1Ext);

  return params;
}

function getCompatParamsFromControls() {
  const params = getSelectionParamsFromControls();
  params.set("groupBy", dom.groupBy?.value || "device");
  params.set("usage", dom.usage?.value || "any");

  const limit = String(dom.limit?.value || "").trim();
  if (limit) params.set("limit", limit);

  const minTested = String(dom.minTested?.value || "").trim();
  if (minTested) params.set("minTested", minTested);

  if (dom.excludeUnknown?.checked) params.set("excludeUnknown", "1");
  return params;
}

function syncUrlFromControls() {
  const params = getCompatParamsFromControls();
  const next = params.toString();
  const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function clearSelectionControls() {
  dom.browserFilter.value = "";
  dom.osFilter.value = "";
  dom.countryFilter.value = "";
  dom.deviceFilter.value = "";
  dom.cpuFilter.value = "";

  dom.fWebgpuAvailable.checked = false;
  dom.fWebgl2Available.checked = false;
  dom.fWebgl1Available.checked = false;
  dom.fAppleSilicon.checked = false;

  dom.fWebgpuFeature.value = "";
  dom.fWebgl2Ext.value = "";
  dom.fWebgl1Ext.value = "";
}

function clearMatrixControls() {
  dom.groupBy.value = "device";
  dom.usage.value = "any";
  dom.limit.value = "12";
  dom.minTested.value = "0";
  dom.excludeUnknown.checked = false;
}

function renderActiveFilterChips() {
  if (!dom.activeFilters) return;
  const params = getSelectionParamsFromControls();
  const chips = [];

  const add = (key, label) => {
    chips.push(`
      <span class="chip">
        <span>${escapeHtml(label)}</span>
        <button type="button" data-clear="${escapeHtml(key)}" aria-label="Remove filter">×</button>
      </span>
    `);
  };

  if (params.get("browser")) add("browser", `Browser: ${params.get("browser")}`);
  if (params.get("os")) add("os", `OS: ${params.get("os")}`);
  if (params.get("country")) add("country", `Country: ${params.get("country")}`);
  if (params.get("deviceType")) add("deviceType", `Device: ${params.get("deviceType")}`);
  if (params.get("cpuArch")) add("cpuArch", `CPU: ${params.get("cpuArch")}`);
  if (params.get("appleSilicon")) add("appleSilicon", "Apple Silicon");
  if (params.get("webgpuAvailable")) add("webgpuAvailable", "WebGPU available");
  if (params.get("webgl2Available")) add("webgl2Available", "WebGL2 available");
  if (params.get("webgl1Available")) add("webgl1Available", "WebGL1 available");
  if (params.get("webgpuFeature")) add("webgpuFeature", `WebGPU feature: ${params.get("webgpuFeature")}`);
  if (params.get("webgl2Ext")) add("webgl2Ext", `WebGL2 ext: ${params.get("webgl2Ext")}`);
  if (params.get("webgl1Ext")) add("webgl1Ext", `WebGL1 ext: ${params.get("webgl1Ext")}`);

  dom.activeFilters.innerHTML =
    chips.length > 0 ? chips.join("") : `<span class="text-[12px] text-muted">All reports</span>`;

  dom.activeFilters.querySelectorAll("button[data-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.clear;
      if (key === "browser") dom.browserFilter.value = "";
      else if (key === "os") dom.osFilter.value = "";
      else if (key === "country") dom.countryFilter.value = "";
      else if (key === "deviceType") dom.deviceFilter.value = "";
      else if (key === "cpuArch") dom.cpuFilter.value = "";
      else if (key === "appleSilicon") dom.fAppleSilicon.checked = false;
      else if (key === "webgpuAvailable") dom.fWebgpuAvailable.checked = false;
      else if (key === "webgl2Available") dom.fWebgl2Available.checked = false;
      else if (key === "webgl1Available") dom.fWebgl1Available.checked = false;
      else if (key === "webgpuFeature") dom.fWebgpuFeature.value = "";
      else if (key === "webgl2Ext") dom.fWebgl2Ext.value = "";
      else if (key === "webgl1Ext") dom.fWebgl1Ext.value = "";
      refresh();
    });
  });
}

function loadCompatState() {
  const raw = safeStorageGet(COMPAT_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveCompatState() {
  const state = {
    selection: Object.fromEntries(getSelectionParamsFromControls().entries()),
    matrix: {
      groupBy: dom.groupBy.value,
      usage: dom.usage.value,
      limit: dom.limit.value,
      minTested: dom.minTested.value,
      excludeUnknown: dom.excludeUnknown.checked ? "1" : "",
    },
  };
  safeStorageSet(COMPAT_STATE_KEY, JSON.stringify(state));
}

function applyControlsFromQuery(q) {
  if (!q) return;
  const params = q instanceof URLSearchParams ? q : new URLSearchParams(String(q));
  const get = (key) => (params.get(key) || "").trim();

  dom.browserFilter.value = get("browser");
  dom.osFilter.value = get("os");
  dom.countryFilter.value = get("country");
  dom.deviceFilter.value = get("deviceType");
  dom.cpuFilter.value = get("cpuArch");

  dom.fAppleSilicon.checked = truthy(get("appleSilicon"));
  dom.fWebgpuAvailable.checked = truthy(get("webgpuAvailable"));
  dom.fWebgl2Available.checked = truthy(get("webgl2Available"));
  dom.fWebgl1Available.checked = truthy(get("webgl1Available"));

  dom.fWebgpuFeature.value = get("webgpuFeature");
  dom.fWebgl2Ext.value = get("webgl2Ext");
  dom.fWebgl1Ext.value = get("webgl1Ext");

  dom.groupBy.value = get("groupBy") || dom.groupBy.value;
  dom.usage.value = get("usage") || dom.usage.value;
  dom.limit.value = get("limit") || dom.limit.value;
  dom.minTested.value = get("minTested") || dom.minTested.value;
  dom.excludeUnknown.checked = truthy(get("excludeUnknown"));
}

function applyControlsFromState(state) {
  if (!state || typeof state !== "object") return;

  const sel = state.selection || {};
  dom.browserFilter.value = String(sel.browser || "");
  dom.osFilter.value = String(sel.os || "");
  dom.countryFilter.value = String(sel.country || "");
  dom.deviceFilter.value = String(sel.deviceType || "");
  dom.cpuFilter.value = String(sel.cpuArch || "");

  dom.fAppleSilicon.checked = truthy(sel.appleSilicon);
  dom.fWebgpuAvailable.checked = truthy(sel.webgpuAvailable);
  dom.fWebgl2Available.checked = truthy(sel.webgl2Available);
  dom.fWebgl1Available.checked = truthy(sel.webgl1Available);

  dom.fWebgpuFeature.value = String(sel.webgpuFeature || "");
  dom.fWebgl2Ext.value = String(sel.webgl2Ext || "");
  dom.fWebgl1Ext.value = String(sel.webgl1Ext || "");

  const mx = state.matrix || {};
  if (mx.groupBy) dom.groupBy.value = String(mx.groupBy);
  if (mx.usage) dom.usage.value = String(mx.usage);
  if (mx.limit) dom.limit.value = String(mx.limit);
  if (mx.minTested != null) dom.minTested.value = String(mx.minTested);
  dom.excludeUnknown.checked = truthy(mx.excludeUnknown);
}

function cellClasses(p) {
  if (p >= 90) return "bg-good/10";
  if (p >= 50) return "bg-warn/10";
  if (p > 0) return "bg-bad/5";
  return "bg-bad/10";
}

function renderCell(cell, label) {
  const tested = Number(cell?.tested || 0);
  const supported = Number(cell?.supported || 0);
  if (!tested) return `<span class="text-muted">-</span>`;
  const p = pct(supported, tested);
  const title = `${label}: ${supported}/${tested} (${p}%)`;
  return `<span class="font-semibold" title="${escapeHtml(title)}">${p}%</span><span class="ml-2 text-[12px] text-muted">${supported}/${tested}</span>`;
}

function columnTitleLines(col, groupBy) {
  const dt = String(col?.deviceType || "").trim();
  const os = String(col?.os || "").trim();
  const br = String(col?.browser || "").trim();

  switch (groupBy) {
    case "os":
      return [os || "Unknown"];
    case "browser":
      return [br || "Unknown"];
    case "device_type":
      return [dt || "Unknown"];
    case "os_browser":
      return [os || "Unknown", br || "Unknown"];
    case "device":
    default:
      return [dt || "Unknown", os || "Unknown", br || "Unknown"];
  }
}

function renderMatrix(resp) {
  lastCompat = resp;
  dom.rawJson.textContent = stringifySafe(resp);
  renderActiveFilterChips();

  const matched = Number(resp?.selection?.matched || 0);
  const cols = Array.isArray(resp?.columns) ? resp.columns : [];
  const rows = Array.isArray(resp?.rows) ? resp.rows : [];
  const groupBy = String(resp?.options?.groupBy || dom.groupBy.value || "device");
  const usage = String(resp?.options?.usage || dom.usage.value || "any");

  const shown = cols.length;
  const testedSum = cols.reduce((acc, c) => acc + Number(c?.testedAny || 0), 0);
  dom.matrixSummary.textContent = `Matched ${matched} • Buckets ${shown} • Tested (any) ${testedSum} • GroupBy ${groupBy} • Usage ${usage}`;

  if (!dom.compatThead || !dom.compatTbody) return;

  if (!matched || rows.length === 0) {
    dom.compatThead.innerHTML = "";
    dom.compatTbody.innerHTML = `
      <tr class="border-b border-border/50">
        <td class="p-4 text-muted">No data for this segment.</td>
      </tr>
    `;
    dom.copyCsvBtn.disabled = true;
    return;
  }

  const headerCells = [
    `<th class="p-3 text-left text-[11px] uppercase tracking-wide text-muted sticky left-0 bg-black/40 backdrop-blur border-r border-border z-10">Texture family</th>`,
    `<th class="p-3 text-left text-[11px] uppercase tracking-wide text-muted border-r border-border">Overall</th>`,
  ];

  for (const col of cols) {
    const lines = columnTitleLines(col, groupBy)
      .map((l) => `<div class="leading-tight">${escapeHtml(l)}</div>`)
      .join("");
    const meta = `<div class="mt-1 text-[10px] text-muted">${Number(col?.testedAny || 0)}/${Number(col?.matched || 0)}</div>`;
    headerCells.push(
      `<th class="p-3 text-left text-[11px] uppercase tracking-wide text-muted whitespace-nowrap" title="${escapeHtml(col?.key || "")}">${lines}${meta}</th>`
    );
  }

  dom.compatThead.innerHTML = `<tr>${headerCells.join("")}</tr>`;

  dom.compatTbody.innerHTML = rows
    .map((row) => {
      const label = String(row?.label || row?.id || "");
      const desc = String(row?.description || "");
      const overallCell = row?.overall || { supported: 0, tested: 0 };
      const overallPct = pct(overallCell.supported, overallCell.tested);
      const overallClass = overallCell.tested ? cellClasses(overallPct) : "";

      const cells = [];
      cells.push(
        `<td class="p-3 sticky left-0 bg-[rgba(10,12,18,0.98)] backdrop-blur border-r border-border z-10">
          <div class="font-semibold text-[#cbd3e7]">${escapeHtml(label)}</div>
          ${desc ? `<div class="text-[12px] text-muted mt-0.5">${escapeHtml(desc)}</div>` : ""}
        </td>`
      );
      cells.push(
        `<td class="p-3 border-r border-border ${overallClass}">${renderCell(overallCell, `${label} (overall)`)}</td>`
      );

      const rowCells = Array.isArray(row?.cells) ? row.cells : [];
      for (let i = 0; i < cols.length; i += 1) {
        const c = rowCells[i] || { supported: 0, tested: 0 };
        const p = pct(c.supported, c.tested);
        const cls = c.tested ? cellClasses(p) : "";
        cells.push(`<td class="p-3 ${cls}">${renderCell(c, `${label} • ${cols[i]?.key || ""}`)}</td>`);
      }

      return `<tr class="border-b border-border/50 hover:bg-white/[0.02]">${cells.join("")}</tr>`;
    })
    .join("");

  dom.copyCsvBtn.disabled = false;
}

function toCsvValue(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

function buildCsv(resp) {
  const cols = Array.isArray(resp?.columns) ? resp.columns : [];
  const rows = Array.isArray(resp?.rows) ? resp.rows : [];
  const groupBy = String(resp?.options?.groupBy || "device");

  const header = ["Texture family", "Overall"].concat(cols.map((c) => columnTitleLines(c, groupBy).join(" • ")));
  const lines = [header.map(toCsvValue).join(",")];

  for (const r of rows) {
    const label = String(r?.label || r?.id || "");
    const overall = r?.overall || { supported: 0, tested: 0 };
    const overallText = overall.tested ? `${overall.supported}/${overall.tested} (${pct(overall.supported, overall.tested)}%)` : "-";

    const row = [label, overallText];
    const cells = Array.isArray(r?.cells) ? r.cells : [];
    for (let i = 0; i < cols.length; i += 1) {
      const c = cells[i] || { supported: 0, tested: 0 };
      row.push(c.tested ? `${c.supported}/${c.tested} (${pct(c.supported, c.tested)}%)` : "-");
    }
    lines.push(row.map(toCsvValue).join(","));
  }

  return lines.join("\n");
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function fetchCompat(params, signal) {
  const url = params && params.toString() ? `/api/compat?${params}` : "/api/compat";
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refresh({ syncUrl = true } = {}) {
  if (refreshAbort) refreshAbort.abort();
  refreshAbort = new AbortController();

  setStatus("accent", "Loading…");
  dom.refreshBtn.disabled = true;
  dom.refreshBtn.classList.add("opacity-70", "pointer-events-none");
  dom.copyCsvBtn.disabled = true;

  try {
    saveCompatState();
    if (syncUrl) syncUrlFromControls();
    const params = getCompatParamsFromControls();
    const resp = await fetchCompat(params, refreshAbort.signal);
    populateFilterOptionsFromResponse(resp);
    renderMatrix(resp);
    setStatus("good", "Updated");
  } catch (err) {
    if (String(err?.name) === "AbortError") return;
    console.error(err);
    setStatus("bad", "Error");
    showToast("error", "Failed to load compatibility", String(err?.message || err));
  } finally {
    dom.refreshBtn.disabled = false;
    dom.refreshBtn.classList.remove("opacity-70", "pointer-events-none");
  }
}

// ===== Event listeners =====
dom.refreshBtn.addEventListener("click", () => refresh());
dom.clearFiltersBtn.addEventListener("click", () => {
  clearSelectionControls();
  clearMatrixControls();
  refresh();
});
dom.copyCsvBtn.addEventListener("click", async () => {
  if (!lastCompat) return;
  const csv = buildCsv(lastCompat);
  const ok = await copyTextToClipboard(csv);
  showToast(ok ? "success" : "error", ok ? "Copied CSV" : "Copy failed", ok ? `${csv.split("\n").length - 1} row(s)` : "");
});

dom.browserFilter.addEventListener("change", () => refresh());
dom.osFilter.addEventListener("change", () => refresh());
dom.countryFilter.addEventListener("change", () => refresh());
dom.deviceFilter.addEventListener("change", () => refresh());
dom.cpuFilter.addEventListener("change", () => refresh());

dom.fWebgpuAvailable.addEventListener("change", () => refresh());
dom.fWebgl2Available.addEventListener("change", () => refresh());
dom.fWebgl1Available.addEventListener("change", () => refresh());
dom.fAppleSilicon.addEventListener("change", () => refresh());

dom.groupBy.addEventListener("change", () => refresh());
dom.usage.addEventListener("change", () => refresh());
dom.limit.addEventListener("change", () => refresh());
dom.excludeUnknown.addEventListener("change", () => refresh());

let textDebounce = null;
const queueRefresh = () => {
  if (textDebounce) clearTimeout(textDebounce);
  textDebounce = setTimeout(() => refresh(), 250);
};
dom.fWebgpuFeature.addEventListener("input", queueRefresh);
dom.fWebgl2Ext.addEventListener("input", queueRefresh);
dom.fWebgl1Ext.addEventListener("input", queueRefresh);
dom.minTested.addEventListener("input", queueRefresh);

// ===== Initial load =====
(async () => {
  setStatus("accent", "Loading…");

  const saved = loadCompatState();

  const qs = new URLSearchParams(window.location.search);
  const hasQuery = Array.from(qs.keys()).length > 0;
  if (hasQuery) {
    applyControlsFromQuery(qs);
  } else if (saved) {
    applyControlsFromState(saved);
  }

  // Populate select options from the full dataset (helps pivot without clearing).
  try {
    const baseParams = new URLSearchParams();
    baseParams.set("limit", "1");
    baseParams.set("minTested", "0");
    baseParams.set("groupBy", "device");
    baseParams.set("usage", "any");
    const base = await fetchCompat(baseParams, refreshAbort?.signal);
    populateFilterOptionsFromResponse(base);
  } catch {
    // ignore; refresh will surface issues
  }

  // Ensure options include any pre-selected values.
  setSelectOptions(dom.browserFilter, optionUniverse.browsers.concat([dom.browserFilter.value]), dom.browserFilter.value);
  setSelectOptions(dom.osFilter, optionUniverse.os.concat([dom.osFilter.value]), dom.osFilter.value);
  setSelectOptions(dom.countryFilter, optionUniverse.countries.concat([dom.countryFilter.value]), dom.countryFilter.value);
  setSelectOptions(dom.deviceFilter, optionUniverse.deviceTypes.concat([dom.deviceFilter.value]), dom.deviceFilter.value);
  setSelectOptions(dom.cpuFilter, optionUniverse.cpuArch.concat([dom.cpuFilter.value]), dom.cpuFilter.value);

  await refresh({ syncUrl: !hasQuery && saved != null });
})();

