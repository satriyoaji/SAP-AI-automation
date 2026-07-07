import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Save, Users, Search, XCircle, CheckCircle2 } from "lucide-react";

interface CustomerRow {
  customerName: string;
  itemsCount: number;
  mappedCount: number;
  sapCardCode: string | null;
  sapCardName: string | null;
}

interface BpCandidate {
  cardCode: string;
  cardName: string;
  cardType?: string;
  cardForeignName?: string;
}

interface CustomerItem {
  customerName: string;
  customerItemCode: string;
  description: string;
  sapItemCode: string;
  seenCount: number;
  mappingId: number | null;
  updatedAt: string | null;
}

interface CustomerDetail {
  customerName: string;
  items: CustomerItem[];
}

const API = "http://localhost:3001/api/customer-items";

export default function MasterItemCustomer() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bpModalCustomer, setBpModalCustomer] = useState<string | null>(null);
  const [bpCandidates, setBpCandidates] = useState<BpCandidate[]>([]);
  const [bpSelectedCode, setBpSelectedCode] = useState<string | null>(null);
  const [bpLoading, setBpLoading] = useState(false);
  const [bpError, setBpError] = useState<string | null>(null);
  const [bpSearchInput, setBpSearchInput] = useState("");
  const [bpSaving, setBpSaving] = useState(false);

  useEffect(() => {
    void fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetch(API);
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load customers:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleCustomer = async (customerName: string) => {
    if (openCustomer === customerName) {
      setOpenCustomer(null);
      setDetail(null);
      setDrafts({});
      return;
    }
    setOpenCustomer(customerName);
    setDetail(null);
    setDrafts({});
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/${encodeURIComponent(customerName)}`);
      const data = (await res.json()) as CustomerDetail;
      setDetail(data);
      const initial: Record<string, string> = {};
      for (const item of data.items || []) {
        initial[item.customerItemCode] = item.sapItemCode || "";
      }
      setDrafts(initial);
    } catch (error) {
      console.error("Failed to load customer detail:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveMapping = async (item: CustomerItem) => {
    if (!detail) return;
    const value = (drafts[item.customerItemCode] || "").trim();
    setSavingCode(item.customerItemCode);
    try {
      const res = await fetch(
        `${API}/${encodeURIComponent(detail.customerName)}/${encodeURIComponent(item.customerItemCode)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sapItemCode: value,
            description: item.description,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) =>
            it.customerItemCode === item.customerItemCode
              ? {
                  ...it,
                  sapItemCode: saved.sapItemCode || "",
                  mappingId: saved.id,
                  updatedAt: saved.updatedAt,
                }
              : it,
          ),
        };
      });
      // Refresh the customer list counts.
      void fetchCustomers();
    } catch (error) {
      console.error("Failed to save mapping:", error);
      alert("Failed to save mapping");
    } finally {
      setSavingCode(null);
    }
  };

  const openBpModal = async (customerName: string, initialSearch?: string) => {
    setBpModalCustomer(customerName);
    setBpCandidates([]);
    setBpSelectedCode(null);
    setBpError(null);
    setBpSearchInput(initialSearch ?? customerName);
    void loadBpCandidates(customerName, initialSearch);
  };

  const loadBpCandidates = async (customerName: string, searchOverride?: string) => {
    setBpLoading(true);
    setBpError(null);
    try {
      const qs = searchOverride ? `?search=${encodeURIComponent(searchOverride)}` : "";
      const res = await fetch(
        `${API}/${encodeURIComponent(customerName)}/sap-candidates${qs}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setBpCandidates(Array.isArray(body?.candidates) ? body.candidates : []);
      setBpSelectedCode(body?.selectedCardCode || null);
    } catch (err: any) {
      setBpError(err?.message || "Failed to load SAP candidates");
      setBpCandidates([]);
    } finally {
      setBpLoading(false);
    }
  };

  const saveBpPick = async () => {
    if (!bpModalCustomer || !bpSelectedCode) return;
    const chosen = bpCandidates.find((c) => c.cardCode === bpSelectedCode);
    if (!chosen) return;
    setBpSaving(true);
    try {
      const res = await fetch(
        `${API}/${encodeURIComponent(bpModalCustomer)}/sap-bp`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sapCardCode: chosen.cardCode,
            sapCardName: chosen.cardName,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchCustomers();
      setBpModalCustomer(null);
    } catch (err: any) {
      setBpError(err?.message || "Failed to save BP");
    } finally {
      setBpSaving(false);
    }
  };

  const clearBp = async (customerName: string) => {
    if (!confirm(`Clear the saved SAP BP for "${customerName}"?`)) return;
    try {
      await fetch(`${API}/${encodeURIComponent(customerName)}/sap-bp`, {
        method: "DELETE",
      });
      await fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.trim().toLowerCase();
    return customers.filter((c) => c.customerName.toLowerCase().includes(q));
  }, [customers, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Master Item Customer</h1>
        <p className="text-gray-600 mt-1">
          Map each customer's item codes to your SAP item codes. New POs will
          reuse these mappings when creating SAP documents.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Users className="w-5 h-5" />
            <span className="font-semibold">
              Customers ({customers.length})
            </span>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer..."
            className="px-3 py-1.5 border rounded-md text-sm w-64"
          />
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No customers detected in POs yet.
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((c) => {
              const isOpen = openCustomer === c.customerName;
              return (
                <li key={c.customerName}>
                  <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <button
                      onClick={() => toggleCustomer(c.customerName)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {c.customerName}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {c.itemsCount} distinct item{c.itemsCount === 1 ? "" : "s"}
                          {" · "}
                          {c.mappedCount} mapped to SAP
                        </div>
                      </div>
                    </button>
                    {/* SAP BP chip / picker */}
                    <div className="flex items-center gap-2 shrink-0">
                      {c.sapCardCode ? (
                        <div
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800"
                          title={c.sapCardName || undefined}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span className="font-mono">{c.sapCardCode}</span>
                          {c.sapCardName && (
                            <span className="hidden md:inline max-w-[220px] truncate opacity-80">
                              {c.sapCardName}
                            </span>
                          )}
                          <button
                            onClick={() => openBpModal(c.customerName)}
                            className="ml-1 rounded px-1 text-emerald-700 hover:bg-emerald-100"
                          >
                            change
                          </button>
                          <button
                            onClick={() => clearBp(c.customerName)}
                            className="rounded px-1 text-red-600 hover:bg-red-50"
                            title="Clear saved BP"
                          >
                            <XCircle className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => openBpModal(c.customerName)}
                          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-100"
                        >
                          <Search className="w-3 h-3" />
                          Pick BP
                        </button>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          c.mappedCount >= c.itemsCount && c.itemsCount > 0
                            ? "bg-green-100 text-green-800"
                            : c.mappedCount > 0
                              ? "bg-amber-100 text-amber-800"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {c.itemsCount === 0
                          ? "no items"
                          : c.mappedCount >= c.itemsCount
                            ? "complete"
                            : c.mappedCount > 0
                              ? "partial"
                              : "unmapped"}
                      </span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="bg-gray-50 border-t px-4 py-4">
                      {detailLoading ? (
                        <div className="text-sm text-gray-500 py-4">
                          Loading items...
                        </div>
                      ) : !detail || detail.items.length === 0 ? (
                        <div className="text-sm text-gray-500 py-4">
                          No items detected for this customer.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-500 uppercase">
                                <th className="text-left py-2 pr-4">
                                  Customer Item Code
                                </th>
                                <th className="text-left py-2 pr-4">
                                  Description
                                </th>
                                <th className="text-left py-2 pr-4">Seen</th>
                                <th className="text-left py-2 pr-4">
                                  SAP Item Code
                                </th>
                                <th className="text-right py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {detail.items.map((item) => {
                                const draft =
                                  drafts[item.customerItemCode] ?? "";
                                const dirty =
                                  draft.trim() !== (item.sapItemCode || "").trim();
                                return (
                                  <tr key={item.customerItemCode}>
                                    <td className="py-2 pr-4 font-mono text-xs">
                                      {item.customerItemCode}
                                    </td>
                                    <td className="py-2 pr-4 text-gray-700 max-w-md">
                                      {item.description || (
                                        <span className="text-gray-400 italic">
                                          (none)
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 pr-4 text-gray-500">
                                      {item.seenCount}x
                                    </td>
                                    <td className="py-2 pr-4">
                                      <input
                                        type="text"
                                        value={draft}
                                        onChange={(e) =>
                                          setDrafts((prev) => ({
                                            ...prev,
                                            [item.customerItemCode]:
                                              e.target.value,
                                          }))
                                        }
                                        placeholder="e.g., 8535-BN"
                                        className="px-2 py-1 border rounded-md text-sm w-52 font-mono"
                                      />
                                    </td>
                                    <td className="py-2 text-right">
                                      <button
                                        onClick={() => saveMapping(item)}
                                        disabled={
                                          !dirty ||
                                          savingCode === item.customerItemCode
                                        }
                                        className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <Save className="w-3 h-3" />
                                        {savingCode === item.customerItemCode
                                          ? "Saving..."
                                          : "Save"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {bpModalCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBpModalCustomer(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Pick SAP BusinessPartner
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Customer from PO: <span className="font-medium">{bpModalCustomer}</span>
                </p>
              </div>
              <button
                onClick={() => setBpModalCustomer(null)}
                className="rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <div className="border-b border-gray-100 px-5 py-3 flex items-center gap-2">
              <input
                type="text"
                value={bpSearchInput}
                onChange={(e) => setBpSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void loadBpCandidates(bpModalCustomer, bpSearchInput.trim() || undefined);
                  }
                }}
                placeholder="Search SAP by CardCode / CardName / CardForeignName"
                className="flex-1 px-3 py-1.5 border rounded-md text-sm"
              />
              <button
                onClick={() =>
                  void loadBpCandidates(
                    bpModalCustomer,
                    bpSearchInput.trim() || undefined,
                  )
                }
                disabled={bpLoading}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <Search className="w-3 h-3" />
                Search
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-3">
              {bpLoading && (
                <div className="py-8 text-center text-sm text-gray-500">
                  Loading SAP candidates…
                </div>
              )}
              {bpError && (
                <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {bpError}
                </div>
              )}
              {!bpLoading && bpCandidates.length === 0 && !bpError && (
                <div className="py-8 text-center text-sm text-gray-500">
                  No SAP candidates found. Try a different search.
                </div>
              )}
              {!bpLoading && bpCandidates.length > 0 && (
                <ul className="space-y-1">
                  {bpCandidates.map((c) => {
                    const checked = bpSelectedCode === c.cardCode;
                    return (
                      <li key={c.cardCode}>
                        <label
                          className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer ${
                            checked
                              ? "border-blue-400 bg-blue-50"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="bp"
                            checked={checked}
                            onChange={() => setBpSelectedCode(c.cardCode)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-semibold">
                                {c.cardCode}
                              </span>
                              <span className="text-sm text-gray-900 truncate">
                                {c.cardName}
                              </span>
                            </div>
                            {c.cardForeignName && (
                              <div className="text-xs text-gray-500 mt-0.5 truncate">
                                Foreign: {c.cardForeignName}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setBpModalCustomer(null)}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                disabled={bpSaving}
              >
                Cancel
              </button>
              <button
                onClick={saveBpPick}
                disabled={!bpSelectedCode || bpSaving}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bpSaving ? "Saving…" : "Save selected BP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
