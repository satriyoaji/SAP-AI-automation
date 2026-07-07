import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customerItemMappings, customerBpMappings, purchaseOrders, sapConnections } from "../db/schema.js";
import { SapB1Service } from "../services/sapB1.js";

const router = Router();

type ExtractedItem = {
  itemCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  uom?: string | null;
};

type ExtractedData = {
  customerName?: string | null;
  items?: ExtractedItem[] | null;
};

const normalizeCustomer = (name: string | null | undefined) =>
  (name || "").trim();

const normalizeItemCode = (code: string | null | undefined) =>
  (code || "").trim();

const parseExtracted = (raw: string | null): ExtractedData | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtractedData;
  } catch {
    return null;
  }
};

// Build the in-memory aggregate of detected (customer -> distinct items) from
// all purchase_orders.extracted_data JSON blobs.
async function loadDetectedByCustomer(): Promise<
  Map<
    string,
    {
      customerName: string;
      items: Map<
        string,
        {
          customerItemCode: string;
          description: string;
          seenCount: number;
        }
      >;
    }
  >
> {
  const rows = await db
    .select({ extractedData: purchaseOrders.extractedData })
    .from(purchaseOrders)
    .all();

  const byCustomer = new Map<
    string,
    {
      customerName: string;
      items: Map<
        string,
        { customerItemCode: string; description: string; seenCount: number }
      >;
    }
  >();

  for (const row of rows) {
    const extracted = parseExtracted(row.extractedData);
    const customer = normalizeCustomer(extracted?.customerName);
    if (!customer) continue;
    const key = customer.toLowerCase();

    let bucket = byCustomer.get(key);
    if (!bucket) {
      bucket = { customerName: customer, items: new Map() };
      byCustomer.set(key, bucket);
    }

    if (!Array.isArray(extracted?.items)) continue;
    for (const item of extracted!.items!) {
      const code = normalizeItemCode(item?.itemCode);
      if (!code) continue;
      const codeKey = code.toLowerCase();
      const existing = bucket.items.get(codeKey);
      if (existing) {
        existing.seenCount += 1;
        // Prefer a longer description if we get a fuller one later
        if (
          (item?.description || "").trim().length >
          (existing.description || "").length
        ) {
          existing.description = (item?.description || "").trim();
        }
      } else {
        bucket.items.set(codeKey, {
          customerItemCode: code,
          description: (item?.description || "").trim(),
          seenCount: 1,
        });
      }
    }
  }

  return byCustomer;
}

// GET /api/customer-items — list one row per detected customer, with item
// counts, how many item mappings have been saved so far, and (if resolved)
// the SAP BusinessPartner it's tied to.
router.get("/", async (_req, res) => {
  const detected = await loadDetectedByCustomer();
  const [mappings, bpMappings] = await Promise.all([
    db.select().from(customerItemMappings).all(),
    db.select().from(customerBpMappings).all(),
  ]);

  const mappedByCustomer = new Map<string, number>();
  for (const m of mappings) {
    if (!m.sapItemCode || m.sapItemCode.trim() === "") continue;
    const key = m.customerName.trim().toLowerCase();
    mappedByCustomer.set(key, (mappedByCustomer.get(key) || 0) + 1);
  }

  const bpByCustomer = new Map(
    bpMappings.map((b) => [b.customerName.trim().toLowerCase(), b] as const),
  );

  const list = Array.from(detected.values())
    .map((c) => {
      const bp = bpByCustomer.get(c.customerName.toLowerCase());
      return {
        customerName: c.customerName,
        itemsCount: c.items.size,
        mappedCount: mappedByCustomer.get(c.customerName.toLowerCase()) || 0,
        sapCardCode: bp?.sapCardCode || null,
        sapCardName: bp?.sapCardName || null,
      };
    })
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  res.json(list);
});

// GET /api/customer-items/:customerName/sap-candidates — call the SAP
// BusinessPartners endpoint and return every candidate that matches the
// customer name (including tenants where the extracted "PT. Foo" doesn't
// literally appear in CardName). Requires an active SAP connection.
router.get("/:customerName/sap-candidates", async (req, res) => {
  const customer = normalizeCustomer(req.params.customerName);
  if (!customer) {
    res.status(400).json({ error: "customerName is required" });
    return;
  }

  const conns = await db.select().from(sapConnections).where(eq(sapConnections.isActive, true)).all();
  if (conns.length === 0) {
    res.status(400).json({ error: "No active SAP connection" });
    return;
  }
  const conn = conns[0];

  const rawSessionId = req.header("x-sap-session-id");
  const initialCookies = typeof rawSessionId === "string" && rawSessionId.trim().length > 0
    ? [`B1SESSION=${rawSessionId.trim().replace(/^B1SESSION=/i, "")}`]
    : undefined;

  const service = new SapB1Service(
    {
      serviceLayerUrl: conn.serviceLayerUrl,
      companyDB: conn.companyDB,
      username: conn.username,
      password: conn.password,
    },
    initialCookies ? { initialCookies } : undefined,
  );

  try {
    // Prefer a query string the user typed; otherwise use the extracted name.
    const search = typeof req.query.search === "string" && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : customer;
    const candidates = await service.getBusinessPartners(search, { allCandidates: true, top: 20 });
    const existing = await db
      .select()
      .from(customerBpMappings)
      .where(eq(customerBpMappings.customerName, customer))
      .get();
    res.json({
      customerName: customer,
      selectedCardCode: existing?.sapCardCode || null,
      candidates,
    });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || "SAP lookup failed" });
  }
});

// PUT /api/customer-items/:customerName/sap-bp — persist the user's BP pick
// for this customer. Overwrites any previous choice.
router.put("/:customerName/sap-bp", async (req, res) => {
  const customer = normalizeCustomer(req.params.customerName);
  const sapCardCode = typeof req.body?.sapCardCode === "string" ? req.body.sapCardCode.trim() : "";
  const sapCardName = typeof req.body?.sapCardName === "string" ? req.body.sapCardName.trim() : "";
  if (!customer || !sapCardCode) {
    res.status(400).json({ error: "customerName and sapCardCode are required" });
    return;
  }

  const existing = await db
    .select()
    .from(customerBpMappings)
    .where(eq(customerBpMappings.customerName, customer))
    .get();

  if (existing) {
    const updated = await db
      .update(customerBpMappings)
      .set({ sapCardCode, sapCardName: sapCardName || null, updatedAt: new Date() })
      .where(eq(customerBpMappings.id, existing.id))
      .returning();
    res.json(updated[0]);
    return;
  }

  const inserted = await db
    .insert(customerBpMappings)
    .values({
      customerName: customer,
      sapCardCode,
      sapCardName: sapCardName || null,
    })
    .returning();
  res.json(inserted[0]);
});

// DELETE /api/customer-items/:customerName/sap-bp — clear the saved BP so
// the processor falls back to fuzzy SAP lookup on the next Send.
router.delete("/:customerName/sap-bp", async (req, res) => {
  const customer = normalizeCustomer(req.params.customerName);
  if (!customer) {
    res.status(400).json({ error: "customerName is required" });
    return;
  }
  await db.delete(customerBpMappings).where(eq(customerBpMappings.customerName, customer));
  res.json({ success: true });
});

// GET /api/customer-items/:customerName — items detected for one customer,
// merged with any saved SAP-code mappings.
router.get("/:customerName", async (req, res) => {
  const customer = normalizeCustomer(req.params.customerName);
  if (!customer) {
    res.status(400).json({ error: "customerName is required" });
    return;
  }

  const detected = await loadDetectedByCustomer();
  const bucket = detected.get(customer.toLowerCase());
  const items = bucket ? Array.from(bucket.items.values()) : [];

  const mappings = await db
    .select()
    .from(customerItemMappings)
    .where(eq(customerItemMappings.customerName, bucket?.customerName || customer))
    .all();
  const mappingByCode = new Map(
    mappings.map((m) => [m.customerItemCode.toLowerCase(), m]),
  );

  const merged = items
    .map((item) => {
      const existing = mappingByCode.get(item.customerItemCode.toLowerCase());
      return {
        customerName: bucket?.customerName || customer,
        customerItemCode: item.customerItemCode,
        description: existing?.description || item.description,
        sapItemCode: existing?.sapItemCode || "",
        seenCount: item.seenCount,
        mappingId: existing?.id ?? null,
        updatedAt: existing?.updatedAt ?? null,
      };
    })
    .sort((a, b) => a.customerItemCode.localeCompare(b.customerItemCode));

  res.json({
    customerName: bucket?.customerName || customer,
    items: merged,
  });
});

// PUT /api/customer-items/:customerName/:customerItemCode — upsert the SAP
// item-code mapping for one (customer, customerItemCode) pair.
router.put("/:customerName/:customerItemCode", async (req, res) => {
  const customer = normalizeCustomer(req.params.customerName);
  const customerItemCode = normalizeItemCode(req.params.customerItemCode);
  if (!customer || !customerItemCode) {
    res.status(400).json({ error: "customerName and customerItemCode are required" });
    return;
  }

  const sapItemCode = typeof req.body?.sapItemCode === "string"
    ? req.body.sapItemCode.trim()
    : "";
  const description = typeof req.body?.description === "string"
    ? req.body.description.trim()
    : null;

  const existing = await db
    .select()
    .from(customerItemMappings)
    .where(
      and(
        eq(customerItemMappings.customerName, customer),
        eq(customerItemMappings.customerItemCode, customerItemCode),
      ),
    )
    .get();

  if (existing) {
    const updated = await db
      .update(customerItemMappings)
      .set({
        sapItemCode: sapItemCode || null,
        description: description ?? existing.description,
        updatedAt: new Date(),
      })
      .where(eq(customerItemMappings.id, existing.id))
      .returning();
    res.json(updated[0]);
    return;
  }

  const inserted = await db
    .insert(customerItemMappings)
    .values({
      customerName: customer,
      customerItemCode,
      description: description ?? null,
      sapItemCode: sapItemCode || null,
    })
    .returning();
  res.json(inserted[0]);
});

export default router;
