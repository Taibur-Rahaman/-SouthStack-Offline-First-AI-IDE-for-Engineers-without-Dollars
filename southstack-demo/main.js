// SouthStack Demo - Main Application Logic
// Uses WebLLM from MLC AI with Qwen2.5-Coder-1.5B model

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine;
let isInitialized = false;
let initializationPromise = null;

// Configuration
const CONFIG = {
    primaryModel: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1',
    fallbackModel: 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1',
    maxTokens: 512,
    temperature: 0.2
};

/**
 * Initialize WebLLM engine
 */
async function init() {
    if (isInitialized && engine) {
        return engine;
    }

    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async () => {
        console.log("========================================");
        console.log("SouthStack Demo - Initializing");
        console.log("========================================");
        console.log("Checking WebGPU...");

        if (!navigator.gpu) {
            console.error("❌ WebGPU not supported.");
            console.error("Please enable WebGPU in Chrome:");
            console.error("chrome://flags/#enable-unsafe-webgpu → Enabled → Restart");
            return null;
        }

        console.log("✅ WebGPU: Supported");
        console.log("Loading Qwen Coder model:", CONFIG.primaryModel);
        console.log("(First time: ~1GB download, then cached offline)");

        try {
            let lastProgress = 0;
            engine = await webllm.CreateMLCEngine(
                CONFIG.primaryModel,
                {
                    initProgressCallback: (progress) => {
                        if (progress && progress.progress !== undefined) {
                            const percent = Math.round(progress.progress * 100);
                            if (percent !== lastProgress && percent > 0) {
                                console.log(`📊 Loading progress: ${percent}%`);
                                lastProgress = percent;
                            }
                        } else if (progress && progress.text) {
                            console.log(`📊 ${progress.text}`);
                        }
                    }
                }
            );

            isInitialized = true;
            console.log("✅ Model ready.");
            console.log("========================================");
            console.log("Usage: ask('your prompt here')");
            console.log("Example: ask('Write a simple Express server')");
            console.log("========================================");
            
            // Expose ask function globally
            window.ask = ask;
            
            return engine;
        } catch (error) {
            console.error("❌ Failed to load primary model:", error.message);
            
            // Try fallback model
            if (CONFIG.primaryModel !== CONFIG.fallbackModel) {
                console.log("🔄 Attempting fallback model:", CONFIG.fallbackModel);
                try {
                    engine = await webllm.CreateMLCEngine(CONFIG.fallbackModel, {
                        initProgressCallback: (progress) => {
                            if (progress && progress.text) {
                                console.log(`📊 ${progress.text}`);
                            }
                        }
                    });
                    isInitialized = true;
                    console.log("✅ Fallback model ready.");
                    window.ask = ask;
                    return engine;
                } catch (fallbackError) {
                    console.error("❌ Fallback model also failed:", fallbackError.message);
                    return null;
                }
            }
            return null;
        }
    })();

    return initializationPromise;
}

/**
 * Ask function - sends prompt to model and prints response
 */
async function ask(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        console.error("❌ Invalid prompt. Usage: ask('your prompt here')");
        return;
    }

    // Ensure engine is initialized
    if (!isInitialized || !engine) {
        console.log("⏳ Initializing model...");
        await init();
        if (!engine) {
            console.error("❌ Model initialization failed. Cannot proceed.");
            return;
        }
    }

    try {
        console.log("\n📝 Prompt:", prompt);
        console.log("🤖 Generating response...\n");
        console.log("─".repeat(50));

        const reply = await engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: CONFIG.temperature,
            max_tokens: CONFIG.maxTokens
        });

        const response = reply.choices[0].message.content;
        
        console.log("Response:");
        console.log(response);
        console.log("\n" + "─".repeat(50));
        console.log("✅ Response complete\n");
        
        return response;
    } catch (error) {
        console.error("\n❌ Error generating response:", error.message);
        
        // If memory error, try fallback
        if (error.message.includes('memory') || error.message.includes('Memory') || 
            error.message.includes('OOM') || error.message.includes('out of memory')) {
            console.log("🔄 Memory issue detected. Attempting fallback model...");
            try {
                engine = null;
                isInitialized = false;
                initializationPromise = null;
                await init();
                return ask(prompt); // Retry
            } catch (fallbackError) {
                console.error("❌ Fallback also failed:", fallbackError.message);
            }
        }
        
        throw error;
    }
}

// Register service worker for offline caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('✅ Service Worker registered for offline caching');
            })
            .catch(error => {
                console.warn('⚠️ Service Worker registration failed:', error);
            });
    });
}

// Initialize on page load
init();
