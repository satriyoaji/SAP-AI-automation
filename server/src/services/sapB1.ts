import { env } from "../config/env.js";

interface SapB1Credentials {
  serviceLayerUrl: string;
  companyDB: string;
  username: string;
  password: string;
}

interface SapB1ServiceOptions {
  initialCookies?: string[];
}

export interface SapB1Session {
  sessionId: string;
  routeId: string;
  cookies: string[];
}

export interface SapB1LoginResponse {
  SessionId: string;
  Version: string;
  SessionTimeout: number;
}

export interface SapB1LoginResult {
  session: SapB1Session;
  response: SapB1LoginResponse;
}

interface SalesOrderLine {
  LineNum?: number;
  ItemCode?: string;
  ItemDescription?: string;
  Quantity: number;
  Price?: number;
  UnitPrice?: number;
  TaxCode?: string;
  VatGroup?: string;
  Currency?: string;
  ShipDate?: string;
  FreeText?: string;
}

interface PurchaseOrderPayload {
  CardCode: string;
  DocDate?: string;
  DocDueDate?: string;
  TaxDate?: string;
  DocCurrency?: string;
  Comments?: string;
  U_OSNO?: string;
  U_ATTNOS?: string;
  U_SQFINAL?: string;
  DocumentLines: SalesOrderLine[];
}

export interface SapPurchaseOrderResult {
  success: boolean;
  docEntry?: number;
  docNum?: number;
  error?: string;
  requestUrl?: string;
  requestMethod?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  statusCode?: number;
  responseBody?: unknown;
}

/**
 * SapB1Service with persistent session management.
 * Uses a single login per instance and reuses the session across all operations.
 * Automatically refreshes the session on 401 Unauthorized errors.
 */
export class SapB1Service {
  private static insecureTlsNoticeShown = false;
  private credentials: SapB1Credentials;
  private _session: SapB1Session | null = null;
  private _lastLoginResponse: SapB1LoginResponse | null = null;
  private _loggedIn = false;
  private _refreshing = false;
  private _lastRequestHeaders: Record<string, string> | null = null;

  private normalizeCookiePair(cookie: string): string | null {
    const head = cookie.split(";")[0]?.trim();
    if (!head || !head.includes("=")) return null;
    const [name, ...rest] = head.split("=");
    const value = rest.join("=").trim();
    if (!name || !value) return null;
    if (name !== "B1SESSION" && name !== "ROUTEID") return null;
    return `${name}=${value}`;
  }

  private uniqueCookiePairs(cookies: string[]): string[] {
    const map = new Map<string, string>();
    for (const raw of cookies) {
      const normalized = this.normalizeCookiePair(raw);
      if (!normalized) continue;
      const [name] = normalized.split("=");
      map.set(name, normalized);
    }
    return Array.from(map.values());
  }

  private toHeaderRecord(headers?: HeadersInit): Record<string, string> {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
  }

  constructor(credentials: SapB1Credentials, options?: SapB1ServiceOptions) {
    this.credentials = credentials;
    if (options?.initialCookies?.length) {
      const cookieParts = this.uniqueCookiePairs(options.initialCookies);
      const sessionId = cookieParts.find((c) => c.startsWith("B1SESSION="))?.split("=")[1]?.split(";")[0] || "";
      const routeId = cookieParts.find((c) => c.startsWith("ROUTEID="))?.split("=")[1]?.split(";")[0] || "";
      if (sessionId) {
        this._session = { sessionId, routeId, cookies: cookieParts };
        this._loggedIn = true;
      }
    }
  }

  /** Get the current active session */
  getSession(): SapB1Session | null {
    return this._session;
  }

  /** Get the last login response (SessionId, Version, SessionTimeout) */
  getLastLoginResponse(): SapB1LoginResponse | null {
    return this._lastLoginResponse;
  }

  /** Check if we have an active session */
  isLoggedIn(): boolean {
    return this._loggedIn && this._session !== null;
  }

  private async login(): Promise<SapB1Session> {
    const url = `${this.credentials.serviceLayerUrl}/Login`;
    if (env.SAP_INSECURE_TLS) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      if (!SapB1Service.insecureTlsNoticeShown) {
        SapB1Service.insecureTlsNoticeShown = true;
        console.warn("[sap] SAP_INSECURE_TLS=true. TLS certificate verification is disabled for outbound SAP calls.");
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CompanyDB: this.credentials.companyDB,
          UserName: this.credentials.username,
          Password: this.credentials.password,
        }),
      });
    } catch (error: any) {
      const causeMessage = error?.cause?.message ? ` cause=${error.cause.message}` : "";
      throw new Error(`SAP B1 Login fetch failed: ${error?.message || "unknown error"}${causeMessage}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SAP B1 Login failed: ${response.status} - ${errorText}`);
    }

    // Capture the JSON response body
    this._lastLoginResponse = await response.json() as SapB1LoginResponse;

    // Extract cookies from Set-Cookie header
    const setCookie = response.headers.get("set-cookie") || "";
    const cookieParts = this.uniqueCookiePairs(setCookie
      .split(/,(?=\s*\S+=)/)
      .map((c) => c.trim())
      .filter(Boolean));
    const sessionId = cookieParts.find((c) => c.startsWith("B1SESSION="))?.split("=")[1]?.split(";")[0] || "";
    const routeId = cookieParts.find((c) => c.startsWith("ROUTEID="))?.split("=")[1]?.split(";")[0] || "";
    const resolvedSessionId = sessionId || this._lastLoginResponse?.SessionId || "";
    const resolvedCookies = this.uniqueCookiePairs(cookieParts.length > 0
      ? cookieParts
      : (resolvedSessionId ? [`B1SESSION=${resolvedSessionId}`] : []));

    this._session = { sessionId: resolvedSessionId, routeId, cookies: resolvedCookies };
    this._loggedIn = Boolean(this._session.sessionId);

    return this._session;
  }

  private async ensureLoggedIn(): Promise<SapB1Session> {
    if (!this._loggedIn || !this._session) {
      return await this.login();
    }
    return this._session;
  }

  private async refreshToken(): Promise<SapB1Session> {
    if (this._refreshing) {
      // Another refresh is in progress, wait
      while (this._refreshing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this._session!;
    }

    this._refreshing = true;
    try {
      // Clear stale session
      this._loggedIn = false;
      this._session = null;
      return await this.login();
    } finally {
      this._refreshing = false;
    }
  }

  private async logout(): Promise<void> {
    if (!this._session) return;
    const url = `${this.credentials.serviceLayerUrl}/Logout`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          Cookie: this._session.cookies.join("; "),
        },
      });
    } catch {
      // Ignore logout errors
    } finally {
      this._loggedIn = false;
      this._session = null;
    }
  }

  /** Execute an HTTP request with automatic session refresh on 401 */
  private async authenticatedRequest(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    let session = await this.ensureLoggedIn();

    const inputHeaders = this.toHeaderRecord(options.headers);
    const firstRequestHeaders = {
      ...inputHeaders,
      Cookie: session.cookies.join("; "),
    };
    this._lastRequestHeaders = firstRequestHeaders;

    // Make the request
    let response = await fetch(url, {
      ...options,
      headers: firstRequestHeaders,
    });

    // If 401, try to refresh the session once
    if (response.status === 401) {
      try {
        session = await this.refreshToken();
        const retryHeaders = {
          ...inputHeaders,
          Cookie: session.cookies.join("; "),
        };
        this._lastRequestHeaders = retryHeaders;
        response = await fetch(url, {
          ...options,
          headers: retryHeaders,
        });
      } catch (refreshError) {
        // Refresh failed — logout to clear stale session
        await this.logout();
        throw new Error("Session refresh failed. Please re-login.");
      }
    }

    return response;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.login();
      await this.logout();
      return { success: true, message: "Connected successfully" };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async testConnectionWithSession(): Promise<{
    success: boolean;
    message: string;
    sessionId?: string;
    version?: string;
    sessionTimeout?: number;
    cookies?: string[];
  }> {
    try {
      await this.ensureLoggedIn();
      const loginResp = this._lastLoginResponse;
      return {
        success: true,
        message: "Connected successfully",
        sessionId: loginResp?.SessionId,
        version: loginResp?.Version,
        sessionTimeout: loginResp?.SessionTimeout,
        cookies: this._session?.cookies,
      };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // --- SAP API Operations ---

  async createQuotation(payload: PurchaseOrderPayload): Promise<SapPurchaseOrderResult> {
    try {
      const url = `${this.credentials.serviceLayerUrl}/Quotations`;
      const response = await this.authenticatedRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseStatus = response.status;
      const responseText = await response.text();
      let parsedBody: unknown = responseText;
      try {
        parsedBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        parsedBody = responseText;
      }

      if (!response.ok) {
        return {
          success: false,
          error: `SAP B1 Quotation creation failed: ${responseStatus} - ${responseText}`,
          requestUrl: url,
          requestMethod: "POST",
          requestHeaders: this._lastRequestHeaders || undefined,
          requestBody: payload,
          statusCode: responseStatus,
          responseBody: parsedBody,
        };
      }

      const result: any = parsedBody || {};
      return {
        success: true,
        docEntry: result.DocEntry,
        docNum: result.DocNum,
        requestUrl: url,
        requestMethod: "POST",
        requestHeaders: this._lastRequestHeaders || undefined,
        requestBody: payload,
        statusCode: responseStatus,
        responseBody: parsedBody,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        requestUrl: `${this.credentials.serviceLayerUrl}/Quotations`,
        requestMethod: "POST",
        requestHeaders: this._lastRequestHeaders || undefined,
        requestBody: payload,
      };
    }
  }

  async getBusinessPartners(searchTerm?: string): Promise<Array<{ cardCode: string; cardName: string; cardType?: string; cardForeignName?: string }>> {
    const raw = (searchTerm || "").trim();
    if (!raw) {
      const url = `${this.credentials.serviceLayerUrl}/BusinessPartners?$select=CardCode,CardName,CardType,CardForeignName&$filter=CardType eq 'C'&$orderby=CardCode&$top=1`;
      const response = await this.authenticatedRequest(url, { method: "GET" });
      if (!response.ok) throw new Error(`Failed to fetch Business Partners: ${response.status}`);
      const result = await response.json();
      return (result.value || []).map((bp: any) => ({
        cardCode: bp.CardCode,
        cardName: bp.CardName,
        cardType: bp.CardType,
        cardForeignName: bp.CardForeignName,
      }));
    }

    // Build progressively-looser candidates so we can match Indonesian
    // "PT. Foo Bar" companies whose SAP CardName is often stored as
    // "Foo Bar, PT." (prefix moved to suffix) or "Foo Bar Tbk". Also
    // fall through to searching CardForeignName which usually mirrors
    // the customer-facing display form (e.g. "PT. ZEBRA ASABA INDUSTRIES").
    const stripped = raw
      .replace(/^(PT\.?|CV\.?|UD\.?|PD\.?)\s+/i, "")
      .replace(/\s*[,\-]?\s*(Tbk\.?|Persero|Persero\.?)\s*$/i, "")
      .trim();
    const tokens = stripped.split(/\s+/).filter(Boolean);
    // Distinctive core name = first 2 tokens (e.g. "ZEBRA ASABA") — usually
    // enough to narrow the match without being too fuzzy.
    const core = tokens.slice(0, 2).join(" ");
    const first = tokens[0] || "";

    const escape = (s: string) => s.replace(/'/g, "''");
    const candidates = Array.from(
      new Set(
        [raw, stripped, core, first]
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      ),
    );

    for (const term of candidates) {
      const escaped = escape(term);
      const filter =
        `CardType eq 'C' and (` +
          `contains(CardCode,'${escaped}') or ` +
          `contains(CardName,'${escaped}') or ` +
          `contains(CardForeignName,'${escaped}')` +
        `)`;
      const url = `${this.credentials.serviceLayerUrl}/BusinessPartners?$select=CardCode,CardName,CardType,CardForeignName&$filter=${encodeURIComponent(filter)}&$orderby=CardCode&$top=5`;

      const response = await this.authenticatedRequest(url, { method: "GET" });
      if (!response.ok) throw new Error(`Failed to fetch Business Partners: ${response.status}`);
      const result = await response.json();
      const rows = result.value || [];
      if (rows.length > 0) {
        console.log(
          `[sap] getBusinessPartners resolved "${raw}" via candidate "${term}" → ${rows[0].CardCode} (${rows[0].CardName})`,
        );
        return rows.map((bp: any) => ({
          cardCode: bp.CardCode,
          cardName: bp.CardName,
          cardType: bp.CardType,
          cardForeignName: bp.CardForeignName,
        }));
      }
    }

    console.log(`[sap] getBusinessPartners no match for "${raw}" (candidates tried: ${candidates.join(" | ")})`);
    return [];
  }

  async getItems(search?: string): Promise<Array<{ itemCode: string; itemName: string }>> {
    let url = `${this.credentials.serviceLayerUrl}/Items?$select=ItemCode,ItemName`;
    if (search) {
      url += `&$filter=contains(ItemCode,'${search}') or contains(ItemName,'${search}')`;
    }
    url += "&$top=50";

    const response = await this.authenticatedRequest(url, { method: "GET" });

    if (!response.ok) {
      throw new Error(`Failed to fetch Items: ${response.status}`);
    }

    const result = await response.json();
    return (result.value || []).map((item: any) => ({
      itemCode: item.ItemCode,
      itemName: item.ItemName,
    }));
  }

  async getSalesQuotationByOfferSheet(offerSheetNumber: string): Promise<{ docEntry: number; docNum: number; cardCode: string; lines: any[] } | null> {
    const udfField = "U_OfferSheet";
    const url = `${this.credentials.serviceLayerUrl}/Quotations?$filter=${udfField} eq '${encodeURIComponent(offerSheetNumber)}'&$select=DocEntry,DocNum,CardCode,DocumentLines`;

    const response = await this.authenticatedRequest(url, { method: "GET" });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch Sales Quotation by Offer Sheet: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    const quotations = result.value || [];
    if (quotations.length === 0) {
      return null;
    }

    const sq = quotations[0];
    return {
      docEntry: sq.DocEntry,
      docNum: sq.DocNum,
      cardCode: sq.CardCode,
      lines: sq.DocumentLines || [],
    };
  }

  async getSalesQuotationByDocEntry(docEntry: number): Promise<any | null> {
    const url = `${this.credentials.serviceLayerUrl}/Quotations(${docEntry})`;
    const response = await this.authenticatedRequest(url, { method: "GET" });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch Sales Quotation: ${response.status}`);
    }

    return await response.json();
  }

  async createQuotationFromSQ(sqDocEntry: number, sqData: any): Promise<SapPurchaseOrderResult> {
    try {
      const lines = (sqData.DocumentLines || []).map((line: any, idx: number) => ({
        BaseType: 23, // Sales Quotation
        BaseEntry: sqDocEntry,
        BaseLine: line.LineNum ?? idx,
        Quantity: line.Quantity,
        UnitPrice: line.UnitPrice,
        ItemCode: line.ItemCode,
        ItemDescription: line.ItemDescription || line.LineText,
        ShipDate: line.ShipDate,
        FreeText: line.FreeText || "",
      }));

      const payload = {
        CardCode: sqData.CardCode,
        DocDate: sqData.DocDate ? sqData.DocDate.split("T")[0] : new Date().toISOString().split("T")[0],
        DocDueDate: sqData.DocDueDate ? sqData.DocDueDate.split("T")[0] : new Date().toISOString().split("T")[0],
        Comments: `Auto-generated from PO referencing Offer Sheet ${sqData.U_OfferSheet || ""}. Based on SQ #${sqData.DocNum}`,
        DocumentLines: lines,
      };

      const url = `${this.credentials.serviceLayerUrl}/Quotations`;
      const response = await this.authenticatedRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`SAP B1 Quotation creation failed: ${response.status} - ${errorData}`);
      }

      const result = await response.json();
      return {
        success: true,
        docEntry: result.DocEntry,
        docNum: result.DocNum,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

}
