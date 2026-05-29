import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUsageReport } from "../lib/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const days = Number(process.argv[2] || process.env.USAGE_MONITOR_DAYS || 30);
const report = await buildUsageReport({
  days,
  pricingPath: path.join(root, "data", "pricing.json")
});

console.log(JSON.stringify(report, null, 2));
