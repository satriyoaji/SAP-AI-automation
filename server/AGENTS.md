# AGENTS.md — Server (`sap-ai/server`)

> Agent skill guide for the backend. Read this before touching any file in `server/`.

## What this directory is

The Node.js + Express + TypeScript backend for the **PO to SAP** platform. It:

- Polls connected email accounts (Gmail OAuth + generic IMAP) for incoming mail
- Detects Purchase Order (PO) attachments using AI
- Extracts structured PO data (customer, items, qty, price, dates) via OpenAI GPT-4o
- Lets humans review extracted data before pushing it to SAP Business One via the Service Layer REST API
- Stores everything in SQLite (via Drizzle ORM)
- Hosts manual PO upload + analysis endpoints

**Default port:** `3001` · **CORS origin:** `http://localhost:5173` (the Vite dev server)

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 18+, ESM (`"type": "module"`) |
| Framework | Express 4 |
| Language | TypeScript 5.6 (strict) |
| DB | SQLite via `better-sqlite3` + Drizzle ORM 0.36 |
| AI | OpenAI Node SDK 4.71 (GPT-4o) |
| Email | `imapflow` (IMAP), `googleapis` + `mailparser` (Gmail) |
| Validation | `zod` (env schema) |
| Uploads | `multer` (memory storage, 25 MB cap) |
| PDF | `pdf-parse`, `sharp` (rendering) |
| Dev runner | `tsx watch` |
| Other | `cors`, `dotenv`, `ws`, `drizzle-kit` |

## Layout

```
server/
├── src/
│   ├── index.ts              # App bootstrap: CORS, JSON body (50mb), route mounting,
│   │                         #   inline SQL CREATE TABLE migrations, background jobs
│   ├── config/
│   │   └── env.ts            # Zod-validated env loader
│   ├── db/
│   │   ├── index.ts          # Drizzle + better-sqlite3 connection
│   │   └── schema.ts         # Tables: settings, emailAccounts, purchaseOrders,
│   │                         #   poAttachments, sapConnections, activityLogs,
│   │                         #   poTemplates, poTemplateRegions
│   ├── routes/
│   │   ├── email.ts          # /api/email/* — OAuth + IMAP account CRUD
│   │   ├── purchaseOrders.ts # /api/purchase-orders/* — main resource
│   │   ├── sap.ts            # /api/sap/* — connection mgmt + push SO
│   │   ├── settings.ts       # /api/settings/* — KV config
│   │   ├── upload.ts         # /api/upload/* — drag-drop PO analysis
│   │   └── templates.ts      # /api/templates/* — per-customer PO region templates
│   └── services/
│       ├── openai.ts         # analyzeDocument(): GPT-4o prompts + JSON parsing
│       ├── processor.ts      # EmailProcessor + SAPProcessor (background loops)
│       ├── sapB1.ts          # Service Layer client (login, Orders POST)
│       ├── documentExtractor.ts  # MIME → text extraction (PDF, etc.)
│       ├── pdfRenderer.ts    # PDF → PNG for region-based extraction
│       ├── pdfRegionExtractor.ts # Coordinate-cropped text/image extraction
│       ├── templateHints.ts  # Active template hints for prompt context
│       └── email/
│           ├── gmail.ts      # GmailService (OAuth + history.users.messages.list)
│           └── imap.ts       # ImapService (imapflow wrapper)
├── data/                     # SQLite file lives here (gitignored)
├── uploads/                  # Manual upload staging (gitignored)
├── drizzle.config.ts
├── tsconfig.json
├── .env.example              # Copy to .env
└── package.json
```

## Routes (mounted under `/api`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe |
| GET | `/stats` | PO counts grouped by status |
| POST | `/process` | Manually trigger pending-order SAP push |
| — | `/email/*` | OAuth flow, IMAP CRUD, manual fetch |
| — | `/purchase-orders/*` | List / get / update / push-to-SAP / mark-reviewed |
| — | `/sap/*` | Connection CRUD, login test, create Sales Order |
| — | `/settings/*` | KV settings (key/value) |
| — | `/upload/*` | Multer upload + analyze |
| — | `/templates/*` | Per-customer PO template regions |

## Data model (high level)

- **`purchase_orders`** — one row per email that surfaced a candidate PO. Status enum:
  `detected → analyzing → reviewed → needs_offer_sheet → processing → completed | error`.
  Persists `extractedData` and `aiAnalysis` as JSON strings. SAP identifiers (`sapDocEntry`,
  `sapDocNum`, `sqDocEntry`, `sqDocNum`) and `offerSheetNumber` are denormalized columns for
  fast list rendering.
- **`po_attachments`** — base64-encoded content + extracted text + AI classification.
  Hard cap `MAX_PERSIST_BYTES = 25 MB` (matches multer limit).
- **`email_accounts`** — both Gmail (OAuth tokens) and IMAP (host/port/creds) providers.
- **`sap_connections`** — Service Layer URL + company DB + creds.
- **`po_templates`** + **`po_template_regions`** — customer-specific rectangle hints
  (`x, y, width, height` as 0–1 relative coordinates) used by `pdfRegionExtractor` to
  pull targeted fields before the generic GPT-4o pass.

## Background jobs (started in `index.ts`)

- **`EmailProcessor`** — polls every **60 s**, fetches unread mail from active accounts,
  runs PO detection + extraction, persists rows.
- **`SAPProcessor`** — every **30 s**, picks up `reviewed` / `processing` orders whose
  prerequisites are met and pushes Sales Orders to SAP B1.

## Environment variables

Defined and Zod-validated in `src/config/env.ts`:

| Var | Required | Default |
| --- | --- | --- |
| `NODE_ENV` | — | `development` |
| `PORT` | — | `3001` |
| `DATABASE_URL` | — | `./data/db.sqlite` |
| `OPENAI_API_KEY` | recommended | `""` |
| `GOOGLE_CLIENT_ID` | for Gmail | — |
| `GOOGLE_CLIENT_SECRET` | for Gmail | — |
| `GOOGLE_REDIRECT_URI` | — | `http://localhost:3001/api/email/auth/google/callback` |
| `JWT_SECRET` | — | dev fallback (change in prod) |
| `CORS_ORIGIN` | — | `http://localhost:5173` |

> Only `OPENAI_API_KEY` is required at boot. Gmail + SAP are configurable at runtime
> through the Settings UI.

## Common commands

From repo root (uses npm workspaces):

```bash
npm install                              # installs server + client + root
cp server/.env.example server/.env       # then fill in OPENAI_API_KEY
npm run db:push -w server                # apply Drizzle schema
npm run dev                              # runs server + client concurrently
npm run build                            # tsc both workspaces
npm start                                # runs server from dist/
```

From `server/`:

```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc → dist/
npm run db:generate  # drizzle-kit generate
npm run db:push      # drizzle-kit push
npm run db:migrate   # drizzle-kit migrate
```

## Conventions

- **ESM throughout.** All imports use the `.js` extension even for `.ts` files
  (e.g. `import { db } from "./db/index.js"`). Drizzle config and route imports
  rely on this.
- **JSON-in-text columns.** `extractedData` and `aiAnalysis` are stored as `TEXT`
  and parsed with `JSON.parse` on read; handle `try/catch` around parse calls
  (see `routes/purchaseOrders.ts` `GET /`).
- **Inline migrations.** `index.ts` issues `CREATE TABLE IF NOT EXISTS` and
  `ALTER TABLE … ADD COLUMN` wrapped in `try/catch`. New columns should be added
  defensively the same way so existing DBs migrate without a tool.
- **No auth on the API.** The server has no built-in auth middleware — CORS is
  the only gate. Don't expose `3001` to the public internet without adding auth.
- **Service Layer credentials are stored in plaintext** in `sap_connections.password`.
  Treat this as a single-tenant internal tool, or hash before persisting.
- **Multer limits** — `25 MB` per file, JSON body `50 MB`. Match the
  `MAX_PERSIST_BYTES` constant if you raise either.
- **OpenAI prompts live in `services/openai.ts`** as `analyzeDocument()`. When
  changing the schema, also update the type returned and any UI consumers.
- **Region coordinates are 0–1 relative** to the PDF page. Don't switch to pixels
  without updating both `pdfRegionExtractor` and the `PDFAnnotator` client.

## Where to make common changes

| If you need to… | Look at |
| --- | --- |
| Change PO detection prompt or extracted schema | `services/openai.ts` (`analyzeDocument`) |
| Change polling cadence | `index.ts` `setInterval(...)` calls at the bottom |
| Add a new column to `purchase_orders` | `db/schema.ts` + inline `ALTER TABLE` in `index.ts` |
| Add a new API endpoint | New file in `routes/` + `app.use(...)` in `index.ts` |
| Add a new email provider | New file in `services/email/` + branch in `routes/email.ts` |
| Change SAP Service Layer mapping | `services/sapB1.ts` (login + Orders POST shape) |
| Change per-customer extraction hints | `services/pdfRegionExtractor.ts` + `services/templateHints.ts` |