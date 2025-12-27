const dom = {
  runBtn: document.getElementById("runBtn"),
  copyBtn: document.getElementById("copyBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  runStatus: document.getElementById("runStatus"),
  progressSection: document.getElementById("progressSection"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  secureContextItem: document.getElementById("secureContextItem"),
  secureContext: document.getElementById("secureContext"),
  webgpuItem: document.getElementById("webgpuItem"),
  webgpuStatus: document.getElementById("webgpuStatus"),
  webgl2Item: document.getElementById("webgl2Item"),
  webgl2Status: document.getElementById("webgl2Status"),
  dynamicRangeItem: document.getElementById("dynamicRangeItem"),
  dynamicRange: document.getElementById("dynamicRange"),
  colorGamutItem: document.getElementById("colorGamutItem"),
  colorGamut: document.getElementById("colorGamut"),
  browserSummary: document.getElementById("browserSummary"),
  osSummary: document.getElementById("osSummary"),
  deviceSummary: document.getElementById("deviceSummary"),
  clientInfo: document.getElementById("clientInfo"),
  clientInfoStructured: document.getElementById("clientInfoStructured"),
  clientInfoDetails: document.getElementById("clientInfoDetails"),
  searchInput: document.getElementById("searchInput"),
  supportedOnly: document.getElementById("supportedOnly"),
  hdrOnly: document.getElementById("hdrOnly"),
  compressedOnly: document.getElementById("compressedOnly"),
  webgpuTbody: document.getElementById("webgpuTbody"),
  formatCount: document.getElementById("formatCount"),
  webgpuFeatures: document.getElementById("webgpuFeatures"),
  webgpuLimits: document.getElementById("webgpuLimits"),
  webgpuAdapterInfo: document.getElementById("webgpuAdapterInfo"),
  webgl2Info: document.getElementById("webgl2Info"),
  webgl2Structured: document.getElementById("webgl2Structured"),
  webgl1Info: document.getElementById("webgl1Info"),
  webgl1Structured: document.getElementById("webgl1Structured"),
  toastContainer: document.getElementById("toastContainer"),
};

/** @type {any} */
let lastReport = null;
/** @type {Array<any>} */
let lastWebgpuFormats = [];
/** @type {string} */
let currentSortKey = "";
/** @type {string} */
let currentSortDir = "asc";
/** @type {string} */
let detectedCountryCode = "";

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

// ===== Toast Notification System =====
function showToast(type, title, message, duration = 4000) {
  const toast = document.createElement("div");
  const baseClasses = "flex items-start gap-3 py-3.5 px-4 rounded-xl border backdrop-blur-lg shadow-card animate-toast-in";
  const typeClasses = type === "success"
    ? "bg-good/15 border-good/30 text-good"
    : "bg-bad/15 border-bad/30 text-bad";
  toast.className = `${baseClasses} ${typeClasses}`;

  const iconSvg = type === "success"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 shrink-0 mt-0.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

  toast.innerHTML = `
    ${iconSvg}
    <div class="flex flex-col gap-0.5">
      <div class="font-semibold text-sm">${escapeHtml(title)}</div>
      ${message ? `<div class="text-xs opacity-80">${escapeHtml(message)}</div>` : ""}
    </div>
  `;

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("animate-toast-in");
    toast.classList.add("animate-toast-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== Progress Bar =====
function setProgress(percent, text) {
  dom.progressBar.style.width = `${percent}%`;
  dom.progressBar.setAttribute("aria-valuenow", String(percent));
  dom.progressText.textContent = text;
}

function showProgress() {
  dom.progressSection.style.display = "block";
  setProgress(0, "Initializing...");
}

function hideProgress() {
  dom.progressSection.style.display = "none";
}

const WEBGPU_TEXTURE_FORMATS = [
  // 8-bit formats
  "r8unorm",
  "r8snorm",
  "r8uint",
  "r8sint",
  // 16-bit formats
  "r16uint",
  "r16sint",
  "r16float",
  "rg8unorm",
  "rg8snorm",
  "rg8uint",
  "rg8sint",
  // 32-bit formats
  "r32uint",
  "r32sint",
  "r32float",
  "rg16uint",
  "rg16sint",
  "rg16float",
  "rg32uint",
  "rg32sint",
  "rg32float",
  "rgba8unorm",
  "rgba8unorm-srgb",
  "rgba8snorm",
  "rgba8uint",
  "rgba8sint",
  "bgra8unorm",
  "bgra8unorm-srgb",
  // Packed / HDR-ish
  "rgb9e5ufloat",
  "rgb10a2uint",
  "rgb10a2unorm",
  "rg11b10ufloat",
  // 64/128-bit formats
  "rgba16uint",
  "rgba16sint",
  "rgba16float",
  "rgba32uint",
  "rgba32sint",
  "rgba32float",
  // Depth/stencil formats
  "stencil8",
  "depth16unorm",
  "depth24plus",
  "depth24plus-stencil8",
  "depth32float",
  "depth32float-stencil8",
  // BC compressed formats
  "bc1-rgba-unorm",
  "bc1-rgba-unorm-srgb",
  "bc2-rgba-unorm",
  "bc2-rgba-unorm-srgb",
  "bc3-rgba-unorm",
  "bc3-rgba-unorm-srgb",
  "bc4-r-unorm",
  "bc4-r-snorm",
  "bc5-rg-unorm",
  "bc5-rg-snorm",
  "bc6h-rgb-ufloat",
  "bc6h-rgb-float",
  "bc7-rgba-unorm",
  "bc7-rgba-unorm-srgb",
  // ETC2/EAC compressed formats
  "etc2-rgb8unorm",
  "etc2-rgb8unorm-srgb",
  "etc2-rgb8a1unorm",
  "etc2-rgb8a1unorm-srgb",
  "etc2-rgba8unorm",
  "etc2-rgba8unorm-srgb",
  "eac-r11unorm",
  "eac-r11snorm",
  "eac-rg11unorm",
  "eac-rg11snorm",
  // ASTC compressed formats
  "astc-4x4-unorm",
  "astc-4x4-unorm-srgb",
  "astc-5x4-unorm",
  "astc-5x4-unorm-srgb",
  "astc-5x5-unorm",
  "astc-5x5-unorm-srgb",
  "astc-6x5-unorm",
  "astc-6x5-unorm-srgb",
  "astc-6x6-unorm",
  "astc-6x6-unorm-srgb",
  "astc-8x5-unorm",
  "astc-8x5-unorm-srgb",
  "astc-8x6-unorm",
  "astc-8x6-unorm-srgb",
  "astc-8x8-unorm",
  "astc-8x8-unorm-srgb",
  "astc-10x5-unorm",
  "astc-10x5-unorm-srgb",
  "astc-10x6-unorm",
  "astc-10x6-unorm-srgb",
  "astc-10x8-unorm",
  "astc-10x8-unorm-srgb",
  "astc-10x10-unorm",
  "astc-10x10-unorm-srgb",
  "astc-12x10-unorm",
  "astc-12x10-unorm-srgb",
  "astc-12x12-unorm",
  "astc-12x12-unorm-srgb",
];

const WEBGL_COMPRESSED_ENUMS = new Map([
  // S3TC / DXT
  [0x83f0, "COMPRESSED_RGB_S3TC_DXT1_EXT"],
  [0x83f1, "COMPRESSED_RGBA_S3TC_DXT1_EXT"],
  [0x83f2, "COMPRESSED_RGBA_S3TC_DXT3_EXT"],
  [0x83f3, "COMPRESSED_RGBA_S3TC_DXT5_EXT"],
  // S3TC sRGB
  [0x8c4c, "COMPRESSED_SRGB_S3TC_DXT1_EXT"],
  [0x8c4d, "COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT"],
  [0x8c4e, "COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT"],
  [0x8c4f, "COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT"],
  // ETC1
  [0x8d64, "COMPRESSED_RGB_ETC1_WEBGL"],
  // ETC2/EAC (common subset)
  [0x9274, "COMPRESSED_R11_EAC"],
  [0x9275, "COMPRESSED_SIGNED_R11_EAC"],
  [0x9276, "COMPRESSED_RG11_EAC"],
  [0x9277, "COMPRESSED_SIGNED_RG11_EAC"],
  [0x9270, "COMPRESSED_RGB8_ETC2"],
  [0x9271, "COMPRESSED_SRGB8_ETC2"],
  [0x9272, "COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2"],
  [0x9273, "COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2"],
  [0x9278, "COMPRESSED_RGBA8_ETC2_EAC"],
  [0x9279, "COMPRESSED_SRGB8_ALPHA8_ETC2_EAC"],
  // BPTC
  [0x8e8c, "COMPRESSED_RGBA_BPTC_UNORM_EXT"],
  [0x8e8d, "COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT"],
  [0x8e8e, "COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT"],
  [0x8e8f, "COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT"],
  // RGTC
  [0x8dbb, "COMPRESSED_RED_RGTC1_EXT"],
  [0x8dbc, "COMPRESSED_SIGNED_RED_RGTC1_EXT"],
  [0x8dbd, "COMPRESSED_RED_GREEN_RGTC2_EXT"],
  [0x8dbe, "COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT"],
  // ASTC
  [0x93b0, "COMPRESSED_RGBA_ASTC_4x4_KHR"],
  [0x93b1, "COMPRESSED_RGBA_ASTC_5x4_KHR"],
  [0x93b2, "COMPRESSED_RGBA_ASTC_5x5_KHR"],
  [0x93b3, "COMPRESSED_RGBA_ASTC_6x5_KHR"],
  [0x93b4, "COMPRESSED_RGBA_ASTC_6x6_KHR"],
  [0x93b5, "COMPRESSED_RGBA_ASTC_8x5_KHR"],
  [0x93b6, "COMPRESSED_RGBA_ASTC_8x6_KHR"],
  [0x93b7, "COMPRESSED_RGBA_ASTC_8x8_KHR"],
  [0x93b8, "COMPRESSED_RGBA_ASTC_10x5_KHR"],
  [0x93b9, "COMPRESSED_RGBA_ASTC_10x6_KHR"],
  [0x93ba, "COMPRESSED_RGBA_ASTC_10x8_KHR"],
  [0x93bb, "COMPRESSED_RGBA_ASTC_10x10_KHR"],
  [0x93bc, "COMPRESSED_RGBA_ASTC_12x10_KHR"],
  [0x93bd, "COMPRESSED_RGBA_ASTC_12x12_KHR"],
  [0x93d0, "COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR"],
  [0x93d1, "COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR"],
  [0x93d2, "COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR"],
  [0x93d3, "COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR"],
  [0x93d4, "COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR"],
  [0x93d5, "COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR"],
  [0x93d6, "COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR"],
  [0x93d7, "COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR"],
  [0x93d8, "COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR"],
  [0x93d9, "COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR"],
  [0x93da, "COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR"],
  [0x93db, "COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR"],
  [0x93dc, "COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR"],
  [0x93dd, "COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR"],
]);

function mediaMatchText(query) {
  try {
    return window.matchMedia(query).matches ? "yes" : "no";
  } catch {
    return "n/a";
  }
}

async function detectHdrVideoDecoding() {
  const mc = navigator.mediaCapabilities;
  if (!mc || typeof mc.decodingInfo !== "function") {
    return { available: false, supported: false, best: null, error: null };
  }

  const withTimeout = (promise, timeoutMs) => {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  /** @type {Array<{key:string, contentType:string, transferFunction:string, colorGamut:string, hdrMetadataType:string}>} */
  const variants = [
    {
      key: "vp9-pq",
      contentType: 'video/webm; codecs="vp09.02.10.10"',
      transferFunction: "pq",
      colorGamut: "rec2020",
      hdrMetadataType: "smpteSt2086",
    },
    {
      key: "av1-pq",
      contentType: 'video/mp4; codecs="av01.0.10M.10"',
      transferFunction: "pq",
      colorGamut: "rec2020",
      hdrMetadataType: "smpteSt2086",
    },
    {
      key: "hevc-pq",
      contentType: 'video/mp4; codecs="hvc1.2.4.L150.B0"',
      transferFunction: "pq",
      colorGamut: "rec2020",
      hdrMetadataType: "smpteSt2086",
    },
  ];

  const results = await Promise.all(
    variants.map(async (v) => {
      const cfg = {
        type: "file",
        video: {
          contentType: v.contentType,
          width: 3840,
          height: 2160,
          bitrate: 20000000,
          framerate: 30,
          transferFunction: v.transferFunction,
          colorGamut: v.colorGamut,
          hdrMetadataType: v.hdrMetadataType,
        },
      };

      try {
        const info = await withTimeout(mc.decodingInfo(cfg), 1200);
        return {
          key: v.key,
          supported: Boolean(info?.supported),
          smooth: Boolean(info?.smooth),
          powerEfficient: Boolean(info?.powerEfficient),
        };
      } catch (err) {
        return { key: v.key, supported: false, error: String(err) };
      }
    })
  );

  const best = results.find((r) => r.supported) || null;
  return {
    available: true,
    supported: Boolean(best),
    best: best ? { key: best.key, smooth: Boolean(best.smooth), powerEfficient: Boolean(best.powerEfficient) } : null,
    results,
    error: null,
  };
}

function setStatusChip(el, state, text) {
  const span = document.createElement("span");
  const baseClasses = "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 border text-xs font-medium tabular-nums transition-all";
  const stateClasses = state === "good"
    ? "border-good/40 text-good bg-good/15"
    : state === "bad"
    ? "border-bad/40 text-bad bg-bad/15"
    : state === "warn"
    ? "border-warn/45 text-warn bg-warn/15"
    : "border-accent/40 text-accent bg-accent/10";
  span.className = `${baseClasses} ${stateClasses}`;
  span.textContent = text;
  el.replaceChildren(span);
}

function setStatusItemState(itemEl, state) {
  // Remove state classes (these are handled via inner badge now, but keep for compatibility)
  itemEl.classList.remove("border-good/30", "border-bad/30", "border-warn/30");
  if (state === "good") {
    itemEl.classList.add("border-good/30");
  } else if (state === "bad") {
    itemEl.classList.add("border-bad/30");
  } else if (state === "warn") {
    itemEl.classList.add("border-warn/30");
  }
}

function stringifySafe(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function fnv1aHex(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function sha256Hex(input) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const data = new TextEncoder().encode(input);
    const buf = await subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  } catch {
    return null;
  }
}

function normalizePlatformVersion(version) {
  if (!version) return null;
  const s = String(version).trim().replace(/_/g, ".");
  if (!s) return null;
  const parts = s.split(".").filter(Boolean);
  if (parts.length === 0) return null;
  // Keep major.minor[.patch] without trying to "fix" it. Different browsers
  // already round/truncate this value for privacy; keep what we got.
  return parts.slice(0, 3).join(".");
}

function parseOSFromUA(userAgent, platformHint, platformVersionHint) {
  const ua = userAgent || "";
  const platform = (platformHint || "").toLowerCase();
  const platformVersion = normalizePlatformVersion(platformVersionHint);
  const uaWindows = parseWindowsVersionFromUA(ua);
  const uaMac = parseMacOSVersionFromUA(ua);
  const uaAndroid = parseAndroidVersionFromUA(ua);
  const uaIOS = parseIOSVersionFromUA(ua);

  // Client Hints platform names: "Windows", "macOS", "Android", "iOS", "Linux", "Chrome OS"
  if (platform.includes("windows")) {
    // UA often collapses Win10/Win11 into "Windows NT 10.0"; prefer UA-CH when available.
    return {
      name: "Windows",
      version: platformVersion || uaWindows,
      source: platformVersion ? "uaData.platformVersion" : uaWindows ? "userAgent" : "unknown",
      uaVersion: uaWindows,
      platformVersion,
    };
  }
  if (platform.includes("mac")) {
    // Modern browsers may freeze macOS UA to "10.15.7" even on newer versions.
    // Treat that value as "unknown" unless we have UA-CH platformVersion.
    const isFrozenUA = !platformVersion && uaMac === "10.15.7";
    return {
      name: "macOS",
      version: isFrozenUA ? null : (platformVersion || uaMac),
      source: platformVersion ? "uaData.platformVersion" : isFrozenUA ? "userAgentFrozen" : uaMac ? "userAgent" : "unknown",
      uaVersion: uaMac,
      platformVersion,
      note: isFrozenUA ? "UA often frozen at 10.15.7 on modern macOS; version hidden by browser." : null,
    };
  }
  if (platform.includes("android")) return { name: "Android", version: platformVersion || uaAndroid, source: platformVersion ? "uaData.platformVersion" : "userAgent" };
  if (platform.includes("ios")) return { name: "iOS/iPadOS", version: platformVersion || uaIOS, source: platformVersion ? "uaData.platformVersion" : "userAgent" };
  if (platform.includes("cros") || platform.includes("chrome os")) return { name: "ChromeOS", version: platformVersion || null, source: platformVersion ? "uaData.platformVersion" : "unknown" };
  if (platform.includes("linux")) return { name: "Linux", version: null, source: "unknown" };

  if (/Windows NT/i.test(ua)) return { name: "Windows", version: uaWindows, source: "userAgent" };
  if (/Android/i.test(ua)) return { name: "Android", version: uaAndroid, source: "userAgent" };
  if (/(iPhone|iPad|iPod)/i.test(ua)) return { name: "iOS/iPadOS", version: uaIOS, source: "userAgent" };
  if (/Mac OS X/i.test(ua)) {
    const isFrozenUA = !platformVersion && uaMac === "10.15.7";
    return { name: "macOS", version: isFrozenUA ? null : (platformVersion || uaMac), source: platformVersion ? "uaData.platformVersion" : isFrozenUA ? "userAgentFrozen" : "userAgent", uaVersion: uaMac, platformVersion, note: isFrozenUA ? "UA often frozen at 10.15.7 on modern macOS; version hidden by browser." : null };
  }
  if (/CrOS/i.test(ua)) return { name: "ChromeOS", version: null, source: "unknown" };
  if (/Linux/i.test(ua)) return { name: "Linux", version: null, source: "unknown" };
  return { name: "Unknown", version: null, source: "unknown" };
}

function parseWindowsVersionFromUA(ua) {
  const m = /Windows NT ([0-9.]+)/i.exec(ua);
  if (!m) return null;
  const v = m[1];
  if (v === "10.0") return "10/11";
  if (v === "6.3") return "8.1";
  if (v === "6.2") return "8";
  if (v === "6.1") return "7";
  return v;
}

function parseMacOSVersionFromUA(ua) {
  const m = /Mac OS X ([0-9_]+)/i.exec(ua);
  return m ? m[1].replace(/_/g, ".") : null;
}

function parseAndroidVersionFromUA(ua) {
  const m = /Android ([0-9.]+)/i.exec(ua);
  return m ? m[1] : null;
}

function parseIOSVersionFromUA(ua) {
  const m = /OS ([0-9_]+) like Mac OS X/i.exec(ua);
  return m ? m[1].replace(/_/g, ".") : null;
}

function normalizeArchitecture(rawArchitecture, rawBitness) {
  if (!rawArchitecture) return null;
  const arch = String(rawArchitecture).trim().toLowerCase();
  const bitness = rawBitness != null ? String(rawBitness).trim() : "";

  if (arch === "arm") return bitness === "64" ? "arm64" : "arm";
  if (arch === "aarch64") return "arm64";
  if (arch === "x86") return bitness === "64" ? "x86_64" : "x86";
  if (arch === "x64") return "x86_64";
  if (arch === "amd64") return "x86_64";
  return rawArchitecture;
}

function architectureFromUA(userAgent) {
  const ua = userAgent || "";
  if (/\b(arm64|aarch64)\b/i.test(ua)) return "arm64";
  if (/\b(x86_64|amd64|x64|win64)\b/i.test(ua)) return "x86_64";
  if (/\b(i686|i386|x86)\b/i.test(ua)) return "x86";
  return null;
}

function detectCpuInfo(userAgent, os, uaData) {
  const high = uaData?.highEntropy || null;
  const rawArch = high?.architecture || null;
  const rawBitness = high?.bitness || null;

  let architecture = normalizeArchitecture(rawArch, rawBitness);
  if (!architecture) {
    const uaArch = architectureFromUA(userAgent);
    // Avoid misleading "Intel" macOS UA strings; only accept UA-derived arch for macOS when it's explicitly ARM.
    if (uaArch && (os?.name !== "macOS" || uaArch === "arm64")) {
      architecture = uaArch;
    }
  }

  let isAppleSilicon = null;
  if (os?.name === "macOS") {
    if (architecture && architecture.startsWith("arm")) isAppleSilicon = true;
    if (architecture && architecture.startsWith("x86")) isAppleSilicon = false;
  }

  return {
    architecture,
    bitness: rawBitness != null ? String(rawBitness) : null,
    wow64: typeof high?.wow64 === "boolean" ? high.wow64 : null,
    source: rawArch ? "uaData" : architecture ? "userAgent" : "unknown",
    isAppleSilicon,
  };
}

function cpuLabel(osName, cpu) {
  if (!cpu) return null;
  const arch = cpu.architecture || null;
  if (osName === "macOS") {
    if (cpu.isAppleSilicon === true) {
      if (arch && arch.startsWith("x86")) return `Apple Silicon (Rosetta ${arch})`;
      return arch ? `Apple Silicon (${arch})` : "Apple Silicon";
    }
    if (cpu.isAppleSilicon === false) return arch ? `Intel (${arch})` : "Intel";
  }
  return arch;
}

function osVersionLabel(os) {
  if (!os) return "-";
  const name = os.name || "";
  const version = os.version || "";
  if (!version) {
    if (name === "macOS" && os.source === "userAgentFrozen") return "hidden (UA frozen)";
    return "-";
  }
  return version;
}

function parseBrowserFromUA(userAgent, uaData) {
  const ua = userAgent || "";

  // Prefer UA-CH fullVersionList when available.
  const fullVersionList = uaData?.highEntropy?.fullVersionList || uaData?.lowEntropy?.brands || null;
  if (Array.isArray(fullVersionList) && fullVersionList.length) {
    const prefer = [
      "Google Chrome",
      "Microsoft Edge",
      "Brave",
      "Opera",
      "Vivaldi",
      "Chromium",
    ];
    const candidates = fullVersionList.filter((b) => b?.brand && b.brand !== "Not A Brand");
    let chosen = null;
    for (const p of prefer) {
      chosen = candidates.find((c) => c.brand === p);
      if (chosen) break;
    }
    if (!chosen) chosen = candidates[0] || null;
    if (chosen) return { name: chosen.brand, version: chosen.version || null, source: "uaData" };
  }

  // iOS browsers often identify via special tokens.
  const iosChrome = /CriOS\/([0-9.]+)/.exec(ua);
  if (iosChrome) return { name: "Chrome (iOS)", version: iosChrome[1], source: "userAgent" };
  const iosFirefox = /FxiOS\/([0-9.]+)/.exec(ua);
  if (iosFirefox) return { name: "Firefox (iOS)", version: iosFirefox[1], source: "userAgent" };
  const iosEdge = /EdgiOS\/([0-9.]+)/.exec(ua);
  if (iosEdge) return { name: "Edge (iOS)", version: iosEdge[1], source: "userAgent" };

  const edge = /Edg\/([0-9.]+)/.exec(ua);
  if (edge) return { name: "Microsoft Edge", version: edge[1], source: "userAgent" };
  const chrome = /Chrome\/([0-9.]+)/.exec(ua);
  if (chrome) return { name: "Google Chrome", version: chrome[1], source: "userAgent" };
  const firefox = /Firefox\/([0-9.]+)/.exec(ua);
  if (firefox) return { name: "Firefox", version: firefox[1], source: "userAgent" };

  const safari = /Version\/([0-9.]+).*Safari\//.exec(ua);
  if (safari && !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR\//.test(ua)) {
    return { name: "Safari", version: safari[1], source: "userAgent" };
  }

  return { name: "Unknown", version: null, source: "unknown" };
}

function detectDeviceType(userAgent, uaData, signals) {
  const ua = userAgent || "";
  const model = uaData?.highEntropy?.model || null;
  const mobileHint = uaData?.lowEntropy?.mobile;

  const isIPad = /\biPad\b/i.test(ua);
  const isIPhone = /\biPhone\b/i.test(ua);
  const isAndroid = /\bAndroid\b/i.test(ua);
  const isTabletUA = /\bTablet\b/i.test(ua) || isIPad;

  const coarsePointer = signals?.pointerCoarse === true;
  const likelyTouch = (signals?.maxTouchPoints || 0) > 0 || coarsePointer;

  if (isTabletUA) return { type: "tablet", model, source: "userAgent" };
  if (isIPhone) return { type: "mobile", model: model || "iPhone", source: "userAgent" };
  if (isAndroid && /\bMobile\b/i.test(ua)) return { type: "mobile", model, source: "userAgent" };
  if (isAndroid) return { type: "tablet", model, source: "userAgent" };

  if (mobileHint === true) return { type: "mobile", model, source: "uaData" };
  if (likelyTouch && (signals?.screenSmall === true)) return { type: "mobile", model, source: "signals" };
  if (likelyTouch) return { type: "tablet", model, source: "signals" };
  return { type: "desktop", model, source: "signals" };
}

function detectEngine(userAgent) {
  const ua = userAgent || "";
  if (/Gecko\/\d/i.test(ua) && /Firefox\//i.test(ua)) return { name: "Gecko", source: "userAgent" };
  if (/AppleWebKit\//i.test(ua)) return { name: "WebKit/Blink", source: "userAgent" };
  return { name: "Unknown", source: "unknown" };
}

async function detectClientInfo() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const vendor = navigator.vendor || "";

  const lowEntropy = navigator.userAgentData
    ? {
        brands: navigator.userAgentData.brands || null,
        mobile: navigator.userAgentData.mobile,
        platform: navigator.userAgentData.platform,
      }
    : null;

  let highEntropy = null;
  let uaDataError = null;
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      highEntropy = await navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
        "model",
        "platformVersion",
        "uaFullVersion",
        "fullVersionList",
        "wow64",
      ]);
    } catch (err) {
      uaDataError = String(err);
      try {
        highEntropy = await navigator.userAgentData.getHighEntropyValues(["platformVersion", "fullVersionList"]);
      } catch (err2) {
        uaDataError = `${uaDataError}; ${String(err2)}`;
      }
    }
  }

  const deviceMemory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : null;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;
  const maxTouchPoints = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : null;

  const jsHeapSizeLimitBytes = (() => {
    const mem = globalThis.performance && performance.memory ? performance.memory : null;
    const raw = mem?.jsHeapSizeLimit;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  })();

  const pointerCoarse = mediaMatchText("(pointer: coarse)") === "yes";
  const hoverNone = mediaMatchText("(hover: none)") === "yes";
  const screenSmall = typeof screen?.width === "number" ? Math.min(screen.width, screen.height) <= 820 : null;

  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  })();

  const signals = {
    deviceMemory,
    hardwareConcurrency,
    maxTouchPoints,
    pointerCoarse,
    hoverNone,
    screenSmall: screenSmall === true,
  };

  const uaData = {
    available: Boolean(navigator.userAgentData),
    lowEntropy,
    highEntropy,
    error: uaDataError,
  };

  const browser = parseBrowserFromUA(userAgent, uaData);
  const os = parseOSFromUA(userAgent, lowEntropy?.platform || platform, highEntropy?.platformVersion || null);
  const device = detectDeviceType(userAgent, uaData, signals);
  const engine = detectEngine(userAgent);
  const cpu = detectCpuInfo(userAgent, os, uaData);

  const platformInfo = {
    summary: (() => {
      const osPart = os?.name ? `${os.name}${os.version ? ` ${os.version}` : ""}` : "Unknown";
      const cpuPart = cpuLabel(os?.name, cpu);
      return cpuPart ? `${osPart} • ${cpuPart}` : osPart;
    })(),
    raw: {
      navigatorPlatform: platform || null,
      uaDataPlatform: lowEntropy?.platform || null,
      uaDataPlatformVersion: highEntropy?.platformVersion || null,
    },
    cpu,
  };

  const fingerprintInput = JSON.stringify({
    browser: { name: browser.name, version: browser.version },
    os: os
      ? {
          name: os.name || null,
          version: os.version || null,
          source: os.source || null,
          uaVersion: os.uaVersion || null,
          platformVersion: os.platformVersion || null,
        }
      : null,
    device: { type: device.type, model: device.model },
    cpu: { architecture: cpu.architecture, bitness: cpu.bitness },
    hw: { deviceMemory, hardwareConcurrency, maxTouchPoints },
    screen: {
      width: screen?.width || null,
      height: screen?.height || null,
      devicePixelRatio: window.devicePixelRatio || null,
    },
  });

  const sha256 = await sha256Hex(fingerprintInput);
  const fnv1a = fnv1aHex(fingerprintInput);

  const dynamicRangeHigh = mediaMatchText("(dynamic-range: high)") === "yes";
  const videoDynamicRangeHigh = mediaMatchText("(video-dynamic-range: high)") === "yes";
  const colorGamutRec2020 = mediaMatchText("(color-gamut: rec2020)") === "yes";
  const colorGamutP3 = mediaMatchText("(color-gamut: p3)") === "yes";
  const colorGamutSRGB = mediaMatchText("(color-gamut: srgb)") === "yes";

  const hdrVideoDecoding = await detectHdrVideoDecoding();
  const wideGamut = colorGamutRec2020 || colorGamutP3;
  const deepColor = typeof screen?.colorDepth === "number" && screen.colorDepth >= 30;
  const hdrCapable =
    dynamicRangeHigh ||
    videoDynamicRangeHigh ||
    hdrVideoDecoding.supported ||
    (deepColor && wideGamut);
  const hdrSource = dynamicRangeHigh
    ? "dynamic-range"
    : videoDynamicRangeHigh
    ? "video-dynamic-range"
    : hdrVideoDecoding.supported
    ? `mediaCapabilities:${hdrVideoDecoding.best?.key || "hdr"}`
    : deepColor && wideGamut
    ? "colorDepth+gamut"
    : "";

  return {
    ua: {
      userAgent,
      platform,
      vendor,
      language: navigator.language || null,
      languages: navigator.languages || null,
      cookieEnabled: navigator.cookieEnabled ?? null,
      doNotTrack: navigator.doNotTrack ?? null,
    },
    uaData,
    parsed: { browser, os, device, engine },
    platform: platformInfo,
    cpu,
    hardware: {
      deviceMemory,
      deviceMemoryNote:
        typeof deviceMemory === "number"
          ? "Approximate GB (privacy-rounded; often capped/rounded in browsers)."
          : "Not available in this browser.",
      hardwareConcurrency,
      hardwareConcurrencyNote:
        typeof hardwareConcurrency === "number"
          ? "Reported logical cores (may be capped/rounded by privacy protections)."
          : "Not available in this browser.",
      jsHeapSizeLimitBytes,
      jsHeapSizeLimitNote:
        typeof jsHeapSizeLimitBytes === "number"
          ? "Non-standard (Chromium): JS heap size limit, not device RAM."
          : "Not available in this browser.",
      maxTouchPoints,
    },
    display: {
      screen: {
        width: screen?.width ?? null,
        height: screen?.height ?? null,
        availWidth: screen?.availWidth ?? null,
        availHeight: screen?.availHeight ?? null,
        colorDepth: screen?.colorDepth ?? null,
        pixelDepth: screen?.pixelDepth ?? null,
      },
      devicePixelRatio: window.devicePixelRatio ?? null,
      dynamicRangeHigh,
      videoDynamicRangeHigh,
      hdrCapable,
      hdrSource,
      hdrVideoDecoding,
      colorGamutRec2020,
      colorGamutP3,
      colorGamutSRGB,
    },
    input: { pointerCoarse, hoverNone },
    time: { timeZone, offsetMinutes: new Date().getTimezoneOffset() },
    fingerprint: { sha256, fnv1a },
  };
}

function guessAppleSiliconFromGpuHints(webgpu, webgl2, webgl1) {
  /** @type {string[]} */
  const hints = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) hints.push(v.trim());
  };

  // WebGPU adapter info (often includes Apple GPU model names on macOS).
  push(webgpu?.adapterInfo?.description);
  push(webgpu?.adapterInfo?.architecture);
  push(webgpu?.adapterInfo?.device);
  push(webgpu?.adapterInfo?.vendor);

  // WebGL renderer strings.
  push(webgl2?.debugInfo?.UNMASKED_RENDERER_WEBGL);
  push(webgl2?.basic?.renderer);
  push(webgl1?.debugInfo?.UNMASKED_RENDERER_WEBGL);
  push(webgl1?.basic?.renderer);

  const combined = hints.join(" | ");
  const lower = combined.toLowerCase();

  const looksLikeAppleSilicon =
    /\bapple\s*m\d\b/.test(lower) ||
    /\bapple\s*m\d\s*(pro|max|ultra)?\b/.test(lower) ||
    /\bapple\s*gpu\b/.test(lower) ||
    /\bagx\b/.test(lower);

  return { looksLikeAppleSilicon, evidence: combined || null };
}

function refreshPlatformSummary(client) {
  if (!client?.platform) return;
  const os = client.parsed?.os || null;
  const cpu = client.cpu || client.platform.cpu || null;
  const osPart = os?.name ? `${os.name}${os.version ? ` ${os.version}` : ""}` : "Unknown";
  const cpuPart = cpuLabel(os?.name, cpu);
  client.platform.summary = cpuPart ? `${osPart} • ${cpuPart}` : osPart;
}

async function recomputeClientFingerprint(client) {
  if (!client?.parsed) return;
  const fingerprintInput = JSON.stringify({
    browser: { name: client.parsed?.browser?.name, version: client.parsed?.browser?.version },
    os: client.parsed?.os
      ? {
          name: client.parsed.os.name || null,
          version: client.parsed.os.version || null,
          source: client.parsed.os.source || null,
          uaVersion: client.parsed.os.uaVersion || null,
          platformVersion: client.parsed.os.platformVersion || null,
        }
      : null,
    device: { type: client.parsed?.device?.type, model: client.parsed?.device?.model },
    cpu: { architecture: client.cpu?.architecture || null, bitness: client.cpu?.bitness || null },
    hw: {
      deviceMemory: client.hardware?.deviceMemory ?? null,
      hardwareConcurrency: client.hardware?.hardwareConcurrency ?? null,
      maxTouchPoints: client.hardware?.maxTouchPoints ?? null,
    },
    screen: {
      width: client.display?.screen?.width ?? null,
      height: client.display?.screen?.height ?? null,
      devicePixelRatio: client.display?.devicePixelRatio ?? null,
    },
  });

  client.fingerprint = client.fingerprint || {};
  client.fingerprint.sha256 = await sha256Hex(fingerprintInput);
  client.fingerprint.fnv1a = fnv1aHex(fingerprintInput);
}

function augmentClientFromGpuHints(client, webgpu, webgl2, webgl1) {
  if (!client?.parsed?.os || client.parsed.os.name !== "macOS") return;

  const guess = guessAppleSiliconFromGpuHints(webgpu, webgl2, webgl1);
  if (!guess.looksLikeAppleSilicon) return;

  client.cpu = client.cpu || {};

  if (client.cpu.isAppleSilicon !== true) {
    client.cpu.isAppleSilicon = true;
  }
  if (!client.cpu.architecture) {
    client.cpu.architecture = "arm64";
  }
  if (!client.cpu.source || client.cpu.source === "unknown") {
    client.cpu.source = "gpuHints";
  } else if (!String(client.cpu.source).includes("gpuHints")) {
    client.cpu.source = `${client.cpu.source}+gpuHints`;
  }

  const evidenceParts = [];
  if (client.cpu.evidence) evidenceParts.push(String(client.cpu.evidence));
  if (guess.evidence) evidenceParts.push(String(guess.evidence));
  client.cpu.evidence = evidenceParts.join(" | ") || client.cpu.evidence || null;

  refreshPlatformSummary(client);
}

// ===== Render Structured Client Info =====
function renderStructuredClientInfo(client) {
  if (!client) return;

  const computedPlatform = client.platform?.summary || "-";
  const rawNavigatorPlatform = client.platform?.raw?.navigatorPlatform || client.ua?.platform || "-";
  const rawUaCHPlatform = client.platform?.raw?.uaDataPlatform || "-";
  const rawUaCHPlatformVersion = client.platform?.raw?.uaDataPlatformVersion || "-";

  const cpuCoresDisplay = typeof client.hardware?.hardwareConcurrency === "number" ? String(client.hardware.hardwareConcurrency) : "-";
  const deviceMemoryDisplay = typeof client.hardware?.deviceMemory === "number" ? `${client.hardware.deviceMemory} GB` : "-";
  const jsHeapSizeLimitDisplay = (() => {
    const bytes = client.hardware?.jsHeapSizeLimitBytes;
    if (typeof bytes !== "number") return "-";
    const gib = bytes / 1024 / 1024 / 1024;
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
  })();

  const sections = [
    {
      title: "Browser",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
      rows: [
        ["Name", client.parsed?.browser?.name || "-"],
        ["Version", client.parsed?.browser?.version || "-"],
        ["Engine", client.parsed?.engine?.name || "-"],
        ["Language", client.ua?.language || "-"],
      ]
    },
    {
      title: "Operating System",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
      rows: [
        ["Name", client.parsed?.os?.name || "-"],
        ["Version", osVersionLabel(client.parsed?.os)],
        ["Version source", client.parsed?.os?.source || "-"],
        ["UA version", client.parsed?.os?.uaVersion || "-"],
        ["UA-CH platform", rawUaCHPlatform],
        ["UA-CH platformVersion", rawUaCHPlatformVersion],
        ["Computed platform", computedPlatform],
        ["navigator.platform", rawNavigatorPlatform],
      ]
    },
    {
      title: "Device",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`,
      rows: [
        ["Type", client.parsed?.device?.type || "-"],
        ["Model", client.parsed?.device?.model || "-"],
        ["Touch Points", client.hardware?.maxTouchPoints ?? "-"],
      ]
    },
    {
      title: "Hardware",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`,
      rows: [
        ["CPU", cpuLabel(client.parsed?.os?.name, client.cpu) || "-"],
        ["CPU source", client.cpu?.source || "-"],
        ["CPU evidence", client.cpu?.evidence || "-"],
        ["Logical cores (reported)", cpuCoresDisplay],
        ["Cores note", client.hardware?.hardwareConcurrencyNote || "-"],
        ["RAM (reported)", deviceMemoryDisplay],
        ["RAM note", client.hardware?.deviceMemoryNote || "-"],
        ["JS heap limit", jsHeapSizeLimitDisplay],
        ["JS heap note", client.hardware?.jsHeapSizeLimitNote || "-"],
      ]
    },
    {
      title: "Display",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
      rows: [
        ["Resolution", `${client.display?.screen?.width || "-"} x ${client.display?.screen?.height || "-"}`],
        ["Pixel Ratio", client.display?.devicePixelRatio ?? "-"],
        ["Color Depth", client.display?.screen?.colorDepth ? `${client.display.screen.colorDepth}-bit` : "-"],
        ["HDR (active)", yesNo(client.display?.dynamicRangeHigh === true)],
        ["HDR (capable)", yesNo(client.display?.hdrCapable === true)],
        ["HDR source", client.display?.hdrSource || "-"],
        ["Video HDR query", yesNo(client.display?.videoDynamicRangeHigh === true)],
        ["HDR video decode", client.display?.hdrVideoDecoding?.available ? (client.display.hdrVideoDecoding.supported ? `Yes (${client.display.hdrVideoDecoding.best?.key || "supported"})` : "No") : "n/a"],
      ]
    },
    {
      title: "Fingerprint",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path><path d="M12 10v12"></path><path d="M9 13c-3 0-6 2-6 5"></path><path d="M15 13c3 0 6 2 6 5"></path></svg>`,
      rows: [
        ["SHA-256", client.fingerprint?.sha256 ? `${client.fingerprint.sha256.slice(0, 16)}...` : "-"],
        ["FNV-1a", client.fingerprint?.fnv1a || "-"],
        ["Timezone", client.time?.timeZone || "-"],
        ["Country", detectedCountryCode || "-"],
      ]
    },
  ];

  dom.clientInfoStructured.innerHTML = sections.map(section => `
    <div class="p-4 rounded-xl border border-border bg-black/15">
      <h4 class="flex items-center gap-2 m-0 mb-3 text-[13px] font-semibold text-[#cbd3e7] uppercase tracking-wide [&_svg]:w-4 [&_svg]:h-4 [&_svg]:text-accent">${section.icon}${escapeHtml(section.title)}</h4>
      ${section.rows.map(([key, value]) => `
        <div class="flex justify-between items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
          <span class="text-muted text-xs shrink-0">${escapeHtml(key)}</span>
          <span class="text-text-primary text-xs text-right font-medium break-all">${escapeHtml(String(value))}</span>
        </div>
      `).join("")}
    </div>
  `).join("");

  dom.clientInfoStructured.style.display = "grid";
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function valueOrDash(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number" && !Number.isFinite(v)) return "-";
  return String(v);
}

function renderStructuredWebglInfo(info, targetEl) {
  if (!targetEl) return;
  if (!info || !info.available) {
    targetEl.innerHTML = "";
    targetEl.style.display = "none";
    return;
  }

  const basic = info.basic || {};
  const limits = info.limits || {};
  const ext = info.extensions || {};
  const tests = info.textureTests || {};

  const renderer =
    info.debugInfo?.UNMASKED_RENDERER_WEBGL || basic.renderer || "-";
  const vendor =
    info.debugInfo?.UNMASKED_VENDOR_WEBGL || basic.vendor || "-";

  const supportedExtNames = Object.keys(ext).filter((k) => ext[k]).sort();
  const trueExtCount = supportedExtNames.length;
  const compressionCount = Array.isArray(info.compressedFormats) ? info.compressedFormats.length : 0;
  const aniso = info.anisotropy?.supported ? `Yes (max ${valueOrDash(info.anisotropy.max)})` : "No";
  const extListText = supportedExtNames.join("\n");

  const astcSupported = Boolean(info.astc) || Boolean(ext.WEBGL_compressed_texture_astc);
  const astcProfiles = Array.isArray(info.astc?.profiles) ? info.astc.profiles : null;
  const astcProfilesText = astcSupported ? (astcProfiles ? astcProfiles.join(", ") : "n/a") : "-";
  const astcHdrProfileText = astcSupported ? (astcProfiles ? yesNo(astcProfiles.includes("hdr")) : "n/a") : "-";

  const sections = [
    {
      title: "Core",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
      rows: [
        ["Context", info.webgl2 ? "WebGL2" : "WebGL1"],
        ["Version", basic.version || "-"],
        ["GLSL", basic.shadingLanguageVersion || "-"],
        ["Renderer", renderer],
        ["Vendor", vendor],
      ],
    },
    {
      title: "Texture Limits",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M3 9h18M9 21V9"></path></svg>`,
      rows: [
        ["MAX_TEXTURE_SIZE", valueOrDash(limits.MAX_TEXTURE_SIZE)],
        ["MAX_CUBE_MAP_TEXTURE_SIZE", valueOrDash(limits.MAX_CUBE_MAP_TEXTURE_SIZE)],
        ["MAX_RENDERBUFFER_SIZE", valueOrDash(limits.MAX_RENDERBUFFER_SIZE)],
        ["MAX_TEXTURE_IMAGE_UNITS", valueOrDash(limits.MAX_TEXTURE_IMAGE_UNITS)],
        ["MAX_VERTEX_TEXTURE_IMAGE_UNITS", valueOrDash(limits.MAX_VERTEX_TEXTURE_IMAGE_UNITS)],
        ["MAX_COMBINED_TEXTURE_IMAGE_UNITS", valueOrDash(limits.MAX_COMBINED_TEXTURE_IMAGE_UNITS)],
        ...(info.webgl2
          ? [
              ["MAX_3D_TEXTURE_SIZE", valueOrDash(limits.MAX_3D_TEXTURE_SIZE)],
              ["MAX_ARRAY_TEXTURE_LAYERS", valueOrDash(limits.MAX_ARRAY_TEXTURE_LAYERS)],
            ]
          : []),
      ],
    },
    {
      title: "Float/HDR",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line></svg>`,
      rows: [
        ["Float texture", yesNo(tests.floatTexture)],
        ["Float renderable", yesNo(tests.floatRenderable)],
        ["Half-float texture", yesNo(tests.halfFloatTexture)],
        ["Half-float renderable", yesNo(tests.halfFloatRenderable)],
        ["EXT_color_buffer_float", yesNo(ext.EXT_color_buffer_float || ext.WEBGL_color_buffer_float)],
        ["EXT_color_buffer_half_float", yesNo(ext.EXT_color_buffer_half_float)],
        ["Float filtering", yesNo(ext.OES_texture_float_linear)],
        ["Half-float filtering", yesNo(ext.OES_texture_half_float_linear)],
      ],
    },
    {
      title: "Compression & Sampling",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
      rows: [
        ["Anisotropy", aniso],
        ["S3TC/DXT", yesNo(ext.WEBGL_compressed_texture_s3tc)],
        ["S3TC sRGB", yesNo(ext.WEBGL_compressed_texture_s3tc_srgb)],
        ["ETC1", yesNo(ext.WEBGL_compressed_texture_etc1)],
        ["ETC2/EAC", yesNo(ext.WEBGL_compressed_texture_etc)],
        ["ASTC", yesNo(astcSupported)],
        ["ASTC profiles", astcProfilesText],
        ["ASTC HDR profile", astcHdrProfileText],
        ["BPTC", yesNo(ext.EXT_texture_compression_bptc)],
        ["RGTC", yesNo(ext.EXT_texture_compression_rgtc)],
        ["Reported compressed formats", String(compressionCount)],
        ["Supported extensions", String(trueExtCount)],
      ],
    },
    {
      title: "Extensions",
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6h-8a2 2 0 0 0-2 2v2"></path><path d="M4 18h8a2 2 0 0 0 2-2v-2"></path><path d="M12 12H4"></path><path d="M20 12h-4"></path><path d="M8 6H4"></path><path d="M20 18h-4"></path></svg>`,
      rows: [
        ["Count", String(trueExtCount)],
      ],
      extraHtml: `
        <details class="details">
          <summary>Show supported extensions</summary>
          <pre class="pre muted">${escapeHtml(extListText || "No extensions reported.")}</pre>
        </details>
      `,
    },
  ];

  targetEl.innerHTML = sections
    .map(
      (section) => `
    <div class="p-4 rounded-xl border border-border bg-black/15">
      <h4 class="flex items-center gap-2 m-0 mb-3 text-[13px] font-semibold text-[#cbd3e7] uppercase tracking-wide [&_svg]:w-4 [&_svg]:h-4 [&_svg]:text-accent">${section.icon}${escapeHtml(section.title)}</h4>
      ${section.rows
        .map(
          ([key, value]) => `
        <div class="flex justify-between items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
          <span class="text-muted text-xs shrink-0">${escapeHtml(key)}</span>
          <span class="text-text-primary text-xs text-right font-medium break-all">${escapeHtml(String(value))}</span>
        </div>
      `
        )
        .join("")}
      ${section.extraHtml || ""}
    </div>
  `
    )
    .join("");
  targetEl.style.display = "grid";
}

function formatKind(format) {
  if (format.startsWith("bc")) return "compressed-bc";
  if (format.startsWith("etc2") || format.startsWith("eac")) return "compressed-etc2/eac";
  if (format.startsWith("astc")) return "compressed-astc";
  if (format.startsWith("depth") || format.startsWith("stencil")) return "depth/stencil";
  if (format.includes("-srgb")) return "srgb";
  if (format.includes("snorm")) return "snorm";
  if (format.includes("unorm")) return "unorm";
  if (format.includes("sint")) return "sint";
  if (format.includes("uint")) return "uint";
  if (format.includes("float") || format.includes("ufloat")) return "float";
  return "other";
}

function formatIsCompressed(format) {
  return format.startsWith("bc") || format.startsWith("etc2") || format.startsWith("eac") || format.startsWith("astc");
}

function formatIsHdr(format) {
  if (format.includes("float") || format.includes("ufloat")) return true;
  if (format === "rg11b10ufloat" || format === "rgb9e5ufloat") return true;
  if (format === "rgb10a2unorm") return true;
  return false;
}

function compressedBlockSize(format) {
  if (format.startsWith("astc-")) {
    const match = /^astc-(\d+)x(\d+)-/.exec(format);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  }
  return { width: 4, height: 4 };
}

function testSizeForFormat(format) {
  if (formatIsCompressed(format)) {
    const { width, height } = compressedBlockSize(format);
    return { width, height, depthOrArrayLayers: 1 };
  }
  return { width: 1, height: 1, depthOrArrayLayers: 1 };
}

function sampleClass(format) {
  if (format.startsWith("depth") || format.startsWith("stencil")) return "depth";
  if (format.includes("sint")) return "sint";
  if (format.includes("uint") && !format.endsWith("unorm")) return "uint";
  return "floatLike";
}

async function withValidation(device, fn) {
  device.pushErrorScope("validation");
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  const error = await device.popErrorScope();
  return { ok: !thrown && !error, thrown, error };
}

async function testCreateTexture(device, format, usage) {
  const size = testSizeForFormat(format);
  const descriptor = {
    size,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format,
    usage,
  };

  const result = await withValidation(device, () => {
    const tex = device.createTexture(descriptor);
    tex.destroy();
  });

  return result.ok;
}

async function testTextureBinding(device, format, sampleType, samplerType, filterMode) {
  const size = testSizeForFormat(format);
  const usage = GPUTextureUsage.TEXTURE_BINDING;

  const result = await withValidation(device, () => {
    const tex = device.createTexture({
      size,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
      format,
      usage,
    });
    const view = tex.createView();
    const samplerDesc =
      samplerType === "comparison"
        ? { compare: "less", magFilter: filterMode, minFilter: filterMode, mipmapFilter: filterMode }
        : { magFilter: filterMode, minFilter: filterMode, mipmapFilter: filterMode };
    const sampler = device.createSampler(samplerDesc);

    const bgl = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType, viewDimension: "2d" },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: samplerType } },
      ],
    });

    device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
      ],
    });
    tex.destroy();
  });

  return result.ok;
}

async function testStorageBinding(device, format) {
  const size = testSizeForFormat(format);
  const usage = GPUTextureUsage.STORAGE_BINDING;

  const result = await withValidation(device, () => {
    const tex = device.createTexture({
      size,
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: "2d",
      format,
      usage,
    });
    const view = tex.createView();
    const bgl = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format, viewDimension: "2d" },
        },
      ],
    });
    device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: view }] });
    tex.destroy();
  });

  return result.ok;
}

async function detectWebgpu(onProgress) {
  const webgpu = {
    available: typeof navigator.gpu !== "undefined",
    secureContext: window.isSecureContext === true,
    preferredCanvasFormat: null,
    adapterInfo: null,
    adapterFeatures: [],
    deviceFeatures: [],
    limits: null,
    formats: [],
    warnings: [],
    errors: [],
  };

  if (!webgpu.available) return webgpu;
  if (!webgpu.secureContext) {
    webgpu.warnings.push("WebGPU requires a secure context (https or localhost).");
  }

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      webgpu.errors.push("navigator.gpu.requestAdapter() returned null.");
      return webgpu;
    }
  } catch (err) {
    webgpu.errors.push(`requestAdapter() failed: ${String(err)}`);
    return webgpu;
  }

  webgpu.adapterFeatures = Array.from(adapter.features || []).sort();
  webgpu.limits = adapter.limits ? Object.fromEntries(Object.entries(adapter.limits)) : null;

  try {
    if (typeof navigator.gpu.getPreferredCanvasFormat === "function") {
      webgpu.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat();
    }
  } catch {
    // ignore
  }

  try {
    if (typeof adapter.requestAdapterInfo === "function") {
      webgpu.adapterInfo = await adapter.requestAdapterInfo();
    }
  } catch (err) {
    webgpu.warnings.push(`requestAdapterInfo() not available/blocked: ${String(err)}`);
  }

  let device = null;
  try {
    const requiredFeatures = webgpu.adapterFeatures.slice();
    device = await adapter.requestDevice({ requiredFeatures });
  } catch (err) {
    webgpu.warnings.push(`requestDevice(all features) failed, retrying minimal: ${String(err)}`);
    try {
      device = await adapter.requestDevice();
    } catch (err2) {
      webgpu.errors.push(`requestDevice() failed: ${String(err2)}`);
      return webgpu;
    }
  }

  device.addEventListener?.("uncapturederror", (ev) => {
    // Avoid noisy UI; errors should be scoped. Still, record for debugging.
    webgpu.warnings.push(`Uncaptured WebGPU error: ${ev?.error?.message || String(ev?.error || ev)}`);
  });

  webgpu.deviceFeatures = Array.from(device.features || []).sort();

  // Format checks
  const totalFormats = WEBGPU_TEXTURE_FORMATS.length;
  for (let i = 0; i < totalFormats; i += 1) {
    const format = WEBGPU_TEXTURE_FORMATS[i];
    const progress = Math.round(((i + 1) / totalFormats) * 100);

    if (i % 4 === 0 && onProgress) {
      onProgress(progress, `Checking format ${i + 1}/${totalFormats}: ${format}`);
    }

    const kind = formatKind(format);
    const hdr = formatIsHdr(format);
    const compressed = formatIsCompressed(format);

    const entry = {
      format,
      kind,
      hdr,
      compressed,
      sampled: false,
      filterable: null,
      renderable: false,
      storage: false,
    };

    // Sampled + filterable checks
    const sc = sampleClass(format);
    if (sc === "depth") {
      entry.sampled = await testTextureBinding(device, format, "depth", "comparison", "linear");
      entry.filterable = null;
    } else if (sc === "sint") {
      entry.sampled = await testTextureBinding(device, format, "sint", "non-filtering", "nearest");
      entry.filterable = null;
    } else if (sc === "uint") {
      entry.sampled = await testTextureBinding(device, format, "uint", "non-filtering", "nearest");
      entry.filterable = null;
    } else {
      const okFilterable = await testTextureBinding(device, format, "float", "filtering", "linear");
      if (okFilterable) {
        entry.sampled = true;
        entry.filterable = true;
      } else {
        const okUnfilterable = await testTextureBinding(device, format, "unfilterable-float", "non-filtering", "nearest");
        entry.sampled = okUnfilterable;
        entry.filterable = okUnfilterable ? false : null;
      }
    }

    entry.renderable = await testCreateTexture(device, format, GPUTextureUsage.RENDER_ATTACHMENT);
    entry.storage = await testStorageBinding(device, format);

    webgpu.formats.push(entry);
  }

  try {
    device.destroy?.();
  } catch {
    // ignore
  }

  return webgpu;
}

function tryCreateWebglContext(type) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const gl = canvas.getContext(type, { antialias: false, alpha: false, depth: false, stencil: false });
  return gl;
}

function gatherWebglInfo(gl) {
  if (!gl) return { available: false };
  const isWebgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

  const basic = {
    version: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
  };

  const limits = {
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    MAX_CUBE_MAP_TEXTURE_SIZE: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
    MAX_RENDERBUFFER_SIZE: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
  };

  if (isWebgl2) {
    limits.MAX_3D_TEXTURE_SIZE = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    limits.MAX_ARRAY_TEXTURE_LAYERS = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  }

  const supportedExtensions = gl.getSupportedExtensions() || [];
  supportedExtensions.sort();

  /** @type {Record<string, boolean>} */
  const extensions = {};
  for (const name of supportedExtensions) {
    if (name && typeof name === "string") extensions[name] = true;
  }

  // More robust anisotropy detection across vendor-prefixed names.
  const anisotropyExt =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("MOZ_EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  if (anisotropyExt) {
    extensions.EXT_texture_filter_anisotropic = true;
  }

  // ASTC profile support (LDR vs HDR) if exposed by the extension.
  let astc = null;
  try {
    const astcExt = gl.getExtension("WEBGL_compressed_texture_astc");
    if (astcExt) {
      let profiles = null;
      if (typeof astcExt.getSupportedProfiles === "function") {
        try {
          profiles = astcExt.getSupportedProfiles();
        } catch {
          profiles = null;
        }
      }

      let normalized = null;
      if (Array.isArray(profiles)) {
        const seen = new Set();
        for (const raw of profiles) {
          const s = String(raw || "").trim().toLowerCase();
          if (!s) continue;
          seen.add(s);
        }
        normalized = Array.from(seen).sort((a, b) => a.localeCompare(b));
      }

      astc = {
        profiles: normalized,
        hdrProfile: Array.isArray(normalized) ? normalized.includes("hdr") : false,
        ldrProfile: Array.isArray(normalized) ? normalized.includes("ldr") : false,
      };
    }
  } catch {
    // ignore
  }

  let debugInfo = null;
  if (extensions.WEBGL_debug_renderer_info) {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      debugInfo = {
        UNMASKED_VENDOR_WEBGL: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
        UNMASKED_RENDERER_WEBGL: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
      };
    }
  }

  let compressedFormats = [];
  try {
    const enums = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
    if (enums && typeof enums.length === "number") {
      compressedFormats = Array.from(enums, (v) => WEBGL_COMPRESSED_ENUMS.get(v) || `0x${v.toString(16)}`);
      compressedFormats.sort();
    }
  } catch {
    // ignore
  }

  return {
    available: true,
    webgl2: isWebgl2,
    basic,
    limits,
    extensions,
    debugInfo,
    compressedFormats,
    astc,
    anisotropy: anisotropyExt
      ? { supported: true, max: gl.getParameter(anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) }
      : { supported: false, max: null },
    textureTests: testWebglTextures(gl, isWebgl2, extensions),
  };
}

function testWebglTextures(gl, isWebgl2, extensions) {
  const result = {
    floatTexture: false,
    halfFloatTexture: false,
    floatRenderable: false,
    halfFloatRenderable: false,
  };

  const texTarget = gl.TEXTURE_2D;
  const createAndInit = (internalFormat, format, type) => {
    const tex = gl.createTexture();
    gl.bindTexture(texTarget, tex);
    gl.texParameteri(texTarget, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(texTarget, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(texTarget, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(texTarget, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (isWebgl2) {
      gl.texImage2D(texTarget, 0, internalFormat, 1, 1, 0, format, type, null);
    } else {
      // WebGL1 uses unsized internalFormat=format.
      gl.texImage2D(texTarget, 0, format, 1, 1, 0, format, type, null);
    }

    const err = gl.getError();
    gl.bindTexture(texTarget, null);
    return { tex, ok: err === gl.NO_ERROR };
  };

  const canRenderToTexture = (tex) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texTarget, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    return status === gl.FRAMEBUFFER_COMPLETE;
  };

  // Float textures (32F)
  if (isWebgl2 || extensions.OES_texture_float) {
    const internalFormat = isWebgl2 ? gl.RGBA32F : gl.RGBA;
    const { tex, ok } = createAndInit(internalFormat, gl.RGBA, gl.FLOAT);
    result.floatTexture = ok;
    if (ok) {
      // Rendering to float in WebGL2 typically requires EXT_color_buffer_float. In WebGL1: WEBGL_color_buffer_float.
      result.floatRenderable = canRenderToTexture(tex);
    }
    gl.deleteTexture(tex);
  }

  // Half-float textures (16F)
  const halfFloatType = isWebgl2 ? gl.HALF_FLOAT : gl.getExtension("OES_texture_half_float")?.HALF_FLOAT_OES;
  if (halfFloatType) {
    const internalFormat = isWebgl2 ? gl.RGBA16F : gl.RGBA;
    const { tex, ok } = createAndInit(internalFormat, gl.RGBA, halfFloatType);
    result.halfFloatTexture = ok;
    if (ok) {
      // Rendering to half-float typically requires EXT_color_buffer_half_float.
      result.halfFloatRenderable = canRenderToTexture(tex);
    }
    gl.deleteTexture(tex);
  }

  return result;
}

function renderWebglInfo(target, info) {
  target.textContent = stringifySafe(info);
}

function formatSupportBadge(value) {
  const base = "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 border text-xs font-medium tabular-nums transition-all";
  if (value === null) return `<span class="${base} border-warn/45 text-warn bg-warn/15">n/a</span>`;
  if (value === true) return `<span class="${base} border-good/40 text-good bg-good/15">yes</span>`;
  return `<span class="${base} border-bad/40 text-bad bg-bad/15">no</span>`;
}

function sortFormats(formats, key, dir) {
  const sorted = [...formats];
  sorted.sort((a, b) => {
    let aVal = a[key];
    let bVal = b[key];

    // Handle different types
    if (typeof aVal === "string" && typeof bVal === "string") {
      return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    if (typeof aVal === "boolean" && typeof bVal === "boolean") {
      aVal = aVal ? 1 : 0;
      bVal = bVal ? 1 : 0;
    }
    if (aVal === null) aVal = -1;
    if (bVal === null) bVal = -1;

    return dir === "asc" ? aVal - bVal : bVal - aVal;
  });
  return sorted;
}

function renderWebgpuTable(formats, filter) {
  const { search, supportedOnly, hdrOnly, compressedOnly } = filter;
  const searchNorm = (search || "").trim().toLowerCase();

  let filtered = formats.filter(f => {
    if (searchNorm && !f.format.toLowerCase().includes(searchNorm)) return false;
    if (supportedOnly && !(f.sampled || f.renderable || f.storage)) return false;
    if (hdrOnly && !f.hdr) return false;
    if (compressedOnly && !f.compressed) return false;
    return true;
  });

  // Apply sorting if set
  if (currentSortKey) {
    filtered = sortFormats(filtered, currentSortKey, currentSortDir);
  }

  // Update sort indicators
  document.querySelectorAll("#webgpuTable thead th.sortable").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === currentSortKey) {
      th.classList.add(`sorted-${currentSortDir}`);
    }
  });

  // Update format count
  const supportedCount = filtered.filter(f => f.sampled || f.renderable || f.storage).length;
  dom.formatCount.innerHTML = `Showing <strong>${filtered.length}</strong> formats (${supportedCount} supported)`;

  if (filtered.length === 0) {
    dom.webgpuTbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-0">
          <div class="text-center py-12 px-6 text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-12 h-12 mx-auto mb-4 opacity-50">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <div class="text-base font-semibold text-text-primary mb-2">No Matching Formats</div>
            <div class="text-sm max-w-xs mx-auto">Try adjusting your search or filter criteria.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const rows = filtered.map(f => {
    const isSupported = f.sampled || f.renderable || f.storage;
    const rowClass = isSupported ? "bg-good/5" : "";
    return `<tr class="border-b border-border/50 transition-colors hover:bg-white/[0.02] ${rowClass}">
      <td class="p-3"><code class="font-mono text-[0.9em] text-[#d7deff] bg-accent/10 px-1.5 py-0.5 rounded">${escapeHtml(f.format)}</code></td>
      <td class="p-3 text-muted">${escapeHtml(f.kind)}</td>
      <td class="p-3">${formatSupportBadge(f.hdr)}</td>
      <td class="p-3">${formatSupportBadge(f.sampled)}</td>
      <td class="p-3">${formatSupportBadge(f.filterable)}</td>
      <td class="p-3">${formatSupportBadge(f.renderable)}</td>
      <td class="p-3">${formatSupportBadge(f.storage)}</td>
    </tr>`;
  });

  dom.webgpuTbody.innerHTML = rows.join("");
}

function updateFilters() {
  renderWebgpuTable(lastWebgpuFormats, {
    search: dom.searchInput.value,
    supportedOnly: dom.supportedOnly.checked,
    hdrOnly: dom.hdrOnly.checked,
    compressedOnly: dom.compressedOnly.checked,
  });
}

// ===== Column Sorting =====
function setupTableSorting() {
  document.querySelectorAll("#webgpuTable thead th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (currentSortKey === key) {
        currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
      } else {
        currentSortKey = key;
        currentSortDir = "asc";
      }
      updateFilters();
    });
  });
}

async function run() {
  dom.runBtn.disabled = true;
  dom.runBtn.classList.add("opacity-70", "pointer-events-none");
  dom.copyBtn.disabled = true;
  dom.downloadBtn.disabled = true;
  dom.runStatus.textContent = "";
  dom.runStatus.className = "flex items-center gap-2 text-[13px] text-muted";
  detectedCountryCode = "";

  showProgress();
  setProgress(5, "Detecting client information...");

  // Update initial status
  const isSecure = window.isSecureContext;
  setStatusChip(dom.secureContext, isSecure ? "good" : "bad", isSecure ? "Yes" : "No");
  setStatusItemState(dom.secureContextItem, isSecure ? "good" : "bad");

  const dynamicRangeHigh = mediaMatchText("(dynamic-range: high)") === "yes";
  const videoDynamicRangeHigh = mediaMatchText("(video-dynamic-range: high)") === "yes";
  const hdrText = dynamicRangeHigh ? "HDR" : videoDynamicRangeHigh ? "HDR (video)" : "SDR";
  setStatusChip(dom.dynamicRange, dynamicRangeHigh ? "good" : "warn", hdrText);
  setStatusItemState(dom.dynamicRangeItem, dynamicRangeHigh ? "good" : videoDynamicRangeHigh ? "warn" : null);

  const colorGamuts = [];
  if (mediaMatchText("(color-gamut: rec2020)") === "yes") colorGamuts.push("Rec.2020");
  if (mediaMatchText("(color-gamut: p3)") === "yes") colorGamuts.push("P3");
  if (mediaMatchText("(color-gamut: srgb)") === "yes") colorGamuts.push("sRGB");
  const gamutText = colorGamuts.length > 0 ? colorGamuts[0] : "Unknown";
  setStatusChip(dom.colorGamut, colorGamuts.includes("P3") || colorGamuts.includes("Rec.2020") ? "good" : "warn", gamutText);
  setStatusItemState(dom.colorGamutItem, colorGamuts.includes("P3") ? "good" : null);

  setProgress(10, "Gathering client information...");

  const [client, webgpu, webgl2, webgl1] = await Promise.all([
    detectClientInfo(),
    detectWebgpu((progress, text) => {
      const scaledProgress = 20 + Math.round(progress * 0.7); // Scale to 20-90%
      setProgress(scaledProgress, text);
    }),
    Promise.resolve(gatherWebglInfo(tryCreateWebglContext("webgl2"))),
    Promise.resolve(gatherWebglInfo(tryCreateWebglContext("webgl"))),
  ]);

  setProgress(95, "Finalizing results...");

  // Improve "HDR" format classification with ASTC HDR profile support (when exposed by WebGL).
  const astcHdrProfileSupported = Boolean(webgl2?.astc?.hdrProfile) || Boolean(webgl1?.astc?.hdrProfile);
  if (astcHdrProfileSupported && Array.isArray(webgpu.formats)) {
    for (const f of webgpu.formats) {
      if (!f || typeof f.format !== "string") continue;
      if (f.format.startsWith("astc-") && !f.format.endsWith("-srgb")) {
        f.hdr = true;
      }
    }
  }

  // Best-effort fixups: browsers can lie/omit CPU platform details; try to infer Apple Silicon from GPU strings.
  setProgress(96, "Normalizing platform details...");
  augmentClientFromGpuHints(client, webgpu, webgl2, webgl1);
  await recomputeClientFingerprint(client);

  // Update client info
  dom.clientInfo.textContent = stringifySafe(client);
  renderStructuredClientInfo(client);

  const hdrActive = client?.display?.dynamicRangeHigh === true;
  const hdrVideo = client?.display?.videoDynamicRangeHigh === true;
  const hdrCapable = client?.display?.hdrCapable === true;
  const hdrFinalText = hdrActive ? "HDR" : hdrVideo ? "HDR (video)" : hdrCapable ? "Capable" : "SDR";
  setStatusChip(dom.dynamicRange, hdrActive ? "good" : "warn", hdrFinalText);
  setStatusItemState(dom.dynamicRangeItem, hdrActive ? "good" : hdrCapable ? "warn" : null);

  dom.browserSummary.textContent =
    client?.parsed?.browser?.name && client?.parsed?.browser?.version
      ? `${client.parsed.browser.name} ${client.parsed.browser.version.split(".")[0]}`
      : client?.parsed?.browser?.name || "-";
  const osName = client?.parsed?.os?.name || "";
  const osVersion = osVersionLabel(client?.parsed?.os);
  dom.osSummary.textContent = osName ? `${osName}${osVersion !== "-" ? ` ${osVersion}` : ""}` : "-";
  dom.deviceSummary.textContent =
    client?.parsed?.device?.model ? `${client.parsed.device.type} (${client.parsed.device.model})` : client?.parsed?.device?.type || "-";

  // Update WebGPU status
  const webgpuState = webgpu.available ? (webgpu.errors.length ? "warn" : "good") : "bad";
  const webgpuText = webgpu.available ? (webgpu.errors.length ? "Partial" : "Available") : "Not Available";
  setStatusChip(dom.webgpuStatus, webgpuState, webgpuText);
  setStatusItemState(dom.webgpuItem, webgpuState);

  // Update WebGL2 status
  setStatusChip(dom.webgl2Status, webgl2.available ? "good" : "bad", webgl2.available ? "Available" : "Not Available");
  setStatusItemState(dom.webgl2Item, webgl2.available ? "good" : "bad");

  lastWebgpuFormats = webgpu.formats || [];
  renderWebgpuTable(lastWebgpuFormats, {
    search: dom.searchInput.value,
    supportedOnly: dom.supportedOnly.checked,
    hdrOnly: dom.hdrOnly.checked,
    compressedOnly: dom.compressedOnly.checked,
  });

  dom.webgpuFeatures.textContent = stringifySafe({
    preferredCanvasFormat: webgpu.preferredCanvasFormat,
    adapterFeatures: webgpu.adapterFeatures,
    deviceFeatures: webgpu.deviceFeatures,
    warnings: webgpu.warnings,
    errors: webgpu.errors,
  });
  dom.webgpuLimits.textContent = stringifySafe(webgpu.limits);
  dom.webgpuAdapterInfo.textContent = stringifySafe(webgpu.adapterInfo);

  renderWebglInfo(dom.webgl2Info, webgl2);
  renderWebglInfo(dom.webgl1Info, webgl1);
  renderStructuredWebglInfo(webgl2, dom.webgl2Structured);
  renderStructuredWebglInfo(webgl1, dom.webgl1Structured);

  lastReport = {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    client,
    secureContext: window.isSecureContext === true,
    display: {
      dynamicRangeHigh: client?.display?.dynamicRangeHigh === true,
      videoDynamicRangeHigh: client?.display?.videoDynamicRangeHigh === true,
      hdrCapable: client?.display?.hdrCapable === true,
      hdrSource: client?.display?.hdrSource || "",
      colorGamutRec2020: client?.display?.colorGamutRec2020 === true,
      colorGamutP3: client?.display?.colorGamutP3 === true,
      colorGamutSRGB: client?.display?.colorGamutSRGB === true,
    },
    webgpu,
    webgl2,
    webgl1,
  };

  dom.copyBtn.disabled = false;
  dom.downloadBtn.disabled = false;

  setProgress(100, "Complete!");

  // Submit to backend
  const submit = await submitReportToBackend(lastReport);

  // Update country code from server response
  if (submit.ok && submit.payload?.countryCode) {
    detectedCountryCode = submit.payload.countryCode;
    renderStructuredClientInfo(lastReport.client);
  }

  hideProgress();
  dom.runBtn.classList.remove("opacity-70", "pointer-events-none");

  const supportedFormats = lastWebgpuFormats.filter(f => f.sampled || f.renderable || f.storage).length;

  if (submit.ok) {
    const serverStatus = submit.payload?.status ? String(submit.payload.status) : "ok";
    dom.runStatus.textContent = `Detection complete. ${supportedFormats}/${lastWebgpuFormats.length} formats supported. Uploaded: ${serverStatus}`;
    dom.runStatus.className = "flex items-center gap-2 text-[13px] text-good";
    showToast("success", "Detection Complete", `Found ${supportedFormats} supported WebGPU formats`);
  } else {
    if (submit.status === 404) {
      dom.runStatus.textContent = `Detection complete. ${supportedFormats}/${lastWebgpuFormats.length} formats supported. (No backend)`;
    } else {
      const status = submit.status != null ? `HTTP ${submit.status}` : "network error";
      dom.runStatus.textContent = `Detection complete. ${supportedFormats}/${lastWebgpuFormats.length} formats supported. Upload failed (${status})`;
    }
    dom.runStatus.className = "flex items-center gap-2 text-[13px] text-good";
    showToast("success", "Detection Complete", `Found ${supportedFormats} supported WebGPU formats`);
  }

  dom.runBtn.disabled = false;
}

async function copyJson() {
  if (!lastReport) return;
  const text = stringifySafe(lastReport);
  try {
    await navigator.clipboard.writeText(text);
    showToast("success", "Copied to Clipboard", "JSON data is ready to paste");
  } catch (err) {
    showToast("error", "Copy Failed", String(err));
  }
}

function downloadJson() {
  if (!lastReport) return;
  const text = stringifySafe(lastReport);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gpu-texture-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("success", "Download Started", "Check your downloads folder");
}

async function submitReportToBackend(report) {
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });

    const contentType = res.headers.get("Content-Type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
    return { ok: res.ok, status: res.status, payload };
  } catch (err) {
    return { ok: false, status: null, payload: String(err) };
  }
}

// ===== Event Listeners =====
dom.runBtn.addEventListener("click", run);
dom.copyBtn.addEventListener("click", copyJson);
dom.downloadBtn.addEventListener("click", downloadJson);
dom.searchInput.addEventListener("input", updateFilters);
dom.supportedOnly.addEventListener("change", updateFilters);
dom.hdrOnly.addEventListener("change", updateFilters);
dom.compressedOnly.addEventListener("change", updateFilters);

// Setup table sorting
setupTableSorting();

// ===== Initial UI State =====
const isSecure = window.isSecureContext;
setStatusChip(dom.secureContext, isSecure ? "good" : "bad", isSecure ? "Yes" : "No");
setStatusItemState(dom.secureContextItem, isSecure ? "good" : "bad");

const hasWebGPU = typeof navigator.gpu !== "undefined";
setStatusChip(dom.webgpuStatus, hasWebGPU ? "warn" : "bad", hasWebGPU ? "Detected" : "Not Available");
setStatusItemState(dom.webgpuItem, hasWebGPU ? "warn" : "bad");

const initialWebgl2 = tryCreateWebglContext("webgl2");
setStatusChip(dom.webgl2Status, initialWebgl2 ? "warn" : "bad", initialWebgl2 ? "Detected" : "Not Available");
setStatusItemState(dom.webgl2Item, initialWebgl2 ? "warn" : "bad");

const dynamicRangeHigh = mediaMatchText("(dynamic-range: high)") === "yes";
const videoDynamicRangeHigh = mediaMatchText("(video-dynamic-range: high)") === "yes";
const hdrText = dynamicRangeHigh ? "HDR" : videoDynamicRangeHigh ? "HDR (video)" : "SDR";
setStatusChip(dom.dynamicRange, dynamicRangeHigh ? "good" : "warn", hdrText);
setStatusItemState(dom.dynamicRangeItem, dynamicRangeHigh ? "good" : videoDynamicRangeHigh ? "warn" : null);

const colorGamuts = [];
if (mediaMatchText("(color-gamut: rec2020)") === "yes") colorGamuts.push("Rec.2020");
if (mediaMatchText("(color-gamut: p3)") === "yes") colorGamuts.push("P3");
if (mediaMatchText("(color-gamut: srgb)") === "yes") colorGamuts.push("sRGB");
const gamutText = colorGamuts.length > 0 ? colorGamuts[0] : "Unknown";
setStatusChip(dom.colorGamut, colorGamuts.includes("P3") || colorGamuts.includes("Rec.2020") ? "good" : "warn", gamutText);
setStatusItemState(dom.colorGamutItem, colorGamuts.includes("P3") ? "good" : null);

dom.browserSummary.textContent = "-";
dom.osSummary.textContent = "-";
dom.deviceSummary.textContent = "-";

// Auto-run once per browser (first visit on this origin).
const AUTO_RUN_KEY = "hdrDetection.autoRun.v1";
if (safeStorageGet(AUTO_RUN_KEY) !== "1") {
  // Mark before running to avoid repeated runs on reload/crash loops.
  safeStorageSet(AUTO_RUN_KEY, "1");

  const start = () => {
    // Give the UI a moment to paint before doing heavy GPU work.
    setTimeout(() => {
      if (dom.runBtn.disabled) return;
      run().catch((err) => {
        console.error(err);
        showToast("error", "Auto-run failed", String(err));
        dom.runBtn.disabled = false;
        dom.runBtn.classList.remove("opacity-70", "pointer-events-none");
      });
    }, 250);
  };

  if (document.visibilityState === "visible") {
    start();
  } else {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") start();
      },
      { once: true }
    );
  }
}
