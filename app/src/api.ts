import type {
  AdminProduct,
  Category,
  Machine,
  Order,
  Product,
  Quote,
  User,
} from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => {
  token = t;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the server");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && path !== "/auth/login")
      onUnauthorized?.();
    throw new ApiError(
      res.status,
      data?.error?.code ?? "ERROR",
      data?.error?.message ?? "Something went wrong",
      data?.error?.detail,
    );
  }
  return data as T;
}

export type OrderRequest = {
  items: { productId: number; quantity: number }[];
  promoCode?: string;
};

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>("POST", "/auth/login", {
      username,
      password,
    }),
  me: () => request<{ user: User }>("GET", "/auth/me"),
  products: () =>
    request<{ machine: Machine; products: Product[] }>("GET", "/products"),
  quote: (r: OrderRequest) => request<Quote>("POST", "/quote", r),
  createOrder: (r: OrderRequest, idempotencyKey: string) =>
    request<{ order: Order }>("POST", "/orders", r, {
      "Idempotency-Key": idempotencyKey,
    }),
  getOrder: (id: number) => request<{ order: Order }>("GET", `/orders/${id}`),
  activeOrder: () => request<{ order: Order | null }>("GET", "/orders/active"),
  pay: (id: number) => request<{ order: Order }>("POST", `/orders/${id}/pay`),
  cancel: (id: number) =>
    request<{ order: Order }>("POST", `/orders/${id}/cancel`),
  // admin
  adminProducts: () =>
    request<{ products: AdminProduct[] }>("GET", "/admin/products"),
  createProduct: (b: ProductInput & { stock: number }) =>
    request<{ product: AdminProduct }>("POST", "/admin/products", b),
  updateProduct: (id: number, b: Partial<ProductInput>) =>
    request<{ product: AdminProduct }>("PATCH", `/admin/products/${id}`, b),
  setStock: (id: number, quantity: number, reason?: string) =>
    request<{ product: AdminProduct }>("PUT", `/admin/products/${id}/stock`, {
      quantity,
      reason,
    }),
  setMachine: (status: Machine["status"]) =>
    request<Machine>("PATCH", "/admin/machine", { status }),
  machine: () => request<Machine>("GET", "/machine"),
};

export type ProductInput = {
  name: string;
  category: Category;
  sizeLabel: string;
  priceMinor: number;
  listPriceMinor: number | null;
  slot: string | null;
  active: boolean;
};

/** Idempotency keys only need to be unique per user; they are not secrets. */
export const newIdempotencyKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
