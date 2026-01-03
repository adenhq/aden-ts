/**
 * Run All Examples
 *
 * This script provides a menu to run individual examples or lists them.
 * Run: npx tsx examples/run-all.ts [example-name]
 *
 * Examples:
 *   npx tsx examples/run-all.ts           # Show available examples
 *   npx tsx examples/run-all.ts openai    # Run openai-basic.ts
 *   npx tsx examples/run-all.ts cost      # Run cost-control-local.ts
 */

import { spawn } from "child_process";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const examples = readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts") && f !== "run-all.ts")
  .map((f) => f.replace(".ts", ""));

function runExample(name: string): Promise<number> {
  return new Promise((resolve) => {
    const file = join(__dirname, `${name}.ts`);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${name}`);
    console.log("=".repeat(60));

    const child = spawn("npx", ["tsx", file], {
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Available examples:");
    console.log("");
    for (const example of examples) {
      console.log(`  - ${example}`);
    }
    console.log("");
    console.log("Usage: npx tsx examples/run-all.ts <example-name>");
    console.log("       npx tsx examples/<example-name>.ts");
    return;
  }

  const query = args[0].toLowerCase();
  const match = examples.find((e) => e.toLowerCase().includes(query));

  if (!match) {
    console.error(`No example matching "${query}" found.`);
    console.error("Available:", examples.join(", "));
    process.exit(1);
  }

  const code = await runExample(match);
  process.exit(code);
}

main().catch(console.error);
