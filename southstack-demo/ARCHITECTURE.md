# SouthStack Demo Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Tab                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │         HTML (index.html)                        │  │
│  │  - WebGPU status check                          │  │
│  │  - Instructions display                         │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐  │
│  │         JavaScript (main.js)                    │  │
│  │  - WebLLM import (esm.run CDN)                  │  │
│  │  - Model initialization                         │  │
│  │  - window.ask() function                        │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐  │
│  │         WebGPU API                              │  │
│  │  - Hardware acceleration                        │  │
│  │  - GPU compute shaders                          │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐  │
│  │         WebLLM Engine                           │  │
│  │  - Model loading                                │  │
│  │  - Inference                                    │  │
│  │  - Token generation                             │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐  │
│  │         Qwen2.5-Coder-1.5B                      │  │
│  │  - 4-bit quantized                              │  │
│  │  - Cached in IndexedDB                          │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                                │
│                        ▼                                │
│  ┌─────────────────────────────────────────────────┐  │
│  │         Console Output                          │  │
│  │  - ask("prompt") → response                    │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │         Service Worker                          │  │
│  │  - Cache static assets                          │  │
│  │  - Cache model shards                           │  │
│  │  - Offline support                              │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### First Load (Online Required)

```
User opens page
  → Service Worker registers
  → WebGPU check
  → WebLLM loads from CDN
  → Model downloads (~1GB)
  → Model cached in IndexedDB
  → Ready for use
```

### Subsequent Loads (Offline)

```
User opens page (offline)
  → Service Worker serves cached HTML/JS
  → WebLLM loads from cache
  → Model loads from IndexedDB
  → Ready for use (no internet needed)
```

### User Interaction

```
User types: ask("Write Express server")
  → Function sends prompt to engine
  → Engine generates tokens via WebGPU
  → Response streamed to console
  → User sees code output
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Browser (Chrome) | Execution environment |
| **Acceleration** | WebGPU | GPU compute for LLM |
| **LLM Framework** | WebLLM (MLC AI) | In-browser inference |
| **Model** | Qwen2.5-Coder-1.5B | Code generation |
| **Quantization** | 4-bit (q4f32_1) | Memory efficiency |
| **Storage** | IndexedDB | Model weight caching |
| **Offline** | Service Worker | Asset caching |
| **CDN** | esm.run | Module delivery |

## Memory Usage

| Component | Estimated RAM |
|-----------|---------------|
| Browser base | ~500MB |
| WebLLM runtime | ~200MB |
| Model (1.5B 4-bit) | ~1-2GB |
| **Total** | **~2-3GB** |

## Performance Expectations

| Hardware | Tokens/sec | Use Case |
|----------|------------|----------|
| Integrated GPU | 5-15 | Acceptable |
| Dedicated GPU | 15-35 | Excellent |
| CPU fallback | 2-5 | Slow but usable |

## Offline Capability

- ✅ **Static assets**: Cached by Service Worker
- ✅ **Model weights**: Cached in IndexedDB (WebLLM handles this)
- ✅ **JavaScript**: Served from cache when offline
- ✅ **No external calls**: After first load, zero network requests

## Error Handling

1. **WebGPU unavailable**: Clear error message with instructions
2. **Model load failure**: Automatic fallback to 0.5B model
3. **Memory error**: Retry with smaller model
4. **Network failure**: Use cached assets/model

## Security & Privacy

- ✅ All processing local (no data sent to servers)
- ✅ Model weights cached locally
- ✅ No API keys required
- ✅ No authentication needed
- ✅ Works completely offline
