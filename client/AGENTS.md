# AGENTS.md — Client (`sap-ai/client`)

> Agent skill guide for the frontend. Read this before touching any file in `client/`.

## What this directory is

The React + Vite + TypeScript single-page app for the **PO to SAP** platform. It is
the human-in-the-loop surface where users:

- See the dashboard (PO counts by status)
- Browse every email the server polled and every detected Purchase Order
- Review AI-extracted PO data on a side-by-side PDF + form view
- Annotate PDFs to define per-customer extraction templates
- Manage email + SAP Business One connections
- Manually upload a PO document for analysis

**Default port:** `5173` (Vite dev) · proxies/fetches the API at `http://localhost:3001`

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | React 18 + Vite 5 |
| Language | TypeScript 5.6 |
| Routing | React Router 6 (`react-router-dom`) |
| Styling | TailwindCSS 3.4 + PostCSS + Autoprefixer |
| Icons | `lucide-react` |
| PDF viewing | `react-pdf` 9 |
| Utils | `clsx`, `tailwind-merge` |

## Layout

```
client/
├── index.html                       # Vite entry, mounts #root
├── vite.config.ts                   # React plugin, dev server config
├── tailwind.config.js               # Tailwind theme tokens
├── postcss.config.js
├── tsconfig.json                    # App code
├── tsconfig.node.json               # Vite config TS
└── src/
    ├── main.tsx                     # ReactDOM.createRoot → <App/>
    ├── App.tsx                      # Sidebar nav + <Routes>
    ├── index.css                    # Tailwind directives + globals
    ├── components/
    │   └── PDFAnnotator.tsx         # PDF viewer + region drawing toolbar
    └── pages/
        ├── Dashboard.tsx            # KPI cards + recent activity
        ├── PurchaseOrders.tsx       # List with `detectedOnly` toggle (All Emails / Detected POs)
        ├── PODetail.tsx             # Single PO review: PDF + extracted-data form
        ├── NeedsOfferSheet.tsx      # POs missing an Offer Sheet number
        ├── Settings.tsx             # Email + SAP connection management
        ├── Upload.tsx               # Drag-drop manual PO upload
        └── Templates.tsx            # Customer-specific region templates
```

## Routes (defined in `App.tsx`)

| Path | Component | Notes |
| --- | --- | --- |
| `/` | `Dashboard` | Stats + recent |
| `/purchase-orders` | `PurchaseOrders` (`title="All Emails"`) | Every email row |
| `/detected-pos` | `PurchaseOrders` (`detectedOnly`, `title="Detected POs"`) | Only rows where AI said `isPurchaseOrder: true` |
| `/needs-offer-sheet` | `NeedsOfferSheet` | POs that need an Offer Sheet |
| `/purchase-orders/:id` | `PODetail` | Review + push to SAP |
| `/upload` | `Upload` | Drag-drop manual analysis |
| `/templates` | `Templates` | Per-customer region hints |
| `/settings` | `Settings` | Email + SAP creds |

The sidebar uses `NavLink`'s `isActive` for the active style; `tailwind-merge`-free,
Tailwind utility classes only.

## Backend contract

All API calls hit `http://localhost:3001/api/...` (overridable via `VITE_API_BASE`
if you add it — currently hard-coded in pages). The server's CORS allow-list is
`CORS_ORIGIN=http://localhost:5173`, so keep this in sync if you change either side.

Key endpoints used by the UI:

- `GET /api/stats`
- `GET /api/purchase-orders` and `GET /api/purchase-orders/:id`
- `POST /api/purchase-orders/:id/analyze`
- `POST /api/purchase-orders/:id/push-to-sap`
- `GET/POST /api/email/accounts` + `/api/email/auth/google/*`
- `GET/POST /api/sap/connections` + `/api/sap/test`
- `POST /api/upload/analyze`
- `GET/POST/PUT/DELETE /api/templates/*`

## Conventions

- **Function components only.** No class components. `App.tsx` is the only one
  using hooks implicitly via React Router.
- **Tailwind first.** Don't reach for CSS modules / styled-components; co-locate
  `className="..."` strings on the JSX. Reusable utilities: `clsx` + `tailwind-merge`
  for conditional class composition.
- **lucide-react for icons.** Don't install another icon set. Stroke width matches
  Tailwind defaults (`size={18}` is the navbar norm).
- **No global state library.** Each page owns its own state with `useState` /
  `useEffect`. Fetch on mount, refetch on action.
- **API responses may return JSON-in-string** (e.g. `extractedData`, `aiAnalysis`)
  because the server persists them as TEXT. `JSON.parse` defensively — wrap in
  `try/catch` (matches the server-side behavior in `routes/purchaseOrders.ts`).
- **PDF coordinates are 0–1 relative** to the page. The `PDFAnnotator` writes
  regions in this form. Don't store pixel offsets.
- **File-upload size cap is 25 MB** on the server (multer `fileSize`). The Upload
  page should pre-validate the same to give fast feedback.

## Common commands

From repo root:

```bash
npm install         # installs all workspaces
npm run dev         # runs server + client concurrently
npm run build       # builds both
```

From `client/`:

```bash
npm run dev      # vite dev server on :5173
npm run build    # tsc + vite build → dist/
npm run preview  # serve the production build locally
```

## Where to make common changes

| If you need to… | Look at |
| --- | --- |
| Add / rename a sidebar entry or route | `src/App.tsx` (both the `<NavLink>` and the `<Route>`) |
| Change the dashboard tiles | `pages/Dashboard.tsx` (consumes `GET /api/stats`) |
| Change the PO list columns or filters | `pages/PurchaseOrders.tsx` (supports `detectedOnly` prop) |
| Change how a PO is reviewed / edited before SAP push | `pages/PODetail.tsx` |
| Change the Offer Sheet flow | `pages/NeedsOfferSheet.tsx` |
| Add a new field to the extracted-data schema | `components/PDFAnnotator.tsx` (region shape) **and** `server/services/openai.ts` |
| Change settings forms or email/SAP connection UX | `pages/Settings.tsx` |
| Change per-customer templates UI | `pages/Templates.tsx` + `components/PDFAnnotator.tsx` |
| Change theme tokens / brand colors | `tailwind.config.js` (then `index.css` if needed) |