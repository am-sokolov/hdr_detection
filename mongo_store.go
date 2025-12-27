package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

type mongoStore struct {
	client *mongo.Client
	db     *mongo.Database
	coll   *mongo.Collection
}

type reportDoc struct {
	Fingerprint     string    `bson:"fingerprint"`
	CreatedAt       time.Time `bson:"createdAt"`
	ReceivedAt      time.Time `bson:"receivedAt"`
	Browser         string    `bson:"browser,omitempty"`
	OS              string    `bson:"os,omitempty"`
	DeviceType      string    `bson:"deviceType,omitempty"`
	CPUArch         string    `bson:"cpuArch,omitempty"`
	Country         string    `bson:"country,omitempty"`
	AppleSilicon    *bool     `bson:"appleSilicon,omitempty"`
	WebGPUAvailable bool      `bson:"webgpuAvailable"`
	WebGL2Available bool      `bson:"webgl2Available"`
	WebGL1Available bool      `bson:"webgl1Available"`
	HDRDisplay      bool      `bson:"hdrDisplay"`
	Report          Report    `bson:"report"`
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func mongoURIFromEnv() string {
	if v := firstEnv("MONGO_URI", "MONGODB_URI"); v != "" {
		return v
	}

	// Fall back to building a Mongo Atlas URI from parts.
	user := firstEnv("MONGO_USER", "MONGO_USERNAME", "MONGO_ATLAS_USER", "MONGO_ATLAS_USERNAME")
	pass := firstEnv("MONGO_PASSWORD", "MONGO_ATLAS_PASSWORD")
	host := firstEnv("MONGO_HOST", "MONGO_ATLAS_HOST", "MONGO_CLUSTER", "MONGO_ATLAS_CLUSTER")
	if host == "" {
		return ""
	}
	if strings.Contains(host, "://") {
		return host
	}

	scheme := firstEnv("MONGO_SCHEME")
	if scheme == "" {
		scheme = "mongodb+srv"
	}

	dbName := firstEnv("MONGO_DB", "MONGO_DATABASE")
	params := firstEnv("MONGO_PARAMS")
	if params == "" {
		params = "retryWrites=true&w=majority"
	}

	u := &url.URL{Scheme: scheme, Host: host, RawQuery: params}
	if dbName != "" {
		u.Path = "/" + dbName
	}
	if user != "" {
		if pass != "" {
			u.User = url.UserPassword(user, pass)
		} else {
			u.User = url.User(user)
		}
	}
	return u.String()
}

func mongoDBNameFromURI(uri string) string {
	u, err := url.Parse(strings.TrimSpace(uri))
	if err != nil {
		return ""
	}
	return strings.Trim(u.Path, "/")
}

func openAndInitMongo(ctx context.Context, mongoURI string) (*mongoStore, error) {
	uri := strings.TrimSpace(mongoURI)
	if uri == "" {
		uri = mongoURIFromEnv()
	}
	if uri == "" {
		return nil, nil
	}

	dbName := firstEnv("MONGO_DB", "MONGO_DATABASE")
	if dbName == "" {
		dbName = mongoDBNameFromURI(uri)
	}
	if dbName == "" {
		dbName = "hdr_detection"
	}
	collName := firstEnv("MONGO_COLLECTION")
	if collName == "" {
		collName = "reports"
	}

	opts := options.Client().ApplyURI(uri)
	opts.SetServerSelectionTimeout(5 * time.Second)
	opts.SetConnectTimeout(8 * time.Second)

	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("mongo ping: %w", err)
	}

	db := client.Database(dbName)
	coll := db.Collection(collName)

	indexCtx, indexCancel := context.WithTimeout(ctx, 10*time.Second)
	defer indexCancel()
	if err := ensureMongoIndexes(indexCtx, coll); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}

	return &mongoStore{client: client, db: db, coll: coll}, nil
}

func ensureMongoIndexes(ctx context.Context, coll *mongo.Collection) error {
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "fingerprint", Value: 1}},
			Options: options.Index().SetName("fingerprint_unique").SetUnique(true),
		},
		{
			Keys:    bson.D{{Key: "createdAt", Value: -1}},
			Options: options.Index().SetName("created_at_desc"),
		},
		{
			Keys:    bson.D{{Key: "browser", Value: 1}},
			Options: options.Index().SetName("browser"),
		},
		{
			Keys:    bson.D{{Key: "os", Value: 1}},
			Options: options.Index().SetName("os"),
		},
		{
			Keys:    bson.D{{Key: "country", Value: 1}},
			Options: options.Index().SetName("country"),
		},
		{
			Keys:    bson.D{{Key: "deviceType", Value: 1}},
			Options: options.Index().SetName("deviceType"),
		},
		{
			Keys:    bson.D{{Key: "cpuArch", Value: 1}},
			Options: options.Index().SetName("cpuArch"),
		},
		{
			Keys:    bson.D{{Key: "appleSilicon", Value: 1}},
			Options: options.Index().SetName("appleSilicon"),
		},
		{
			Keys:    bson.D{{Key: "webgpuAvailable", Value: 1}},
			Options: options.Index().SetName("webgpuAvailable"),
		},
		{
			Keys:    bson.D{{Key: "webgl2Available", Value: 1}},
			Options: options.Index().SetName("webgl2Available"),
		},
		{
			Keys:    bson.D{{Key: "webgl1Available", Value: 1}},
			Options: options.Index().SetName("webgl1Available"),
		},
		{
			Keys:    bson.D{{Key: "hdrDisplay", Value: 1}},
			Options: options.Index().SetName("hdrDisplay"),
		},
	}
	if _, err := coll.Indexes().CreateMany(ctx, models); err != nil {
		return fmt.Errorf("mongo create indexes: %w", err)
	}
	return nil
}

func (s *Store) mongoPing(ctx context.Context) error {
	if s.mongo == nil || s.mongo.client == nil {
		return nil
	}
	return s.mongo.client.Ping(ctx, readpref.Primary())
}

func (s *Store) countReportsFromMongo(ctx context.Context) (int, error) {
	if s.mongo == nil || s.mongo.coll == nil {
		return 0, nil
	}
	n, err := s.mongo.coll.CountDocuments(ctx, bson.D{})
	if err != nil {
		return 0, fmt.Errorf("count reports: %w", err)
	}
	return int(n), nil
}

func (s *Store) loadReportsFromMongo(ctx context.Context) ([]Report, error) {
	if s.mongo == nil || s.mongo.coll == nil {
		return nil, nil
	}

	findOpts := options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetProjection(bson.D{{Key: "report", Value: 1}}).
		SetLimit(int64(s.cfg.MaxReports))

	cur, err := s.mongo.coll.Find(ctx, bson.D{}, findOpts)
	if err != nil {
		return nil, fmt.Errorf("load reports: %w", err)
	}
	defer cur.Close(ctx)

	reports := make([]Report, 0, 256)
	for cur.Next(ctx) {
		var doc struct {
			Report Report `bson:"report"`
		}
		if err := cur.Decode(&doc); err != nil {
			continue
		}
		reports = append(reports, doc.Report)
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("iterate reports: %w", err)
	}
	return reports, nil
}

func (s *Store) pruneMongo(ctx context.Context) error {
	if s.mongo == nil || s.mongo.coll == nil {
		return nil
	}
	if s.cfg.MaxReports <= 0 {
		return nil
	}

	count, err := s.mongo.coll.CountDocuments(ctx, bson.D{})
	if err != nil {
		return fmt.Errorf("count reports: %w", err)
	}
	max := int64(s.cfg.MaxReports)
	if count <= max {
		return nil
	}
	toDelete := count - max

	findOpts := options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: 1}}).
		SetLimit(toDelete).
		SetProjection(bson.D{{Key: "_id", Value: 1}})

	cur, err := s.mongo.coll.Find(ctx, bson.D{}, findOpts)
	if err != nil {
		return fmt.Errorf("prune find: %w", err)
	}
	defer cur.Close(ctx)

	capHint := int(minInt64(toDelete, 2048))
	ids := make([]bson.ObjectID, 0, capHint)
	for cur.Next(ctx) {
		var row struct {
			ID bson.ObjectID `bson:"_id"`
		}
		if err := cur.Decode(&row); err != nil {
			continue
		}
		ids = append(ids, row.ID)
	}
	if err := cur.Err(); err != nil {
		return fmt.Errorf("prune iterate: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}

	_, err = s.mongo.coll.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": ids}})
	if err != nil {
		return fmt.Errorf("prune delete: %w", err)
	}
	return nil
}

func minInt64(a int64, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func (s *Store) submitMongo(now time.Time, _ip string, fingerprint string, report Report) (submitResult, error) {
	s.mu.Lock()
	s.maybeCleanupLocked(now)
	s.totalReceived += 1
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	meta := reportMetaFromReport(report)
	doc := reportDoc{
		Fingerprint:     fingerprint,
		CreatedAt:       now,
		ReceivedAt:      now,
		Browser:         meta.Browser,
		OS:              meta.OS,
		DeviceType:      meta.DeviceType,
		CPUArch:         meta.CPUArch,
		Country:         meta.Country,
		AppleSilicon:    meta.AppleSilicon,
		WebGPUAvailable: meta.WebGPUAvailable,
		WebGL2Available: meta.WebGL2Available,
		WebGL1Available: meta.WebGL1Available,
		HDRDisplay:      meta.HDRDisplay,
		Report:          report,
	}

	status := "accepted"
	stored := true
	message := "Stored new fingerprint."

	if _, err := s.mongo.coll.InsertOne(ctx, doc); err != nil {
		if !mongo.IsDuplicateKeyError(err) {
			s.mu.Lock()
			s.totalRejected += 1
			s.mu.Unlock()
			return submitResult{}, fmt.Errorf("insert report: %w", err)
		}

		// Existing fingerprint: enforce dedupe window (but still update the record).
		var existing struct {
			ReceivedAt time.Time `bson:"receivedAt"`
			Report     Report    `bson:"report"`
		}
		if err := s.mongo.coll.FindOne(ctx, bson.M{"fingerprint": fingerprint}, options.FindOne().SetProjection(bson.D{
			{Key: "receivedAt", Value: 1},
			{Key: "report", Value: 1},
		})).Decode(&existing); err != nil {
			s.mu.Lock()
			s.totalRejected += 1
			s.mu.Unlock()
			return submitResult{}, fmt.Errorf("select receivedAt: %w", err)
		}

		merged := mergeReportsPreferNew(report, existing.Report)
		meta = reportMetaFromReport(merged)

		set := bson.M{
			"receivedAt":      now,
			"webgpuAvailable": meta.WebGPUAvailable,
			"webgl2Available": meta.WebGL2Available,
			"webgl1Available": meta.WebGL1Available,
			"hdrDisplay":      meta.HDRDisplay,
			"report":          merged,
		}
		if meta.Browser != "" {
			set["browser"] = meta.Browser
		}
		if meta.OS != "" {
			set["os"] = meta.OS
		}
		if meta.DeviceType != "" {
			set["deviceType"] = meta.DeviceType
		}
		if meta.CPUArch != "" {
			set["cpuArch"] = meta.CPUArch
		}
		if meta.Country != "" {
			set["country"] = meta.Country
		}
		if meta.AppleSilicon != nil {
			set["appleSilicon"] = *meta.AppleSilicon
		}

		if _, err := s.mongo.coll.UpdateOne(ctx, bson.M{"fingerprint": fingerprint}, bson.M{"$set": set}); err != nil {
			s.mu.Lock()
			s.totalRejected += 1
			s.mu.Unlock()
			return submitResult{}, fmt.Errorf("update report: %w", err)
		}

		if now.Sub(existing.ReceivedAt) < s.cfg.DedupeTTL {
			status = "duplicate"
			stored = false
			message = "Duplicate fingerprint within dedupe window (updated existing record)."
		} else {
			message = "Updated existing fingerprint (outside dedupe window)."
		}
	}

	if err := s.pruneMongo(ctx); err != nil {
		s.mu.Lock()
		s.totalRejected += 1
		s.mu.Unlock()
		return submitResult{}, err
	}
	storedCount, err := s.countReportsFromMongo(ctx)
	if err != nil {
		s.mu.Lock()
		s.totalRejected += 1
		s.mu.Unlock()
		return submitResult{}, err
	}

	s.mu.Lock()
	if status == "duplicate" {
		s.totalDuplicate += 1
	} else {
		s.totalAccepted += 1
	}
	s.mu.Unlock()

	return submitResult{
		Status:      status,
		Fingerprint: fingerprint,
		Stored:      stored,
		StoredCount: storedCount,
		ReceivedAt:  now,
		Message:     message,
	}, nil
}
