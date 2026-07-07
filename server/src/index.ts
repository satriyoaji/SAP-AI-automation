import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { db } from "./db/index.js";
import { purchaseOrders, poSapLogs } from "./db/schema.js";
import { sql, eq, desc } from "drizzle-orm";
import emailRoutes from "./routes/email.js";
import poRoutes from "./routes/purchaseOrders.js";
import sapRoutes from "./routes/sap.js";
import settingsRoutes from "./routes/settings.js";
import uploadRoutes from "./routes/upload.js";
import templatesRoutes from "./routes/templates.js";
import customerItemsRoutes from "./routes/customerItems.js";
import { EmailProcessor, SAPProcessor } from "./services/processor.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));

// Initialize DB tables (simple migration)
try {
  db.run(sql`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    imap_host TEXT,
    imap_port INTEGER,
    imap_secure INTEGER,
    imap_username TEXT,
    imap_password TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_account_id INTEGER NOT NULL,
    email_message_id TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_name TEXT,
    subject TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'detected',
    confidence REAL,
    ai_analysis TEXT,
    extracted_data TEXT,
    offer_sheet_number TEXT,
    sq_doc_entry INTEGER,
    sq_doc_num INTEGER,
    sap_doc_entry INTEGER,
    sap_doc_num INTEGER,
    sap_error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS po_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content TEXT,
    extracted_text TEXT,
    is_po_attachment INTEGER,
    ai_analysis TEXT,
    size INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // ---- Schema migration: add columns if missing ----
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN offer_sheet_number TEXT`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN sq_doc_entry INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE purchase_orders ADD COLUMN sq_doc_num INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE po_attachments ADD COLUMN is_po_attachment INTEGER`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE po_attachments ADD COLUMN ai_analysis TEXT`); } catch { /* exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS sap_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    service_layer_url TEXT NOT NULL,
    company_db TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_connected_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS po_sap_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    request_url TEXT,
    request_method TEXT,
    request_headers TEXT NOT NULL,
    request_body TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    is_success INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
  try { db.run(sql`ALTER TABLE po_sap_logs ADD COLUMN request_url TEXT`); } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE po_sap_logs ADD COLUMN request_method TEXT`); } catch { /* exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS customer_bp_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL UNIQUE,
    sap_card_code TEXT NOT NULL,
    sap_card_name TEXT,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS customer_item_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_item_code TEXT NOT NULL,
    description TEXT,
    sap_item_code TEXT,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS customer_item_mappings_customer_code_uq
    ON customer_item_mappings (customer_name, customer_item_code)`);

  db.run(sql`CREATE TABLE IF NOT EXISTS po_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    customer_name TEXT,
    sender_email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sample_pdf_path TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS po_template_regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    prompt TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
} catch (error) {
  console.error("DB initialization error:", error);
}

// Routes
app.use("/api/email", emailRoutes);
app.use("/api/purchase-orders", poRoutes);
app.use("/api/sap", sapRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/customer-items", customerItemsRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Stats endpoint
app.get("/api/stats", async (_req, res) => {
  const pos = await db.select().from(purchaseOrders).all();
  res.json({
    total: pos.length,
    detected: pos.filter((p: any) => p.status === "detected").length,
    analyzing: pos.filter((p: any) => p.status === "analyzing").length,
    reviewed: pos.filter((p: any) => p.status === "reviewed").length,
    needs_offer_sheet: pos.filter((p: any) => p.status === "needs_offer_sheet").length,
    processing: pos.filter((p: any) => p.status === "processing").length,
    completed: pos.filter((p: any) => p.status === "completed").length,
    error: pos.filter((p: any) => p.status === "error").length,
  });
});

// Trigger manual processing
app.post("/api/process", async (_req, res) => {
  const sapProcessor = new SAPProcessor();
  await sapProcessor.processPendingOrders();
  res.json({ success: true });
});

// Trigger processing for one PO immediately.
app.post("/api/process/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid PO id" });
    return;
  }

  const po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!po) {
    res.status(404).json({ error: "PO not found" });
    return;
  }
  if (po.status !== "reviewed") {
    res.status(400).json({ error: "PO must be in reviewed status" });
    return;
  }

  const extractedData = po.extractedData ? JSON.parse(po.extractedData) : null;
  const extractedOfferSheet = extractedData?.offerSheetNumber;
  if (!extractedOfferSheet || String(extractedOfferSheet).trim().length === 0) {
    res.status(400).json({ error: "extractedData.offerSheetNumber is required" });
    return;
  }

  const attnos = typeof req.body?.attnos === "string" ? req.body.attnos.trim() : "";
  if (!attnos) {
    res.status(400).json({ error: "attnos (Attention Name) is required" });
    return;
  }

  const rawSessionId = req.header("x-sap-session-id");
  const initialSessionId = typeof rawSessionId === "string"
    ? rawSessionId.trim().replace(/^B1SESSION=/i, "")
    : undefined;

  const sapProcessor = new SAPProcessor();
  try {
    await sapProcessor.processOrderNow(id, initialSessionId, attnos);
  } catch (error: any) {
    const message = error?.message || "Failed to process PO";
    if (message === "Customer Name not found") {
      res.status(400).json({ success: false, error: "Customer Name not found" });
      return;
    }
    res.status(500).json({ success: false, error: message });
    return;
  }
  const updated = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get();
  if (!updated) {
    res.status(500).json({ success: false, error: "PO not found after processing" });
    return;
  }

  if (updated.status === "completed") {
    res.json({ success: true, po: updated });
    return;
  }

  const latestSapLog = await db
    .select()
    .from(poSapLogs)
    .where(eq(poSapLogs.poId, id))
    .orderBy(desc(poSapLogs.createdAt))
    .get();

  let sapResponseBody: unknown = null;
  if (latestSapLog?.responseBody) {
    try {
      sapResponseBody = JSON.parse(latestSapLog.responseBody);
    } catch {
      sapResponseBody = latestSapLog.responseBody;
    }
  }

  const responseCode =
    latestSapLog?.responseStatus && latestSapLog.responseStatus >= 400
      ? latestSapLog.responseStatus
      : 502;

  // SAP submit failure is now signalled by `sapError` being set — the PO
  // is left in `reviewed` so the user can hit Send again after fixing
  // whichever underlying issue was reported.
  if (updated.sapError && updated.sapError.trim().length > 0) {
    res.status(responseCode).json({
      success: false,
      error: updated.sapError || "Failed to send PO to SAP",
      sapStatusCode: latestSapLog?.responseStatus || null,
      sapResponse: sapResponseBody,
      po: updated,
    });
    return;
  }

  res.status(202).json({
    success: false,
    error: "PO is still processing",
    po: updated,
  });
});

const PORT = env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start background processors
const emailProcessor = new EmailProcessor();
emailProcessor.start(60000); // Check every 1 minute

// SAP submission is now manual-only: every push requires U_ATTNOS entered
// on the PO detail page, so an unattended background loop can only mark
// rows in error. Submit via POST /api/process/:id from the UI instead.
