# Seed reference (§26 infra/seed)

JSON consumed by the NestJS seeder **and** mirrored by the prototype's
`src/lib/*` modules. Single direction of truth for structure:

| File | Mirrors | Edited in app at |
|---|---|---|
| roles.json, permissions.json | PERMS matrix | — (API only, no UI) |
| orgUnits.json | UNITS / MINISTRIES | /org |
| fiscalYears.json | Admin FY settings | /admin/fiscal-years |
| lookups.json | Admin lookups | /admin/* |
| approvalRoutes.json | `seedRoutes()` in lifecycle.js | /admin (routes) |
| alertRules.json | ALERT_RULES in alerts.js | /admin/alerts |

Collection data (users, works, …) lives ONLY in Mongo — there are
no collection fixtures. The BS calendar table also lives in Mongo
(`lookups` key `bsCalendar`, served by `GET /api/calendar/bs`).

`bsCalendar` day counts must be verified against the official Nepali
calendar before go-live (month lengths vary by year — never a formula).
