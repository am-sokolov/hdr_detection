const dom = {
  refreshBtn: document.getElementById("refreshBtn"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  statsStatus: document.getElementById("statsStatus"),
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

  matchedCount: document.getElementById("matchedCount"),
  storedCount: document.getElementById("storedCount"),
  acceptedCount: document.getElementById("acceptedCount"),
  duplicateCount: document.getElementById("duplicateCount"),
  rateLimitedCount: document.getElementById("rateLimitedCount"),
  webgpuAvailableCount: document.getElementById("webgpuAvailableCount"),
  webgpuTestedCount: document.getElementById("webgpuTestedCount"),
  webglAvailability: document.getElementById("webglAvailability"),
  uptime: document.getElementById("uptime"),

  breakdownBrowsers: document.getElementById("breakdownBrowsers"),
  breakdownOS: document.getElementById("breakdownOS"),
  breakdownCountries: document.getElementById("breakdownCountries"),
  breakdownDevices: document.getElementById("breakdownDevices"),

  baselineCopyBtn: document.getElementById("baselineCopyBtn"),
  baselineUsage: document.getElementById("baselineUsage"),
  baselineThreshold: document.getElementById("baselineThreshold"),
  baselineThresholdValue: document.getElementById("baselineThresholdValue"),
  baselineCompressedOnly: document.getElementById("baselineCompressedOnly"),
  baselineHdrOnly: document.getElementById("baselineHdrOnly"),
  baselineColorOnly: document.getElementById("baselineColorOnly"),
  baselineDenominator: document.getElementById("baselineDenominator"),
  baselineResults: document.getElementById("baselineResults"),

  formatDenominator: document.getElementById("formatDenominator"),
  formatSearch: document.getElementById("formatSearch"),
  formatSort: document.getElementById("formatSort"),
  minSupport: document.getElementById("minSupport"),
  minSupportValue: document.getElementById("minSupportValue"),
  supportedOnly: document.getElementById("supportedOnly"),
  compressedOnly: document.getElementById("compressedOnly"),
  hdrOnly: document.getElementById("hdrOnly"),
  formatTableSummary: document.getElementById("formatTableSummary"),
  formatTableBody: document.getElementById("formatTableBody"),

  webgl2Summary: document.getElementById("webgl2Summary"),
  webgl1Summary: document.getElementById("webgl1Summary"),
  webgl2Json: document.getElementById("webgl2Json"),
  webgl1Json: document.getElementById("webgl1Json"),

  rawJson: document.getElementById("rawJson"),
  toastContainer: document.getElementById("toastContainer"),
};

/** @type {any} */
let lastStats = null;
/** @type {{browsers:string[], os:string[], countries:string[], deviceTypes:string[], cpuArch:string[]}} */
let optionUniverse = { browsers: [], os: [], countries: [], deviceTypes: [], cpuArch: [] };
let refreshAbort = null;

const STATS_STATE_KEY_V2 = "hdrDetection.statsState.v2";
const STATS_STATE_KEY_V1 = "hdrDetection.statsState.v1";

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

function safeStorageRemove(key) {
  try {
    if (!globalThis.localStorage) return false;
    localStorage.removeItem(key);
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

function formatUptime(seconds) {
  if (typeof seconds !== "number") return "-";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function formatCountAndPct(n, d) {
  const nn = Number(n || 0);
  const dd = Number(d || 0);
  if (!dd) return `${nn}`;
  return `${nn}/${dd} (${pct(nn, dd)}%)`;
}

function setStatus(state, text) {
  if (!dom.statsStatus) return;
  const base = "badge";
  const className =
    state === "good"
      ? `${base} badge--good`
      : state === "bad"
      ? `${base} badge--bad`
      : state === "warn"
      ? `${base} badge--warn`
      : `${base} badge--accent`;
  dom.statsStatus.className = className;
  dom.statsStatus.textContent = text;
}

// ===== Toasts =====
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

// ===== Filters (selection) =====
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

function populateFilterOptionsFromStats(stats) {
  const b = stats?.breakdown || {};
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

function applyControlsFromQuery(q) {
  if (!q) return;
  const params = q instanceof URLSearchParams ? q : new URLSearchParams(String(q));
  const get = (key) => (params.get(key) || "").trim();

  dom.browserFilter.value = get("browser");
  dom.osFilter.value = get("os");
  dom.countryFilter.value = get("country");
  dom.deviceFilter.value = get("deviceType");
  dom.cpuFilter.value = get("cpuArch");

  const truthy = (v) => ["1", "true", "t", "yes", "y", "on"].includes(String(v || "").toLowerCase());
  dom.fAppleSilicon.checked = truthy(get("appleSilicon"));
  dom.fWebgpuAvailable.checked = truthy(get("webgpuAvailable"));
  dom.fWebgl2Available.checked = truthy(get("webgl2Available"));
  dom.fWebgl1Available.checked = truthy(get("webgl1Available"));

  dom.fWebgpuFeature.value = get("webgpuFeature");
  dom.fWebgl2Ext.value = get("webgl2Ext");
  dom.fWebgl1Ext.value = get("webgl1Ext");
}

function syncUrlFromControls() {
  const params = getSelectionParamsFromControls();
  const next = params.toString();
  const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function setSelectionFilter(key, value) {
  const v = String(value || "").trim();
  if (key === "browser") dom.browserFilter.value = v;
  else if (key === "os") dom.osFilter.value = v;
  else if (key === "country") dom.countryFilter.value = v;
  else if (key === "deviceType") dom.deviceFilter.value = v;
  else if (key === "cpuArch") dom.cpuFilter.value = v;
}

function clearSelectionFilter(key) {
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
      clearSelectionFilter(key);
      refresh();
    });
  });
}

// ===== State =====
function captureStateFromControls() {
  return {
    v: 2,
    selection: {
      browser: dom.browserFilter?.value || "",
      os: dom.osFilter?.value || "",
      country: dom.countryFilter?.value || "",
      deviceType: dom.deviceFilter?.value || "",
      cpuArch: dom.cpuFilter?.value || "",
      appleSilicon: Boolean(dom.fAppleSilicon?.checked),
      webgpuAvailable: Boolean(dom.fWebgpuAvailable?.checked),
      webgl2Available: Boolean(dom.fWebgl2Available?.checked),
      webgl1Available: Boolean(dom.fWebgl1Available?.checked),
      webgpuFeature: dom.fWebgpuFeature?.value || "",
      webgl2Ext: dom.fWebgl2Ext?.value || "",
      webgl1Ext: dom.fWebgl1Ext?.value || "",
    },
    local: {
      format: {
        search: dom.formatSearch?.value || "",
        sort: dom.formatSort?.value || "any_desc",
        minSupport: Number(dom.minSupport?.value || 0),
        supportedOnly: Boolean(dom.supportedOnly?.checked),
        compressedOnly: Boolean(dom.compressedOnly?.checked),
        extendedOnly: Boolean(dom.hdrOnly?.checked),
      },
      baseline: {
        usage: dom.baselineUsage?.value || "any",
        threshold: Number(dom.baselineThreshold?.value || 95),
        compressedOnly: Boolean(dom.baselineCompressedOnly?.checked),
        hdrOnly: Boolean(dom.baselineHdrOnly?.checked),
        colorOnly: Boolean(dom.baselineColorOnly?.checked),
      },
    },
  };
}

function saveStatsState() {
  safeStorageSet(STATS_STATE_KEY_V2, JSON.stringify(captureStateFromControls()));
}

function loadStatsState() {
  const rawV2 = safeStorageGet(STATS_STATE_KEY_V2);
  if (rawV2) {
    try {
      const parsed = JSON.parse(rawV2);
      if (parsed && typeof parsed === "object" && parsed.v === 2) return parsed;
    } catch {
      // ignore
    }
  }

  // Migrate v1 → v2 best-effort.
  const rawV1 = safeStorageGet(STATS_STATE_KEY_V1);
  if (!rawV1) return null;
  try {
    const parsed = JSON.parse(rawV1);
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null;
    return {
      v: 2,
      selection: {
        browser: parsed.selection?.browser || "",
        os: parsed.selection?.os || "",
        country: parsed.selection?.country || "",
        deviceType: parsed.selection?.deviceType || "",
        cpuArch: parsed.selection?.cpuArch || "",
        appleSilicon: Boolean(parsed.selection?.appleSilicon),
        webgpuAvailable: Boolean(parsed.selection?.webgpuAvailable),
        webgl2Available: Boolean(parsed.selection?.webgl2Available),
        webgl1Available: Boolean(parsed.selection?.webgl1Available),
        webgpuFeature: parsed.selection?.webgpuFeature || "",
        webgl2Ext: parsed.selection?.webgl2Ext || "",
        webgl1Ext: parsed.selection?.webgl1Ext || "",
      },
      local: {
        format: {
          search: parsed.local?.search || "",
          sort: "any_desc",
          minSupport: 0,
          supportedOnly: Boolean(parsed.local?.supportedOnly),
          compressedOnly: Boolean(parsed.local?.compressedOnly),
          extendedOnly: Boolean(parsed.local?.hdrOnly),
        },
        baseline: {
          usage: "any",
          threshold: 95,
          compressedOnly: false,
          hdrOnly: false,
          colorOnly: false,
        },
      },
    };
  } catch {
    return null;
  }
}

function applyControlsFromState(state, { applySelection = true, applyLocal = true } = {}) {
  const sel = state?.selection && typeof state.selection === "object" ? state.selection : null;
  const local = state?.local && typeof state.local === "object" ? state.local : null;

  if (applySelection && sel) {
    dom.browserFilter.value = String(sel.browser || "");
    dom.osFilter.value = String(sel.os || "");
    dom.countryFilter.value = String(sel.country || "");
    dom.deviceFilter.value = String(sel.deviceType || "");
    dom.cpuFilter.value = String(sel.cpuArch || "");
    dom.fAppleSilicon.checked = Boolean(sel.appleSilicon);
    dom.fWebgpuAvailable.checked = Boolean(sel.webgpuAvailable);
    dom.fWebgl2Available.checked = Boolean(sel.webgl2Available);
    dom.fWebgl1Available.checked = Boolean(sel.webgl1Available);
    dom.fWebgpuFeature.value = String(sel.webgpuFeature || "");
    dom.fWebgl2Ext.value = String(sel.webgl2Ext || "");
    dom.fWebgl1Ext.value = String(sel.webgl1Ext || "");
  }

  if (applyLocal && local) {
    if (local.format && typeof local.format === "object") {
      dom.formatSearch.value = String(local.format.search || "");
      dom.formatSort.value = String(local.format.sort || "any_desc");
      dom.minSupport.value = String(Number(local.format.minSupport || 0));
      dom.supportedOnly.checked = Boolean(local.format.supportedOnly);
      dom.compressedOnly.checked = Boolean(local.format.compressedOnly);
      dom.hdrOnly.checked = Boolean(local.format.extendedOnly);
    }
    if (local.baseline && typeof local.baseline === "object") {
      dom.baselineUsage.value = String(local.baseline.usage || "any");
      dom.baselineThreshold.value = String(Number(local.baseline.threshold || 95));
      dom.baselineCompressedOnly.checked = Boolean(local.baseline.compressedOnly);
      dom.baselineHdrOnly.checked = Boolean(local.baseline.hdrOnly);
      dom.baselineColorOnly.checked = Boolean(local.baseline.colorOnly);
    }
  }
}

// ===== Rendering =====
function renderBreakdown(targetEl, items, matchedCount, filterKey) {
  if (!targetEl) return;
  const list = Array.isArray(items) ? items : [];
  const matched = Number(matchedCount || 0);

  if (list.length === 0) {
    targetEl.innerHTML = `<div class="text-[13px] text-muted">No data yet</div>`;
    return;
  }

  const maxCount = Math.max(...list.map((it) => Number(it.count || 0)), 0) || 1;
  const rows = list.slice(0, 8).map((it) => {
    const name = String(it.name || "");
    const count = Number(it.count || 0);
    const rel = Math.round((count / maxCount) * 100);
    const share = matched ? `${pct(count, matched)}%` : "-";
    return `
      <button type="button" class="text-left rounded-lg p-2 hover:bg-white/[0.03] transition-colors border border-transparent hover:border-border"
        data-filter-key="${escapeHtml(filterKey)}" data-filter-value="${escapeHtml(name)}">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] font-medium text-text-primary truncate">${escapeHtml(name || "Unknown")}</div>
            <div class="text-[12px] text-muted">${count} • ${share}</div>
          </div>
          <div class="w-32 shrink-0">
            <div class="bar"><div style="width:${rel}%"></div></div>
          </div>
        </div>
      </button>
    `;
  });

  targetEl.innerHTML = rows.join("");
  targetEl.querySelectorAll("button[data-filter-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.filterKey;
      const value = btn.dataset.filterValue;
      setSelectionFilter(key, value);
      refresh();
    });
  });
}

function renderOverview(stats) {
  const matched = Number(stats?.selection?.matched || 0);
  const totals = stats?.totals || {};

  dom.matchedCount.textContent = String(matched);
  dom.storedCount.textContent = String(totals.stored ?? "-");
  dom.acceptedCount.textContent = String(totals.accepted ?? "-");
  dom.duplicateCount.textContent = String(totals.duplicates ?? "-");
  dom.rateLimitedCount.textContent = String(totals.rateLimited ?? "-");
  dom.uptime.textContent = formatUptime(Number(stats?.uptimeSec || 0));

  const webgpuAvail = Number(stats?.webgpu?.availableCount || 0);
  const webgpuTested = Number(stats?.webgpu?.testedCount || 0);
  const webgl2Avail = Number(stats?.webgl?.webgl2?.availableCount || 0);
  const webgl1Avail = Number(stats?.webgl?.webgl1?.availableCount || 0);

  dom.webgpuAvailableCount.textContent = formatCountAndPct(webgpuAvail, matched);
  dom.webgpuTestedCount.textContent = formatCountAndPct(webgpuTested, matched);
  dom.webglAvailability.textContent = `${formatCountAndPct(webgl2Avail, matched)} • ${formatCountAndPct(webgl1Avail, matched)}`;
}

function renderBaseline(stats) {
  const denom = Number(stats?.webgpu?.testedCount || 0);
  const formats = Array.isArray(stats?.webgpu?.formats) ? stats.webgpu.formats : [];

  dom.baselineDenominator.textContent = String(denom);
  const usage = dom.baselineUsage?.value || "any";
  const threshold = Number(dom.baselineThreshold?.value || 95);
  dom.baselineThresholdValue.textContent = `${threshold}%`;

  if (!denom || formats.length === 0) {
    dom.baselineResults.innerHTML = `<span class="text-[13px] text-muted">No WebGPU format data yet for this segment.</span>`;
    dom.baselineCopyBtn.disabled = true;
    return;
  }

  const compressedOnly = Boolean(dom.baselineCompressedOnly?.checked);
  const hdrOnly = Boolean(dom.baselineHdrOnly?.checked);
  const colorOnly = Boolean(dom.baselineColorOnly?.checked);

  const supportField = usage === "sampled"
    ? "sampled"
    : usage === "filterable"
    ? "filterable"
    : usage === "renderable"
    ? "renderable"
    : usage === "storage"
    ? "storage"
    : "any";

  const passed = [];
  for (const f of formats) {
    if (!f || typeof f.format !== "string") continue;
    if (compressedOnly && !f.compressed) continue;
    if (hdrOnly && !f.hdr) continue;
    if (colorOnly && String(f.kind || "") !== "color") continue;
    const count = Number(f[supportField] || 0);
    const share = pct(count, denom);
    if (share < threshold) continue;
    passed.push({ format: f.format, pct: share });
  }
  passed.sort((a, b) => (b.pct - a.pct) || a.format.localeCompare(b.format));

  if (passed.length === 0) {
    dom.baselineResults.innerHTML = `<span class="text-[13px] text-muted">No formats meet this threshold.</span>`;
    dom.baselineCopyBtn.disabled = true;
    return;
  }

  dom.baselineCopyBtn.disabled = false;
  dom.baselineResults.innerHTML = passed
    .slice(0, 120)
    .map(
      (it) => `<span class="chip"><span><code class="font-mono text-[0.9em]">${escapeHtml(it.format)}</code> <span class="text-muted">(${it.pct}%)</span></span></span>`
    )
    .join("");
  dom.baselineCopyBtn.dataset.copyPayload = passed.map((it) => it.format).join("\n");
}

function formatSupportCell(count, denom) {
  const n = Number(count || 0);
  const d = Number(denom || 0);
  if (!d) return `<span class="text-muted">-</span>`;
  const p = pct(n, d);
  const good = n > 0;
  const badge = good ? "badge badge--good" : "badge badge--bad";
  return `<span class="${badge}">${p}%</span><span class="ml-2 text-[12px] text-muted">${n}/${d}</span>`;
}

function renderFormatExplorer(stats) {
  const denom = Number(stats?.webgpu?.testedCount || 0);
  const formats = Array.isArray(stats?.webgpu?.formats) ? stats.webgpu.formats : [];

  dom.formatDenominator.textContent = denom ? `${denom} report(s)` : "0";
  dom.minSupportValue.textContent = `${Number(dom.minSupport?.value || 0)}%`;

  if (!denom || formats.length === 0) {
    dom.formatTableSummary.textContent = "No WebGPU format data yet for this segment.";
    dom.formatTableBody.innerHTML = "";
    return;
  }

  const search = (dom.formatSearch?.value || "").trim().toLowerCase();
  const supportedOnly = Boolean(dom.supportedOnly?.checked);
  const compressedOnly = Boolean(dom.compressedOnly?.checked);
  const extendedOnly = Boolean(dom.hdrOnly?.checked);
  const minSupport = Number(dom.minSupport?.value || 0);
  const sortKey = dom.formatSort?.value || "any_desc";

  const filtered = [];
  for (const f of formats) {
    if (!f || typeof f.format !== "string") continue;
    const name = f.format;
    if (search && !name.toLowerCase().includes(search)) continue;
    if (supportedOnly && Number(f.any || 0) <= 0) continue;
    if (compressedOnly && !f.compressed) continue;
    if (extendedOnly && !f.hdr) continue;
    if (minSupport > 0 && pct(Number(f.any || 0), denom) < minSupport) continue;
    filtered.push(f);
  }

  const cmpNum = (a, b, field) => Number(a[field] || 0) - Number(b[field] || 0);
  filtered.sort((a, b) => {
    switch (sortKey) {
      case "any_asc":
        return cmpNum(a, b, "any") || a.format.localeCompare(b.format);
      case "name_asc":
        return a.format.localeCompare(b.format);
      case "name_desc":
        return b.format.localeCompare(a.format);
      case "sampled_desc":
        return cmpNum(b, a, "sampled") || cmpNum(b, a, "any") || a.format.localeCompare(b.format);
      case "renderable_desc":
        return cmpNum(b, a, "renderable") || cmpNum(b, a, "any") || a.format.localeCompare(b.format);
      case "storage_desc":
        return cmpNum(b, a, "storage") || cmpNum(b, a, "any") || a.format.localeCompare(b.format);
      case "any_desc":
      default:
        return cmpNum(b, a, "any") || a.format.localeCompare(b.format);
    }
  });

  const supportedCount = filtered.filter((f) => Number(f.any || 0) > 0).length;
  dom.formatTableSummary.textContent = `Showing ${filtered.length} format(s) (${supportedCount} supported)`;

	  dom.formatTableBody.innerHTML = filtered
	    .slice(0, 300)
	    .map((f) => {
	      const supported = Number(f.any || 0) > 0;
	      const rowClass = supported ? "bg-good/5" : "";
	      const kind = String(f.kind || "");
	      const hdrCount = Number(f.hdrCount || 0);
	      const hdrDenom = Number(f.tested || denom || 0);
	      const hdrBadge =
	        f.hdr
	          ? hdrDenom > 0 && hdrCount > 0 && hdrCount < hdrDenom
	            ? `<span class="badge badge--warn" title="HDR in ${hdrCount}/${hdrDenom} reports">HDR ${pct(hdrCount, hdrDenom)}%</span>`
	            : `<span class="badge badge--good">HDR</span>`
	          : "";
	      const typeBadges = [
	        kind ? `<span class="badge badge--accent">${escapeHtml(kind)}</span>` : "",
	        f.compressed ? `<span class="badge badge--warn">compressed</span>` : "",
	        hdrBadge,
	      ].filter(Boolean);
	      return `
	        <tr class="border-b border-border/50 hover:bg-white/[0.02] ${rowClass}">
	          <td class="p-3">
	            <code class="font-mono text-[0.9em] text-[#d7deff] bg-accent/10 px-1.5 py-0.5 rounded">${escapeHtml(f.format)}</code>
          </td>
          <td class="p-3 text-muted">${typeBadges.join(" ")}</td>
          <td class="p-3">${formatSupportCell(f.any, denom)}</td>
          <td class="p-3">${formatSupportCell(f.sampled, denom)}</td>
          <td class="p-3">${formatSupportCell(f.filterable, denom)}</td>
          <td class="p-3">${formatSupportCell(f.renderable, denom)}</td>
          <td class="p-3">${formatSupportCell(f.storage, denom)}</td>
        </tr>
      `;
    })
    .join("");
}

function topCounts(items, max = 6) {
  if (!Array.isArray(items) || items.length === 0) return "-";
  return items
    .slice(0, max)
    .map((it) => `${it.name} (${it.count})`)
    .join(", ");
}

function renderWebglSummary(ctxStats, matchedCount, targetEl) {
  if (!targetEl) return;
  const matched = Number(matchedCount || 0);
  if (!ctxStats) {
    targetEl.innerHTML = `<div class="text-[13px] text-muted">No data</div>`;
    return;
  }

  const available = Number(ctxStats.availableCount || 0);
  const availability = formatCountAndPct(available, matched);
  const tests = ctxStats.textureTests || {};
  const aniso = ctxStats.anisotropy || {};
  const limits = ctxStats.limits || {};

  const rows = [
    ["Available", availability],
    ["Top extensions", topCounts(ctxStats.extensions, 8)],
    ["Compressed formats", topCounts(ctxStats.compressedFormats, 8)],
    ["Float textures", formatCountAndPct(Number(tests.floatTexture || 0), available)],
    ["Half-float textures", formatCountAndPct(Number(tests.halfFloatTexture || 0), available)],
    ["Float renderable", formatCountAndPct(Number(tests.floatRenderable || 0), available)],
    ["Half-float renderable", formatCountAndPct(Number(tests.halfFloatRenderable || 0), available)],
    ["Anisotropy", formatCountAndPct(Number(aniso.supported || 0), available)],
    ["MAX_TEXTURE_SIZE", topCounts(limits.maxTextureSize, 4)],
  ].filter(([_k, v]) => v !== "-");

  targetEl.innerHTML = rows
    .map(
      ([k, v]) => `
      <div class="flex justify-between items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
        <span class="text-muted text-xs shrink-0">${escapeHtml(k)}</span>
        <span class="text-text-primary text-xs text-right font-medium break-all">${escapeHtml(String(v))}</span>
      </div>
    `
    )
    .join("");
}

function renderAll(stats) {
  lastStats = stats;

  dom.rawJson.textContent = stringifySafe(stats);
  dom.webgl2Json.textContent = stringifySafe(stats?.webgl?.webgl2 || null);
  dom.webgl1Json.textContent = stringifySafe(stats?.webgl?.webgl1 || null);

  renderActiveFilterChips();
  renderOverview(stats);

  const matched = Number(stats?.selection?.matched || 0);
  const b = stats?.breakdown || {};
  renderBreakdown(dom.breakdownBrowsers, b.browsers, matched, "browser");
  renderBreakdown(dom.breakdownOS, b.os, matched, "os");
  renderBreakdown(dom.breakdownCountries, b.countries, matched, "country");
  renderBreakdown(dom.breakdownDevices, b.deviceTypes, matched, "deviceType");

  renderBaseline(stats);
  renderFormatExplorer(stats);
  renderWebglSummary(stats?.webgl?.webgl2, matched, dom.webgl2Summary);
  renderWebglSummary(stats?.webgl?.webgl1, matched, dom.webgl1Summary);
}

// ===== Network =====
async function fetchStats(params, signal) {
  const url = params && params.toString() ? `/api/stats?${params}` : "/api/stats";
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

  try {
    saveStatsState();
    if (syncUrl) syncUrlFromControls();
    const params = getSelectionParamsFromControls();
    const stats = await fetchStats(params, refreshAbort.signal);
    renderAll(stats);
    setStatus("good", "Updated");
  } catch (err) {
    if (String(err?.name) === "AbortError") return;
    console.error(err);
    setStatus("bad", "Error");
    showToast("error", "Failed to load stats", String(err?.message || err));
  } finally {
    dom.refreshBtn.disabled = false;
    dom.refreshBtn.classList.remove("opacity-70", "pointer-events-none");
  }
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

// ===== Local-only updates =====
function updateLocalViews() {
  // Keep UI labels in sync even before the first stats load.
  dom.baselineThresholdValue.textContent = `${Number(dom.baselineThreshold?.value || 95)}%`;
  dom.minSupportValue.textContent = `${Number(dom.minSupport?.value || 0)}%`;

  if (lastStats) {
    renderBaseline(lastStats);
    renderFormatExplorer(lastStats);
  }
  saveStatsState();
}

// ===== Clipboard =====
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

// ===== Event listeners =====
dom.refreshBtn.addEventListener("click", () => refresh());
dom.clearFiltersBtn.addEventListener("click", () => {
  clearSelectionControls();
  refresh();
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

let textDebounce = null;
const queueRefresh = () => {
  if (textDebounce) clearTimeout(textDebounce);
  textDebounce = setTimeout(() => refresh(), 250);
};
dom.fWebgpuFeature.addEventListener("input", queueRefresh);
dom.fWebgl2Ext.addEventListener("input", queueRefresh);
dom.fWebgl1Ext.addEventListener("input", queueRefresh);

dom.baselineUsage.addEventListener("change", updateLocalViews);
dom.baselineThreshold.addEventListener("input", updateLocalViews);
dom.baselineCompressedOnly.addEventListener("change", updateLocalViews);
dom.baselineHdrOnly.addEventListener("change", updateLocalViews);
dom.baselineColorOnly.addEventListener("change", updateLocalViews);
dom.baselineCopyBtn.addEventListener("click", async () => {
  const payload = dom.baselineCopyBtn.dataset.copyPayload || "";
  if (!payload) return;
  const ok = await copyTextToClipboard(payload);
  showToast(ok ? "success" : "error", ok ? "Copied" : "Copy failed", ok ? `${payload.split("\n").length} format(s)` : "");
});

dom.formatSearch.addEventListener("input", updateLocalViews);
dom.formatSort.addEventListener("change", updateLocalViews);
dom.minSupport.addEventListener("input", updateLocalViews);
dom.supportedOnly.addEventListener("change", updateLocalViews);
dom.compressedOnly.addEventListener("change", updateLocalViews);
dom.hdrOnly.addEventListener("change", updateLocalViews);

// ===== Initial load =====
(async () => {
  setStatus("accent", "Loading…");

  const saved = loadStatsState();
  if (saved) applyControlsFromState(saved, { applySelection: false, applyLocal: true });

  // Populate select options from the full, unfiltered dataset.
  try {
    const base = await fetchStats(null);
    populateFilterOptionsFromStats(base);
  } catch {
    // Ignore; refresh() will show the error if it fails too.
  }

  const qs = new URLSearchParams(window.location.search);
  const selectionKeys = [
    "browser",
    "os",
    "country",
    "deviceType",
    "cpuArch",
    "appleSilicon",
    "webgpuAvailable",
    "webgl2Available",
    "webgl1Available",
    "webgpuFeature",
    "webgl2Ext",
    "webgl1Ext",
  ];
  const hasSelectionQuery = selectionKeys.some((k) => qs.has(k));

  if (hasSelectionQuery) {
    applyControlsFromQuery(qs);
  } else if (saved) {
    applyControlsFromState(saved, { applySelection: true, applyLocal: false });
  }

  // Ensure options include any pre-selected values.
  setSelectOptions(dom.browserFilter, optionUniverse.browsers.concat([dom.browserFilter.value]), dom.browserFilter.value);
  setSelectOptions(dom.osFilter, optionUniverse.os.concat([dom.osFilter.value]), dom.osFilter.value);
  setSelectOptions(dom.countryFilter, optionUniverse.countries.concat([dom.countryFilter.value]), dom.countryFilter.value);
  setSelectOptions(dom.deviceFilter, optionUniverse.deviceTypes.concat([dom.deviceFilter.value]), dom.deviceFilter.value);
  setSelectOptions(dom.cpuFilter, optionUniverse.cpuArch.concat([dom.cpuFilter.value]), dom.cpuFilter.value);

  updateLocalViews();
  await refresh({ syncUrl: !hasSelectionQuery && saved != null });
})();
