/** Quick connectivity check for the configured LLM provider. */
import { getProvider } from "./index.js";

const provider = getProvider();
console.log(`Provider: ${provider.name}`);

const res = await provider.generateJSON({
  stage: "ping",
  system: "You return JSON only.",
  prompt: 'Return this exact JSON object: {"ok": true, "hello": "world"}',
});

console.log("Latency:", res.latencyMs, "ms | Model:", res.model);
console.log("Usage:", res.usage);
console.log("Data:", JSON.stringify(res.data));
