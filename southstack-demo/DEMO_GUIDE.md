# SouthStack Demo Guide

## Requirements (যা দেখাতে হবে)

1. **Coding LLM browser এ run করবে** – তাঁর browser এ, Internet ছাড়া
2. **JS দিয়ে prompt পাঠালে উত্তর দেবে** – `ask("prompt")` use করবে
3. **Browser এর console এ দেখাতে হবে** – সব output console এ
4. **Frontend বানালে হবে না** – Console-only version আছে

---

## Console-Only Version (Frontend নেই)

**File:** `console-only.html`

- শুধু এক লাইন: "Open Console (F12) → ask("your prompt")"
- কোনো extra UI নেই
- সব কিছু console এ

**Chalan (Windows & Mac):**

**Windows (Command Prompt / PowerShell):**
```cmd
cd southstack-demo
python -m http.server 8000
```
*(না চললে `py -m http.server 8000` চেষ্টা করো)*

**Mac (Terminal):**
```bash
cd southstack-demo
python3 -m http.server 8000
```

Browser এ খোলো: **http://localhost:8000/console-only.html**

1. Console খোলো: **F12** (Windows/Mac) অথবা **Ctrl+Shift+J** (Windows) / **Cmd+Option+J** (Mac)
2. "Model ready." আসা পর্যন্ত অপেক্ষা করো (প্রথম বার model download হবে)
3. Console এ লিখো: `ask("Write a simple Express server")`
4. উত্তর console এ দেখাবে

---

## Internet ছাড়া দেখানো (Offline Proof)

1. **প্রথম বার:** Internet **on** রেখে page খোলো, model fully load হতে দাও ("Model ready." দেখাবে)
2. **Internet বন্ধ করো** (WiFi off অথবা DevTools → Network → Offline টিক দাও)
3. **Page reload করো** (F5)
4. Console এ আবার লিখো: `ask("Write bubble sort in JS")`
5. উত্তর এলে **proof:** Browser এ, Internet ছাড়া, JS prompt → console এ output ✅

---

## সংক্ষেপে

| যা চাই          | কোথায় / কী করবে |
|-----------------|-------------------|
| Browser এ run   | Chrome এ console-only.html খোলো |
| Internet ছাড়া  | প্রথম বার load, তারপর WiFi off করে reload |
| JS দিয়ে prompt | Console এ `ask("your prompt")` |
| Console এ দেখানো | সব output console এই আসবে |
| Frontend না থাকলেও হবে | `console-only.html` use করো |
