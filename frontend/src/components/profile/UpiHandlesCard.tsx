"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import type { ProfileSummary, StoredUpiHandle } from "@/types/offramp";
import { useToast } from "@/hooks/useToast";

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

export function UpiHandlesCard({ initialHandles }: { initialHandles: ProfileSummary["handles"] }) {
  const [handles, setHandles] = useState(initialHandles);
  const [upiId, setUpiId] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const run = (task: () => Promise<StoredUpiHandle[]>, successMessage: string) => {
    startTransition(() => {
      void task()
        .then((next) => {
          setHandles(next);
          showToast(successMessage, "success");
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : "Request failed.", "error");
        });
    });
  };

  return (
    <section className="section-shell rounded-3xl p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Linked UPI handles
          </p>
          <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
            Saved payout destinations
          </h2>
        </div>
        <div className="text-[11px] font-[var(--font-mono)] text-[var(--text-3)]">
          {handles.length}/3 linked
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {handles.map((handle) => (
          <div
            key={handle.id}
            className="data-row flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-[var(--font-syne)] text-[15px] font-[700]">{handle.upiMasked}</span>
                {handle.isDefault ? (
                  <span className="rounded-full bg-[var(--accent-green-bg)] px-2.5 py-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--success-fg)]">
                    Default
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[12px] text-[var(--text-2)]">
                {handle.bankName} · Added {new Date(handle.addedAt).toLocaleDateString("en-IN")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!handle.isDefault ? (
                <button
                  type="button"
                  className="btn-ghost w-auto"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      async () => {
                        const payload = await jsonRequest<{ handles: StoredUpiHandle[] }>(`/api/profile/upi/${handle.id}`, {
                          method: "PATCH",
                        });
                        return payload.handles;
                      },
                      "Default handle updated",
                    )
                  }
                >
                  Set as default
                </button>
              ) : null}
              <button
                type="button"
                className="btn-ghost w-auto"
                disabled={isPending}
                onClick={() =>
                  run(
                    async () => {
                      const payload = await jsonRequest<{ handles: StoredUpiHandle[] }>(`/api/profile/upi/${handle.id}`, {
                        method: "DELETE",
                      });
                      return payload.handles;
                    },
                    "Handle removed",
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] p-4">
        <p className="text-[12px] text-[var(--text-2)]">
          Add a new handle. Only the masked display value is stored here; the full ID is hashed before persistence.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={upiId}
            onChange={(event) => setUpiId(event.target.value)}
            placeholder="name@upi"
            className="rp-input"
          />
          <button
            type="button"
            className="btn-primary btn-accent sm:w-auto"
            disabled={isPending || !upiId.trim()}
            onClick={() =>
              run(
                async () => {
                  const payload = await jsonRequest<{ handles: StoredUpiHandle[] }>("/api/profile/upi", {
                    method: "POST",
                    body: JSON.stringify({ upiId }),
                  });
                  setUpiId("");
                  return payload.handles;
                },
                "UPI handle added",
              )
            }
          >
            Add handle
          </button>
        </div>
      </div>
    </section>
  );
}
