import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const SAP_SESSION_COOKIE = "sap_b1_session";

const getCookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];

const setCookie = (name: string, value: string, expiresAt: Date) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expiresAt.toUTCString()}; path=/`;
};

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

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const isSapApi = requestUrl.includes("/api/sap/");

  let nextInit = init;
  if (isSapApi) {
    const session = getSapSessionFromCookie();
    if (session) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      if (!headers.has("x-sap-session-id")) {
        headers.set("x-sap-session-id", session.replace("B1SESSION=", ""));
      }
      nextInit = {
        ...init,
        headers,
      };
    }
  }

  const response = await originalFetch(input, nextInit);

  if (isSapApi) {
    const headerSessionId = response.headers.get("x-sap-session-id");
    const headerTimeout = Number(response.headers.get("x-sap-session-timeout") || 30);

    if (headerSessionId) {
      saveSapSessionCookie({
        sessionId: headerSessionId,
        sessionTimeout: Number.isFinite(headerTimeout) ? headerTimeout : 30,
      });
    }
  }

  return response;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
