import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Save, Users } from "lucide-react";

interface CustomerRow {
  customerName: string;
  itemsCount: number;
  mappedCount: number;
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
                  <button
                    onClick={() => toggleCustomer(c.customerName)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
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
                  </button>

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
    </div>
  );
}
