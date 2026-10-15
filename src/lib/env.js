// Server-only env loader. Import ONLY in API routes / server components —
// never from client components (secrets must not leak to the browser).

const bool = (v, d = false) => (v === undefined ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function required(name, val) {
  if (!val && process.env.NODE_ENV === "production") {
    throw new Error(`[env] ${name} is required in production (see .env.example)`);
  }
  return val;
}

let cached = null;
export function getEnv() {
  if (cached) return cached;
  if (typeof window !== "undefined") throw new Error("[env] imported on client — use public config instead");
  const e = process.env;
  cached = {
    isProd: e.NODE_ENV === "production",
    tz: e.TZ || "Asia/Kathmandu",
    appBaseUrl: e.APP_BASE_URL || "http://localhost:3000",
    mongo: {
      uri: e.MONGODB_URI || "mongodb://app:devpasswordchange@localhost:27017/wmams?replicaSet=rs0&readPreference=primary",
      reportUri: e.MONGODB_REPORT_URI || "mongodb://app:devpasswordchange@localhost:27017/wmams?replicaSet=rs0&readPreference=secondaryPreferred",
    },
    redisUrl: e.REDIS_URL || "redis://localhost:6379/0",
    s3: {
      endpoint: e.S3_ENDPOINT || "http://localhost:9000",
      accessKey: e.S3_ACCESS_KEY || "minioadmin",
      secretKey: required("S3_SECRET_KEY", e.S3_SECRET_KEY || "minioadmin-change-me"),
      buckets: {
        main: e.S3_BUCKET_MAIN || "wmams-docs",
        quarantine: e.S3_BUCKET_QUARANTINE || "wmams-quarantine",
        reports: e.S3_BUCKET_REPORTS || "wmams-reports",
      },
    },
    jwt: {
      accessSecret: required("JWT_ACCESS_SECRET", e.JWT_ACCESS_SECRET || "dev-only-access-secret-32-bytes-minimum-000"),
      refreshSecret: required("JWT_REFRESH_SECRET", e.JWT_REFRESH_SECRET || "dev-only-refresh-secret-32-bytes-minimum-00"),
      accessTtl: e.JWT_ACCESS_TTL || "15m",
      refreshTtl: e.JWT_REFRESH_TTL || "7d",
    },
    fieldEncryptionKey: required("FIELD_ENCRYPTION_KEY", e.FIELD_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"),
    otp: { ttlSeconds: num(e.OTP_TTL_SECONDS, 300), maxAttempts: num(e.OTP_MAX_ATTEMPTS, 3) },
    smtp: {
      host: e.SMTP_HOST || "localhost",
      port: num(e.SMTP_PORT, 1025),
      user: e.SMTP_USER || "",
      pass: e.SMTP_PASS || "",
      from: e.MAIL_FROM || "WMAMS <no-reply@wmams.gov.np>",
      configured: bool(e.SMTP_HOST, false),
    },
    sms: {
      provider: e.SMS_PROVIDER || "log",
      apiUrl: e.SMS_API_URL || "",
      apiKey: e.SMS_API_KEY || "",
      sender: e.SMS_SENDER || "WMAMS",
    },
    clamav: { host: e.CLAMAV_HOST || "localhost", port: num(e.CLAMAV_PORT, 3310) },
  };
  return cached;
}

// Redacted snapshot for /api/health — presence booleans only, no secret values.
export function envPresence() {
  const c = getEnv();
  return {
    mongodb: !!c.mongo.uri,
    mongodbReport: !!c.mongo.reportUri,
    redis: !!c.redisUrl,
    s3: !!c.s3.endpoint,
    jwt: !!(c.jwt.accessSecret && c.jwt.refreshSecret),
    fieldEncryption: !!c.fieldEncryptionKey,
    smtp: c.smtp.configured,
    sms: c.sms.provider,
    clamav: `${c.clamav.host}:${c.clamav.port}`,
    tz: c.tz,
  };
}
