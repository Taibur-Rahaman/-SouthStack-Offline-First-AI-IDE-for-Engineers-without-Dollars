# SouthStack – Windows & Mac

Same demo on both: **Windows** and **Mac**.

---

## 1. Start the server

### Windows (Command Prompt or PowerShell)

```cmd
cd southstack-demo
python -m http.server 8000
```

- যদি `python` না চলে: `py -m http.server 8000` চেষ্টা করো।
- Python না থাকলে: [python.org](https://www.python.org/downloads/) থেকে install করো।

### Mac (Terminal)

```bash
cd southstack-demo
python3 -m http.server 8000
```

---

## 2. Open in Chrome

**Windows & Mac:** Chrome খুলে যাও:

- `http://localhost:8000/`
- অথবা শুধু console: `http://localhost:8000/console-only.html`

---

## 3. Open DevTools Console

| কী করবে      | Windows / Linux   | Mac                |
|--------------|-------------------|--------------------|
| Console খোলো | **F12** বা **Ctrl+Shift+J** | **F12** বা **Cmd+Option+J** |
| Page reload  | **F5** বা **Ctrl+R**       | **F5** বা **Cmd+R**         |

---

## 4. Use the demo

1. Console এ **"Model ready."** আসা পর্যন্ত অপেক্ষা করো (প্রথম বার model download হবে)।
2. লিখো: `ask("Write a simple Express server")`
3. উত্তর console এ দেখাবে।

---

## 5. Offline test (Windows & Mac)

1. প্রথম বার Internet **on** রেখে model load হতে দাও।
2. Internet বন্ধ করো (WiFi off অথবা DevTools → Network → Offline)।
3. Page **reload** করো (F5 / Cmd+R / Ctrl+R)।
4. Console এ আবার `ask("Write bubble sort in JS")` চালাও।
5. উত্তর এলে = **browser এ, Internet ছাড়া কাজ করছে**।

---

## WebGPU (Windows & Mac)

- **Chrome 113+** দরকার।
- Enable: `chrome://flags/#enable-unsafe-webgpu` → **Enabled** → **Restart Chrome**।
- Windows ও Mac দুটোতেই একই।

---

## সংক্ষেপ

| ধাপ        | Windows                    | Mac                         |
|------------|----------------------------|-----------------------------|
| Server     | `python -m http.server 8000` বা `py -m ...` | `python3 -m http.server 8000` |
| Console    | F12 বা Ctrl+Shift+J        | F12 বা Cmd+Option+J         |
| Reload     | F5 বা Ctrl+R               | F5 বা Cmd+R                 |
| Prompt     | `ask("your prompt")`       | একই                         |
