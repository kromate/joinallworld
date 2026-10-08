import type { PlotAddress } from './life.ts';
import type { CityId } from './protocol.ts';

/** Payment proof in civic storage; the world registry remains the ownership authority. */
export interface LandPurchase {
  owner: string;
  id: string;
  fingerprint: string;
  token: string;
  city: CityId;
  anchor: PlotAddress;
  plot: number;
  price: number;
  at: number;
  phase: 'intent' | 'paid' | 'finalized' | 'cancelled';
}
export interface LandBuyRequest { cityId: CityId; clientId: string; anchor: PlotAddress; plot: number; price: number }
export interface LandView {
  city: CityId;
  anchor: PlotAddress | null;
  extras: number[];
  candidates: { plot: number; price: number }[];
  pending: { phase: LandPurchase['phase']; plot: number; price: number } | null;
  maxExtras: number;
  beta: true;
}

export interface LandPayPayload { anchor: PlotAddress; plot: number; price: number }
