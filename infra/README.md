# WMAMS infrastructure

## Dev stack (matches §26)

```bash
cp .env.example .env.local   # edit secrets — never commit
docker compose -f infra/docker/docker-compose.dev.yml up -d
npm run dev
```

| Service | URL | Notes |
|---|---|---|
| App | http://localhost:3000 | TZ=Asia/Kathmandu |
| Mongo | localhost:27017 (`rs0`, user `app`) | single-node replica set → transactions work |
| Redis | localhost:6379 | BullMQ jobs + `perm:{user}:pv` cache |
| MinIO API / console | http://localhost:9000 / :9001 | buckets auto-created: `wmams-docs`, `wmams-quarantine`, `wmams-reports` (reports expire 7d) |
| ClamAV | localhost:3310 | uploads stream here before leaving quarantine |
| Mailpit | http://localhost:8025 (SMTP :1025) | OTP + alert mail in dev |

## Env contract

All variables are documented in `.env.example` (single source of truth).
Runtime access goes through `src/lib/env.js` (`getEnv()`):

- dev: boots with safe defaults, zero config
- production (`NODE_ENV=production`): **fails fast** on missing `JWT_*_SECRET`, `FIELD_ENCRYPTION_KEY`, `S3_SECRET_KEY`
- client components must never import it — `GET /api/health` exposes presence booleans only, no secret values

## Production notes (GIDC, §37)

- Mongo 3-member replica set (2 GIDC + 1 DR), `w: majority`, dashboards on `MONGODB_REPORT_URI` (secondaryPreferred)
- Redis Sentinel, MinIO ×4 with replication, secrets from vault (not env files)
- `JWT_ACCESS_TTL=15m`, refresh `7d` rotating HttpOnly cookie; `OTP_TTL_SECONDS=300`, `OTP_MAX_ATTEMPTS=3`
