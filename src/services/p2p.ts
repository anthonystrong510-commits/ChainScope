import { getAuthHeaders, getOptionalAuthHeaders } from '../firebase';
import type {
  P2PAd,
  P2PAdSide,
  P2PAsset,
  P2PChatMessage,
  P2PEscrowMode,
  P2POrder,
  P2POverviewResponse,
  P2PPriceType,
  P2PSavedPaymentMethod,
} from '../types/p2p';

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

export async function fetchP2POverview(): Promise<P2POverviewResponse> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/db/p2p/overview', { headers });
  return parseJson<P2POverviewResponse>(res);
}

export async function saveP2PPaymentProfile(params: {
  countryCode: string;
  methodId: string;
  accountHolder: string;
  accountDetails: string;
  instructions?: string;
}): Promise<P2PSavedPaymentMethod> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/db/p2p/payment-profiles', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ paymentProfile: P2PSavedPaymentMethod }>(res);
  return data.paymentProfile;
}

export async function deleteP2PPaymentProfile(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/payment-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  await parseJson<{ ok: boolean }>(res);
}

export async function createP2PAd(params: {
  side: P2PAdSide;
  asset: P2PAsset;
  countryCode: string;
  priceType: P2PPriceType;
  fixedPriceFiat: number;
  floatingMarginPct: number;
  availableCryptoAmount: number;
  minFiatOrder: number;
  maxFiatOrder: number;
  paymentMethodIds: string[];
  paymentWindowMins: number;
  escrowMode: P2PEscrowMode;
  terms?: string;
}): Promise<P2PAd> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/db/p2p/ads', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ ad: P2PAd }>(res);
  return data.ad;
}

export async function updateP2PAdStatus(
  id: string,
  status: 'active' | 'paused' | 'closed'
): Promise<P2PAd> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/ads/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  });
  const data = await parseJson<{ ad: P2PAd }>(res);
  return data.ad;
}

export async function createP2POrder(params: {
  adId: string;
  fiatAmount: number;
  paymentMethodId: string;
  sellerPaymentDetails?: {
    accountHolder?: string;
    accountDetails?: string;
    instructions?: string;
  };
}): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/db/p2p/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function fetchP2POrderDetail(orderId: string): Promise<{
  order: P2POrder;
  messages: P2PChatMessage[];
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}`, { headers });
  return parseJson<{ order: P2POrder; messages: P2PChatMessage[] }>(res);
}

export async function lockP2PEscrow(
  orderId: string,
  params: {
    mode: P2PEscrowMode;
    txHash?: string;
    signature?: string;
    sellerPaymentDetails?: {
      accountHolder?: string;
      accountDetails?: string;
      instructions?: string;
    };
  }
): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/lock-escrow`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function markP2PFiatPaid(
  orderId: string,
  params: {
    fiatProofRef: string;
    fiatProofImage?: string;
    fiatProofNote?: string;
  }
): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/mark-paid`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function releaseP2PEscrow(orderId: string): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/release`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function cancelP2POrder(orderId: string): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function disputeP2POrder(orderId: string, reason: string): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/dispute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason }),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export async function sendP2PMessageRest(
  orderId: string,
  params: {
    text: string;
    attachmentImage?: string;
    txHash?: string;
    clientId?: string;
  }
): Promise<P2PChatMessage> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/p2p/orders/${encodeURIComponent(orderId)}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJson<{ message: P2PChatMessage }>(res);
  return data.message;
}

export async function fetchAdminP2POrders(): Promise<{
  orders: P2POrder[];
  messagesByOrder: Record<string, P2PChatMessage[]>;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/db/admin/p2p/orders', { headers });
  return parseJson<{
    orders: P2POrder[];
    messagesByOrder: Record<string, P2PChatMessage[]>;
  }>(res);
}

export async function resolveAdminP2POrder(
  orderId: string,
  decision: 'release_to_buyer' | 'refund_to_seller',
  note: string
): Promise<P2POrder> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/db/admin/p2p/orders/${encodeURIComponent(orderId)}/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision, note }),
  });
  const data = await parseJson<{ order: P2POrder }>(res);
  return data.order;
}

export function compressPaymentProofImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a PNG, JPG, or WEBP screenshot.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read receipt image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid receipt image format.'));
      img.onload = () => {
        const maxSide = 960;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas compression unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.78;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 280_000 && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > 315_000) {
          reject(new Error('Receipt image is still too large after compression. Try cropping first.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
