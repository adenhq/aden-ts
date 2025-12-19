import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  // Mark LLM SDKs as external so we use the user's installed versions
  // This is critical for prototype patching to work correctly
  external: [
    "openai",
    "@google/generative-ai",
    "@anthropic-ai/sdk",
  ],
});
