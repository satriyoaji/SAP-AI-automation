import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, AlertCircle, CheckCircle2, XCircle, FileText, ChevronDown, ChevronRight, Download, RefreshCw, Upload } from "lucide-react";

interface POItem {
  itemCode?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  uom?: string;
}

interface POData {
  id: number;
  senderEmail: string;
  senderName: string;
  subject: string;
  status: string;
  confidence: number;
  receivedAt: string;
  offerSheetNumber?: string | null;
  sqDocEntry?: number | null;
  sqDocNum?: number | null;
  extractedData: {
    isPurchaseOrder?: boolean;
    reason?: string;
    rawText?: string;
    customerName?: string;
    customerCode?: string;
    poNumber?: string;
    poDate?: string;
    deliveryDate?: string;
    offerSheetNumber?: string;
    items: POItem[];
    totalAmount?: number;
    currency?: string;
    shipToAddress?: string;
    billToAddress?: string;
    paymentTerms?: string;
    notes?: string;
  } | null;
  aiAnalysis: { fullText?: string; screening?: any; attachmentAnalyses?: any[] } | null;
  sapDocEntry?: number;
  sapDocNum?: number;
  sapError?: string;
  attachments: Array<{
    id: number;
    filename: string;
    contentType: string;
    size: number;
    isPoAttachment?: boolean | null;
    aiAnalysis?: string | null;
    hasContent?: boolean;
  }>;
}

interface PoSapLog {
  id: number;
  poId: number;
  requestHeaders: Record<string, string> | null;
  requestBody: unknown;
  responseStatus: number | null;
  responseBody: unknown;
  isSuccess: boolean;
  createdAt: string;
}

function formatFileSize(bytes: number | undefined | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PODetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [po, setPo] = useState<POData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [showExtractedJson, setShowExtractedJson] = useState(false);
  const [offerSheetInput, setOfferSheetInput] = useState("");
  const [submittingOfferSheet, setSubmittingOfferSheet] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [replacingAttId, setReplacingAttId] = useState<number | null>(null);
  const [showSapLogsModal, setShowSapLogsModal] = useState(false);
  const [sapLogs, setSapLogs] = useState<PoSapLog[]>([]);
  const [loadingSapLogs, setLoadingSapLogs] = useState(false);
  const [sapLogsError, setSapLogsError] = useState<string | null>(null);
  const [showSendConfirmModal, setShowSendConfirmModal] = useState(false);
  const [attnos, setAttnos] = useState("");
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const handleReplaceFile = async (attId: number, file: File) => {
    if (!po) return;
    setReplacingAttId(attId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/purchase-orders/${po.id}/attachments/${attId}/replace`,
        { method: "POST", body: fd }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Replace failed (${res.status})`);
      }
      const r = await fetch(`/api/purchase-orders/${po.id}`);
      const data = await r.json();
      setPo(data);
    } catch (e: any) {
      alert(e?.message || "Replace failed");
    }
    setReplacingAttId(null);
  };

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPo(data);
        setOfferSheetInput(data.offerSheetNumber || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // const handleSendToSAP = async () => {
  //   if (!po) return;
  //   setProcessing(true);
  //   await fetch(`/api/purchase-orders/${po.id}/process`, { method: "POST" });
  //   // Refresh
  //   const r = await fetch(`/api/purchase-orders/${po.id}`);
  //   const data = await r.json();
  //   setPo(data);
  //   setProcessing(false);
  // };

  const handleSubmitAndSendPoToSap = async () => {
    if (!po) return;
    setProcessing(true);
    try {
      const rawSessionCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("sap_b1_session="))
        ?.split("=")[1];
      const decodedSession = rawSessionCookie ? decodeURIComponent(rawSessionCookie) : "";
      const sessionId = decodedSession.startsWith("B1SESSION=")
        ? decodedSession.replace("B1SESSION=", "")
        : "";

      const res = await fetch(`/api/process/${po.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionId ? { "x-sap-session-id": sessionId } : {}),
        },
        body: JSON.stringify({ extractedData: po.extractedData, attnos: attnos.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Process failed (${res.status})`);
      }
    } catch (e: any) {
      alert(e?.message || "Failed to submit and send PO to SAP");
    }
    const r = await fetch(`/api/purchase-orders/${po.id}`);
    const data = await r.json();
    setPo(data);
    setProcessing(false);
  };

  const handleOpenSapLogs = async () => {
    if (!po) return;
    setShowSapLogsModal(true);
    setLoadingSapLogs(true);
    setSapLogsError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/sap-logs`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to load logs (${res.status})`);
      }
      const data = await res.json();
      setSapLogs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setSapLogsError(e?.message || "Failed to load SAP logs");
      setSapLogs([]);
    }
    setLoadingSapLogs(false);
  };

  const handleReanalyze = async () => {
    if (!po) return;
    setReanalyzing(true);
    setReanalyzeError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/reanalyze`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Re-analyze failed (${res.status})`);
      }
      // Refetch the full detail so attachments, status, extracted data all update.
      const r = await fetch(`/api/purchase-orders/${po.id}`);
      const data = await r.json();
      setPo(data);
      setOfferSheetInput(data.offerSheetNumber || "");
    } catch (e: any) {
      setReanalyzeError(e?.message || "Re-analyze failed");
    }
    setReanalyzing(false);
  };

  const handleSubmitOfferSheet = async () => {
    if (!po || !offerSheetInput.trim()) return;
    setSubmittingOfferSheet(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/offer-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerSheetNumber: offerSheetInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setPo((prev) => (prev ? { ...prev, ...data } : null));
      }
    } catch (e) {
      console.error(e);
    }
    setSubmittingOfferSheet(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!po) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">Purchase order not found.</p>
      </div>
    );
  }

  const data = po.extractedData;
  const isPO = data?.isPurchaseOrder ?? false;
  const rawText = data?.rawText || po.aiAnalysis?.fullText || "";
  const sapSessionCookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith("sap_b1_session="))
    ?.split("=")[1];
  const hasActiveSapSession = !!sapSessionCookie && decodeURIComponent(sapSessionCookie).startsWith("B1SESSION=");
  const shouldHideNoActiveConnectionError =
    hasActiveSapSession && (po.sapError || "").toLowerCase() === "no active sap connection";
  const hasOfferSheetInExtractedData =
    !!(data?.offerSheetNumber && String(data.offerSheetNumber).trim().length > 0);

  return (
    <div>
      <button
        onClick={() => navigate("/purchase-orders")}
        className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} className="mr-1" />
        Back to Purchase Orders
      </button>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-900">PO Detail</h2>
          <p className="text-sm text-gray-500 mt-1 truncate">{po.subject}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleReanalyze}
            disabled={reanalyzing}
            className="btn-secondary"
            title="Re-run the AI on this record. Uses the stored attachment bytes when available, otherwise re-fetches the original email."
          >
            <RefreshCw size={16} className={`mr-2 ${reanalyzing ? "animate-spin" : ""}`} />
            {reanalyzing ? "Re-analyzing..." : "Re-analyze"}
          </button>
          {isPO && (
            <button
              onClick={handleOpenSapLogs}
              className="btn-secondary"
            >
              SAP API Logs
            </button>
          )}
          {po.status === "reviewed" && isPO && hasOfferSheetInExtractedData && (
            <button
              onClick={() => setShowSendConfirmModal(true)}
              disabled={processing || !hasActiveSapSession}
              className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              title={!hasActiveSapSession ? "SAP session is not active. Please test connection in Settings first." : undefined}
            >
              <Send size={16} className="mr-2" />
              {processing ? "Sending..." : "Send PO to SAP"}
            </button>
          )}
          {po.status === "needs_offer_sheet" && (
            <span className="status-badge bg-orange-100 text-orange-800">Needs Offer Sheet</span>
          )}
        </div>
      </div>

      {reanalyzeError && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{reanalyzeError}</p>
        </div>
      )}

      <div className={`mb-6 p-4 rounded-lg border flex items-start gap-3 ${isPO ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        {isPO ? (
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
        ) : (
          <XCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        )}
        <div className="flex-1">
          <p className={`text-sm font-medium ${isPO ? "text-green-800" : "text-amber-800"}`}>
            {isPO ? "Detected as a Purchase Order" : "Not recognized as a Purchase Order"}
          </p>
          <p className={`text-sm ${isPO ? "text-green-700" : "text-amber-700"}`}>
            Confidence: {Math.round((po.confidence || 0) * 100)}%
            {data?.reason ? ` — ${data.reason}` : ""}
          </p>
        </div>
      </div>

      {/* Offer Sheet Section */}
      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Offer Sheet Reference</h3>
        {po.status === "needs_offer_sheet" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              No Offer Sheet reference number was detected in the PO document. Please enter it manually.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={offerSheetInput}
                onChange={(e) => setOfferSheetInput(e.target.value)}
                placeholder="e.g. 0130/ADPI/OS/04/2026"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleSubmitOfferSheet}
                disabled={submittingOfferSheet || !offerSheetInput.trim()}
                className="btn-primary"
              >
                {submittingOfferSheet ? "Submitting..." : "Submit & Process PO"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Offer Sheet Number</dt>
              <dd className="text-sm font-medium text-gray-900">{po.offerSheetNumber || "-"}</dd>
            </div>
            {po.sqDocNum && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">SAP SQ Reference</dt>
                <dd className="text-sm font-medium text-gray-900">
                  #{po.sqDocNum} (DocEntry: {po.sqDocEntry})
                </dd>
              </div>
            )}
            {po.sapDocNum && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">SAP SO Created</dt>
                <dd className="text-sm font-medium text-green-700">
                  #{po.sapDocNum} (DocEntry: {po.sapDocEntry})
                </dd>
              </div>
            )}
          </div>
        )}
      </div>

      {po.sapError && !shouldHideNoActiveConnectionError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">SAP Error</p>
            <p className="text-sm text-red-600">{po.sapError}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Info</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">From</dt>
              <dd className="text-sm font-medium text-gray-900">
                {po.senderName || po.senderEmail}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium text-gray-900">{po.senderEmail}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Subject</dt>
              <dd className="text-sm font-medium text-gray-900">{po.subject}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Received</dt>
              <dd className="text-sm font-medium text-gray-900">
                {new Date(po.receivedAt).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-sm font-medium text-gray-900 capitalize">{po.status}</dd>
            </div>
          </dl>
        </div>

        {data && isPO && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Data</h3>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Customer</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.customerName || "-"} ({data.customerCode || "no code"})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">PO Number</dt>
                <dd className="text-sm font-medium text-gray-900">{data.poNumber || "-"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">PO Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.poDate ? new Date(data.poDate).toLocaleDateString() : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Delivery Date</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.deliveryDate ? new Date(data.deliveryDate).toLocaleDateString() : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Total</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {data.totalAmount ? `${data.currency || "$"}${data.totalAmount.toLocaleString()}` : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Payment Terms</dt>
                <dd className="text-sm font-medium text-gray-900">{data.paymentTerms || "-"}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {data && data.items.length > 0 && (
        <div className="card mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Items</h3>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item Code</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">UOM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.itemCode || "-"}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.description || "-"}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">
                    {item.unitPrice ? item.unitPrice.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">{item.uom || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="card mt-6">
          <button
            onClick={() => setShowExtractedJson((v) => !v)}
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 w-full"
          >
            {showExtractedJson ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <FileText size={18} className="text-gray-500" />
            Extracted JSON (SAP Payload)
          </button>
          {showExtractedJson && (
            <pre className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}

      {rawText && (
        <div className="card mt-6">
          <button
            onClick={() => setShowRawText((v) => !v)}
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 w-full"
          >
            {showRawText ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <FileText size={18} className="text-gray-500" />
            Parsed Document Text
          </button>
          {showRawText && (
            <pre className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto">
              {rawText}
            </pre>
          )}
        </div>
      )}

      {po.attachments.length > 0 && (
        <div className="card mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Attachments</h3>
          <div className="space-y-2">
            {po.attachments.map((att) => {
              const downloadUrl = `/api/purchase-orders/${po.id}/attachments/${att.id}/download`;
              const sizeLabel = formatFileSize(att.size);
              const canDownload = att.hasContent === true;
              return (
                <div key={att.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded">
                      <span className="text-xs font-medium text-gray-600">
                        {att.contentType.split("/")[1]?.toUpperCase() || "FILE"}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {canDownload ? (
                          <a
                            href={downloadUrl}
                            download={att.filename}
                            className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1"
                          >
                            {att.filename}
                            <Download size={12} />
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-gray-500">{att.filename}</p>
                        )}
                        {att.isPoAttachment === true && (
                          <span className="status-badge bg-green-100 text-green-800 text-xs">PO</span>
                        )}
                        {att.isPoAttachment === false && (
                          <span className="status-badge bg-gray-100 text-gray-600 text-xs">Not PO</span>
                        )}
                        {!canDownload && (
                          <span
                            className="status-badge bg-amber-100 text-amber-800 text-xs"
                            title="Original file bytes were not saved for this record. Re-fetch the email or re-upload the document to enable download."
                          >
                            not stored
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{att.contentType}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {sizeLabel && (
                      <span className="text-xs text-gray-500">{sizeLabel}</span>
                    )}
                    {!canDownload && (
                      <>
                        <input
                          ref={(el) => {
                            fileInputRefs.current[att.id] = el;
                          }}
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleReplaceFile(att.id, f);
                            e.target.value = "";
                          }}
                        />
                        <button
                          onClick={() => fileInputRefs.current[att.id]?.click()}
                          disabled={replacingAttId === att.id}
                          className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50"
                          title="Upload a fresh copy of this file so it can be downloaded and re-analyzed."
                        >
                          <Upload size={12} />
                          {replacingAttId === att.id ? "Uploading..." : "Replace"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showSapLogsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowSapLogsModal(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">SAP PurchaseOrders API Logs</h3>
              <button
                onClick={() => setShowSapLogsModal(false)}
                className="rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(85vh-64px)] overflow-auto p-5 space-y-4">
              {loadingSapLogs && (
                <p className="text-sm text-gray-500">Loading logs...</p>
              )}
              {sapLogsError && (
                <p className="text-sm text-red-600">{sapLogsError}</p>
              )}
              {!loadingSapLogs && !sapLogsError && sapLogs.length === 0 && (
                <p className="text-sm text-gray-500">No API history for this PO yet.</p>
              )}
              {!loadingSapLogs && !sapLogsError && sapLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">#{log.id}</span>{" "}
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                    <div className={`text-xs font-semibold px-2 py-1 rounded ${
                      log.isSuccess ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {log.responseStatus || "-"} {log.isSuccess ? "SUCCESS" : "FAILED"}
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Request Headers</p>
                      <pre className="rounded bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap break-words overflow-auto max-h-40">
                        {JSON.stringify(log.requestHeaders || {}, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Request Body</p>
                      <pre className="rounded bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap break-words overflow-auto max-h-52">
                        {JSON.stringify(log.requestBody, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Response Body</p>
                      <pre className="rounded bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap break-words overflow-auto max-h-52">
                        {typeof log.responseBody === "string"
                          ? log.responseBody
                          : JSON.stringify(log.responseBody, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSendConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowSendConfirmModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Send to SAP</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">
                Proceed to send this PO data to SAP Service Layer <code>POST /Quotations</code>?
              </p>
              <div>
                <label htmlFor="attnos" className="block text-sm font-medium text-gray-800 mb-1">
                  Attention Name (U_ATTNOS) <span className="text-red-500">*</span>
                </label>
                <input
                  id="attnos"
                  type="text"
                  value={attnos}
                  onChange={(e) => setAttnos(e.target.value)}
                  placeholder="e.g. IBU DEPUTRI"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  Free text — required by the SAP Quotation.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
              <button
                onClick={() => setShowSendConfirmModal(false)}
                className="btn-secondary"
                disabled={processing}
              >
                No
              </button>
              <button
                onClick={async () => {
                  setShowSendConfirmModal(false);
                  await handleSubmitAndSendPoToSap();
                }}
                className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={processing || !attnos.trim()}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
