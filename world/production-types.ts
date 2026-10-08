import type { Bounds, Region, SourceRecord } from './types.ts';
import type { WorldPlan } from './pipeline.ts';

export interface InventoryNode {
  id: string; parentId: string | null; name: string;
  kind: 'world' | 'continent' | 'country'; countryCode: string | null;
  bounds: Bounds | null; sourceFeatureIds: string[];
  provider: 'world' | 'legacy-ng';
  outline: 'available' | 'missing'; exceptions: string[];
}
export interface WorldInventory {
  schemaVersion: 1; sources: SourceRecord[]; nodes: InventoryNode[];
  outlines: Array<{nodeId:string; geometry: {type:'Polygon'|'MultiPolygon';coordinates:unknown}}>; 
  sourceUnitCount: number; exceptions: string[];
}
export interface AcquisitionRequest {
  schemaVersion: 1; id: string; inventoryUnitId: string; region: Region;
  provider: 'overture'; release: string; layers: Array<'buildings'|'roads'>;
  limits: {networkBytes:number;outputBytes:number;features:number;durationMs:number;memoryMb:number;diskBytes:number};
}
export interface AcquisitionOptions { pythonExecutable: string; allowedRoot: string; signal?: AbortSignal }
export interface AcquisitionResult {
  plan: WorldPlan; requestHash: string; receiptPath: string;
  metrics: {networkBytes:number;outputBytes:number;features:number;elapsedMs:number};
  upstream: Array<{url:string;etag:string|null;bytes:number}>;
  exceptions: string[];
}
export type CampaignUnit = {
  id:string; inventoryUnitId:string; priority:number;
} & ({kind:'local';plan:WorldPlan}|{kind:'acquire';request:AcquisitionRequest}|{kind:'protected';reason:string});
export interface WorldCampaign {
  schemaVersion:1; id:string; inventoryHash:string; units:CampaignUnit[];
  limits: {durationMs:number;jobDurationMs:number;networkBytes:number;outputBytes:number;diskBytes:number;memoryMb:number;maxAttempts:number};
}
