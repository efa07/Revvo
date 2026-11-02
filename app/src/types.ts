// Money is always integer minor units (santim). 7200 = ETB 72. The app never computes totals itself.
export type Role = 'admin' | 'staff';
export type User = { id: number; username: string; role: Role };
export type Category = 'drinks' | 'snacks' | 'sweets';

export type Product = {
  id: number; name: string; category: Category; sizeLabel: string;
  price: number; listPrice: number | null; imageUrl: string | null; soldOut: boolean;
};
export type Machine = { id: string; status: 'ACTIVE' | 'MAINTENANCE' };

export type Quote = {
  items: { productId: number; category: Category; name: string; sizeLabel: string; unitPrice: number; listPrice: number; quantity: number }[];
  subtotal: number; offerSavings: number; promoCode: string | null; promoDiscount: number; total: number; currency: string;
};

export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
export type DispenseStatus = 'NOT_STARTED' | 'DISPENSING' | 'DELIVERED' | 'PARTIAL' | 'FAILED' | 'UNKNOWN';
export type ItemStatus = 'PENDING' | 'DISPENSING' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';

export type Order = {
  id: number; reference: string; machineId: string; createdAt: string;
  items: { productId: number; category: Category; name: string; sizeLabel: string; unitPrice: number; listPrice: number; quantity: number; delivered: number; status: ItemStatus }[];
  subtotal: number; offerSavings: number; promoCode: string | null; promoDiscount: number; total: number; currency: string;
  paymentStatus: PaymentStatus; dispenseStatus: DispenseStatus; checkoutUrl: string | null;
};

export type AdminProduct = {
  id: number; name: string; category: Category; sizeLabel: string; priceMinor: number; listPriceMinor: number | null;
  imageUrl: string | null; slot: string | null; active: boolean; stock: { onHand: number; reserved: number; available: number };
};
