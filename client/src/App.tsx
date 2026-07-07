import { useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Mail,
  Settings,
  Upload,
  ClipboardCheck,
  FileQuestion,
  FileType,
  Boxes,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ServerOff,
} from "lucide-react";
import Dashboard from "./pages/Dashboard";
import PurchaseOrders from "./pages/PurchaseOrders";
import PODetail from "./pages/PODetail";
import SettingsPage from "./pages/Settings";
import UploadPage from "./pages/Upload";
import NeedsOfferSheet from "./pages/NeedsOfferSheet";
import Templates from "./pages/Templates";
import MasterItemCustomer from "./pages/MasterItemCustomer";

type SapConnectionStatus = "unknown" | "connected" | "no_connection" | "expired" | "error";

function App() {
  const [sapStatus, setSapStatus] = useState<SapConnectionStatus>("unknown");
  const [sapStatusMessage, setSapStatusMessage] = useState<string>("");
  const [savedConnectionId, setSavedConnectionId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const sapSessionExpired = sapStatus === "expired";

  const getCookie = useCallback((name: string) =>
    document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${name}=`))
      ?.split("=")[1], []);

  const setCookie = useCallback((name: string, value: string, expiresAt: Date) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expiresAt.toUTCString()}; path=/`;
  }, []);

  const checkSessionCookie = useCallback(async () => {
    try {
      const res = await fetch("/api/sap/connections");
      const connections = await res.json();
      if (!res.ok || !Array.isArray(connections) || connections.length === 0) {
        setSavedConnectionId(null);
        setSapStatus("no_connection");
        setSapStatusMessage("No SAP connection saved");
        return;
      }
      setSavedConnectionId(connections[0].id);
    } catch {
      setSavedConnectionId(null);
      setSapStatus("error");
      setSapStatusMessage("Failed to read SAP connections");
      return;
    }

    const raw = getCookie("sap_b1_session");
    if (!raw) {
      setSapStatus("expired");
      setSapStatusMessage("SAP session expired");
      return;
    }
    const decoded = decodeURIComponent(raw);
    const isValid = decoded.startsWith("B1SESSION=") && decoded.length > "B1SESSION=".length;
    if (isValid) {
      setSapStatus("connected");
      setSapStatusMessage("SAP session active");
    } else {
      setSapStatus("expired");
      setSapStatusMessage("SAP session expired");
    }
  }, [getCookie]);

  const retrySapConnection = useCallback(async () => {
    if (!savedConnectionId) {
      // No saved connection to retry — just re-check state.
      await checkSessionCookie();
      return;
    }
    setRetrying(true);
    try {
      const res = await fetch(`/api/sap/connections/${savedConnectionId}/test`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body?.success === true;
      if (ok && body?.sessionId) {
        const timeoutMinutes = body?.sessionTimeout || 30;
        const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
        setCookie("sap_b1_session", `B1SESSION=${body.sessionId}`, expiresAt);
        window.dispatchEvent(new Event("sap-session-updated"));
        setSapStatus("connected");
        setSapStatusMessage("SAP session active");
      } else {
        setSapStatus("error");
        setSapStatusMessage(body?.message || body?.error || `Retry failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setSapStatus("error");
      setSapStatusMessage(err?.message || "Network error");
    } finally {
      setRetrying(false);
    }
  }, [savedConnectionId, setCookie, checkSessionCookie]);

  useEffect(() => {
    void checkSessionCookie();

    const onSessionUpdated = () => {
      void checkSessionCookie();
    };

    window.addEventListener("sap-session-updated", onSessionUpdated);
    window.addEventListener("focus", onSessionUpdated);

    return () => {
      window.removeEventListener("sap-session-updated", onSessionUpdated);
      window.removeEventListener("focus", onSessionUpdated);
    };
  }, [checkSessionCookie]);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">PO to SAP</h1>
        </div>
        <nav className="p-4 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>
          <NavLink
            to="/purchase-orders"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Mail size={18} />
            All Emails
          </NavLink>
          <NavLink
            to="/detected-pos"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <ClipboardCheck size={18} />
            Detected POs
          </NavLink>
          <NavLink
            to="/needs-offer-sheet"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <FileQuestion size={18} />
            Needs Offer Sheet
          </NavLink>
          <NavLink
            to="/upload"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Upload size={18} />
            Upload PO
          </NavLink>
          <NavLink
            to="/templates"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <FileType size={18} />
            Templates
          </NavLink>
          <NavLink
            to="/master-item-customer"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Boxes size={18} />
            Master Item Customer
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`
            }
          >
            <Settings size={18} />
            Settings
          </NavLink>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Header: SAP connection status pill + retry */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200 px-6 py-2 flex items-center justify-end gap-3">
          <SapStatusPill
            status={sapStatus}
            message={sapStatusMessage}
            retrying={retrying}
            hasSavedConnection={savedConnectionId !== null}
            onRetry={retrySapConnection}
          />
        </div>
        <div className="max-w-7xl mx-auto px-6 py-8">
          {sapSessionExpired && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3">
              <span>SAP session expired. {savedConnectionId ? "Click Retry above to reuse the saved connection, or update it in Settings." : "Update connection in Settings."}</span>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/purchase-orders" element={<PurchaseOrders title="All Emails" />} />
            <Route
              path="/detected-pos"
              element={<PurchaseOrders detectedOnly title="Detected POs" />}
            />
            <Route path="/needs-offer-sheet" element={<NeedsOfferSheet />} />
            <Route path="/purchase-orders/:id" element={<PODetail />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/master-item-customer" element={<MasterItemCustomer />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function SapStatusPill({
  status,
  message,
  retrying,
  hasSavedConnection,
  onRetry,
}: {
  status: SapConnectionStatus;
  message: string;
  retrying: boolean;
  hasSavedConnection: boolean;
  onRetry: () => void;
}) {
  const style =
    status === "connected"
      ? "bg-green-50 text-green-700 border-green-200"
      : status === "no_connection"
        ? "bg-gray-50 text-gray-700 border-gray-200"
        : status === "expired"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : status === "error"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-gray-50 text-gray-500 border-gray-200";

  const Icon =
    status === "connected"
      ? CheckCircle2
      : status === "no_connection"
        ? ServerOff
        : status === "error" || status === "expired"
          ? XCircle
          : RefreshCw;

  const label =
    status === "connected"
      ? "SAP Connected"
      : status === "no_connection"
        ? "No SAP Connection"
        : status === "expired"
          ? "SAP Session Expired"
          : status === "error"
            ? "SAP Connection Error"
            : "Checking SAP…";

  const showRetry =
    hasSavedConnection && (status === "expired" || status === "error");

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${style}`}>
      <Icon size={14} className={status === "unknown" ? "animate-spin" : ""} />
      <span>{label}</span>
      {message && status !== "connected" && status !== "unknown" && (
        <span className="hidden md:inline text-[11px] opacity-75 truncate max-w-[240px]" title={message}>
          — {message}
        </span>
      )}
      {showRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="ml-1 inline-flex items-center gap-1 rounded-full border border-current/40 px-2 py-0.5 text-[11px] hover:bg-black/5 disabled:opacity-50"
          title="Retry using the saved connection"
        >
          <RefreshCw size={11} className={retrying ? "animate-spin" : ""} />
          {retrying ? "Retrying" : "Retry"}
        </button>
      )}
    </div>
  );
}

export default App;
