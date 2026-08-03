import { z } from "zod";

export const LEEMO_VISUALIZATION_SERVER = "leemo-visualization";
export const LEEMO_VISUALIZATION_TOOL = "create_visualization";
export const LEEMO_VISUALIZATION_TOOL_NAME =
  `mcp__${LEEMO_VISUALIZATION_SERVER}__${LEEMO_VISUALIZATION_TOOL}` as const;

const label = z.string().min(1).max(160);
const detail = z.string().min(1).max(500);
const cell = z.union([z.string().max(500), z.number().finite()]);

const matrix = {
  columns: z.array(label).min(2).max(8),
  rows: z.array(z.object({
    cells: z.array(cell).min(1).max(8),
  }).strict()).min(1).max(100),
};

const tableSchema = z.object({
  kind: z.literal("table"),
  ...matrix,
}).strict();

const comparisonSchema = z.object({
  kind: z.literal("comparison"),
  ...matrix,
}).strict();

const timelineSchema = z.object({
  kind: z.literal("timeline"),
  events: z.array(z.object({
    label,
    date: label.optional(),
    detail: detail.optional(),
  }).strict()).min(2).max(30),
}).strict();

const flowSchema = z.object({
  kind: z.literal("flow"),
  steps: z.array(z.object({
    label,
    detail: detail.optional(),
  }).strict()).min(2).max(20),
}).strict();

const barSchema = z.object({
  kind: z.literal("bar"),
  values: z.array(z.object({
    label,
    value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  }).strict()).min(1).max(20),
  unit: z.string().max(40).optional(),
}).strict();

export const visualizationDataSchema = z.discriminatedUnion("kind", [
  tableSchema,
  comparisonSchema,
  timelineSchema,
  flowSchema,
  barSchema,
]).superRefine((value, ctx) => {
  if (value.kind !== "table" && value.kind !== "comparison") return;
  value.rows.forEach((row, index) => {
    if (row.cells.length === value.columns.length) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rows", index, "cells"],
      message: "每一行的单元格数量必须与列数一致。",
    });
  });
});

export const visualizationInputSchema = z.object({
  file_path: z.string().min(1).max(1_000),
  title: z.string().min(1).max(160),
  subtitle: z.string().min(1).max(500).optional(),
  visualization: visualizationDataSchema,
  overwrite: z.boolean().optional(),
}).strict();

export type VisualizationData = z.infer<typeof visualizationDataSchema>;
export type VisualizationInput = z.infer<typeof visualizationInputSchema>;

export function ensureVisualizationHtmlExtension(filePath: string): string {
  const trimmed = filePath.trim();
  return trimmed.toLocaleLowerCase().endsWith(".html") ? trimmed : `${trimmed}.html`;
}

export function parseVisualizationInput(input: unknown): VisualizationInput | null {
  const parsed = visualizationInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
