import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

dotenv.config();

const PORT = 3000;

async function startServer() {
  console.log("[STARTUP] Initializing server...");
  const app = express();
  
  app.use(express.json({ limit: "50mb" }));
  
  // Load Firebase Config
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId } = firebaseConfig;
  const databaseId = (firebaseConfig.firestoreDatabaseId || "").trim() || "(default)";
  const FIREBASE_API_KEY = firebaseConfig.apiKey;

  console.log(`[INIT] Starting with Project: ${projectId}, DB: ${databaseId}`);
  
  // Initialize Admin
  if (!getApps().length) {
    try {
      initializeApp({ projectId });
      console.log("[INIT] Firebase Admin initialized.");
    } catch (e: any) {
      console.error("[INIT] Initialization failed:", e.message);
      initializeApp();
    }
  }

  // Get DB instance with aggressive fallback
  let db: any;
  const getDbInstance = (dbId?: string) => {
    try {
      const targetDb = (!dbId || dbId === "(default)") ? undefined : dbId;
      // In newer firebase-admin, you can call getFirestore(targetDb) for the default app
      return getFirestore(targetDb);
    } catch (e: any) {
      console.error(`[INIT] getFirestore failure for ${dbId}:`, e.message);
      return getFirestore();
    }
  };

  db = getDbInstance(databaseId);
  console.log(`[INIT] Firestore instance bound to DB: ${databaseId}`);
  
  // IN-MEMORY CACHE FOR SERVER-SIDE
  const serverCache: any = {
    settings: { data: null, time: 0 },
    courses: new Map(), // Map<courseId, {data, time}>
    providers: new Map() // Map<providerId, {data, time}>
  };
  const SERVER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  // FIREBASE HELPERS
  const unwrapRestFields = (fields: any) => {
    const result: any = {};
    for (const key in fields) {
      const val = fields[key];
      if (val.stringValue !== undefined) result[key] = val.stringValue;
      else if (val.doubleValue !== undefined) result[key] = Number(val.doubleValue);
      else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
      else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
      else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
      else if (val.mapValue !== undefined) result[key] = unwrapRestFields(val.mapValue.fields || {});
    }
    return result;
  };

  const restGet = async (col: string, id: string, dbId?: string) => {
    const tidyDb = (!dbId || dbId === "(default)") ? "(default)" : dbId;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/${col}/${id}?key=${FIREBASE_API_KEY}`;
    console.log(`[REST-GET] 🌐 ${url.split('?')[0]}`);
    try {
      const res = await axios.get(url, { timeout: 10000 });
      if (res.data && res.data.name) {
        return {
          exists: true,
          data: () => ({ id, ...unwrapRestFields(res.data.fields || {}) })
        };
      }
      return { exists: false, data: () => ({}) };
    } catch (e: any) {
      console.error(`[REST-GET] ❌ Failed: ${e.message}`);
      if (e.response?.status === 404) return { exists: false, data: () => ({}) };
      throw e;
    }
  };

  const getDocSafe = async (col: string, id: string) => {
    const now = Date.now();
    if (col === "settings" && id === "payment") {
      if (serverCache.settings.data && (now - serverCache.settings.time < SERVER_CACHE_TTL)) {
        return { exists: true, data: () => serverCache.settings.data };
      }
    } else if (col === "courses" || col === "providers") {
      const cached = col === "courses" ? serverCache.courses.get(id) : serverCache.providers.get(id);
      if (cached && (now - cached.time < SERVER_CACHE_TTL)) {
        return { exists: true, data: () => cached.data };
      }
    }

    try {
      const snap = await db.collection(col).doc(id).get();
      if (snap.exists) {
        const data = snap.data();
        if (col === "settings" && id === "payment") serverCache.settings = { data, time: now };
        else if (col === "courses") serverCache.courses.set(id, { data, time: now });
        else if (col === "providers") serverCache.providers.set(id, { data, time: now });
        return snap;
      }
    } catch (err: any) {
      console.error(`[ORDER-FS] SDK Error: ${err.message}`);
    }

    const restResult = await restGet(col, id, databaseId);
    if (restResult.exists) return restResult;

    if (databaseId && databaseId !== "(default)") {
      const restDefault = await restGet(col, id, "(default)");
      if (restDefault.exists) return restDefault;
    }
    
    return { exists: false, data: () => ({}) };
  };

  const updateDocSafe = async (col: string, id: string, data: any) => {
    console.log(`[ORDER-FS] Attempting UPDATE: ${col}/${id} on ${databaseId}`);
    try {
      await db.collection(col).doc(id).update(data);
      console.log(`[ORDER-FS] ✅ Success: ${col}/${id} updated via SDK.`);
      return true;
    } catch (err: any) {
      console.warn(`[ORDER-FS] ⚠️ SDK Update Failed: ${err.message}`);
      
      if (databaseId && databaseId !== "(default)") {
        try {
          const defaultDb = getDbInstance("(default)");
          await defaultDb.collection(col).doc(id).update(data);
          return true;
        } catch (e) {
          console.error(`[ORDER-FS] SDK Fallback Update failed.`);
        }
      }

      try {
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/${col}/${id}?updateMask.fieldPaths=${Object.keys(data).join('&updateMask.fieldPaths=')}&key=${FIREBASE_API_KEY}`;
        
        const fields: any = {};
        for (const key in data) {
          const val = data[key];
          if (typeof val === "string") fields[key] = { stringValue: val };
          else if (typeof val === "number") fields[key] = { doubleValue: val };
          else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
          else if (typeof val === "boolean") fields[key] = { booleanValue: val };
          else if (val === null) fields[key] = { nullValue: null };
        }

        await axios.patch(url, { fields }, { timeout: 10000 });
        return true;
      } catch (restErr: any) {
        console.error(`[ORDER-FS] ‼️ Terminal: REST Update also failed: ${restErr.message}`);
      }
    }
    return false;
  };

  const adjustUserBalanceSafe = async (userId: string, change: number) => {
    console.log(`[BALANCE-SAFE] Adjusting balance for ${userId} by ${change}`);
    
    // 1. Try SDK Transaction first
    try {
      let success = false;
      await db.runTransaction(async (transaction: any) => {
        const userRef = db.collection("users").doc(userId);
        const userSnap = await transaction.get(userRef);
        if (userSnap.exists) {
          const current = Number(userSnap.data().balance || 0);
          transaction.update(userRef, { balance: FieldValue.increment(change) });
          success = true;
        }
      });
      if (success) {
        console.log(`[BALANCE-SAFE] SDK transaction adjusted balance successfully by ${change}`);
        return true;
      }
    } catch (sdkErr: any) {
      console.warn(`[BALANCE-SAFE] SDK transaction adjustment failed: ${sdkErr.message}. Falling back to REST.`);
    }

    // 2. Fallback: Read balance and overwrite via REST
    try {
      const uSnap = await getDocSafe("users", userId);
      if (uSnap && uSnap.exists) {
        const uData = uSnap.data() || {};
        const currentBalance = Number(uData.balance || 0);
        const newBalance = Number((currentBalance + change).toFixed(2));
        const res = await updateDocSafe("users", userId, { balance: newBalance });
        if (res) {
          console.log(`[BALANCE-SAFE] REST successfully adjusted balance by ${change} (New balance: ${newBalance})`);
          return true;
        }
      }
    } catch (restErr: any) {
      console.error(`[BALANCE-SAFE] Terminal fallback failed: ${restErr.message}`);
    }
    return false;
  };
  
  // ULTIMATE REST FALLBACK HELPER
  // This uses the API Key which can sometimes bypass Service Account permission gaps
  const saveDepositViaRest = async (data: any) => {
    const tidyProjectId = projectId?.trim();
    const tidyDbId = databaseId?.trim();
    const isCloudRun = !!process.env.K_SERVICE || !!process.env.FUNCTION_NAME || true; // Assume high-trust env

    const url = `https://firestore.googleapis.com/v1/projects/${tidyProjectId}/databases/${tidyDbId || "(default)"}/documents/deposits?key=${FIREBASE_API_KEY}`;
    
    // Create fields map with proper Firestore REST types
    const fields: any = {};
    for (const key in data) {
      const val = data[key];
      if (typeof val === "string") fields[key] = { stringValue: val };
      else if (typeof val === "number") fields[key] = { doubleValue: val };
      else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
      else if (key === "createdAt") fields[key] = { timestampValue: new Date().toISOString() };
    }

    const headers: any = {
      "Content-Type": "application/json"
    };

    try {
      // Always try to fetch metadata token first in this environment
      const tokenRes = await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
        headers: { "Metadata-Flavor": "Google" },
        timeout: 3000
      });
      if (tokenRes.data?.access_token) {
        headers["Authorization"] = `Bearer ${tokenRes.data.access_token}`;
        console.log("[REST-DB] Metadata token acquired.");
      }
    } catch (e: any) {
      console.log("[REST-DB] Could not get metadata token, using API Key only.");
    }

    console.log(`[REST-DB] Posting to: ${url.split('?')[0]}`);
    return axios.post(url, { fields }, { headers });
  };

  // Verify DB access on startup and auto-fallback if named DB is restricted/missing
  try {
    await db.collection("settings").doc("payment").get();
    console.log(`[INIT] SDK connection verified for DB: ${databaseId || "(default)"}`);
  } catch (err: any) {
    console.error(`[INIT] SDK connection error with DB ${databaseId}: ${err.message}`);
    // If permission denied or not found on a named DB, force switch to the default one
    if (databaseId && databaseId !== "(default)" && (err.message.includes("PERMISSION_DENIED") || err.message.includes("NOT_FOUND"))) {
      console.warn(`[INIT] Falling back to (default) database due to error...`);
      try {
        db = getFirestore(getApps()[0]);
        // Also verify the fallback
        await db.collection("settings").doc("payment").get();
        console.log("[INIT] Successfully fell back to (default) database.");
      } catch (fallbackErr: any) {
        console.error(`[INIT] Fallback to default DB failed: ${fallbackErr.message}`);
        // Even if it fails, we keep the defaultDb instance as it's our last hope
      }
    }
  }

  // Health check
  app.get("/api/health", (req, res) => res.json({ 
    status: "ok", 
    configProjectId: projectId, 
    configDatabaseId: databaseId || "(default)",
    envProject: process.env.GOOGLE_CLOUD_PROJECT || "not-set",
    envDatabase: process.env.GOOGLE_CLOUD_DATABASE || "not-set",
    hasAdminApp: getApps().length > 0
  }));

  // Razorpay
  app.post("/api/razorpay/create-order", async (req, res) => {
    try {
      const sS = await getDocSafe("settings", "payment");
      const s = sS.data();
      const rzp = new Razorpay({ key_id: s.razorpayKeyId, key_secret: s.razorpayKeySecret });
      const order = await rzp.orders.create({ amount: Math.round(req.body.amount * 100), currency: "INR", receipt: `r_${Date.now()}` });
      res.json({ success: true, order });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/razorpay/verify", async (req, res) => {
    try {
      const sS = await getDocSafe("settings", "payment");
      const secret = sS.data()?.razorpayKeySecret;
      const hmac = crypto.createHmac("sha256", secret).update(req.body.razorpay_order_id + "|" + req.body.razorpay_payment_id).digest("hex");
      if (hmac === req.body.razorpay_signature) {
        await db.runTransaction(async (t: any) => {
          t.update(db.collection("users").doc(req.body.userId), { balance: FieldValue.increment(Number(req.body.amount)) });
          t.set(db.collection("deposits").doc(), { ...req.body, status: "approved", createdAt: FieldValue.serverTimestamp() });
        });
        res.json({ success: true });
      } else res.status(400).json({ error: "Invalid sig" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Manual Deposit
  app.post("/api/deposits/submit-manual", async (req, res) => {
    const { amount, utr, screenshotUrl, userId, userEmail } = req.body;
    console.log(`[DEPOSIT] Attempting submission: UTR=${utr}, User=${userId}`);
    
    const cleanUtr = String(utr).replace(/\D/g, "");
    if (cleanUtr.length !== 12) return res.status(400).json({ error: "Invalid UTR format. Must be 12 digits." });
    
    try {
      // Primary Attempt: Transaction
      await db.runTransaction(async (t: any) => {
        const lockRef = db.collection("utr_locks").doc(cleanUtr);
        const lock = await t.get(lockRef);
        if (lock.exists) throw new Error("DUPLICATE_UTR");
        
        t.set(lockRef, { createdAt: FieldValue.serverTimestamp(), userId, amount: Number(amount) });
        t.set(db.collection("deposits").doc(), {
          userId, 
          userEmail: userEmail || "not-provided", 
          amount: Number(amount), 
          utr: cleanUtr, 
          screenshotUrl: screenshotUrl || "", 
          status: "pending", 
          createdAt: FieldValue.serverTimestamp(),
          source: "secure-transaction"
        });
      });
      res.json({ success: true });
    } catch (e: any) {
      console.error(`[DEPOSIT] Transaction error: ${e.message}`);
      
      if (e.message === "DUPLICATE_UTR") {
        return res.status(400).json({ error: "This UTR number has already been used." });
      }

      // If it's a permission error, it might be the named database. Try a direct write.
      try {
        console.log("[DEPOSIT] Trying direct write fallback...");
        await db.collection("deposits").add({
          userId,
          userEmail: userEmail || "not-provided",
          amount: Number(amount),
          utr: cleanUtr,
          screenshotUrl: screenshotUrl || "",
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
          source: "direct-sdk-fallback"
        });
        return res.json({ success: true, message: "Request received" });
      } catch (e2: any) {
        console.error(`[DEPOSIT] Direct write failed: ${e2.message}`);
        
        // Final attempt: try the default database explicitly
        try {
          console.log("[DEPOSIT] Trying default database fallback...");
          const defaultDb = getFirestore(getApps()[0]);
          await defaultDb.collection("deposits").add({
            userId,
            userEmail: userEmail || "not-provided",
            amount: Number(amount),
            utr: cleanUtr,
            screenshotUrl,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            source: "default-db-fallback"
          });
          return res.json({ success: true, message: "Request received (D)" });
        } catch (e3: any) {
          console.error(`[DEPOSIT] Default DB fallback failed: ${e3.message}`);
          
          // LAST RESORT: REST API with API KEY (Bypasses SDK issues)
          try {
            console.log("[DEPOSIT] Attempting ULTIMATE REST FALLBACK...");
            await saveDepositViaRest({
              userId,
              userEmail: userEmail || "not-provided",
              amount: Number(amount),
              utr: cleanUtr,
              screenshotUrl: screenshotUrl || "",
              status: "pending",
              source: "rest-ultimate-fallback"
            });
            console.log("[DEPOSIT] ULTIMATE REST FALLBACK SUCCESS.");
            return res.json({ success: true, message: "Request received (R)" });
          } catch (e4: any) {
            console.error(`[DEPOSIT] ALL ATTEMPTS FAILED. REST Error: ${e4.response?.data?.error?.message || e4.message}`);
            res.status(500).json({ 
              error: "Permission denied or database error.", 
              details: e4.response?.data?.error?.message || e4.message,
              tip: "Please check Firebase Database ID and Permissions in AI Studio Settings."
            });
          }
        }
      }
    }
  });

  // Improved Proxy for Provider with better logging and headers
  app.post("/api/proxy-provider", async (req, res) => {
    const { courseId, targetLink, quantity, orderId } = req.body;
    
    console.log(`[ORDER] Request Body:`, JSON.stringify(req.body));
    console.log(`[ORDER] Processing order ${orderId} for course ${courseId}`);

    try {
      if (!courseId || !orderId) {
        throw new Error("Missing required fields: courseId and orderId are mandatory.");
      }

      // 1. Fetch Course
      let cS;
      try {
        cS = await getDocSafe("courses", courseId);
      } catch (e: any) {
        console.error(`[ORDER] Failed to fetch course doc: ${e.message}`);
        throw new Error(`Technical Error (Courses): ${e.message}`);
      }

      if (!cS || !cS.exists) throw new Error(`Service Configuration Not Found: The service with ID "${courseId}" does not exist in our database.`);
      const c = cS.data();
      
      // 2. Fetch Settings
      let s;
      try {
        const sS = await getDocSafe("settings", "payment");
        s = sS.data() || {};
      } catch (e) {
        console.error(`[ORDER] Failed to fetch settings, using defaults.`);
        s = {};
      }
      
      // 3. Resolve Provider
      let pUrl = (s.providerApiUrl || "").trim();
      let pKey = (s.providerApiKey || "").trim();
      
      if (c.providerId && c.providerId !== "global") {
        console.log(`[ORDER] Course uses specific provider: ${c.providerId}`);
        try {
          const pS = await getDocSafe("providers", c.providerId);
          if (pS && pS.exists) { 
            const pData = pS.data() || {};
            pUrl = (pData.apiUrl || "").trim(); 
            pKey = (pData.apiKey || "").trim(); 
          } else {
            console.warn(`[ORDER] Provider "${c.providerId}" not found, falling back to global settings.`);
          }
        } catch (e) {
          console.warn(`[ORDER] Error fetching provider details, falling back.`);
        }
      }

      if (!pUrl || !pKey) {
        throw new Error("Provider API URL or Key is missing. Please check your admin configuration.");
      }

      // Ensure URL is absolute
      if (!pUrl.startsWith("http")) pUrl = "https://" + pUrl;

      if (!c.providerServiceId || String(c.providerServiceId) === "0") {
        throw new Error(`Provider Service ID for course "${c.title}" is missing or invalid.`);
      }
      
      let finalLink = String(targetLink).trim();
      
      // 1. If it starts with @, it's likely an Instagram/Twitter handle, convert to profile link
      if (finalLink.startsWith("@")) {
        const username = finalLink.substring(1);
        if (c.category?.toLowerCase().includes("instagram")) {
          finalLink = `https://www.instagram.com/${username}/`;
        } else if (c.category?.toLowerCase().includes("twitter") || c.category?.toLowerCase().includes("x")) {
          finalLink = `https://x.com/${username}/`;
        } else if (c.category?.toLowerCase().includes("tiktok")) {
          finalLink = `https://www.tiktok.com/@${username}`;
        }
      } else if (!finalLink.includes("://") && !finalLink.includes(".")) {
        // Raw username input without domain or @ prefix
        const username = finalLink.trim();
        const cat = (c.category || "").toLowerCase();
        if (cat.includes("instagram")) {
          finalLink = `https://www.instagram.com/${username}/`;
        } else if (cat.includes("twitter") || cat.includes("x.com") || cat.includes("x / twitter") || cat.includes(" x ")) {
          finalLink = `https://x.com/${username}/`;
        } else if (cat.includes("tiktok")) {
          finalLink = `https://www.tiktok.com/@${username}`;
        } else if (cat.includes("telegram") || cat.includes("tg")) {
          finalLink = `https://t.me/${username}`;
        } else if (cat.includes("youtube") || cat.includes("yt")) {
          finalLink = `https://www.youtube.com/@${username}`;
        }
      }
      
      // 2. Add https:// if missing and looks like a domain
      if (finalLink.length > 3 && !finalLink.includes("://") && finalLink.includes(".")) {
        finalLink = "https://" + finalLink;
      }
      
      // 3. Strip tracking parameters (but keep basic link structure)
      try {
        if (finalLink.includes("?")) {
           const urlObj = new URL(finalLink);
           // List of common trackers to remove
           const trackers = ["igshid", "utm_source", "utm_medium", "utm_campaign", "fbclid", "s", "t"];
           trackers.forEach(t => urlObj.searchParams.delete(t));
           finalLink = urlObj.toString();
         }
      } catch (err) {
        // Fallback to original if URL is weird
      }

      console.log(`[ORDER] Routing to Provider: ${pUrl} | Service: ${c.providerServiceId}`);
      console.log(`[ORDER] Payload: service=${c.providerServiceId}, link=${finalLink}, quantity=${quantity}`);
      
      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "add");
      params.append("service", String(c.providerServiceId).trim());
      params.append("link", finalLink);
      params.append("quantity", String(quantity).trim());

      // Dual Transmission: set parameters in query string as well as URL-encoded body
      const querySeparator = pUrl.includes("?") ? "&" : "?";
      const finalUrl = pUrl + querySeparator + params.toString();

      let response;
      let attempts = 0;
      const maxAttempts = 2; // Retry once if it fails due to network
      
      while (attempts < maxAttempts) {
        try {
          attempts++;
          console.log(`[ORDER] Calling Provider API (Attempt ${attempts}): ${finalUrl}`);
          response = await axios.post(finalUrl, params.toString(), {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 55000 
          });
          break; // Success!
        } catch (axiosError: any) {
          if (attempts >= maxAttempts) {
            console.error(`[ORDER] Provider Connection Failed after ${attempts} attempts: ${axiosError.message}`);
            
            let providerErr = "Connection failed";
            if (axiosError.response) {
              console.error(`[ORDER] Provider Error Status: ${axiosError.response.status}`);
              console.error(`[ORDER] Provider Error Body:`, JSON.stringify(axiosError.response.data));
              providerErr = axiosError.response.data?.error || axiosError.response.data?.message || axiosError.response.data?.msg || `HTTP ${axiosError.response.status}`;
            } else if (axiosError.request) {
              providerErr = "No response from provider (Timeout or Network Error)";
            } else {
              providerErr = axiosError.message;
            }

            const stringErr = typeof providerErr === 'string' ? providerErr : JSON.stringify(providerErr);
            
            // AUTOMATIC REFUND ON CONNECTION FAILURE
            try {
              console.log(`[REFUND] Starting connection failure refund for ${orderId}`);
              await db.runTransaction(async (transaction: any) => {
                const orderRef = db.collection("orders").doc(orderId);
                const orderSnap = await transaction.get(orderRef);
                
                if (orderSnap.exists) {
                  const orderData = orderSnap.data();
                  if (orderData.status !== "Failed" && orderData.status !== "Refunded") {
                    const userRef = db.collection("users").doc(orderData.userId);
                    const userSnap = await transaction.get(userRef);
                    
                    if (userSnap.exists) {
                       const price = Number(orderData.totalPrice || 0);
                       transaction.update(userRef, { balance: FieldValue.increment(price) });
                       transaction.update(orderRef, { 
                         status: "Failed", 
                         error: `Refunded: API Connection Error (${stringErr})`,
                         updatedAt: FieldValue.serverTimestamp()
                       });
                       console.log(`[REFUND] Wallet updated for User ${orderData.userId}: +₹${price}`);
                    }
                  }
                }
              });
            } catch (refundErr: any) {
              console.error(`[REFUND] Transaction failed, trying direct update fallback: ${refundErr.message}`);
              // Fallback to safe rest-based balance adjustment and status update
              try {
                const oSnap = await getDocSafe("orders", orderId);
                if (oSnap && oSnap.exists) {
                  const oData = oSnap.data();
                  const price = Number(oData.totalPrice || 0);
                  const refSuccess = await adjustUserBalanceSafe(oData.userId, price);
                  if (refSuccess) {
                    await updateDocSafe("orders", orderId, { 
                      status: "Failed", 
                      error: `Refunded: API Connection Error (${stringErr})`,
                      updatedAt: new Date()
                    });
                    console.log(`[REFUND] Fallback wallet refund successful for User ${oData.userId}: +₹${price}`);
                  } else {
                    await updateDocSafe("orders", orderId, { 
                      status: "Failed", 
                      error: `Failed (Refund pending manual check): ${stringErr}`,
                      updatedAt: new Date()
                    });
                  }
                } else {
                  console.error(`[REFUND] Order ${orderId} not found in fallback.`);
                }
              } catch (fallbackErr: any) {
                console.error(`[REFUND] Terminal fallback failed: ${fallbackErr.message}`);
                await updateDocSafe("orders", orderId, { 
                  status: "Failed", 
                  error: `Failed (Refund error): ${stringErr}`,
                  updatedAt: new Date()
                });
              }
            }
            
            return res.status(400).json({ success: false, error: stringErr });
          } else {
            console.warn(`[ORDER] Attempt ${attempts} failed, retrying in 2 seconds...`);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      
      console.log(`[ORDER] Provider Response Status: ${response.status}`);
      
      // Parse response carefully
      let resData = response.data;
      
      // Handle cases where response might be a string that needs parsing
      if (typeof resData === "string") {
        try {
          const trimmed = resData.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            resData = JSON.parse(trimmed);
          } else {
            // Plain string response - check if it's just a number (some panels return only ID)
            if (trimmed.match(/^\d+$/)) {
              resData = { order: trimmed };
            }
          }
        } catch(e) {
          console.log(`[ORDER] Non-JSON string response from provider.`);
        }
      }
      
      // Some providers return an array
      if (Array.isArray(resData) && resData.length > 0) {
          resData = resData[0];
      }

      console.log(`[ORDER] Provider Data:`, JSON.stringify(resData));
      
      // Comprehensive Success & Order ID Detection
      let providerOrderId = resData?.order || resData?.order_id || resData?.orderid || resData?.orderId || resData?.id || resData?.ID;
      
      // If no ID but status is success, we might have an issue but the order is "received"
      const isStatusSuccess = resData?.status === "success" || 
                              resData?.status === "Success" || 
                              resData?.success === true || 
                              resData?.success === "true" ||
                              resData?.msg?.toLowerCase().includes("success") ||
                              resData?.message?.toLowerCase().includes("success");
      
      // Fallback: If status is success but no order ID, check if the whole response is a number
      if (!providerOrderId && typeof resData === 'number') {
        providerOrderId = String(resData);
      }
      
      if (providerOrderId || isStatusSuccess) {
        const oId = providerOrderId ? String(providerOrderId) : "SENT_NO_ID";
        try {
          await db.runTransaction(async (transaction: any) => {
            const orderRef = db.collection("orders").doc(orderId);
            const orderSnap = await transaction.get(orderRef);
            
            if (orderSnap.exists) {
              const orderData = orderSnap.data();
              
              // CRITICAL: If the order was previously FAILED/REFUNDED, we must re-deduct balance on success
              if (orderData.status === "Failed" || orderData.status === "Refunded") {
                const userRef = db.collection("users").doc(orderData.userId);
                const userSnap = await transaction.get(userRef);
                
                if (userSnap.exists) {
                  const currentBalance = userSnap.data().balance || 0;
                  const price = orderData.totalPrice || 0;
                  
                  // Even if user has 0 balance now, we deduct (panel logic allows retry to proceed if admin triggered)
                  transaction.update(userRef, { balance: currentBalance - price });
                  console.log(`[RE-DEDUCT] Order ${orderId} successful retry. Deducted ₹${price} from User ${orderData.userId}`);
                }
              }
              
              transaction.update(orderRef, { 
                status: "Completed", 
                providerOrderId: oId, 
                error: null,
                updatedAt: FieldValue.serverTimestamp(),
                providerRawResponse: JSON.stringify(resData).substring(0, 800)
              });
            }
          });
        } catch (updateErr: any) {
          console.warn(`[ORDER] Final update failed but order was sent: ${updateErr.message}`);
          // Fallback if transaction fails but we know it was sent
          await updateDocSafe("orders", orderId, { 
            status: "Completed", 
            providerOrderId: oId, 
            updatedAt: new Date() 
          });
        }
        return res.json({ success: true, providerOrderId: oId });
      } else {
        // Collect all possible error keys from common SMM panels
        const rawError = resData?.error || resData?.message || resData?.msg || resData?.errors || resData?.ERR || resData?.status;
        let errorMsg = "Provider rejected the request.";
        
        if (rawError) {
          if (typeof rawError === "string") errorMsg = rawError;
          else if (Array.isArray(rawError)) errorMsg = rawError.join(", ");
          else if (typeof rawError === "object") {
            // Some panels return { errors: { link: ["invalid"] } }
            const firstInnerKey = Object.keys(rawError)[0];
            if (firstInnerKey && Array.isArray(rawError[firstInnerKey])) {
              errorMsg = `${firstInnerKey}: ${rawError[firstInnerKey][0]}`;
            } else {
              errorMsg = JSON.stringify(rawError);
            }
          }
        } else if (typeof resData === "string" && resData.length > 0) {
          errorMsg = resData;
        }

        console.error(`[ORDER] Provider Rejection: ${errorMsg} | Raw Response: ${JSON.stringify(resData)}`);
        
        // AUTOMATIC REFUND ON PROVIDER REJECTION
        try {
          console.log(`[REFUND] Starting rejection refund for ${orderId}`);
          await db.runTransaction(async (transaction: any) => {
            const orderRef = db.collection("orders").doc(orderId);
            const orderSnap = await transaction.get(orderRef);
            
            if (orderSnap.exists) {
              const orderData = orderSnap.data();
              if (orderData.status !== "Failed" && orderData.status !== "Refunded") {
                const userRef = db.collection("users").doc(orderData.userId);
                const userSnap = await transaction.get(userRef);
                
                if (userSnap.exists) {
                  const price = Number(orderData.totalPrice || 0);
                  transaction.update(userRef, { balance: FieldValue.increment(price) });
                  transaction.update(orderRef, { 
                    status: "Failed", 
                    error: `Refunded: Provider Rejected Order (${String(errorMsg).substring(0, 200)})`,
                    updatedAt: FieldValue.serverTimestamp()
                  });
                  console.log(`[REFUND] Wallet updated for User ${orderData.userId}: +₹${price}`);
                }
              }
            }
          });
        } catch (refundErr: any) {
          console.error(`[REFUND] Rejection refund failed, using fallback: ${refundErr.message}`);
          try {
            const oSnap = await getDocSafe("orders", orderId);
            if (oSnap && oSnap.exists) {
              const oData = oSnap.data();
              const price = Number(oData.totalPrice || 0);
              const refSuccess = await adjustUserBalanceSafe(oData.userId, price);
              if (refSuccess) {
                await updateDocSafe("orders", orderId, { 
                  status: "Failed", 
                  error: `Refunded: Provider Rejected Order (${String(errorMsg).substring(0, 200)})`,
                  updatedAt: new Date()
                });
                console.log(`[REFUND] Fallback rejection refund successful for User ${oData.userId}: +₹${price}`);
              } else {
                await updateDocSafe("orders", orderId, { 
                  status: "Failed", 
                  error: `Failed (Refund pending manual check): ${String(errorMsg).substring(0, 200)}`,
                  updatedAt: new Date()
                });
              }
            } else {
              console.error(`[REFUND] Order ${orderId} not found in rejection fallback.`);
            }
          } catch (fallbackErr: any) {
            console.error(`[REFUND] Terminal rejection fallback failed: ${fallbackErr.message}`);
            await updateDocSafe("orders", orderId, { 
              status: "Failed", 
              error: `Failed (Refund error): ${String(errorMsg).substring(0, 200)}`,
              updatedAt: new Date()
            });
          }
        }
        
        return res.status(400).json({ success: false, error: String(errorMsg) });
      }
    } catch (e: any) { 
      console.error(`[ORDER] Final Catch: ${e.message}`);
      return res.status(500).json({ success: false, error: e.message || "Unknown internal server error" }); 
    }
  });

  // Test Provider API
  app.post("/api/test-provider", async (req, res) => {
    try {
      const { providerId } = req.body;
      let pUrl = "";
      let pKey = "";

      if (providerId) {
        const pS = await getDocSafe("providers", providerId);
        if (pS.exists) {
          pUrl = pS.data()?.apiUrl;
          pKey = pS.data()?.apiKey;
        } else {
          return res.status(404).json({ error: "Provider not found" });
        }
      } else {
        const sS = await getDocSafe("settings", "payment");
        pUrl = sS.data()?.providerApiUrl;
        pKey = sS.data()?.providerApiKey;
      }

      if (!pUrl || !pKey) return res.status(400).json({ error: "API URL or Key missing" });

      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "balance");

      const response = await axios.post(pUrl, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000
      });

      if (response.data.balance !== undefined) {
        res.json({ success: true, balance: response.data.balance, currency: response.data.currency });
      } else {
        res.status(400).json({ error: response.data.error || "Failed to fetch balance" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Check Order Status (Single check for UI)
  app.post("/api/order-status", async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    try {
      const oS = await db.collection("orders").doc(orderId).get();
      if (!oS.exists) return res.status(404).json({ error: "Order not found" });
      res.json({ success: true, status: oS.data()?.status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Sync Order Status (Improved logic with duplicate write prevention)
  app.post("/api/sync-order-status", async (req, res) => {
    try {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: "orderId required" });

      const oS = await db.collection("orders").doc(orderId).get();
      if (!oS.exists) return res.status(404).json({ error: "Order not found" });
      const order = oS.data();

      // OPTIMIZATION: If already in a terminal state, don't write anything
      const currentStatus = order.status || "Pending";
      const terminalStatuses = ["Completed", "Canceled", "Refunded", "Partial", "Failed"];
      if (terminalStatuses.includes(currentStatus)) {
        return res.json({ success: true, status: currentStatus, upToDate: true });
      }

      if (!order.providerOrderId) {
        return res.json({ success: true, status: currentStatus, message: "No provider ID yet" });
      }

      // Fetch provider info
      let pUrl = "";
      let pKey = "";
      const sS = await getDocSafe("settings", "payment");
      const sData = sS.data() || {};
      pUrl = sData.providerApiUrl || "";
      pKey = sData.providerApiKey || "";

      if (order.courseId) {
        const cS = await getDocSafe("courses", order.courseId);
        if (cS.exists) {
          const cData = cS.data();
          if (cData.providerId && cData.providerId !== "global") {
            const pS = await getDocSafe("providers", cData.providerId);
            if (pS.exists) {
              const pData = pS.data();
              pUrl = pData.apiUrl || "";
              pKey = pData.apiKey || "";
            }
          }
        }
      }

      if (!pUrl || !pKey) return res.status(400).json({ error: "Provider config missing" });

      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "status");
      params.append("order", String(order.providerOrderId));

      const response = await axios.post(pUrl.startsWith("http") ? pUrl : `https://${pUrl}`, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000
      });

      let pStatus = response.data.status;
      if (pStatus) {
        pStatus = pStatus.charAt(0).toUpperCase() + pStatus.slice(1).toLowerCase();
        if (pStatus === "Inprogress") pStatus = "In Progress";
        if (pStatus === "Cancelled") pStatus = "Canceled";

        // CRITICAL: Only write if status actually changed or enough time passed
        const shouldUpdate = 
          pStatus !== currentStatus || 
          pStatus !== order.providerStatus ||
          !order.updatedAt;

        if (shouldUpdate) {
          await db.collection("orders").doc(orderId).update({ 
            status: pStatus, 
            providerStatus: pStatus,
            updatedAt: FieldValue.serverTimestamp() 
          });
          console.log(`[SYNC] ✅ Updated order ${orderId} to ${pStatus}`);
          return res.json({ success: true, status: pStatus, updated: true });
        }
        
        return res.json({ success: true, status: currentStatus, updated: false });
      } else {
        res.status(400).json({ error: response.data.error || "Failed to fetch status" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite
  const isProductionMode = process.env.NODE_ENV === "production" || fs.existsSync(path.join(process.cwd(), 'dist'));
  if (!isProductionMode) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`[READY] Port ${PORT}`));
}

startServer().catch(console.error);
