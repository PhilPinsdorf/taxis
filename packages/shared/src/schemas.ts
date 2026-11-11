import { z } from 'zod';

export const CATEGORIES = [
  'Zelt',
  'Mobiliar',
  'Licht',
  'Ton',
  'Strom',
  'Stagebox/Snake',
  'Kabel',
  'Kabelschutz',
  'Generisch',
] as const;

export const MaterialKindSchema = z.enum(['item', 'cable', 'linear']);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

export const PortSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  connector: z.string().min(1),
  direction: z.enum(['in', 'out', 'io']),
  count: z.number().int().min(1),
  required: z.boolean(),
});
export type Port = z.infer<typeof PortSchema>;

export const StockLengthSchema = z.object({
  length: z.number().positive(),
  qty: z.number().int().min(0),
});
export type StockLength = z.infer<typeof StockLengthSchema>;

export const MaterialInputSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  kind: MaterialKindSchema,
  color: z.string().default('#64748b'),
  /** Breite in m (item) bzw. Bandbreite (linear/cable-Darstellung) */
  width: z.number().positive().default(1),
  /** Tiefe in m (item) */
  depth: z.number().positive().default(1),
  shape: z.enum(['rect', 'circle']).default('rect'),
  resizable: z.boolean().default(false),
  stockMode: z.enum(['limited', 'unlimited']).default('unlimited'),
  /** Eigenbestand: Stück (item) bzw. Segmente (linear). Bei Kabeln über stockLengths. */
  stockQty: z.number().int().min(0).default(0),
  /** linear: Länge eines Segments in m (z.B. Defender 1 m) */
  segmentLength: z.number().positive().nullable().default(null),
  /** cable: Steckertyp */
  connector: z.string().nullable().default(null),
  /** cable: Kanalzahl bei Multicore/Snake */
  channels: z.number().int().positive().nullable().default(null),
  /** cable: vorhandene Stücklängen */
  stockLengths: z.array(StockLengthSchema).default([]),
  ports: z.array(PortSchema).default([]),
  notes: z.string().default(''),
  archived: z.boolean().default(false),
});
export type MaterialInput = z.infer<typeof MaterialInputSchema>;

export const MaterialSchema = MaterialInputSchema.extend({ id: z.string() });
export type Material = z.infer<typeof MaterialSchema>;

// ---------------------------------------------------------------------------
// Plan-Dokument
// ---------------------------------------------------------------------------

export const PointSchema = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof PointSchema>;

export const EndpointSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('port'),
    itemId: z.string(),
    portId: z.string(),
    channel: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('cable'),
    cableId: z.string(),
    end: z.enum(['start', 'end']),
  }),
]);
export type Endpoint = z.infer<typeof EndpointSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  /** Position in Bild-Pixeln (Mittelpunkt) */
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  /** Maß-Override in m (nur bei resizable) */
  w: z.number().positive().nullable().default(null),
  d: z.number().positive().nullable().default(null),
  label: z.string().default(''),
  /** Override der Port-Anzahl je Port-ID (z.B. Stagebox 32 statt 16 Kanäle) */
  portCounts: z.record(z.string(), z.number().int().min(1)).default({}),
});
export type Item = z.infer<typeof ItemSchema>;

export const CableRunSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  points: z.array(PointSchema),
  mode: z.enum(['free', 'fixed']).default('free'),
  /** Feste Kabellänge in m (mode = fixed) */
  fixedLength: z.number().positive().nullable().default(null),
  /** Höhenzuschlag in m an Start/Ende (z.B. Traverse hoch) */
  heightStart: z.number().min(0).default(0),
  heightEnd: z.number().min(0).default(0),
  /** Reserve in % – null = Projekt-Default */
  reservePct: z.number().min(0).max(90).nullable().default(null),
  from: EndpointSchema.nullable().default(null),
  to: EndpointSchema.nullable().default(null),
  label: z.string().default(''),
});
export type CableRun = z.infer<typeof CableRunSchema>;

export const LinearRunSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  points: z.array(PointSchema),
  label: z.string().default(''),
});
export type LinearRun = z.infer<typeof LinearRunSchema>;

export const ShapeSchema = z.object({
  id: z.string(),
  kind: z.enum(['rect', 'ellipse', 'text']),
  x: z.number(),
  y: z.number(),
  /** Maße in m */
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().default(0),
  color: z.string().default('#64748b'),
  label: z.string().default(''),
});
export type Shape = z.infer<typeof ShapeSchema>;

export const ScaleSchema = z.object({
  pxPerMeter: z.number().positive(),
  a: PointSchema,
  b: PointSchema,
  meters: z.number().positive(),
});
export type Scale = z.infer<typeof ScaleSchema>;

export const SheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageId: z.string().nullable().default(null),
  imageW: z.number().positive().default(3000),
  imageH: z.number().positive().default(2000),
  scale: ScaleSchema.nullable().default(null),
  items: z.array(ItemSchema).default([]),
  cables: z.array(CableRunSchema).default([]),
  linears: z.array(LinearRunSchema).default([]),
  shapes: z.array(ShapeSchema).default([]),
});
export type Sheet = z.infer<typeof SheetSchema>;

export const ExtraSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  qty: z.number().int().min(1),
  /** Bei Kabeln: Länge je Stück in m */
  lengthM: z.number().positive().nullable().default(null),
  note: z.string().default(''),
});
export type Extra = z.infer<typeof ExtraSchema>;

export const PlanSettingsSchema = z.object({
  defaultReservePct: z.number().min(0).max(90).default(10),
});

export const PlanDocSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sheets: z.array(SheetSchema).default([]),
  extras: z.array(ExtraSchema).default([]),
  settings: PlanSettingsSchema.default({ defaultReservePct: 10 }),
});
export type PlanDoc = z.infer<typeof PlanDocSchema>;

// ---------------------------------------------------------------------------
// Projekte, Snapshots, Anfragen
// ---------------------------------------------------------------------------

export const ProjectInputSchema = z.object({
  name: z.string().min(1),
  date: z.string().default(''),
  location: z.string().default(''),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export interface ProjectSummary extends ProjectInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanState {
  doc: PlanDoc;
  revision: number;
}

export interface SnapshotSummary {
  id: string;
  projectId: string;
  name: string;
  note: string;
  createdAt: string;
}

export const RequestStatusSchema = z.enum(['angefragt', 'bestätigt', 'abgelehnt']);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const RequestInputSchema = z.object({
  materialId: z.string().min(1),
  qty: z.number().int().min(1),
  /** Bei Kabeln: Länge je Stück */
  lengthM: z.number().positive().nullable().default(null),
  supplier: z.string().default(''),
  status: RequestStatusSchema.default('angefragt'),
  note: z.string().default(''),
});
export type RequestInput = z.infer<typeof RequestInputSchema>;
export type MaterialRequest = RequestInput & { id: string; projectId: string; createdAt: string };

export const DEFAULT_CONNECTORS = [
  'XLR',
  'DMX 3-pol',
  'DMX 5-pol',
  'Schuko',
  'CEE16',
  'CEE32',
  'CEE63',
  'powerCON',
  'Speakon',
  'Cat',
  'Multicore',
];

export function emptyPlan(): PlanDoc {
  return PlanDocSchema.parse({});
}
