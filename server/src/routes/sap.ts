import { Router } from "express";
import { db } from "../db/index.js";
import { sapConnections } from "../db/schema.js";
import { SapB1Service } from "../services/sapB1.js";
import { eq } from "drizzle-orm";

const router = Router();

function parseInitialSessionCookie(req: any): string[] | undefined {
  const rawSessionIdHeader = req.header("x-sap-session-id");
  if (typeof rawSessionIdHeader === "string" && rawSessionIdHeader.trim().length > 0) {
    const sessionId = rawSessionIdHeader.trim().replace(/^B1SESSION=/i, "");
    return sessionId ? [`B1SESSION=${sessionId}`] : undefined;
  }

  const legacyCookiesHeader = req.header("x-sap-session-cookies");
  if (!legacyCookiesHeader) return undefined;
  try {
    const parsed = JSON.parse(legacyCookiesHeader);
    if (!Array.isArray(parsed)) return undefined;
    const cookies = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return cookies.length > 0 ? cookies : undefined;
  } catch {
    return undefined;
  }
}

function attachSessionHeaders(res: any, service: SapB1Service) {
  const session = service.getSession();
  const login = service.getLastLoginResponse();
  if (session?.sessionId) {
    res.setHeader("x-sap-session-id", session.sessionId);
  }
  if (login?.Version) {
    res.setHeader("x-sap-session-version", login.Version);
  }
  if (typeof login?.SessionTimeout === "number") {
    res.setHeader("x-sap-session-timeout", String(login.SessionTimeout));
  }
}

// GET /connections/:id/full — return full connection including password (for editing)
router.get("/connections/:id/full", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();
  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(conn);
});

router.get("/connections", async (_req, res) => {
  const connections = await db.select().from(sapConnections);
  res.json(connections.map((c) => ({
    ...c,
    password: undefined,
  })));
});

router.post("/connections", async (req, res) => {
  const { name, serviceLayerUrl, companyDB, username, password } = req.body;

  if (!name || !serviceLayerUrl || !companyDB || !username || !password) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // Enforce 1-connection limit: delete existing record before inserting
  await db.delete(sapConnections);

  const values = {
    name,
    serviceLayerUrl,
    companyDB,
    username,
    password,
    lastConnectedAt: new Date(),
  };

  const result = await db.insert(sapConnections).values(values).returning();

  res.json({ ...result[0], password: undefined });
});

router.post("/connections/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const initialCookies = parseInitialSessionCookie(req);
  const service = new SapB1Service(
    {
      serviceLayerUrl: conn.serviceLayerUrl,
      companyDB: conn.companyDB,
      username: conn.username,
      password: conn.password,
    },
    { initialCookies }
  );

  const test = await service.testConnectionWithSession();
  if (test.success === true) {
    await db.update(sapConnections).set({ lastConnectedAt: new Date() }).where(eq(sapConnections.id, id));
  }

  attachSessionHeaders(res, service);
  res.status(test.success ? 200 : 502).json(test);
});

// POST /api/sap/test — test a connection using inline credentials (not saved).
// Returns session details so frontend can persist in browser cookie.
router.post("/test", async (req, res) => {
  const { serviceLayerUrl, companyDB, username, password } = req.body;

  if (!serviceLayerUrl || !companyDB || !username || !password) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const service = new SapB1Service({ serviceLayerUrl, companyDB, username, password });
  const test = await service.testConnectionWithSession();
  attachSessionHeaders(res, service);
  res.status(test.success ? 200 : 502).json(test);
});

router.delete("/connections/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(sapConnections).where(eq(sapConnections.id, id));
  res.json({ success: true });
});

router.get("/connections/:id/business-partners", async (req, res) => {
  const id = Number(req.params.id);
  const search = req.query.search as string | undefined;
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const initialCookies = parseInitialSessionCookie(req);
  const service = new SapB1Service(
    {
      serviceLayerUrl: conn.serviceLayerUrl,
      companyDB: conn.companyDB,
      username: conn.username,
      password: conn.password,
    },
    { initialCookies }
  );

  const partners = await service.getBusinessPartners(search);
  attachSessionHeaders(res, service);
  res.json(partners);
});

router.get("/connections/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  const search = req.query.search as string | undefined;
  const conn = await db.select().from(sapConnections).where(eq(sapConnections.id, id)).get();

  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const initialCookies = parseInitialSessionCookie(req);
  const service = new SapB1Service(
    {
      serviceLayerUrl: conn.serviceLayerUrl,
      companyDB: conn.companyDB,
      username: conn.username,
      password: conn.password,
    },
    { initialCookies }
  );

  const items = await service.getItems(search);
  attachSessionHeaders(res, service);
  res.json(items);
});

export default router;
