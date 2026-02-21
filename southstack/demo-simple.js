// Simple demo version - uses esm.run CDN
import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine;

async function init() {
  console.log("Checking WebGPU...");

  if (!navigator.gpu) {
    console.error("WebGPU not supported. Enable in chrome://flags/#enable-unsafe-webgpu");
    return;
  }

  // Use a WebLLM prebuilt model ID (Qwen2.5-Coder is not in prebuiltAppConfig.model_list)
  console.log("Loading model...");

  engine = await webllm.CreateMLCEngine(
    "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    {
      initProgressCallback: (progress) => {
        console.log(progress);
      }
    }
  );

  console.log("Model ready.");
  window.ask = ask;
}

async function ask(prompt) {
  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 512
  });

  console.log("Model Output:");
  console.log(reply.choices[0].message.content);
}

init();
