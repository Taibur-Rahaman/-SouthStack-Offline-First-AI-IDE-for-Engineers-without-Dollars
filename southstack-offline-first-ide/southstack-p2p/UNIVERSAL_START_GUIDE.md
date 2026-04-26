# 🌐 SouthStack Universal - Works on ANY Router!

## ✅ What's New

I've created a **universal system** that automatically works across all devices (phones, tablets, laptops) on any network/router:

### Features Added:
1. **🔍 Auto Network Discovery** - Click one button to find all URLs
2. **📱 QR Code Generation** - Automatic QR codes for phone scanning  
3. **🔖 mDNS/Bonjour Support** - Easy names like `southstack-8000.local`
4. **🎯 Auto-fill LAN URLs** - Automatically fills phone-friendly URLs
5. **📋 Copy All URLs** - One-click copy for sharing
6. **🖥️ Cross-platform** - Windows, macOS, Linux, Android, iOS

---

## 🚀 Quick Start (3 Steps)

### Step 1: Start the Server

**Mac/Linux:**
```bash
cd southstack-p2p
./start-universal.sh
```

**Or directly:**
```bash
cd southstack-p2p
python3 serve_universal.py
```

**Windows:**
```cmd
cd southstack-p2p
py -3 serve_universal.py
```

### Step 2: Open on Your Computer
Browser will show:
```
💻 LOCAL ACCESS:
   http://127.0.0.1:8000
   http://localhost:8000
```

### Step 3: Connect Phones & Tablets

**Option A: Auto-Discover (Recommended)**
1. Click **"🔍 Discover Network URLs"** button on the page
2. Find URL starting with `192.168.x.x` or `10.x.x.x`
3. Type that URL on your phone (same Wi-Fi required!)
4. Or scan the QR code shown

**Option B: Manual**
1. Look at terminal output for "NETWORK ACCESS" section
2. Find the URL like `http://192.168.31.91:8000`
3. Type it on your phone browser

**Option C: Easy Name (macOS/iOS only)**
- Use: `http://southstack-8000.local:8000`
- Works like magic on Apple devices!

---

## 📱 Phone Connection Example

When server starts, you'll see:
```
🌐 NETWORK ACCESS:
   [1] http://192.168.31.91:8000
       ↑ Use this URL on phones/laptops

🔖 BONUS - Easy Memory Name:
   http://southstack-8000.local:8000
   (Works on macOS/iOS, some Android/Linux)
```

**On your phone:**
1. Make sure same Wi-Fi as computer
2. Open: `http://192.168.31.91:8000`
3. Or use easy name: `http://southstack-8000.local:8000`
4. Tap "Join room" and you're connected!

---

## 🎯 How It Works

### Old System (Problems):
- ❌ Had to manually find IP address
- ❌ Different commands for Windows/Mac/Linux
- ❌ Firewall configuration complex
- ❌ No automatic discovery

### New System (Solution):
- ✅ **One command** runs everywhere
- ✅ **Auto-detects** all network interfaces
- ✅ **Shows all URLs** clearly
- ✅ **QR codes** for instant phone access
- ✅ **mDNS support** for easy names
- ✅ **Auto-fills** LAN URLs in the UI

---

## 🔧 Troubleshooting

### Phone shows "Connection Refused":

**1. Check Same Wi-Fi**
- Phone must be on SAME Wi-Fi as computer
- NOT mobile data!

**2. Check URL**
- Must use computer's IP (e.g., `192.168.31.91`)
- NOT `127.0.0.1` or `localhost` (those mean the phone itself!)
- Include port: `:8000`

**3. Check Firewall**
- **macOS:** System Settings → Network → Firewall → Options → Allow Python
- **Windows:** Firewall → Allow an app → Python
- **Linux:** `sudo ufw allow 8000`

**4. Try These Fixes:**
```bash
# If port 8000 is busy, server auto-switches to 8001, 8002, etc.
# Check terminal for actual port:
SouthStack listening on 0.0.0.0:8001
# Use: http://YOUR_IP:8001
```

---

## 🎨 UI Features

### Network Discovery Panel (NEW!)
```
🌐 Network Discovery — Auto-detect server
[🔍 Discover Network URLs] [📋 Copy All URLs]

✅ Found 3 network URL(s)!
📱 http://192.168.31.91:8000
📱 http://10.0.0.5:8000
💻 http://127.0.0.1:8000
🔖 http://southstack-8000.local:8000

🎯 Auto-filled LAN URL for phones!
```

### Easy Connect Panel
- Shows QR code automatically
- Invite links work cross-device
- Room codes sync automatically

---

## 📊 Technical Details

### What `serve_universal.py` Does:

1. **Multi-IP Detection:**
   - Scans all network interfaces
   - Finds IPv4 on Wi-Fi, Ethernet, etc.
   - Cross-platform (no external dependencies)

2. **mDNS/Bonjour:**
   - Registers `southstack-PORT.local`
   - Works on macOS/iOS natively
   - Linux via avahi-daemon (optional)

3. **HTTP API Endpoints:**
   - `/api/southstack/discover` - Returns all URLs
   - `/api/southstack/offer` - WebRTC signaling
   - `/api/southstack/answer` - WebRTC signaling
   - `/api/southstack/candidate` - WebRTC ICE

4. **WebRTC Signaling:**
   - Automatic SDP exchange
   - No manual copy/paste needed
   - Works through local router

---

## 🎓 Perfect For:

- ✅ University projects (CSE327)
- ✅ Hackathons
- ✅ Study groups
- ✅ Pair programming
- ✅ Multi-device testing
- ✅ Offline coding sessions

---

## 💡 Pro Tips

1. **First Time Setup:**
   - Let model download completely (~500MB-1GB)
   - Then works offline forever

2. **Multiple Devices:**
   - Host creates room
   - Share QR/link
   - Everyone joins same room code

3. **Low-Spec Devices:**
   - Phones without WebGPU can still join as guests
   - Coordinator device runs the LLM
   - Guests can run subtasks if they have WebGPU

4. **Reconnection:**
   - If device disconnects, just rejoin with same room code
   - No data lost with 3+ devices

---

## 🆘 Need Help?

**Check these in order:**
1. ✅ Server running? (check terminal)
2. ✅ Same Wi-Fi? (not mobile data)
3. ✅ Correct IP? (192.168.x.x, not 127.0.0.1)
4. ✅ Correct port? (include :8000)
5. ✅ Firewall allows Python?
6. ✅ Try `?nosw=1` to bypass cache

**Debug Mode:**
```bash
# Run with verbose logging
python3 serve_universal.py
# Watch terminal for connection attempts
```

---

## 📝 Files Created

- `serve_universal.py` - Main universal server
- `start-universal.sh` - Easy startup script
- `index.html` - Updated with network discovery UI
- `UNIVERSAL_START_GUIDE.md` - This file

---

**🎉 That's it! Your SouthStack now works on ANY router with ANY device!**

Just run the server, click "Discover Network URLs", and share the link with phones/tablets/laptops!
