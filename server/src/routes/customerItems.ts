import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customerItemMappings, purchaseOrders } from "../db/schema.js";

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
// counts and how many mappings have been saved so far.
router.get("/", async (_req, res) => {
  const detected = await loadDetectedByCustomer();
  const mappings = await db.select().from(customerItemMappings).all();

  const mappedByCustomer = new Map<string, number>();
  for (const m of mappings) {
    if (!m.sapItemCode || m.sapItemCode.trim() === "") continue;
    const key = m.customerName.trim().toLowerCase();
    mappedByCustomer.set(key, (mappedByCustomer.get(key) || 0) + 1);
  }

  const list = Array.from(detected.values())
    .map((c) => ({
      customerName: c.customerName,
      itemsCount: c.items.size,
      mappedCount: mappedByCustomer.get(c.customerName.toLowerCase()) || 0,
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  res.json(list);
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
