# SouthStack - Startup & Testing Guide

## 🚀 কুইক স্টার্ট (Quick Start)

### আপনার ব্রাউজারে SouthStack চালু করার 3টি ধাপ:

#### ধাপ 1: WebGPU চালু করুন (Enable WebGPU)
1. Chrome খুলুন
2. এই লিঙ্কে যান: `chrome://flags/#enable-unsafe-webgpu`
3. "Unsafe WebGPU" সেট করুন: **Enabled**
4. ক্লিক করুন: **Relaunch** (Chrome পুনরায় চালু হবে)

#### ধাপ 2: HTTP সার্ভার চালু করুন (Start Server)
```bash
cd /Users/eloneflax/cse327/southstack
python3 -m http.server 8000
```
আপনি দেখবেন: `Serving HTTP on 0.0.0.0 port 8000`

#### ধাপ 3: ব্রাউজারে খুলুন (Open in Browser)
- Chrome এ যান: `http://localhost:8000/`
- আপনি SouthStack ড্যাশবোর্ড দেখবেন

---

## 📊 Status ড্যাশবোর্ড (Live Display)

আপনি দেখবেন:

```
⚡ SouthStack
Offline-First Coding LLM Runtime

🔧 System Status          🤖 Model Status
├─ WebGPU Support        ├─ Current Model: [Loading...]
├─ Browser: Chrome ✅    ├─ Load Progress: [████░░░░░░] 40%
├─ Memory: 8GB ✅        └─ Primary: Qwen2.5-Coder-1.5B
├─ Storage: 50GB avail   └─ Fallback: Qwen2.5-Coder-0.5B
├─ Offline Cache: Ready
└─ Connection: Online
```

---

## 💻 JavaScript দিয়ে Prompt পাঠান

### ব্রাউজার Console এ এটি করুন (F12 চাপুন):

#### সবচেয়ে সহজ উদাহরণ:
```javascript
// Console এ লিখুন:
ask("Write a hello world in Python")
```

কয়েক সেকেন্ড অপেক্ষা করলে আপনি Console এ উত্তর দেখবেন!

#### আরও উদাহরণ:
```javascript
// সাধারণ প্রোগ্রাম
ask("Write a function to check if number is prime")

// ওয়েব ডেভেলপমেন্ট
ask("Create a React button component")

// ব্যাখ্যা চাওয়া
ask("Explain how closure works in JavaScript")

// SQL প্রশ্ন
ask("Write SQL to find duplicate records")
```

---

## 📱 ফ্রন্টএন্ড - কীভাবে কাজ করে?

### Dashboard Components:

#### 1. **সিস্টেম স্ট্যাটাস কার্ড**
- WebGPU উপলব্ধ কিনা দেখায়
- RAM, Storage, Internet সংযোগ দেখায়
- Offline Cache স্ট্যাটাস দেখায়
- Real-time আপডেট হয়

#### 2. **মডেল স্ট্যাটাস কার্ড**
- কোন মডেল লোড হয়েছে দেখায়
- লোডিং প্রগ্রেস বার (0% থেকে 100%)
- Primary & Fallback মডেল তথ্য
- সাইজ ও প্যারামিটার দেখায়

#### 3. **অ্যাকশন বাটন**
```
[Test Model] - মডেল টেস্ট করুন
[Clear Cache] - ক্যাশ মুছে ফেলুন  
[Open Console] - Console খুলুন
[System Info] - সিস্টেম তথ্য দেখুন
```

#### 4. **Console Output প্যানেল**
- Browser console এর সব output দেখায়
- Prompts এবং responses দেখায়
- Status messages এবং errors দেখায়
- Live scrolling সহ

---

## 🎯 ফার্স্ট ব্যবহার করুন:

### Model ডাউনলোড করুন (First Time):
1. Dashboard খুলুন
2. Console দেখুন (F12)
3. আপনি দেখবেন: `📥 Downloading model weights (first time only, ~500MB-1GB)...`
4. অপেক্ষা করুন... 10-30 মিনিট (Speedের উপর নির্ভর করে)
5. দেখবেন: `✅ Model loaded successfully`

### প্রথম Prompt পাঠান:
```javascript
ask("Write hello world in Python")

// Console এ দেখবেন:
// 📝 Prompt: Write hello world in Python
// 🤖 Generating response...
// ────────────────────────────────────────────────────────
// Response:
// [Model এর উত্তর স্ট্রিম হবে]
// ────────────────────────────────────────────────────────
// ✅ Response complete
```

---

## 🔌 অফলাইন মোড টেস্ট করুন

### Offline তে কাজ করে কিনা পরীক্ষা করুন:

1. **Model সম্পূর্ণ ডাউনলোড হওয়ার অপেক্ষা করুন**
   - Console এ দেখুন: `✅ Model loaded successfully`

2. **Offline মোড চালু করুন**
   - DevTools খুলুন: **F12**
   - **Network** ট্যাবে যান
   - **Offline** চেকবক্স চেক করুন

3. **পেজ রিফ্রেশ করুন** (F5)
   - আপনি দেখবেন: সব কিছু ক্যাশ থেকে লোড হচ্ছে
   - Service Worker সব কিছু Cache থেকে সরবরাহ করছে

4. **অফলাইনে Prompt পাঠান**
   ```javascript
   ask("Write a factorial function")
   
   // Internet ছাড়াই কাজ করবে!
   ```

---

## ⚡ সবচেয়ে গুরুত্বপূর্ণ Commands:

```javascript
// ✅ ডাউনলোড করার আগে Model লোড করুন
await SouthStack.ensureInitialized()

// ✅ System Status দেখুন
SouthStack.checkWebGPUSupport()
SouthStack.checkRAM()
await SouthStack.checkStorageQuota()

// ✅ Model পরিবর্তন করুন (যদি Memory সমস্যা হয়)
await SouthStack.initializeEngine('Qwen2.5-Coder-0.5B-Instruct-q4f32_1')

// ✅ Configuration দেখুন
SouthStack.CONFIG
```

---

## 📊 কী কী দেখবেন? (Expected Output)

### প্রথম Load এ:
```
✅ Service Worker registered
WebGPU: ✅ WebGPU is available
Browser: Chrome ✅
Memory: 8GB ✅
Storage: 50GB available
Offline Mode: ❌ Online
📥 Downloading model weights (first time only, ~500MB-1GB)...
📊 Loading progress: 25%
📊 Loading progress: 50%
📊 Loading progress: 75%
📊 Loading progress: 100%
✅ Model loaded successfully
```

### Prompt পাঠানোর সময়:
```
📝 Prompt: Write a function to add two numbers
🤖 Generating response...
────────────────────────────────────────────────────────
Response:
def add(a, b):
    return a + b

result = add(5, 3)
print(result)  # Output: 8
────────────────────────────────────────────────────────
✅ Response complete (450 characters, ~85 tokens)
```

---

## 🛠️ সমস্যা সমাধান:

### সমস্যা: "WebGPU is not available"
**সমাধান**:
1. Chrome > `chrome://flags/#enable-unsafe-webgpu`
2. Set to **Enabled**
3. Click **Relaunch**
4. Restart Chrome completely

### সমস্যা: Model ডাউনলোড হচ্ছে না
**সমাধান**:
1. Internet সংযোগ চেক করুন
2. Storage 1GB+ খালি আছে কিনা চেক করুন
3. সার্ভার চলছে কিনা চেক করুন: `http://localhost:8000/`

### সমস্যা: Offline কাজ করছে না
**সমাধান**:
1. Model সম্পূর্ণ ডাউনলোড হয়েছে কিনা চেক করুন
2. Service Worker activate আছে কিনা দেখুন: DevTools > Application > Service Workers
3. Cache Storage আছে কিনা দেখুন: DevTools > Application > Cache Storage

### সমস্যা: Console এ output দেখা যাচ্ছে না
**সমাধান**:
1. Console Output প্যানেল স্ক্রল করুন (নিচে দেখুন)
2. Browser Console খুলুন (F12) এবং চেক করুন
3. Console এ copy করুন এবং দেখুন

---

## 📌 ফ্রন্টএন্ড Features:

### ✅ Dashboard এ দেখা যায়:
- **Real-time Status Updates** - সব কিছু লাইভ আপডেট হয়
- **Progress Bar** - মডেল লোডিং প্রগ্রেস দেখায়
- **Warning Banners** - কম RAM সতর্কতা দেখায়
- **Error Messages** - সমস্যা পরিষ্কারভাবে দেখায়
- **Live Console Viewer** - সব output এক জায়গায় দেখায়
- **System Information Cards** - WebGPU, RAM, Storage, Connection সব দেখায়
- **Action Buttons** - Test, Clear Cache, Help বাটন

### ✅ সুন্দর Design:
- Dark theme with blue gradient
- Glassmorphism style
- Responsive (মোবাইলেও কাজ করে)
- Smooth animations
- Professional look

---

## 🎓 শেখার মাধ্যমে ব্যবহার করুন:

### Step 1: Setup
```bash
cd /Users/eloneflax/cse327/southstack
python3 -m http.server 8000
# Open: http://localhost:8000/
```

### Step 2: Enable WebGPU
- Go to `chrome://flags/#enable-unsafe-webgpu`
- Set: **Enabled**
- Click: **Relaunch**

### Step 3: Download Model
- Wait for `✅ Model loaded successfully` in console
- Time: 10-30 minutes (first time only)

### Step 4: Test It Works
```javascript
ask("Write a simple function in Python")
// See response in console!
```

### Step 5: Test Offline
- DevTools > Network > Check "Offline"
- Refresh page
- `ask("This works offline!")` - কাজ করবে!

---

## 🎯 সাফল্য হওয়ার চিহ্ন:

✅ আপনি যখন সফল হবেন:
- SouthStack Dashboard দেখা যায়
- WebGPU Status "Available" দেখায়
- Model "loaded" অবস্থায় দেখায়
- `ask()` function কাজ করে
- Console এ response দেখা যায়
- Offline mode এ কাজ করে

---

## 📚 আরও তথ্যের জন্য:

- **সম্পূর্ণ গাইড**: `DEPLOYMENT_GUIDE.md`
- **কোড বিস্তারিত**: `IMPLEMENTATION_SUMMARY.md`
- **রেফারেন্স**: `README.md`
- **সব ফাইলের তালিকা**: `INDEX.md`

---

## ✨ এখনই চালু করুন!

```bash
# Terminal এ:
cd /Users/eloneflax/cse327/southstack
python3 -m http.server 8000

# Then in Chrome:
# 1. Go to: http://localhost:8000/
# 2. Open Console: F12
# 3. Type: ask("Hello World")
# 4. See response!
```

**আপনার অফলাইন Coding LLM এখন প্রস্তুত!** ⚡🚀
