/**
 * Run All Examples and Generate Report
 *
 * Usage: npx tsx examples/run-all.ts
 *
 * This script runs all examples sequentially and generates a summary report.
 */

import "dotenv/config";
import { spawn } from "child_process";
import { readdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExampleResult {
  name: string;
  success: boolean;
  duration: number;
  output: string;
  error?: string;
}

const results: ExampleResult[] = [];
const startTime = Date.now();

/**
 * Run a single example file
 */
async function runExample(filename: string): Promise<ExampleResult> {
  const name = filename.replace(".ts", "");
  const filepath = join(__dirname, filename);
  const start = Date.now();

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const errorChunks: string[] = [];

    const proc = spawn("npx", ["tsx", filepath], {
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    proc.stdout?.on("data", (data) => {
      chunks.push(data.toString());
    });

    proc.stderr?.on("data", (data) => {
      errorChunks.push(data.toString());
    });

    // Timeout after 60 seconds
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        name,
        success: false,
        duration: Date.now() - start,
        output: chunks.join(""),
        error: "Timeout after 60 seconds",
      });
    }, 60000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        name,
        success: code === 0,
        duration: Date.now() - start,
        output: chunks.join(""),
        error: code !== 0 ? errorChunks.join("") : undefined,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        name,
        success: false,
        duration: Date.now() - start,
        output: chunks.join(""),
        error: err.message,
      });
    });
  });
}

/**
 * Extract key metrics from example output
 */
function extractMetrics(output: string): Record<string, string> {
  const metrics: Record<string, string> = {};

  // Token patterns
  const tokenMatch = output.match(/(\d+)\s*(?:in|input).*?(\d+)\s*(?:out|output)/i);
  if (tokenMatch) {
    metrics["Tokens"] = `${tokenMatch[1]} in / ${tokenMatch[2]} out`;
  }

  // Cost patterns
  const costMatch = output.match(/\$[\d.]+/g);
  if (costMatch) {
    metrics["Cost"] = costMatch[costMatch.length - 1];
  }

  // Latency patterns
  const latencyMatch = output.match(/(\d+)ms/);
  if (latencyMatch) {
    metrics["Latency"] = `${latencyMatch[1]}ms`;
  }

  return metrics;
}

/**
 * Generate markdown report
 */
function generateReport(): string {
  const totalDuration = Date.now() - startTime;
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  let report = `# OpenAI-Meter Examples Report

Generated: ${new Date().toISOString()}

## Summary

| Metric | Value |
|--------|-------|
| Total Examples | ${results.length} |
| Successful | ${successful} |
| Failed | ${failed} |
| Total Duration | ${(totalDuration / 1000).toFixed(1)}s |

## Results

`;

  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    const metrics = extractMetrics(result.output);

    report += `### ${status} ${result.name}

- **Duration**: ${(result.duration / 1000).toFixed(1)}s
- **Status**: ${result.success ? "Success" : "Failed"}
`;

    if (Object.keys(metrics).length > 0) {
      report += "- **Metrics**:\n";
      for (const [key, value] of Object.entries(metrics)) {
        report += `  - ${key}: ${value}\n`;
      }
    }

    if (result.error) {
      report += `- **Error**: \`${result.error.slice(0, 200)}\`\n`;
    }

    report += "\n";
  }

  // Add detailed output section
  report += `## Detailed Output

<details>
<summary>Click to expand full output</summary>

`;

  for (const result of results) {
    report += `### ${result.name}

\`\`\`
${result.output.slice(0, 2000)}${result.output.length > 2000 ? "\n... (truncated)" : ""}
\`\`\`

`;
  }

  report += "</details>\n";

  return report;
}

/**
 * Main execution
 */
async function main() {
  console.log("🚀 Running all openai-meter examples...\n");

  // Get all example files except this one
  const files = await readdir(__dirname);
  const examples = files
    .filter((f) => f.endsWith(".ts") && f !== "run-all.ts")
    .sort();

  console.log(`Found ${examples.length} examples to run:\n`);
  examples.forEach((e) => console.log(`  - ${e}`));
  console.log("");

  // Run each example
  for (const example of examples) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${example}`);
    console.log("=".repeat(60));

    const result = await runExample(example);
    results.push(result);

    if (result.success) {
      console.log(`✅ ${example} completed in ${(result.duration / 1000).toFixed(1)}s`);
    } else {
      console.log(`❌ ${example} failed: ${result.error?.slice(0, 100)}`);
    }
  }

  // Generate report
  const report = generateReport();

  // Write report to file
  const reportPath = join(__dirname, "..", "EXAMPLES_REPORT.md");
  await writeFile(reportPath, report, "utf-8");
  console.log(`\n📄 Report written to: EXAMPLES_REPORT.md`);

  // Also print to console
  console.log(`\n${"=".repeat(60)}`);
  console.log("REPORT");
  console.log("=".repeat(60));
  console.log(report);

  // Summary
  const successful = results.filter((r) => r.success).length;
  console.log(`\n✨ Done! ${successful}/${results.length} examples passed.`);

  // Exit with error if any failed
  if (successful < results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
