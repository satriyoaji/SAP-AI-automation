import { useEffect, useState } from "react";
import {
  Save,
  Trash2,
  Mail,
  Server,
  Link as LinkIcon,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Pencil,
} from "lucide-react";

interface EmailAccount {
  id: number;
  provider: string;
  email: string;
  isActive: boolean;
}

interface SAPConnection {
  id: number;
  name: string;
  serviceLayerUrl: string;
  companyDB: string;
  username?: string;
  password?: string;
  isActive: boolean;
  lastConnectedAt?: string | null;
}

const SAP_SESSION_COOKIE = "sap_b1_session";

const setCookie = (name: string, value: string, expiresAt: Date) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expiresAt.toUTCString()}; path=/`;
};

const getCookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];

const getSapSessionFromCookie = (): string | null => {
  const raw = getCookie(SAP_SESSION_COOKIE);
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  return decoded.startsWith("B1SESSION=") ? decoded : null;
};

const saveSapSessionCookie = (session: {
  sessionId?: string;
  sessionTimeout?: number;
}) => {
  if (!session.sessionId) return;
  const timeoutMinutes = session.sessionTimeout || 30;
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  setCookie(SAP_SESSION_COOKIE, `B1SESSION=${session.sessionId}`, expiresAt);
  window.dispatchEvent(new Event("sap-session-updated"));
};

export default function SettingsPage() {
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [sapConnections, setSapConnections] = useState<SAPConnection[]>([]);
  const [imapForm, setImapForm] = useState({
    email: "",
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
    imapUsername: "",
    imapPassword: "",
  });
  const [sapForm, setSapForm] = useState({
    name: "",
    serviceLayerUrl: "",
    companyDB: "",
    username: "",
    password: "",
  });
  const [sapSaveError, setSapSaveError] = useState<string | null>(null);
  const [sapSaving, setSapSaving] = useState(false);
  const [inlineTestResult, setInlineTestResult] = useState<{ status: "idle" | "testing" | "ok" | "failed"; message?: string }>({ status: "idle" });
  const [sessionDetails, setSessionDetails] = useState<{
    sessionId?: string;
    version?: string;
    sessionTimeout?: number;
  } | null>(null);
  const [showSessionInfo, setShowSessionInfo] = useState(false);

  const fetchData = () => {
    fetch("/api/email/accounts")
      .then((r) => r.json())
      .then(setEmailAccounts);
    fetch("/api/sap/connections")
      .then((r) => r.json())
      .then(setSapConnections);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const addImapAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/email/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "imap",
        email: imapForm.email,
        imapHost: imapForm.imapHost,
        imapPort: Number(imapForm.imapPort),
        imapSecure: imapForm.imapSecure,
        imapUsername: imapForm.imapUsername,
        imapPassword: imapForm.imapPassword,
      }),
    });
    setImapForm({ email: "", imapHost: "", imapPort: "993", imapSecure: true, imapUsername: "", imapPassword: "" });
    fetchData();
  };

  const testConnection = async (e: React.MouseEvent) => {
    e.preventDefault();
    setInlineTestResult({ status: "testing" });
    setSessionDetails(null);
    setShowSessionInfo(false);
    try {
      const res = await fetch("/api/sap/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceLayerUrl: sapForm.serviceLayerUrl,
          companyDB: sapForm.companyDB,
          username: sapForm.username,
          password: sapForm.password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body?.success === true;
      if (ok) {
        const details = {
          sessionId: body?.sessionId,
          version: body?.version,
          sessionTimeout: body?.sessionTimeout,
        };
        setSessionDetails(details);
        saveSapSessionCookie(details);
      }
      setInlineTestResult({
        status: ok ? "ok" : "failed",
        message: body?.message || (ok ? "Connected" : `HTTP ${res.status}`),
      });
    } catch (err: any) {
      setInlineTestResult({ status: "failed", message: err?.message || "Network error" });
    }
  };

  const addSAPConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSapSaveError(null);
    setSapSaving(true);
    try {
      const res = await fetch("/api/sap/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sapForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      if (sessionDetails) {
        saveSapSessionCookie(sessionDetails);
      }
      // Reset form and clear inline test result
      setSapForm({ name: "", serviceLayerUrl: "", companyDB: "", username: "", password: "" });
      setInlineTestResult({ status: "idle" });
      setSessionDetails(null);
      setShowSessionInfo(false);
      fetchData();
    } catch (err: any) {
      setSapSaveError(err?.message || "Save failed");
    }
    setSapSaving(false);
  };

  const deleteEmail = async (id: number) => {
    await fetch(`/api/email/accounts/${id}`, { method: "DELETE" });
    fetchData();
  };

  const deleteSAP = async (id: number) => {
    await fetch(`/api/sap/connections/${id}`, { method: "DELETE" });
    fetchData();
  };

  const applyConnection = async (id: number) => {
    try {
      const sessionFromCookie = getSapSessionFromCookie();
      const res = await fetch(`/api/sap/connections/${id}/full`, {
        headers: sessionFromCookie
          ? { "x-sap-session-id": sessionFromCookie.replace("B1SESSION=", "") }
          : undefined,
      });
      const conn = await res.json();
      if (res.ok && conn) {
        setSapForm({
          name: conn.name,
          serviceLayerUrl: conn.serviceLayerUrl,
          companyDB: conn.companyDB,
          username: conn.username || "",
          password: conn.password || "",
        });
      }
    } catch {
      // ignore — user stays on current form data
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Settings</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Email Accounts */}
        <div>
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={20} className="text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900">Email Accounts</h3>
            </div>

            {emailAccounts.length > 0 && (
              <div className="mb-4 space-y-2">
                {emailAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{acc.email}</p>
                      <p className="text-xs text-gray-500 capitalize">{acc.provider}</p>
                    </div>
                    <button onClick={() => deleteEmail(acc.id)} className="text-red-600 hover:text-red-900">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h4 className="text-sm font-medium text-gray-700 mb-3">Add IMAP Account</h4>
            <form onSubmit={addImapAccount} className="space-y-3">
              <div>
                <label className="label">Email Address</label>
                <input className="input" value={imapForm.email} onChange={(e) => setImapForm({ ...imapForm, email: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">IMAP Host</label>
                  <input className="input" value={imapForm.imapHost} onChange={(e) => setImapForm({ ...imapForm, imapHost: e.target.value })} placeholder="imap.gmail.com" required />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" value={imapForm.imapPort} onChange={(e) => setImapForm({ ...imapForm, imapPort: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" value={imapForm.imapUsername} onChange={(e) => setImapForm({ ...imapForm, imapUsername: e.target.value })} required />
              </div>
              <div>
                <label className="label">Password / App Password</label>
                <input type="password" className="input" value={imapForm.imapPassword} onChange={(e) => setImapForm({ ...imapForm, imapPassword: e.target.value })} required />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={imapForm.imapSecure} onChange={(e) => setImapForm({ ...imapForm, imapSecure: e.target.checked })} />
                <span className="text-sm text-gray-600">Use SSL/TLS</span>
              </label>
              <button type="submit" className="btn-primary w-full">
                <Save size={16} className="mr-2" />
                Add IMAP Account
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <a href="/api/email/auth/google" className="btn-secondary w-full">
                <LinkIcon size={16} className="mr-2" />
                Connect Gmail Account
              </a>
            </div>
          </div>
        </div>

        {/* SAP Connections */}
        <div>
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Server size={20} className="text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900">SAP B1 Connections</h3>
            </div>

            {sapConnections.length > 0 && sapConnections[0] && (() => {
              const conn = sapConnections[0];
              return (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{conn.name}</p>
                      <p className="text-xs text-gray-500 truncate">{conn.serviceLayerUrl}</p>
                      <p className="text-xs text-gray-400">DB: {conn.companyDB}</p>
                      {conn.lastConnectedAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Last connected: {new Date(conn.lastConnectedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <button
                        onClick={() => applyConnection(conn.id)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit saved connection"
                      >
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => deleteSAP(conn.id)} className="text-red-600 hover:text-red-900">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <h4 className="text-sm font-medium text-gray-700 mb-3">Add SAP Connection</h4>
            <form onSubmit={addSAPConnection} className="space-y-3">
              <div>
                <label className="label">Connection Name</label>
                <input className="input" value={sapForm.name} onChange={(e) => setSapForm({ ...sapForm, name: e.target.value })} placeholder="Production SAP" required />
              </div>
              <div>
                <label className="label">Service Layer URL</label>
                <input className="input" value={sapForm.serviceLayerUrl} onChange={(e) => setSapForm({ ...sapForm, serviceLayerUrl: e.target.value })} placeholder="https://server:50000/b1s/v1" required />
              </div>
              <div>
                <label className="label">Company Database</label>
                <input className="input" value={sapForm.companyDB} onChange={(e) => setSapForm({ ...sapForm, companyDB: e.target.value })} placeholder="SBODemoUS" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Username</label>
                  <input className="input" value={sapForm.username} onChange={(e) => setSapForm({ ...sapForm, username: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input type="password" className="input" value={sapForm.password} onChange={(e) => setSapForm({ ...sapForm, password: e.target.value })} required />
                </div>
              </div>
              {sapSaveError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Could not save</p>
                    <p className="break-words">{sapSaveError}</p>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={sapSaving}
                className="btn-primary w-full disabled:opacity-50"
              >
                <Save size={16} className="mr-2" />
                {sapSaving ? "Saving..." : "Add SAP Connection"}
              </button>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={inlineTestResult.status === "testing"}
                  className="w-full py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={inlineTestResult.status === "testing" ? "animate-spin" : ""} />
                  {inlineTestResult.status === "testing" ? "Testing..." : "Test Connection"}
                </button>
              </div>
              {/* Test result message */}
              {inlineTestResult.status !== "idle" && (
                <div
                  className={`mt-2 p-3 rounded-lg border text-sm flex items-start gap-2 ${
                    inlineTestResult.status === "ok"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  }`}
                >
                  {inlineTestResult.status === "ok" ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={14} className="mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1">
                    <span className="break-words font-medium">{inlineTestResult.message}</span>
                    {/* Session details on successful test */}
                    {inlineTestResult.status === "ok" && sessionDetails && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowSessionInfo(!showSessionInfo)}
                          className="text-xs underline opacity-75 hover:opacity-100"
                        >
                          {showSessionInfo ? "Hide" : "Show"} Session Details
                        </button>
                        {showSessionInfo && (
                          <div className="mt-2 bg-green-100/50 rounded p-2 text-xs space-y-1">
                            {sessionDetails.sessionId && (
                              <div><span className="font-medium">SessionId:</span> {sessionDetails.sessionId}</div>
                            )}
                            {sessionDetails.version && (
                              <div><span className="font-medium">Version:</span> {sessionDetails.version}</div>
                            )}
                            {sessionDetails.sessionTimeout && (
                              <div><span className="font-medium">Session Timeout:</span> {sessionDetails.sessionTimeout} min</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}
