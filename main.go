package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed *.html *.js
var staticFS embed.FS

type Config struct {
	MaxReports     int
	DedupeTTL      time.Duration
	MaxBodyBytes   int64
	RatePerMinute  float64
	RateBurst      float64
	CleanupEvery   time.Duration
	LimiterIdleTTL time.Duration
}

type Store struct {
	mu sync.Mutex

	cfg   Config
	mongo *mongoStore

	startedAt time.Time

	geo *geoResolver

	reports      map[string]StoredReport // by fingerprint
	order        []string                // insertion order
	lastSeenByFP map[string]time.Time

	limiters map[string]*ipLimiter

	totalReceived    int
	totalAccepted    int
	totalDuplicate   int
	totalRateLimited int
	totalRejected    int
	lastCleanup      time.Time
}

type StoredReport struct {
	Fingerprint string    `json:"fingerprint"`
	ReceivedAt  time.Time `json:"receivedAt"`
	IP          string    `json:"-"`
	Report      Report    `json:"report"`
}

type ipLimiter struct {
	bucket   tokenBucket
	lastSeen time.Time
}

type tokenBucket struct {
	tokens float64
	last   time.Time
}

func (b *tokenBucket) allow(now time.Time, ratePerSecond float64, burst float64) bool {
	if b.last.IsZero() {
		b.last = now
		b.tokens = burst - 1
		return true
	}
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens = minFloat(burst, b.tokens+elapsed*ratePerSecond)
		b.last = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens -= 1
	return true
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func NewStore(cfg Config, mongo *mongoStore) *Store {
	s := &Store{
		cfg:         cfg,
		mongo:       mongo,
		startedAt:   time.Now(),
		geo:         newGeoResolver(),
		limiters:    make(map[string]*ipLimiter),
		lastCleanup: time.Now(),
	}
	if mongo == nil {
		s.reports = make(map[string]StoredReport)
		s.lastSeenByFP = make(map[string]time.Time)
	}
	return s
}

type geoResolver struct {
	mu           sync.Mutex
	cache        map[string]geoCacheEntry
	ttl          time.Duration
	negativeTTL  time.Duration
	cleanupEvery time.Duration
	lastCleanup  time.Time
	httpClient   *http.Client
}

type geoCacheEntry struct {
	countryCode string
	expiresAt   time.Time
}

func newGeoResolver() *geoResolver {
	return &geoResolver{
		cache:        make(map[string]geoCacheEntry),
		ttl:          24 * time.Hour,
		negativeTTL:  1 * time.Hour,
		cleanupEvery: 10 * time.Minute,
		lastCleanup:  time.Now(),
		httpClient: &http.Client{
			Timeout: 1500 * time.Millisecond,
		},
	}
}

func (g *geoResolver) CountryCode(ctx context.Context, now time.Time, ipStr string, r *http.Request) string {
	// Prefer trusted proxy geolocation headers when available (no outbound call).
	if trustProxyHeadersForRequest(r) {
		if code := countryCodeFromHeaders(r.Header); code != "" {
			return code
		}
	}

	ip := net.ParseIP(strings.Trim(ipStr, "[]"))
	if ip == nil || !isPublicIP(ip) {
		// Local dev / internal proxy case: we may only see a private/loopback address.
		// Fall back to resolving the requester's public egress IP (api.country.is/).
		if trustProxyHeadersForRequest(r) {
			const selfKey = "_self"
			if code, ok := g.getCached(now, selfKey); ok {
				return code
			}
			code, err := lookupCountryCodeCountryIs(ctx, g.httpClient, "")
			if err != nil {
				g.setCached(now, selfKey, "")
				return ""
			}
			g.setCached(now, selfKey, code)
			return code
		}
		return ""
	}

	canonicalIP := ip.String()

	if code, ok := g.getCached(now, canonicalIP); ok {
		return code
	}

	code, err := lookupCountryCodeCountryIs(ctx, g.httpClient, canonicalIP)
	if err != nil {
		g.setCached(now, canonicalIP, "")
		return ""
	}
	g.setCached(now, canonicalIP, code)
	return code
}

func (g *geoResolver) getCached(now time.Time, ip string) (string, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupLocked(now)

	entry, ok := g.cache[ip]
	if !ok || now.After(entry.expiresAt) {
		return "", false
	}
	return entry.countryCode, true
}

func (g *geoResolver) setCached(now time.Time, ip string, code string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupLocked(now)

	ttl := g.ttl
	if code == "" {
		ttl = g.negativeTTL
	}
	g.cache[ip] = geoCacheEntry{
		countryCode: code,
		expiresAt:   now.Add(ttl),
	}
}

func (g *geoResolver) cleanupLocked(now time.Time) {
	if now.Sub(g.lastCleanup) < g.cleanupEvery {
		return
	}
	for ip, e := range g.cache {
		if now.After(e.expiresAt) {
			delete(g.cache, ip)
		}
	}
	g.lastCleanup = now
}

func trustProxyHeadersForRequest(r *http.Request) bool {
	remoteIP := stripPortMaybe(r.RemoteAddr)
	return isRender() || isPrivateOrLoopbackIP(remoteIP)
}

func countryCodeFromHeaders(h http.Header) string {
	// A few common proxy/CDN geo headers. Values are typically ISO 3166-1 alpha-2.
	candidates := []string{
		"CF-IPCountry",
		"X-AppEngine-Country",
		"X-Vercel-IP-Country",
		"X-Cloudfront-Viewer-Country",
		"Fastly-GeoIP-Country-Code",
		"X-Country-Code",
		"X-Geo-Country",
	}
	for _, key := range candidates {
		if code := normalizeCountryCode(h.Get(key)); code != "" {
			return code
		}
	}
	return ""
}

func normalizeCountryCode(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if len(s) != 2 {
		return ""
	}
	if s == "XX" || s == "ZZ" {
		return ""
	}
	for i := 0; i < 2; i++ {
		c := s[i]
		if c < 'A' || c > 'Z' {
			return ""
		}
	}
	return s
}

func lookupCountryCodeCountryIs(ctx context.Context, httpClient *http.Client, ip string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 1200*time.Millisecond)
	defer cancel()

	u := "https://api.country.is/" + url.PathEscape(ip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")

	res, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode > 299 {
		io.CopyN(io.Discard, res.Body, 4096)
		return "", fmt.Errorf("geoip: unexpected status %d", res.StatusCode)
	}

	var payload struct {
		Country string `json:"country"`
	}
	dec := json.NewDecoder(io.LimitReader(res.Body, 1<<20))
	if err := dec.Decode(&payload); err != nil {
		return "", err
	}
	if code := normalizeCountryCode(payload.Country); code != "" {
		return code, nil
	}
	return "", fmt.Errorf("geoip: invalid country code")
}

type submitResult struct {
	Status      string    `json:"status"`
	Fingerprint string    `json:"fingerprint,omitempty"`
	Stored      bool      `json:"stored"`
	StoredCount int       `json:"storedCount"`
	ReceivedAt  time.Time `json:"receivedAt"`
	Message     string    `json:"message,omitempty"`
	CountryCode string    `json:"countryCode,omitempty"`
}

func (s *Store) allowIP(now time.Time, ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeCleanupLocked(now)

	l := s.limiters[ip]
	if l == nil {
		l = &ipLimiter{bucket: tokenBucket{tokens: s.cfg.RateBurst, last: now}, lastSeen: now}
		s.limiters[ip] = l
	}
	l.lastSeen = now
	return l.bucket.allow(now, s.cfg.RatePerMinute/60.0, s.cfg.RateBurst)
}

func (s *Store) Submit(now time.Time, ip string, report Report) (submitResult, error) {
	return s.SubmitRaw(now, ip, report, nil)
}

func mergeReportsPreferNew(next Report, prev Report) Report {
	merged := next

	// Preserve server-derived geo if the new report doesn't have it.
	if (merged.Geo == nil || merged.Geo.CountryCode == "") && prev.Geo != nil && prev.Geo.CountryCode != "" {
		merged.Geo = prev.Geo
	}

	// Avoid wiping structured client info if the new report is missing it.
	if merged.Client == nil && prev.Client != nil {
		merged.Client = prev.Client
	}
	if merged.Display == nil && prev.Display != nil {
		merged.Display = prev.Display
	}

	// If a new run fails to collect a section, keep the previous one.
	if len(merged.WebGPU.Formats) == 0 && len(prev.WebGPU.Formats) > 0 {
		merged.WebGPU = prev.WebGPU
	}
	if !merged.WebGL2.Available && prev.WebGL2.Available {
		merged.WebGL2 = prev.WebGL2
	}
	if !merged.WebGL1.Available && prev.WebGL1.Available {
		merged.WebGL1 = prev.WebGL1
	}

	return merged
}

func (s *Store) submitMemory(now time.Time, ip string, fingerprint string, report Report) (submitResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeCleanupLocked(now)

	s.totalReceived += 1

	if lastSeen, ok := s.lastSeenByFP[fingerprint]; ok && now.Sub(lastSeen) < s.cfg.DedupeTTL {
		s.totalDuplicate += 1
		s.lastSeenByFP[fingerprint] = now
		if existing, ok := s.reports[fingerprint]; ok {
			s.reports[fingerprint] = StoredReport{
				Fingerprint: fingerprint,
				ReceivedAt:  now,
				IP:          ip,
				Report:      mergeReportsPreferNew(report, existing.Report),
			}
		}
		return submitResult{
			Status:      "duplicate",
			Fingerprint: fingerprint,
			Stored:      false,
			StoredCount: len(s.reports),
			ReceivedAt:  now,
			Message:     "Duplicate fingerprint within dedupe window (updated existing record).",
		}, nil
	}

	// Accept: replace old entry if exists.
	if _, ok := s.reports[fingerprint]; ok {
		s.reports[fingerprint] = StoredReport{
			Fingerprint: fingerprint,
			ReceivedAt:  now,
			IP:          ip,
			Report:      report,
		}
		s.lastSeenByFP[fingerprint] = now
		s.totalAccepted += 1
		return submitResult{
			Status:      "accepted",
			Fingerprint: fingerprint,
			Stored:      true,
			StoredCount: len(s.reports),
			ReceivedAt:  now,
			Message:     "Updated existing fingerprint (outside dedupe window).",
		}, nil
	}

	s.reports[fingerprint] = StoredReport{
		Fingerprint: fingerprint,
		ReceivedAt:  now,
		IP:          ip,
		Report:      report,
	}
	s.order = append(s.order, fingerprint)
	s.lastSeenByFP[fingerprint] = now
	s.totalAccepted += 1

	for len(s.order) > s.cfg.MaxReports {
		oldest := s.order[0]
		s.order = s.order[1:]
		delete(s.reports, oldest)
		delete(s.lastSeenByFP, oldest)
	}

	return submitResult{
		Status:      "accepted",
		Fingerprint: fingerprint,
		Stored:      true,
		StoredCount: len(s.reports),
		ReceivedAt:  now,
		Message:     "Stored new fingerprint.",
	}, nil
}

func (s *Store) Reject(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeCleanupLocked(now)
	s.totalReceived += 1
	s.totalRejected += 1
}

func (s *Store) RateLimited(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeCleanupLocked(now)
	s.totalReceived += 1
	s.totalRateLimited += 1
}

func (s *Store) maybeCleanupLocked(now time.Time) {
	if now.Sub(s.lastCleanup) < s.cfg.CleanupEvery {
		return
	}
	// Limiter cleanup.
	for ip, lim := range s.limiters {
		if now.Sub(lim.lastSeen) > s.cfg.LimiterIdleTTL {
			delete(s.limiters, ip)
		}
	}
	s.lastCleanup = now
}

func (s *Store) SubmitRaw(now time.Time, ip string, report Report, _rawJSON []byte) (submitResult, error) {
	fingerprint := extractFingerprint(report)
	if fingerprint == "" {
		fingerprint = fallbackFingerprint(report)
	}

	if s.mongo != nil {
		return s.submitMongo(now, ip, fingerprint, report)
	}
	return s.submitMemory(now, ip, fingerprint, report)
}

type reportMeta struct {
	Browser         string
	OS              string
	DeviceType      string
	CPUArch         string
	Country         string
	AppleSilicon    *bool
	WebGPUAvailable bool
	WebGL2Available bool
	WebGL1Available bool
	HDRDisplay      bool
}

func reportMetaFromReport(r Report) reportMeta {
	meta := reportMeta{
		WebGPUAvailable: r.WebGPU.Available,
		WebGL2Available: r.WebGL2.Available,
		WebGL1Available: r.WebGL1.Available,
		HDRDisplay:      reportHDRDisplay(r),
	}

	if r.Client != nil && r.Client.Parsed != nil {
		if r.Client.Parsed.Browser != nil {
			meta.Browser = clampString(r.Client.Parsed.Browser.Name, 128)
		}
		if r.Client.Parsed.OS != nil {
			meta.OS = clampString(r.Client.Parsed.OS.Name, 128)
		}
		if r.Client.Parsed.Device != nil {
			meta.DeviceType = clampString(r.Client.Parsed.Device.Type, 64)
		}
	}
	meta.CPUArch = clampString(reportCPUArch(r), 64)
	if r.Geo != nil {
		meta.Country = clampString(r.Geo.CountryCode, 8)
	}

	meta.AppleSilicon = reportIsAppleSilicon(r)
	return meta
}

func clampString(s string, max int) string {
	v := strings.TrimSpace(s)
	if v == "" || max <= 0 {
		return ""
	}
	if len(v) <= max {
		return v
	}
	return v[:max]
}

type Report struct {
	GeneratedAt string       `json:"generatedAt,omitempty"`
	UserAgent   string       `json:"userAgent,omitempty"`
	Client      *ClientInfo  `json:"client,omitempty"`
	Geo         *GeoInfo     `json:"geo,omitempty"`
	Display     *DisplayInfo `json:"display,omitempty"`
	WebGPU      WebGPUReport `json:"webgpu"`
	WebGL2      WebGLReport  `json:"webgl2"`
	WebGL1      WebGLReport  `json:"webgl1"`
}

type GeoInfo struct {
	CountryCode string `json:"countryCode,omitempty"`
}

type DisplayInfo struct {
	DynamicRangeHigh      bool   `json:"dynamicRangeHigh,omitempty"`
	VideoDynamicRangeHigh bool   `json:"videoDynamicRangeHigh,omitempty"`
	HDRCapable            bool   `json:"hdrCapable,omitempty"`
	HDRSource             string `json:"hdrSource,omitempty"`
	ColorGamutRec2020     bool   `json:"colorGamutRec2020,omitempty"`
	ColorGamutP3          bool   `json:"colorGamutP3,omitempty"`
	ColorGamutSRGB        bool   `json:"colorGamutSRGB,omitempty"`
}

type ClientInfo struct {
	Parsed      *ClientParsed      `json:"parsed,omitempty"`
	Fingerprint *ClientFingerprint `json:"fingerprint,omitempty"`
	UA          *ClientUA          `json:"ua,omitempty"`
	CPU         *ClientCPU         `json:"cpu,omitempty"`
	Platform    *ClientPlatform    `json:"platform,omitempty"`
	Hardware    *ClientHardware    `json:"hardware,omitempty"`
}

type ClientUA struct {
	UserAgent string `json:"userAgent,omitempty"`
	Platform  string `json:"platform,omitempty"`
	Vendor    string `json:"vendor,omitempty"`
}

type ClientFingerprint struct {
	SHA256 *string `json:"sha256,omitempty"`
	FNV1a  string  `json:"fnv1a,omitempty"`
}

type ClientParsed struct {
	Browser *NameVersion `json:"browser,omitempty"`
	OS      *NameVersion `json:"os,omitempty"`
	Device  *DeviceInfo  `json:"device,omitempty"`
	Engine  *NameOnly    `json:"engine,omitempty"`
}

type ClientCPU struct {
	Architecture   string `json:"architecture,omitempty"`
	Bitness        string `json:"bitness,omitempty"`
	Source         string `json:"source,omitempty"`
	IsAppleSilicon *bool  `json:"isAppleSilicon,omitempty"`
	Evidence       string `json:"evidence,omitempty"`
}

type ClientPlatform struct {
	Summary string     `json:"summary,omitempty"`
	CPU     *ClientCPU `json:"cpu,omitempty"`
}

type ClientHardware struct {
	DeviceMemory        *float64 `json:"deviceMemory,omitempty"`
	HardwareConcurrency *int     `json:"hardwareConcurrency,omitempty"`
	MaxTouchPoints      *int     `json:"maxTouchPoints,omitempty"`
}

type NameOnly struct {
	Name   string `json:"name,omitempty"`
	Source string `json:"source,omitempty"`
}

type NameVersion struct {
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Source  string `json:"source,omitempty"`
}

type DeviceInfo struct {
	Type   string `json:"type,omitempty"`
	Model  string `json:"model,omitempty"`
	Source string `json:"source,omitempty"`
}

type WebGPUReport struct {
	Available             bool           `json:"available"`
	SecureContext         bool           `json:"secureContext"`
	PreferredCanvasFormat string         `json:"preferredCanvasFormat,omitempty"`
	AdapterFeatures       []string       `json:"adapterFeatures,omitempty"`
	DeviceFeatures        []string       `json:"deviceFeatures,omitempty"`
	Warnings              []string       `json:"warnings,omitempty"`
	Errors                []string       `json:"errors,omitempty"`
	Formats               []WebGPUFormat `json:"formats,omitempty"`
}

type WebGPUFormat struct {
	Format     string `json:"format"`
	Kind       string `json:"kind,omitempty"`
	HDR        bool   `json:"hdr"`
	Compressed bool   `json:"compressed"`
	Sampled    bool   `json:"sampled"`
	Filterable *bool  `json:"filterable"`
	Renderable bool   `json:"renderable"`
	Storage    bool   `json:"storage"`
}

type WebGLReport struct {
	Available         bool               `json:"available"`
	WebGL2            bool               `json:"webgl2,omitempty"`
	Basic             *WebGLBasic        `json:"basic,omitempty"`
	Limits            *WebGLLimits       `json:"limits,omitempty"`
	Extensions        map[string]bool    `json:"extensions,omitempty"`
	DebugInfo         *WebGLDebugInfo    `json:"debugInfo,omitempty"`
	CompressedFormats []string           `json:"compressedFormats,omitempty"`
	Anisotropy        *WebGLAnisotropy   `json:"anisotropy,omitempty"`
	TextureTests      *WebGLTextureTests `json:"textureTests,omitempty"`
}

type WebGLBasic struct {
	Version                string `json:"version,omitempty"`
	ShadingLanguageVersion string `json:"shadingLanguageVersion,omitempty"`
	Vendor                 string `json:"vendor,omitempty"`
	Renderer               string `json:"renderer,omitempty"`
}

type WebGLLimits struct {
	MaxTextureSize               int  `json:"MAX_TEXTURE_SIZE,omitempty"`
	MaxCubeMapTextureSize        int  `json:"MAX_CUBE_MAP_TEXTURE_SIZE,omitempty"`
	MaxRenderbufferSize          int  `json:"MAX_RENDERBUFFER_SIZE,omitempty"`
	MaxTextureImageUnits         int  `json:"MAX_TEXTURE_IMAGE_UNITS,omitempty"`
	MaxVertexTextureImageUnits   int  `json:"MAX_VERTEX_TEXTURE_IMAGE_UNITS,omitempty"`
	MaxCombinedTextureImageUnits int  `json:"MAX_COMBINED_TEXTURE_IMAGE_UNITS,omitempty"`
	Max3DTextureSize             *int `json:"MAX_3D_TEXTURE_SIZE,omitempty"`
	MaxArrayTextureLayers        *int `json:"MAX_ARRAY_TEXTURE_LAYERS,omitempty"`
}

type WebGLDebugInfo struct {
	UnmaskedVendor   string `json:"UNMASKED_VENDOR_WEBGL,omitempty"`
	UnmaskedRenderer string `json:"UNMASKED_RENDERER_WEBGL,omitempty"`
}

type WebGLAnisotropy struct {
	Supported bool     `json:"supported"`
	Max       *float64 `json:"max,omitempty"`
}

type WebGLTextureTests struct {
	FloatTexture        bool `json:"floatTexture"`
	HalfFloatTexture    bool `json:"halfFloatTexture"`
	FloatRenderable     bool `json:"floatRenderable"`
	HalfFloatRenderable bool `json:"halfFloatRenderable"`
}

func extractFingerprint(r Report) string {
	if r.Client == nil || r.Client.Fingerprint == nil {
		return ""
	}
	if r.Client.Fingerprint.SHA256 != nil && *r.Client.Fingerprint.SHA256 != "" {
		return "sha256:" + *r.Client.Fingerprint.SHA256
	}
	if r.Client.Fingerprint.FNV1a != "" {
		return "fnv1a:" + r.Client.Fingerprint.FNV1a
	}
	return ""
}

func fallbackFingerprint(r Report) string {
	ua := r.UserAgent
	if ua == "" && r.Client != nil && r.Client.UA != nil {
		ua = r.Client.UA.UserAgent
	}
	platform := ""
	if r.Client != nil && r.Client.UA != nil {
		platform = r.Client.UA.Platform
	}

	payload := fmt.Sprintf("ua=%s|platform=%s|webgpu=%t|wgl2=%t",
		ua, platform, r.WebGPU.Available, r.WebGL2.Available)
	sum := sha256.Sum256([]byte(payload))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func validateReport(r *Report) error {
	// Basic structural checks (avoid huge payloads / nonsense).
	if r.WebGPU.Available && len(r.WebGPU.Formats) == 0 {
		// WebGPU check usually returns a full list, but avoid rejecting older clients; treat as warning only.
		return nil
	}
	if len(r.WebGPU.Formats) > 300 {
		return fmt.Errorf("too many WebGPU formats: %d", len(r.WebGPU.Formats))
	}
	return nil
}

type StatsResponse struct {
	GeneratedAt time.Time    `json:"generatedAt"`
	UptimeSec   int64        `json:"uptimeSec"`
	Totals      Totals       `json:"totals"`
	Selection   Selection    `json:"selection"`
	Breakdown   Breakdown    `json:"breakdown"`
	WebGPU      WebGPUStats  `json:"webgpu"`
	WebGL       WebGLStats   `json:"webgl"`
	Display     DisplayStats `json:"display"`
}

type Selection struct {
	Matched int         `json:"matched"`
	Filter  StatsFilter `json:"filter"`
}

type StatsFilter struct {
	Browser         string   `json:"browser,omitempty"`
	OS              string   `json:"os,omitempty"`
	Country         string   `json:"country,omitempty"`
	DeviceType      string   `json:"deviceType,omitempty"`
	CPUArch         string   `json:"cpuArch,omitempty"`
	AppleSilicon    *bool    `json:"appleSilicon,omitempty"`
	WebGPUAvailable *bool    `json:"webgpuAvailable,omitempty"`
	WebGL2Available *bool    `json:"webgl2Available,omitempty"`
	WebGL1Available *bool    `json:"webgl1Available,omitempty"`
	HDRDisplay      *bool    `json:"hdrDisplay,omitempty"`
	WebGPUFeature   []string `json:"webgpuFeature,omitempty"`
	WebGL2Ext       []string `json:"webgl2Ext,omitempty"`
	WebGL1Ext       []string `json:"webgl1Ext,omitempty"`
}

type Totals struct {
	Stored        int `json:"stored"`
	TotalReceived int `json:"totalReceived"`
	Accepted      int `json:"accepted"`
	Duplicates    int `json:"duplicates"`
	RateLimited   int `json:"rateLimited"`
	Rejected      int `json:"rejected"`
}

type Breakdown struct {
	Browsers    []CountItem `json:"browsers"`
	OS          []CountItem `json:"os"`
	Countries   []CountItem `json:"countries"`
	DeviceTypes []CountItem `json:"deviceTypes"`
	CPUArch     []CountItem `json:"cpuArch"`
}

type CountItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type WebGPUStats struct {
	AvailableCount int          `json:"availableCount"`
	TestedCount    int          `json:"testedCount"`
	Formats        []FormatStat `json:"formats"`
}

type FormatStat struct {
	Format     string `json:"format"`
	Kind       string `json:"kind,omitempty"`
	HDR        bool   `json:"hdr"`
	HDRCount   int    `json:"hdrCount"`
	Compressed bool   `json:"compressed"`
	Tested     int    `json:"tested"`
	Any        int    `json:"any"`
	Sampled    int    `json:"sampled"`
	Filterable int    `json:"filterable"`
	Renderable int    `json:"renderable"`
	Storage    int    `json:"storage"`
}

type WebGLStats struct {
	WebGL2 WebGLContextStats `json:"webgl2"`
	WebGL1 WebGLContextStats `json:"webgl1"`
}

type WebGLContextStats struct {
	AvailableCount    int                   `json:"availableCount"`
	Extensions        []CountItem           `json:"extensions"`
	CompressedFormats []CountItem           `json:"compressedFormats"`
	Limits            WebGLLimitsStats      `json:"limits"`
	TextureTests      WebGLTextureTestStats `json:"textureTests"`
	Anisotropy        WebGLAnisotropyStats  `json:"anisotropy"`
}

type WebGLLimitsStats struct {
	MaxTextureSize               []CountItem `json:"maxTextureSize"`
	MaxCubeMapTextureSize        []CountItem `json:"maxCubeMapTextureSize"`
	MaxRenderbufferSize          []CountItem `json:"maxRenderbufferSize"`
	MaxTextureImageUnits         []CountItem `json:"maxTextureImageUnits"`
	MaxVertexTextureImageUnits   []CountItem `json:"maxVertexTextureImageUnits"`
	MaxCombinedTextureImageUnits []CountItem `json:"maxCombinedTextureImageUnits"`
	Max3DTextureSize             []CountItem `json:"max3DTextureSize,omitempty"`
	MaxArrayTextureLayers        []CountItem `json:"maxArrayTextureLayers,omitempty"`
}

type WebGLTextureTestStats struct {
	FloatTexture        int `json:"floatTexture"`
	HalfFloatTexture    int `json:"halfFloatTexture"`
	FloatRenderable     int `json:"floatRenderable"`
	HalfFloatRenderable int `json:"halfFloatRenderable"`
}

type WebGLAnisotropyStats struct {
	Supported int         `json:"supported"`
	Max       []CountItem `json:"max"`
}

type DisplayStats struct {
	DynamicRangeHigh  int `json:"dynamicRangeHigh"`
	ColorGamutRec2020 int `json:"colorGamutRec2020"`
	ColorGamutP3      int `json:"colorGamutP3"`
}

func (s *Store) Stats(now time.Time, filter StatsFilter) (StatsResponse, error) {
	if s.mongo != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		storedCount, err := s.countReportsFromMongo(ctx)
		if err != nil {
			return StatsResponse{}, err
		}
		reports, err := s.loadReportsFromMongo(ctx)
		if err != nil {
			return StatsResponse{}, err
		}

		s.mu.Lock()
		totals := Totals{
			Stored:        storedCount,
			TotalReceived: s.totalReceived,
			Accepted:      s.totalAccepted,
			Duplicates:    s.totalDuplicate,
			RateLimited:   s.totalRateLimited,
			Rejected:      s.totalRejected,
		}
		startedAt := s.startedAt
		s.mu.Unlock()

		return computeStats(now, startedAt, totals, reports, filter), nil
	}

	s.mu.Lock()
	reports := make([]Report, 0, len(s.reports))
	for _, stored := range s.reports {
		reports = append(reports, stored.Report)
	}
	storedCount := len(s.reports)
	totals := Totals{
		Stored:        storedCount,
		TotalReceived: s.totalReceived,
		Accepted:      s.totalAccepted,
		Duplicates:    s.totalDuplicate,
		RateLimited:   s.totalRateLimited,
		Rejected:      s.totalRejected,
	}
	startedAt := s.startedAt
	s.mu.Unlock()

	return computeStats(now, startedAt, totals, reports, filter), nil
}

func computeStats(now time.Time, startedAt time.Time, totals Totals, reports []Report, filter StatsFilter) StatsResponse {
	normalizeWebGLCompressedFormat := func(s string) string {
		s = strings.TrimSpace(s)
		if s == "" {
			return ""
		}
		switch strings.ToLower(s) {
		case "0x8c00":
			return "COMPRESSED_RGB_PVRTC_4BPPV1_IMG"
		case "0x8c01":
			return "COMPRESSED_RGB_PVRTC_2BPPV1_IMG"
		case "0x8c02":
			return "COMPRESSED_RGBA_PVRTC_4BPPV1_IMG"
		case "0x8c03":
			return "COMPRESSED_RGBA_PVRTC_2BPPV1_IMG"
		default:
			return s
		}
	}

	browserCounts := map[string]int{}
	osCounts := map[string]int{}
	countryCounts := map[string]int{}
	deviceCounts := map[string]int{}
	cpuCounts := map[string]int{}

	webgl2ExtCounts := map[string]int{}
	webgl1ExtCounts := map[string]int{}
	webgl2CompressedCounts := map[string]int{}
	webgl1CompressedCounts := map[string]int{}

	webgl2Limits := newWebGLLimitsCounter()
	webgl1Limits := newWebGLLimitsCounter()
	webgl2Tests := WebGLTextureTestStats{}
	webgl1Tests := WebGLTextureTestStats{}
	webgl2AnisoCounts := map[string]int{}
	webgl1AnisoCounts := map[string]int{}
	webgl2AnisoSupported := 0
	webgl1AnisoSupported := 0

	formatMap := map[string]*FormatStat{}
	webgpuAvailable := 0
	webgpuTested := 0
	webgl2Available := 0
	webgl1Available := 0

	dynamicRangeHigh := 0
	colorRec2020 := 0
	colorP3 := 0

	matched := 0
	for _, r := range reports {
		if !matchesStatsFilter(r, filter) {
			continue
		}
		matched += 1

		// Client breakdowns
		if r.Client != nil && r.Client.Parsed != nil {
			if r.Client.Parsed.Browser != nil && r.Client.Parsed.Browser.Name != "" {
				browserCounts[r.Client.Parsed.Browser.Name] += 1
			}
			if r.Client.Parsed.OS != nil && r.Client.Parsed.OS.Name != "" {
				osCounts[r.Client.Parsed.OS.Name] += 1
			}
			if r.Client.Parsed.Device != nil && r.Client.Parsed.Device.Type != "" {
				deviceCounts[r.Client.Parsed.Device.Type] += 1
			}

			if arch := reportCPUArch(r); arch != "" {
				cpuCounts[arch] += 1
			}
		} else if r.UserAgent != "" {
			browserCounts["Unknown"] += 1
			osCounts["Unknown"] += 1
			deviceCounts["Unknown"] += 1
			cpuCounts["Unknown"] += 1
		}

		// Geo
		if r.Geo != nil && r.Geo.CountryCode != "" {
			countryCounts[r.Geo.CountryCode] += 1
		} else {
			countryCounts["Unknown"] += 1
		}

		// Display
		if r.Display != nil {
			if r.Display.DynamicRangeHigh {
				dynamicRangeHigh += 1
			}
			if r.Display.ColorGamutRec2020 {
				colorRec2020 += 1
			}
			if r.Display.ColorGamutP3 {
				colorP3 += 1
			}
		}

		// WebGPU format list (may be derived from WebGL when WebGPU is blocked/unavailable).
		if r.WebGPU.Available {
			webgpuAvailable += 1
		}
		if len(r.WebGPU.Formats) > 0 {
			webgpuTested += 1
			for _, f := range r.WebGPU.Formats {
				stat := formatMap[f.Format]
				if stat == nil {
					stat = &FormatStat{
						Format:     f.Format,
						Kind:       f.Kind,
						HDR:        f.HDR,
						Compressed: f.Compressed,
					}
					formatMap[f.Format] = stat
				} else {
					// Merge static-ish format metadata across reports. Some formats (e.g. ASTC HDR profile)
					// can vary across devices, so treat flags as "any report says yes".
					if stat.Kind == "" && f.Kind != "" {
						stat.Kind = f.Kind
					}
					if !stat.HDR && f.HDR {
						stat.HDR = true
					}
					if !stat.Compressed && f.Compressed {
						stat.Compressed = true
					}
				}
				stat.Tested += 1
				if f.HDR {
					stat.HDRCount += 1
				}
				if f.Sampled {
					stat.Sampled += 1
				}
				if f.Filterable != nil && *f.Filterable {
					stat.Filterable += 1
				}
				if f.Renderable {
					stat.Renderable += 1
				}
				if f.Storage {
					stat.Storage += 1
				}
				if f.Sampled || f.Renderable || f.Storage {
					stat.Any += 1
				}
			}
		}

		if r.WebGL2.Available {
			webgl2Available += 1
			for k, v := range r.WebGL2.Extensions {
				if v {
					webgl2ExtCounts[k] += 1
				}
			}
			for _, cf := range r.WebGL2.CompressedFormats {
				if name := normalizeWebGLCompressedFormat(cf); name != "" {
					webgl2CompressedCounts[name] += 1
				}
			}

			if r.WebGL2.Limits != nil {
				webgl2Limits.add(r.WebGL2.Limits)
			}
			if r.WebGL2.TextureTests != nil {
				if r.WebGL2.TextureTests.FloatTexture {
					webgl2Tests.FloatTexture += 1
				}
				if r.WebGL2.TextureTests.HalfFloatTexture {
					webgl2Tests.HalfFloatTexture += 1
				}
				if r.WebGL2.TextureTests.FloatRenderable {
					webgl2Tests.FloatRenderable += 1
				}
				if r.WebGL2.TextureTests.HalfFloatRenderable {
					webgl2Tests.HalfFloatRenderable += 1
				}
			}
			if r.WebGL2.Anisotropy != nil && r.WebGL2.Anisotropy.Supported {
				webgl2AnisoSupported += 1
				if r.WebGL2.Anisotropy.Max != nil {
					webgl2AnisoCounts[fmt.Sprintf("%d", int(*r.WebGL2.Anisotropy.Max+0.5))] += 1
				}
			}
		}
		if r.WebGL1.Available {
			webgl1Available += 1

			for k, v := range r.WebGL1.Extensions {
				if v {
					webgl1ExtCounts[k] += 1
				}
			}
			for _, cf := range r.WebGL1.CompressedFormats {
				if name := normalizeWebGLCompressedFormat(cf); name != "" {
					webgl1CompressedCounts[name] += 1
				}
			}
			if r.WebGL1.Limits != nil {
				webgl1Limits.add(r.WebGL1.Limits)
			}
			if r.WebGL1.TextureTests != nil {
				if r.WebGL1.TextureTests.FloatTexture {
					webgl1Tests.FloatTexture += 1
				}
				if r.WebGL1.TextureTests.HalfFloatTexture {
					webgl1Tests.HalfFloatTexture += 1
				}
				if r.WebGL1.TextureTests.FloatRenderable {
					webgl1Tests.FloatRenderable += 1
				}
				if r.WebGL1.TextureTests.HalfFloatRenderable {
					webgl1Tests.HalfFloatRenderable += 1
				}
			}
			if r.WebGL1.Anisotropy != nil && r.WebGL1.Anisotropy.Supported {
				webgl1AnisoSupported += 1
				if r.WebGL1.Anisotropy.Max != nil {
					webgl1AnisoCounts[fmt.Sprintf("%d", int(*r.WebGL1.Anisotropy.Max+0.5))] += 1
				}
			}
		}
	}

	return StatsResponse{
		GeneratedAt: now,
		UptimeSec:   int64(now.Sub(startedAt).Seconds()),
		Totals:      totals,
		Selection: Selection{
			Matched: matched,
			Filter:  filter,
		},
		Breakdown: Breakdown{
			Browsers:    sortCounts(browserCounts),
			OS:          sortCounts(osCounts),
			Countries:   sortCounts(countryCounts),
			DeviceTypes: sortCounts(deviceCounts),
			CPUArch:     sortCounts(cpuCounts),
		},
		WebGPU: WebGPUStats{
			AvailableCount: webgpuAvailable,
			TestedCount:    webgpuTested,
			Formats:        sortFormatStats(formatMap),
		},
		WebGL: WebGLStats{
			WebGL2: WebGLContextStats{
				AvailableCount:    webgl2Available,
				Extensions:        sortCounts(webgl2ExtCounts),
				CompressedFormats: sortCounts(webgl2CompressedCounts),
				Limits:            webgl2Limits.stats(webgl2Available),
				TextureTests:      webgl2Tests,
				Anisotropy: WebGLAnisotropyStats{
					Supported: webgl2AnisoSupported,
					Max:       sortCounts(webgl2AnisoCounts),
				},
			},
			WebGL1: WebGLContextStats{
				AvailableCount:    webgl1Available,
				Extensions:        sortCounts(webgl1ExtCounts),
				CompressedFormats: sortCounts(webgl1CompressedCounts),
				Limits:            webgl1Limits.stats(webgl1Available),
				TextureTests:      webgl1Tests,
				Anisotropy: WebGLAnisotropyStats{
					Supported: webgl1AnisoSupported,
					Max:       sortCounts(webgl1AnisoCounts),
				},
			},
		},
		Display: DisplayStats{
			DynamicRangeHigh:  dynamicRangeHigh,
			ColorGamutRec2020: colorRec2020,
			ColorGamutP3:      colorP3,
		},
	}
}

type webglLimitsCounter struct {
	maxTextureSize               map[string]int
	maxCubeMapTextureSize        map[string]int
	maxRenderbufferSize          map[string]int
	maxTextureImageUnits         map[string]int
	maxVertexTextureImageUnits   map[string]int
	maxCombinedTextureImageUnits map[string]int
	max3DTextureSize             map[string]int
	maxArrayTextureLayers        map[string]int
}

func newWebGLLimitsCounter() webglLimitsCounter {
	return webglLimitsCounter{
		maxTextureSize:               map[string]int{},
		maxCubeMapTextureSize:        map[string]int{},
		maxRenderbufferSize:          map[string]int{},
		maxTextureImageUnits:         map[string]int{},
		maxVertexTextureImageUnits:   map[string]int{},
		maxCombinedTextureImageUnits: map[string]int{},
		max3DTextureSize:             map[string]int{},
		maxArrayTextureLayers:        map[string]int{},
	}
}

func (c *webglLimitsCounter) add(l *WebGLLimits) {
	if l == nil {
		return
	}
	incInt(c.maxTextureSize, l.MaxTextureSize)
	incInt(c.maxCubeMapTextureSize, l.MaxCubeMapTextureSize)
	incInt(c.maxRenderbufferSize, l.MaxRenderbufferSize)
	incInt(c.maxTextureImageUnits, l.MaxTextureImageUnits)
	incInt(c.maxVertexTextureImageUnits, l.MaxVertexTextureImageUnits)
	incInt(c.maxCombinedTextureImageUnits, l.MaxCombinedTextureImageUnits)
	if l.Max3DTextureSize != nil {
		incInt(c.max3DTextureSize, *l.Max3DTextureSize)
	}
	if l.MaxArrayTextureLayers != nil {
		incInt(c.maxArrayTextureLayers, *l.MaxArrayTextureLayers)
	}
}

func (c *webglLimitsCounter) stats(availableCount int) WebGLLimitsStats {
	_ = availableCount
	return WebGLLimitsStats{
		MaxTextureSize:               sortCounts(c.maxTextureSize),
		MaxCubeMapTextureSize:        sortCounts(c.maxCubeMapTextureSize),
		MaxRenderbufferSize:          sortCounts(c.maxRenderbufferSize),
		MaxTextureImageUnits:         sortCounts(c.maxTextureImageUnits),
		MaxVertexTextureImageUnits:   sortCounts(c.maxVertexTextureImageUnits),
		MaxCombinedTextureImageUnits: sortCounts(c.maxCombinedTextureImageUnits),
		Max3DTextureSize:             sortCounts(c.max3DTextureSize),
		MaxArrayTextureLayers:        sortCounts(c.maxArrayTextureLayers),
	}
}

func incInt(m map[string]int, v int) {
	if v <= 0 {
		return
	}
	m[fmt.Sprintf("%d", v)] += 1
}

func sumCounts(m map[string]int) int {
	sum := 0
	for _, v := range m {
		sum += v
	}
	return sum
}

func matchesStatsFilter(r Report, f StatsFilter) bool {
	if f.Browser != "" {
		if r.Client == nil || r.Client.Parsed == nil || r.Client.Parsed.Browser == nil || !strings.EqualFold(r.Client.Parsed.Browser.Name, f.Browser) {
			return false
		}
	}
	if f.OS != "" {
		if r.Client == nil || r.Client.Parsed == nil || r.Client.Parsed.OS == nil || !strings.EqualFold(r.Client.Parsed.OS.Name, f.OS) {
			return false
		}
	}
	if f.Country != "" {
		if r.Geo == nil || !strings.EqualFold(r.Geo.CountryCode, f.Country) {
			return false
		}
	}
	if f.DeviceType != "" {
		if r.Client == nil || r.Client.Parsed == nil || r.Client.Parsed.Device == nil || !strings.EqualFold(r.Client.Parsed.Device.Type, f.DeviceType) {
			return false
		}
	}
	if f.CPUArch != "" {
		if !strings.EqualFold(reportCPUArch(r), f.CPUArch) {
			return false
		}
	}
	if f.AppleSilicon != nil {
		v := reportIsAppleSilicon(r)
		if v == nil || *v != *f.AppleSilicon {
			return false
		}
	}
	if f.WebGPUAvailable != nil {
		if r.WebGPU.Available != *f.WebGPUAvailable {
			return false
		}
	}
	if f.WebGL2Available != nil {
		if r.WebGL2.Available != *f.WebGL2Available {
			return false
		}
	}
	if f.WebGL1Available != nil {
		if r.WebGL1.Available != *f.WebGL1Available {
			return false
		}
	}
	if f.HDRDisplay != nil {
		hasHDR := reportHDRDisplay(r)
		if hasHDR != *f.HDRDisplay {
			return false
		}
	}
	if len(f.WebGPUFeature) > 0 {
		for _, feature := range f.WebGPUFeature {
			if feature == "" {
				continue
			}
			if !reportHasWebGPUFeature(r, feature) {
				return false
			}
		}
	}
	if len(f.WebGL2Ext) > 0 {
		for _, ext := range f.WebGL2Ext {
			if ext == "" {
				continue
			}
			if !reportHasWebGLExt(r.WebGL2, ext) {
				return false
			}
		}
	}
	if len(f.WebGL1Ext) > 0 {
		for _, ext := range f.WebGL1Ext {
			if ext == "" {
				continue
			}
			if !reportHasWebGLExt(r.WebGL1, ext) {
				return false
			}
		}
	}
	return true
}

func reportHDRDisplay(r Report) bool {
	if r.Display == nil {
		return false
	}
	if r.Display.HDRCapable {
		return true
	}
	if r.Display.DynamicRangeHigh {
		return true
	}
	if r.Display.VideoDynamicRangeHigh {
		return true
	}
	return false
}

func reportHasWebGLExt(r WebGLReport, ext string) bool {
	if !r.Available || r.Extensions == nil {
		return false
	}
	v, ok := r.Extensions[ext]
	return ok && v
}

func reportHasWebGPUFeature(r Report, feature string) bool {
	if !r.WebGPU.Available {
		return false
	}
	for _, f := range r.WebGPU.DeviceFeatures {
		if f == feature {
			return true
		}
	}
	for _, f := range r.WebGPU.AdapterFeatures {
		if f == feature {
			return true
		}
	}
	return false
}

func reportCPUArch(r Report) string {
	if r.Client == nil {
		return ""
	}
	if r.Client.CPU != nil && r.Client.CPU.Architecture != "" {
		return r.Client.CPU.Architecture
	}
	if r.Client.Platform != nil && r.Client.Platform.CPU != nil && r.Client.Platform.CPU.Architecture != "" {
		return r.Client.Platform.CPU.Architecture
	}
	return ""
}

func reportIsAppleSilicon(r Report) *bool {
	if r.Client == nil {
		return nil
	}
	if r.Client.CPU != nil && r.Client.CPU.IsAppleSilicon != nil {
		return r.Client.CPU.IsAppleSilicon
	}
	if r.Client.Platform != nil && r.Client.Platform.CPU != nil && r.Client.Platform.CPU.IsAppleSilicon != nil {
		return r.Client.Platform.CPU.IsAppleSilicon
	}
	return nil
}

func parseStatsFilter(q url.Values) StatsFilter {
	f := StatsFilter{
		Browser:         strings.TrimSpace(q.Get("browser")),
		OS:              strings.TrimSpace(q.Get("os")),
		Country:         strings.TrimSpace(q.Get("country")),
		DeviceType:      strings.TrimSpace(q.Get("deviceType")),
		CPUArch:         strings.TrimSpace(q.Get("cpuArch")),
		AppleSilicon:    parseBoolPtr(q.Get("appleSilicon")),
		WebGPUAvailable: parseBoolPtr(q.Get("webgpuAvailable")),
		WebGL2Available: parseBoolPtr(q.Get("webgl2Available")),
		WebGL1Available: parseBoolPtr(q.Get("webgl1Available")),
		HDRDisplay:      parseBoolPtr(q.Get("hdrDisplay")),
		WebGPUFeature:   splitCSVParams(q["webgpuFeature"]),
		WebGL2Ext:       splitCSVParams(q["webgl2Ext"]),
		WebGL1Ext:       splitCSVParams(q["webgl1Ext"]),
	}
	return f
}

func parseBoolPtr(raw string) *bool {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" {
		return nil
	}
	switch s {
	case "1", "true", "t", "yes", "y", "on":
		v := true
		return &v
	case "0", "false", "f", "no", "n", "off":
		v := false
		return &v
	default:
		return nil
	}
}

func splitCSVParams(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			p := strings.TrimSpace(part)
			if p == "" {
				continue
			}
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

func sortCounts(m map[string]int) []CountItem {
	items := make([]CountItem, 0, len(m))
	for k, v := range m {
		items = append(items, CountItem{Name: k, Count: v})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Count == items[j].Count {
			return items[i].Name < items[j].Name
		}
		return items[i].Count > items[j].Count
	})
	return items
}

func sortFormatStats(m map[string]*FormatStat) []FormatStat {
	items := make([]FormatStat, 0, len(m))
	for _, v := range m {
		items = append(items, *v)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Format < items[j].Format
	})
	return items
}

func isRender() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("RENDER")), "true")
}

func defaultListenAddr() string {
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		if _, err := strconv.Atoi(p); err == nil {
			return ":" + p
		}
	}
	if isRender() {
		// Render web services default to port 10000 if PORT isn't set.
		return ":10000"
	}
	return ":8080"
}

func main() {
	loadDotEnvNoOverwrite(".env")

	addr := flag.String("addr", defaultListenAddr(), "listen address")
	mongoURI := flag.String("mongo-uri", strings.TrimSpace(firstEnv("MONGO_URI", "MONGODB_URI")), "MongoDB connection string (env MONGO_URI/MONGODB_URI)")
	maxReports := flag.Int("max-reports", 2000, "max unique reports stored (memory or MongoDB)")
	dedupeTTL := flag.Duration("dedupe-ttl", 24*time.Hour, "duplicate window (by fingerprint)")
	ratePerMin := flag.Float64("rate-per-minute", 30, "rate limit for POST /api/report per IP (per minute)")
	burst := flag.Float64("rate-burst", 60, "rate limit burst size per IP")
	flag.Parse()

	cfg := Config{
		MaxReports:     *maxReports,
		DedupeTTL:      *dedupeTTL,
		MaxBodyBytes:   2 << 20, // 2 MiB
		RatePerMinute:  *ratePerMin,
		RateBurst:      *burst,
		CleanupEvery:   30 * time.Second,
		LimiterIdleTTL: 30 * time.Minute,
	}

	if isRender() && strings.TrimSpace(mongoURIFromEnv()) == "" && strings.TrimSpace(*mongoURI) == "" {
		log.Fatal("MONGO_URI is required on Render (set it from your MongoDB Atlas connection string).")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	mongo, err := openAndInitMongo(ctx, *mongoURI)
	if err != nil {
		log.Fatalf("Mongo init failed: %v", err)
	}

	store := NewStore(cfg, mongo)
	mux := http.NewServeMux()

	mux.Handle("/healthz", healthHandler(store))
	mux.Handle("/api/", apiHandler(store))
	mux.Handle("/", staticHandler())

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("Serving on http://%s (open / and /stats)", serverListenHint(*addr))
	log.Fatal(srv.ListenAndServe())
}

func serverListenHint(addr string) string {
	// Helpful for ":8080" case.
	if strings.HasPrefix(addr, ":") {
		return "localhost" + addr
	}
	return addr
}

func staticHandler() http.Handler {
	fsHandler := http.FileServer(http.FS(staticFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("X-HDR-Detection", "1")

		// Common dev-time issue: another project registered a Service Worker on this origin.
		// Serving a reset SW at common paths helps recover without digging through browser settings.
		if r.URL.Path == "/service-worker.js" || r.URL.Path == "/sw.js" {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write([]byte(serviceWorkerResetScript))
			return
		}

		switch r.URL.Path {
		case "/stats":
			r.URL.Path = "/stats.html"
		}
		// Dev-friendly: avoid stale JS/HTML.
		w.Header().Set("Cache-Control", "no-store")
		fsHandler.ServeHTTP(w, r)
	})
}

const serviceWorkerResetScript = `/* hdr-detection reset SW */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.registration.unregister(); } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try { client.navigate(client.url); } catch {}
      }
    } catch {}
  })());
});
// Intentionally no fetch handler: fall through to network.
`

func healthHandler(store *Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		dbOK := false
		dbMsg := "disabled"
		if store.mongo != nil {
			dbOK = store.mongoPing(ctx) == nil
			if dbOK {
				dbMsg = "ok"
			} else {
				dbMsg = "unavailable"
			}
		}

		store.mu.Lock()
		uptimeSec := int64(time.Since(store.startedAt).Seconds())
		store.mu.Unlock()

		status := http.StatusOK
		if store.mongo != nil && !dbOK {
			status = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		writeJSON(w, status, map[string]any{
			"ok":        status == http.StatusOK,
			"db":        dbMsg,
			"uptimeSec": uptimeSec,
		})
	})
}

func apiHandler(store *Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-HDR-Detection", "1")

		switch r.URL.Path {
		case "/api/stats":
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
				return
			}
			filter := parseStatsFilter(r.URL.Query())
			stats, err := store.Stats(time.Now(), filter)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "stats unavailable", "details": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, stats)
			return
		case "/api/report":
			if r.Method != http.MethodPost {
				writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
				return
			}
			handleReport(w, r, store)
			return
		default:
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
			return
		}
	})
}

func handleReport(w http.ResponseWriter, r *http.Request, store *Store) {
	now := time.Now()
	ip := clientIP(r)

	if !allowOrigin(r) {
		store.Reject(now)
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden origin"})
		return
	}

	if !store.allowIP(now, ip) {
		store.RateLimited(now)
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate limited"})
		return
	}

	ct := r.Header.Get("Content-Type")
	if ct != "" && !strings.HasPrefix(strings.ToLower(ct), "application/json") {
		store.Reject(now)
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "content-type must be application/json"})
		return
	}

	body := http.MaxBytesReader(w, r.Body, store.cfg.MaxBodyBytes)
	defer body.Close()

	raw, err := io.ReadAll(body)
	if err != nil {
		store.Reject(now)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body", "details": err.Error()})
		return
	}

	var report Report
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&report); err != nil {
		store.Reject(now)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json", "details": err.Error()})
		return
	}
	if err := ensureEOF(dec); err != nil {
		store.Reject(now)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json", "details": err.Error()})
		return
	}
	if err := validateReport(&report); err != nil {
		store.Reject(now)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid report", "details": err.Error()})
		return
	}

	countryCode := ""
	if store.geo != nil {
		countryCode = store.geo.CountryCode(r.Context(), now, ip, r)
	}
	if countryCode != "" {
		report.Geo = &GeoInfo{CountryCode: countryCode}
	} else {
		// Never trust client-provided geo fields; keep server-derived only.
		report.Geo = nil
	}

	res, err := store.SubmitRaw(now, ip, report, raw)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to store report", "details": err.Error()})
		return
	}
	res.CountryCode = countryCode
	status := http.StatusOK
	if res.Status == "duplicate" {
		status = http.StatusOK
	}
	writeJSON(w, status, res)
}

func ensureEOF(dec *json.Decoder) error {
	// After a single Decode, there should be only whitespace until EOF.
	// Attempting another decode should yield io.EOF.
	var extra any
	if err := dec.Decode(&extra); err == io.EOF {
		return nil
	} else if err != nil {
		return err
	}
	return fmt.Errorf("unexpected extra json value")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func clientIP(r *http.Request) string {
	remoteIP := stripPortMaybe(r.RemoteAddr)

	// Only trust X-Forwarded-For when we're likely behind a reverse proxy (Render or private hop).
	// This prevents trivial spoofing when running the server directly on the public internet.
	trustProxyHeaders := isRender() || isPrivateOrLoopbackIP(remoteIP)

	if trustProxyHeaders {
		if fwd := strings.TrimSpace(r.Header.Get("Forwarded")); fwd != "" {
			if ip := firstClientIPFromForwarded(fwd); ip != "" {
				return ip
			}
		}
		if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
			if ip := firstClientIPFromXFF(xff); ip != "" {
				return ip
			}
		}
		if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
			if ip := stripPortMaybe(xrip); ip != "" {
				return ip
			}
		}
	}

	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return remoteIP
}

func stripPortMaybe(hostport string) string {
	host := strings.TrimSpace(hostport)
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

func firstClientIPFromXFF(xff string) string {
	parts := strings.Split(xff, ",")
	firstValid := ""

	for _, part := range parts {
		raw := strings.TrimSpace(part)
		if raw == "" || strings.EqualFold(raw, "unknown") {
			continue
		}
		ipStr := strings.Trim(stripPortMaybe(raw), "[]")
		if ipStr == "" {
			continue
		}
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if firstValid == "" {
			firstValid = ipStr
		}
		if isPublicIP(ip) {
			return ipStr
		}
	}
	return firstValid
}

func firstClientIPFromForwarded(forwarded string) string {
	// RFC 7239 Forwarded header.
	// Example:
	//   Forwarded: for=192.0.2.60;proto=https;by=203.0.113.43, for="[2001:db8:cafe::17]:4711"
	elements := strings.Split(forwarded, ",")
	firstValid := ""

	for _, el := range elements {
		params := strings.Split(el, ";")
		for _, param := range params {
			p := strings.TrimSpace(param)
			if len(p) < 5 {
				continue
			}
			if !strings.HasPrefix(strings.ToLower(p), "for=") {
				continue
			}

			val := strings.TrimSpace(p[4:])
			if val == "" {
				continue
			}
			if strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"") && len(val) >= 2 {
				val = strings.Trim(val, "\"")
			}
			if val == "" || strings.EqualFold(val, "unknown") || strings.HasPrefix(val, "_") {
				// Obfuscated identifier or unknown.
				continue
			}

			ipStr := strings.Trim(stripPortMaybe(val), "[]")
			if ipStr == "" {
				continue
			}
			ip := net.ParseIP(ipStr)
			if ip == nil {
				continue
			}
			if firstValid == "" {
				firstValid = ipStr
			}
			if isPublicIP(ip) {
				return ipStr
			}
		}
	}
	return firstValid
}

func isPrivateOrLoopbackIP(ipStr string) bool {
	ip := net.ParseIP(strings.Trim(ipStr, "[]"))
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	return isCGNAT(ip)
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if !ip.IsGlobalUnicast() {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return !isCGNAT(ip)
}

func isCGNAT(ip net.IP) bool {
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	// RFC 6598: 100.64.0.0/10
	return v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
}

func allowOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	originHost := u.Host
	if originHost == "" {
		return false
	}
	if strings.EqualFold(originHost, r.Host) {
		return true
	}

	oh, op := splitHostPortLoose(originHost)
	rh, rp := splitHostPortLoose(r.Host)
	if op != "" && rp != "" && op != rp {
		return false
	}
	if isLoopbackHost(oh) && isLoopbackHost(rh) {
		return true
	}
	return false
}

func splitHostPortLoose(hostport string) (host string, port string) {
	if h, p, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(h, "[]"), p
	}
	// url.Host may omit port
	return strings.Trim(hostport, "[]"), ""
}

func isLoopbackHost(host string) bool {
	h := strings.ToLower(strings.Trim(host, "[]"))
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}
