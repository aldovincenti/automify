import * as z from "zod";

import { createZodOutput } from "./lib/zod-output.js";

export const zodOutput = createZodOutput(z);
