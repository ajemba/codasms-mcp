/**
 * Thin client for the CODASMS Reseller API (https://api.codasms.com).
 * Wraps the 5 frozen v1 endpoints. Holds no money logic of its own — every
 * charge/refund decision lives server-side in the API.
 */
import { randomUUID } from "node:crypto";

export const DEFAULT_BASE = "https://api.codasms.com";

/** Friendly, action-oriented text for the API's frozen error reasons. */
const REASON_HELP: Record<string, string> = {
  missing_or_malformed_key: "No API key was sent, or it was malformed. Set CODASMS_API_KEY (or send a Bearer token).",
  invalid_key: "The API key is not valid or has been revoked. Mint a new one in your reseller dashboard.",
  rate_limited: "Too many requests (limit is 60/min per key). Wait a moment and retry.",
  insufficient_balance: "Not enough balance to buy this number. Top up your reseller balance.",
  no_numbers: "No numbers were available for that service/country just now (not charged). Try another country or retry.",
  out_of_stock: "That service/country is out of stock right now (not charged).",
  unavailable: "That service/country is temporarily unavailable (not charged).",
  concierge_only: "That cell is concierge-only and not self-serve buyable via the API.",
  price_moved: "The upstream price moved above the covered cap (not charged). Retry — pricing floats on thin cells.",
  provider_error: "The upstream provider had a transient error. Retry shortly.",
  internal_error: "An internal error occurred. Retry; if it persists, contact support@codasms.com.",
  not_found: "No order with that id belongs to this key.",
  in_progress: "An identical order is already in progress (idempotency). Poll that order instead.",
};

export class CodaApiError extends Error {
  reason: string;
  status: number;
  constructor(reason: string, status: number, extra?: string) {
    const help = REASON_HELP[reason] ?? "The request could not be completed.";
    super(`${reason}: ${help}${extra ? ` (${extra})` : ""}`);
    this.name = "CodaApiError";
    this.reason = reason;
    this.status = status;
  }
}

export interface Balance { ok: boolean; balance_cents: number; balance_usd: number; currency: string; }
export interface CreatedOrder {
  ok: boolean; order_id: number; number: string; service: string; country: string;
  band: string; price_cents: number; status: string; expires_in_seconds: number;
}
export interface OrderStatus {
  ok: boolean; order_id: number; status: string; waiting?: boolean; code?: string | null;
}

export class CodaClient {
  private apiKey: string;
  private base: string;

  constructor(apiKey: string, base: string = DEFAULT_BASE) {
    if (!apiKey || !apiKey.startsWith("coda_live_")) {
      throw new Error("A CODASMS reseller API key (coda_live_...) is required. Get one at https://codasms.com/reseller.");
    }
    this.apiKey = apiKey;
    this.base = base.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { ...init, headers });
    } catch (e) {
      throw new CodaApiError("provider_error", 0, `network error reaching ${this.base}`);
    }
    let data: any = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok || (data && data.ok === false)) {
      const reason = (data && (data.reason || data.error)) || `http_${res.status}`;
      throw new CodaApiError(String(reason), res.status);
    }
    return data as T;
  }

  balance(): Promise<Balance> {
    return this.request<Balance>("/v1/balance");
  }

  services(filters: { service?: string; country?: string } = {}): Promise<any> {
    const q = new URLSearchParams();
    if (filters.service) q.set("service", filters.service);
    if (filters.country) q.set("country", filters.country);
    const qs = q.toString();
    return this.request<any>(`/v1/services${qs ? `?${qs}` : ""}`);
  }

  countries(filters: { service?: string } = {}): Promise<any> {
    const q = new URLSearchParams();
    if (filters.service) q.set("service", filters.service);
    const qs = q.toString();
    return this.request<any>(`/v1/countries${qs ? `?${qs}` : ""}`);
  }

  createOrder(service: string, country: string, band: "standard" | "priority" = "standard"): Promise<CreatedOrder> {
    return this.request<CreatedOrder>("/v1/orders", {
      method: "POST",
      idempotencyKey: randomUUID(),
      body: JSON.stringify({ service, country, band }),
    });
  }

  orderStatus(orderId: number, action: "poll" | "cancel" = "poll"): Promise<OrderStatus> {
    return this.request<OrderStatus>("/v1/orders/status", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, action }),
    });
  }
}
