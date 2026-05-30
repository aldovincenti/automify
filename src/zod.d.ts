import type { JsonOutputOptions, OutputFormat } from "./index.js";
import type { ZodType } from "zod";

export interface ZodOutputOptions extends JsonOutputOptions {
  zodToJsonSchema?: Record<string, unknown>;
}

export function zodOutput<T>(
  name: string,
  schema: ZodType<T>,
  options?: ZodOutputOptions
): OutputFormat & { readonly __output?: T };
