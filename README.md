# WMAMS — Work Management & Budget Monitoring System (MoICS pilot)

Next.js 16 + MongoDB 7. All business data lives in Mongo; there is no static
dataset in the app. Pages fetch collections via `GET /api/data/[col]`
(`src/lib/use-data.js`); writes go through PATCH/POST with `__v`
optimistic-concurrency checks (409 on stale).

## Getting Started (dynamic DB only)

```bash
# 1. Start infra (Mongo replica set, Redis, MinIO, ClamAV, Mailpit)
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 2. Run the app (it redirects to /login; log in, dashboard follows role)
npm run dev
```

There are no collection fixtures — every row (users, works, …)
is created dynamically and lives only in Mongo. To bootstrap a fresh
database, create the first user directly in Mongo (`users` collection,
scrypt `passwordHash`) or bulk-load via `POST /api/seed`
`{ col, docs, replace? }`, then manage everything from the app UI.

Open [http://localhost:3000](http://localhost:3000) — you land on `/login`.
Login checks the `users` collection in Mongo (scrypt `passwordHash`); a wrong
username or password never logs in. Privileged roles get an OTP step,
printed to the dev terminal. Admins can reset any password from the user
detail page (`/users/[username]`) via `POST /api/auth/password`.

Without a reachable Mongo, pages show a DB-unreachable notice with the same
recovery hint. `npm run build` does not need the database (client fetching).

## Data layer map

| Piece | Location |
|---|---|
| Connection (cached, server-only) | `src/lib/db.js` |
| Schemas — §31 collections, scoped common fields, `optimisticConcurrency` | `src/lib/models.js` |
| Generic API `GET/PATCH/POST /api/data/[col]` (scope filter, BR-03) | `src/app/api/data/[col]/route.js` |
| Client hook + unreachable notice | `src/lib/use-data.js` |
| Dynamic bootstrap (bulk-load docs into Mongo) | `POST /api/seed` |
| Scope engine, lifecycle, metrics, alerts, engine | `src/lib/scope.js` etc. (pure, shared) |
