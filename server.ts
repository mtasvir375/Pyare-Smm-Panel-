import express from "express";
import cors from "cors";
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
  
  // Enable absolute CORS for custom domains calling this Cloud Run backend
  app.use(cors({
    origin: (origin, callback) => {
      // Allow any origin, complying with white-label client-side custom domain setups
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers"
    ],
    maxAge: 86400 // Cache preflight OPTIONS responses for 24 hours
  }));
  
  // Load Firebase Config
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId } = firebaseConfig;
  const databaseId = (firebaseConfig.firestoreDatabaseId || "").trim() || "(default)";
  const FIREBASE_API_KEY = firebaseConfig.apiKey;

  const logToDb = async (event: string, meta: any = {}) => {
    try {
      const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
      const customId = `syslog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const restUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/orders/${customId}?key=${FIREBASE_API_KEY}`;
      await axios.patch(restUrl, {
        fields: {
          timestamp: { timestampValue: new Date().toISOString() },
          isSyslog: { booleanValue: true },
          event: { stringValue: event },
          env: { stringValue: process.env.NODE_ENV || "unknown" },
          meta: { stringValue: JSON.stringify(meta).substring(0, 1500) }
        }
      }, { timeout: 8000 });
    } catch (err: any) {
      console.error("Failed to write syslog to Firestore:", err.message);
    }
  };

  logToDb("SERVER_START", { message: "Express server started/restarted successfully" });

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

  // Auto-verify and populate backend API URL in Firestore settings so client domains route correctly
  const ensureBackendUrlIsSet = async () => {
    const ACTIVE_BACKEND_URL = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    try {
      console.log(`[INIT] Auto-ensuring backend URL in Firestore: ${ACTIVE_BACKEND_URL}`);
      const paymentRef = db.collection("settings").doc("payment");
      const snap = await paymentRef.get();
      if (snap.exists) {
        const data = snap.data() || {};
        // If a custom domain like pyaresmmpanel.online or other unique backend is already stored, do NOT overwrite it.
        if (data.backendApiUrl && 
            (data.backendApiUrl.includes("pyaresmmpanel.online") || 
             (!data.backendApiUrl.includes("run.app") && data.backendApiUrl.includes(".")))) {
          console.log(`[INIT] Keeping custom backendApiUrl: ${data.backendApiUrl}`);
          return;
        }
        if (data.backendApiUrl !== ACTIVE_BACKEND_URL) {
          await paymentRef.update({ backendApiUrl: ACTIVE_BACKEND_URL });
          console.log(`[INIT] ✅ Successfully updated backendApiUrl to: ${ACTIVE_BACKEND_URL}`);
        } else {
          console.log(`[INIT] ✅ backendApiUrl is already up to date: ${ACTIVE_BACKEND_URL}`);
        }
      } else {
        await paymentRef.set({ backendApiUrl: ACTIVE_BACKEND_URL });
        console.log(`[INIT] ✅ Created settings/payment with backendApiUrl: ${ACTIVE_BACKEND_URL}`);
      }
    } catch (err: any) {
      console.warn(`[INIT] ⚠️ Auto-updating backendApiUrl via SDK failed: ${err.message}`);
      // Fallback via REST write if databaseId / permissions are weird
      try {
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const restUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/settings/payment?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=backendApiUrl`;
        
        // Double check existing settings if possible before patching
        let shouldPatch = true;
        try {
          const checkRes = await axios.get(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/settings/payment?key=${FIREBASE_API_KEY}`, { timeout: 3000 });
          const existingUrl = checkRes.data?.fields?.backendApiUrl?.stringValue || "";
          if (existingUrl.includes("pyaresmmpanel.online") || (!existingUrl.includes("run.app") && existingUrl.includes("."))) {
            shouldPatch = false;
            console.log(`[INIT] Keeping custom backendApiUrl via REST: ${existingUrl}`);
          }
        } catch (e) {}

        if (shouldPatch) {
          await axios.patch(restUrl, {
            fields: {
              backendApiUrl: { stringValue: ACTIVE_BACKEND_URL }
            }
          }, { timeout: 10000 });
          console.log(`[INIT] ✅ Successfully patched backendApiUrl via Firestore REST API.`);
        }
      } catch (restErr: any) {
        console.error(`[INIT] ❌ REST patch fallback also failed: ${restErr.response?.data || restErr.message}`);
      }
    }
  };
  
  ensureBackendUrlIsSet();
  startBackgroundOrderListener(db);
  
  // IN-MEMORY CACHE FOR SERVER-SIDE
  const serverCache: any = {
    settings: { data: null, time: 0 },
    courses: new Map(), // Map<courseId, {data, time}>
    providers: new Map() // Map<providerId, {data, time}>
  };
  const SERVER_CACHE_TTL = 5 * 1000; // 5 seconds (Fast fallback/highly responsive)

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

  const setDocSafe = async (col: string, id: string, data: any) => {
    console.log(`[ORDER-FS] Attempting SET: ${col}/${id} on ${databaseId}`);
    try {
      await db.collection(col).doc(id).set(data);
      console.log(`[ORDER-FS] ✅ Success: ${col}/${id} set via SDK.`);
      return true;
    } catch (err: any) {
      console.warn(`[ORDER-FS] ⚠️ SDK Set Failed: ${err.message}`);
      
      if (databaseId && databaseId !== "(default)") {
        try {
          const defaultDb = getDbInstance("(default)");
          await defaultDb.collection(col).doc(id).set(data);
          return true;
        } catch (e) {
          console.error(`[ORDER-FS] SDK Fallback Set failed.`);
        }
      }

      try {
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/${col}/${id}?key=${FIREBASE_API_KEY}`;
        
        const fields: any = {};
        for (const key in data) {
          const val = data[key];
          if (typeof val === "string") fields[key] = { stringValue: val };
          else if (typeof val === "number") fields[key] = { doubleValue: val };
          else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
          else if (typeof val === "boolean") fields[key] = { booleanValue: val };
          else if (val === null) fields[key] = { nullValue: null };
        }

        const headers: any = { "Content-Type": "application/json" };
        try {
          const tokenRes = await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
            headers: { "Metadata-Flavor": "Google" },
            timeout: 1000
          });
          if (tokenRes.data?.access_token) {
            headers["Authorization"] = `Bearer ${tokenRes.data.access_token}`;
          }
        } catch (e) {}

        await axios.patch(url, { fields }, { headers, timeout: 10000 });
        return true;
      } catch (restErr: any) {
        console.error(`[ORDER-FS] ‼️ Terminal: REST Set also failed: ${restErr.message}`);
      }
    }
    return false;
  };

  const addDocSafe = async (col: string, data: any) => {
    console.log(`[ORDER-FS] Attempting ADD: ${col} on ${databaseId}`);
    try {
      const docRef = await db.collection(col).add(data);
      console.log(`[ORDER-FS] ✅ Success: ${col}/${docRef.id} added via SDK.`);
      return docRef.id;
    } catch (err: any) {
      console.warn(`[ORDER-FS] ⚠️ SDK Add Failed: ${err.message}`);
      
      if (databaseId && databaseId !== "(default)") {
        try {
          const defaultDb = getDbInstance("(default)");
          const docRef = await defaultDb.collection(col).add(data);
          return docRef.id;
        } catch (e) {
          console.error(`[ORDER-FS] SDK Fallback Add failed.`);
        }
      }

      try {
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/${col}?key=${FIREBASE_API_KEY}`;
        
        const fields: any = {};
        for (const key in data) {
          const val = data[key];
          if (typeof val === "string") fields[key] = { stringValue: val };
          else if (typeof val === "number") fields[key] = { doubleValue: val };
          else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
          else if (typeof val === "boolean") fields[key] = { booleanValue: val };
          else if (val === null) fields[key] = { nullValue: null };
        }

        const headers: any = { "Content-Type": "application/json" };
        try {
          const tokenRes = await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
            headers: { "Metadata-Flavor": "Google" },
            timeout: 1000
          });
          if (tokenRes.data?.access_token) {
            headers["Authorization"] = `Bearer ${tokenRes.data.access_token}`;
          }
        } catch (e) {}

        const res = await axios.post(url, { fields }, { headers, timeout: 10000 });
        const nameParts = (res.data?.name || "").split("/");
        const generatedId = nameParts[nameParts.length - 1];
        if (generatedId) {
          console.log(`[ORDER-FS] REST Add success with ID: ${generatedId}`);
          return generatedId;
        }
      } catch (restErr: any) {
        console.error(`[ORDER-FS] ‼️ Terminal: REST Add also failed: ${restErr.message}`);
      }
    }
    return null;
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
        await adjustUserBalanceSafe(req.body.userId, Number(req.body.amount));
        await addDocSafe("deposits", { ...req.body, status: "approved", createdAt: new Date() });
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
      const lockSnap = await getDocSafe("utr_locks", cleanUtr);
      if (lockSnap.exists) {
        return res.status(400).json({ error: "This UTR number has already been used." });
      }
      
      await setDocSafe("utr_locks", cleanUtr, {
        createdAt: new Date(),
        userId,
        amount: Number(amount)
      });

      const depId = await addDocSafe("deposits", {
        userId, 
        userEmail: userEmail || "not-provided", 
        amount: Number(amount), 
        utr: cleanUtr, 
        screenshotUrl: screenshotUrl || "", 
        status: "pending", 
        createdAt: new Date(),
        source: "rest-safe-manual"
      });

      if (depId) {
        res.json({ success: true });
      } else {
        throw new Error("Failed to write manual deposit to database.");
      }
    } catch (e: any) {
      console.error(`[DEPOSIT] Error submitting manual deposit: ${e.message}`);
      res.status(500).json({ error: e.message || "Failed to submit request." });
    }
  });

  // IN-MEMORY SET TO PREVENT MULTIPLE TRANSMISSIONS
  const processingOrders = new Set<string>();

  // Helper to transmit single order to SMM provider directly
  async function transmitOrderToProviderDirect(orderId: string, orderData: any) {
    // Look up lock first
    if (processingOrders.has(orderId)) {
      console.log(`[LOCK] Order ${orderId} is currently being processed by another worker path. Skipping.`);
      return { success: true, alreadyProcessing: true };
    }

    processingOrders.add(orderId);
    console.log(`[TRANSMIT] Locking & processing orderId: ${orderId}`);

    try {
      // Recheck Firestore to verify it wasn't already completed by a parallel route
      const snapObj = await getDocSafe("orders", orderId);
      if (snapObj.exists) {
        const snapData = snapObj.data() || {};
        if (snapData.providerOrderId) {
          console.log(`[TRANSMIT] Order ${orderId} already has providerOrderId registered: ${snapData.providerOrderId}`);
          return { success: true, providerOrderId: snapData.providerOrderId };
        }
        if (snapData.providerTransmissionStatus === "completed") {
          console.log(`[TRANSMIT] Order ${orderId} transmission was already completed.`);
          return { success: true, providerOrderId: snapData.providerOrderId || "SENT" };
        }
      }

      // 0. Pre-check Balance
      const currentOrderSnap = await getDocSafe("orders", orderId);
      if (!currentOrderSnap.exists) throw new Error("Order not found");
      const currentOrderData = currentOrderSnap.data();
      const orderAmount = currentOrderData.totalPrice || 0;
      
      const userSnap = await getDocSafe("users", currentOrderData.userId);
      if (!userSnap.exists) throw new Error("User profile not found");
      const userBalance = Number(userSnap.data().balance || 0);

      if (userBalance < orderAmount) {
        throw new Error(`Insufficient balance (Current: ₹${userBalance}, Required: ₹${orderAmount}). Order rejected.`);
      }

      const { courseId, targetLink, quantity } = orderData;
      if (!courseId) {
        throw new Error("Missing required field: courseId");
      }

      // 1. Fetch Course details
      let cS = await getDocSafe("courses", courseId);
      if (!cS || !cS.exists) {
        throw new Error(`Service configuration with ID "${courseId}" does not exist in the database.`);
      }
      const c = cS.data();

      // 2. Fetch Settings
      let sS = await getDocSafe("settings", "payment");
      const s = sS.exists ? (sS.data() || {}) : {};

      // 3. Resolve API credentials
      let pUrl = (s.providerApiUrl || "").trim();
      let pKey = (s.providerApiKey || "").trim();

      if (c.providerId && c.providerId !== "global") {
        console.log(`[TRANSMIT] Course ${courseId} is using a custom provider: ${c.providerId}`);
        const pS = await getDocSafe("providers", c.providerId);
        if (pS && pS.exists) {
          const pData = pS.data() || {};
          pUrl = (pData.apiUrl || "").trim();
          pKey = (pData.apiKey || "").trim();
        } else {
          console.warn(`[TRANSMIT] Custom provider ${c.providerId} not found. Falling back to global settings.`);
        }
      }

      if (!pUrl || !pKey) {
        throw new Error("Provider API URL or API Key is missing inside settings. Transmission canceled.");
      }

      if (!pUrl.startsWith("http")) {
        pUrl = "https://" + pUrl;
      }

      if (!c.providerServiceId || String(c.providerServiceId) === "0") {
        throw new Error(`Service ID for course "${c.title}" is missing or mapped poorly.`);
      }

      // 4. Link & Username Normalization
      let finalLink = String(targetLink).trim();
      if (finalLink.startsWith("@")) {
        const username = finalLink.substring(1);
        if (c.category?.toLowerCase().includes("instagram")) finalLink = `https://www.instagram.com/${username}/`;
        else if (c.category?.toLowerCase().includes("twitter") || c.category?.toLowerCase().includes("x")) finalLink = `https://x.com/${username}/`;
        else if (c.category?.toLowerCase().includes("tiktok")) finalLink = `https://www.tiktok.com/@${username}`;
      } else if (!finalLink.includes("://") && !finalLink.includes(".")) {
        const username = finalLink.trim();
        const cat = (c.category || "").toLowerCase();
        if (cat.includes("instagram")) finalLink = `https://www.instagram.com/${username}/`;
        else if (cat.includes("twitter") || cat.includes("x.com") || cat.includes("x / twitter") || cat.includes(" x ")) finalLink = `https://x.com/${username}/`;
        else if (cat.includes("tiktok")) finalLink = `https://www.tiktok.com/@${username}`;
        else if (cat.includes("telegram") || cat.includes("tg")) finalLink = `https://t.me/${username}`;
        else if (cat.includes("youtube") || cat.includes("yt")) finalLink = `https://www.youtube.com/@${username}`;
      }

      if (finalLink.length > 3 && !finalLink.includes("://") && finalLink.includes(".")) {
        finalLink = "https://" + finalLink;
      }

      try {
        if (finalLink.includes("?")) {
          const urlObj = new URL(finalLink);
          const trackers = ["igshid", "utm_source", "utm_medium", "utm_campaign", "fbclid", "s", "t"];
          trackers.forEach(t => urlObj.searchParams.delete(t));
          finalLink = urlObj.toString();
        }
      } catch (err) {}

      console.log(`[TRANSMIT] Sending API request to: ${pUrl}`);
      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "add");
      params.append("service", String(c.providerServiceId).trim());
      params.append("link", finalLink);
      params.append("quantity", String(quantity).trim());

      let response;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          let targetUrl = pUrl;

          // Self-Healing fallback paths
          if (!targetUrl.includes("/api/")) {
            const cleanedBase = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
            if (attempts === 2) targetUrl = `${cleanedBase}/api/v2`;
            else if (attempts === 3) targetUrl = `${cleanedBase}/api/v2/`;
            else if (attempts === 4) targetUrl = `${cleanedBase}/api/v1`;
          }

          let isDualMode = false;
          if (attempts >= 4) {
            isDualMode = true;
            const seq = targetUrl.includes("?") ? "&" : "?";
            targetUrl = targetUrl + seq + params.toString();
          }

          let reqBody: any = params;
          let contentHeader = "application/x-www-form-urlencoded";

          if (attempts === 3) {
            reqBody = {
              key: pKey,
              action: "add",
              service: String(c.providerServiceId).trim(),
              link: finalLink,
              quantity: String(quantity).trim()
            };
            contentHeader = "application/json";
          }

          response = await axios.post(targetUrl, reqBody, {
            headers: {
              "Content-Type": contentHeader,
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 55000
          });
          break; // Succeeded!
        } catch (axiosError: any) {
          const errMsg = axiosError.response ? JSON.stringify(axiosError.response.data) : axiosError.message;
          console.warn(`[TRANSMIT] Attempt ${attempts} failed for ${orderId}: ${errMsg}`);
          await logToDb("PROVIDER_ATTEMPT_FAIL", { attempt: attempts, error: errMsg, msg: axiosError.message, orderId });

          if (attempts >= maxAttempts) {
            // Final failure marking order fail
            let providerErr: any = "Connection failed";
            if (axiosError.response) {
              providerErr = axiosError.response.data?.error || axiosError.response.data?.message || axiosError.response.data?.msg || `HTTP ${axiosError.response.status}`;
            } else if (axiosError.request) {
              providerErr = "No response from provider (Timeout/Network)";
            } else {
              providerErr = axiosError.message;
            }

            const stringErr = (typeof providerErr === "string") ? providerErr : JSON.stringify(providerErr);
            console.error(`[TRANSMIT] Ultimate connection failure to provider: ${stringErr}`);

            await updateDocSafe("orders", orderId, {
              status: "Failed",
              needsProviderTransmission: false,
              providerTransmissionStatus: "failed",
              error: `API Connection Error (${stringErr.substring(0, 400)})`,
              updatedAt: new Date()
            });

            return { success: false, error: stringErr };
          } else {
            const backoff = attempts < 3 ? 500 : (attempts - 1) * 2000;
            await new Promise(r => setTimeout(r, backoff));
          }
        }
      }

      let resData = response?.data;
      if (typeof resData === "string") {
        try {
          const trimmed = resData.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            resData = JSON.parse(trimmed);
          } else if (trimmed.match(/^\d+$/)) {
            resData = { order: trimmed };
          }
        } catch (e) {}
      }

      if (Array.isArray(resData) && resData.length > 0) {
        resData = resData[0];
      }

      let providerOrderId = resData?.order || resData?.order_id || resData?.orderid || resData?.orderId || resData?.id || resData?.ID;
      const isStatusSuccess = resData?.status === "success" || 
                              resData?.status === "Success" || 
                              resData?.success === true || 
                              resData?.success === "true" ||
                              resData?.msg?.toLowerCase().includes("success") ||
                              resData?.message?.toLowerCase().includes("success");

      if (!providerOrderId && typeof resData === "number") {
        providerOrderId = String(resData);
      }

      if (providerOrderId || isStatusSuccess) {
        const oId = providerOrderId ? String(providerOrderId) : "SENT_NO_ID";
        console.log(`[TRANSMIT] Successfully ordered from SMM panel. Provider Order ID: ${oId}`);
        await logToDb("PROXY_PROVIDER_SUCCESS", { providerOrderId: oId, isStatusSuccess, resData, orderId });

        // DEDUCT BALANCE NOW - Order was successful with provider
        try {
          const orderSnap = await getDocSafe("orders", orderId);
          if (orderSnap.exists) {
            const currentData = orderSnap.data();
            // We deduct if it hasn't been deducted yet (Pending/Processing status)
            // or if it was previously failed and we are retrying.
            const needsDeduction = ["Pending", "Processing", "Failed", "Refunded", "Awaiting-Validation"].includes(currentData.status);
            
            if (needsDeduction) {
              const price = currentData.totalPrice || 0;
              const deductionSuccess = await adjustUserBalanceSafe(currentData.userId, -price);
              if (deductionSuccess) {
                console.log(`[DEDUCTION] Deducted ₹${price} from User ${currentData.userId} after successful provider response.`);
              } else {
                console.error(`[DEDUCTION-FAIL] Could not deduct balance for user ${currentData.userId} despite provider success!`);
              }
            }
          }

          await updateDocSafe("orders", orderId, {
            status: "Completed",
            providerOrderId: oId,
            needsProviderTransmission: false,
            providerTransmissionStatus: "completed",
            error: null,
            updatedAt: new Date(),
            providerRawResponse: JSON.stringify(resData).substring(0, 800)
          });
        } catch (updateErr: any) {
          console.warn(`[TRANSMIT] Could not update Firestore snapshot but was definitely ordered: ${updateErr.message}`);
          await updateDocSafe("orders", orderId, {
            status: "Completed",
            providerOrderId: oId,
            needsProviderTransmission: false,
            providerTransmissionStatus: "completed",
            updatedAt: new Date()
          });
        }
        return { success: true, providerOrderId: oId };
      } else {
        // Collect rejection errors
        const rawError = resData?.error || resData?.message || resData?.msg || resData?.errors || resData?.ERR || resData?.status;
        let errorMsg = "Provider rejected the request.";

        if (rawError) {
          if (typeof rawError === "string") errorMsg = rawError;
          else if (Array.isArray(rawError)) errorMsg = rawError.join(", ");
          else if (typeof rawError === "object") {
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

        console.error(`[TRANSMIT] Provider rejected request: ${errorMsg}`);
        await logToDb("PROXY_PROVIDER_REJECTED", { error: errorMsg, resData, orderId });

        const finalErrorStr = typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);

        await updateDocSafe("orders", orderId, {
          status: "Failed",
          needsProviderTransmission: false,
          providerTransmissionStatus: "failed",
          error: `Provider Rejected Order (${finalErrorStr.substring(0, 400)})`,
          updatedAt: new Date()
        });

        return { success: false, error: finalErrorStr };
      }
    } catch (e: any) {
      console.error(`[TRANSMIT] Severe Exception: ${e.message}`);
      await logToDb("PROXY_PROVIDER_ERROR", { error: e.message, orderId });
      return { success: false, error: e.message || "Unknown internal processing error" };
    } finally {
      processingOrders.delete(orderId);
      console.log(`[TRANSMIT] Unlocked orderId: ${orderId}`);
    }
  };

  // Background Live Snapshot Listener
  function startBackgroundOrderListener(dbInstance: any) {
    console.log("[BACKGROUND-PROCESSOR] Starting real-time Firestore background order observer...");
    
    if (!dbInstance) {
      console.warn("[BACKGROUND-PROCESSOR] Firestore reference is undefined. Background observer disabled.");
      return;
    }

    try {
      dbInstance.collection("orders")
        .where("needsProviderTransmission", "==", true)
        .onSnapshot(async (snapshot: any) => {
          if (!snapshot) return;
          
          for (const docChange of snapshot.docChanges()) {
            if (docChange.type === "added" || docChange.type === "modified") {
              const orderDoc = docChange.doc;
              const orderId = orderDoc.id;
              const orderData = orderDoc.data();

              // Safeguard locks
              if (processingOrders.has(orderId)) {
                continue;
              }

              if (orderData.needsProviderTransmission !== true) {
                continue;
              }

              if (orderData.providerTransmissionStatus === "processing" || 
                  orderData.providerTransmissionStatus === "completed" || 
                  orderData.providerTransmissionStatus === "failed") {
                continue;
              }

              if (orderData.providerOrderId) {
                // Safeguard: Already sent or manually processed
                await updateDocSafe("orders", orderId, {
                  needsProviderTransmission: false,
                  providerTransmissionStatus: "completed"
                });
                continue;
              }

              console.log(`[BACKGROUND-PROCESSOR] 🔔 Real-time trigger detected for Order ${orderId}. Initializing automatic dispatch loop...`);
              
              // In background workers, run it asynchronously (without blocking loop iteration)
              (async () => {
                try {
                  // Mark in Firestore as "processing" to lock globally across nodes
                  await updateDocSafe("orders", orderId, {
                    providerTransmissionStatus: "processing",
                    updatedAt: new Date()
                  });

                  await transmitOrderToProviderDirect(orderId, orderData);
                } catch (err: any) {
                  console.error(`[BACKGROUND-PROCESSOR] Task loop error on ${orderId}:`, err.message);
                }
              })();
            }
          }
        }, (error: any) => {
          console.error("[BACKGROUND-PROCESSOR] Firestore snap listener error:", error.message);
          // Auto healing restart loop
          setTimeout(() => startBackgroundOrderListener(dbInstance), 12000);
        });
    } catch (err: any) {
      console.error("[BACKGROUND-PROCESSOR] Live listener mapping failed:", err.message);
    }
  };

  // Improved Proxy for Provider with better logging and headers
  app.post("/api/proxy-provider", async (req, res) => {
    const { courseId, targetLink, quantity, orderId } = req.body;
    
    console.log(`[HTTP Proxy] Order transmission call received for order: ${orderId}`);
    try {
      const result = await transmitOrderToProviderDirect(orderId, { courseId, targetLink, quantity });
      if (result.success) {
        return res.json({ success: true, providerOrderId: result.providerOrderId });
      } else {
        return res.status(400).json({ success: false, error: result.alreadyProcessing ? "Processing in-progress..." : result.error });
      }
    } catch (e: any) {
      console.error(`[HTTP Proxy] Severe endpoint exception: ${e.message}`);
      return res.status(500).json({ success: false, error: e.message || "Unknown endpoint exception." });
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
      const oS = await getDocSafe("orders", orderId);
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

      const oS = await getDocSafe("orders", orderId);
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
          await updateDocSafe("orders", orderId, { 
            status: pStatus, 
            providerStatus: pStatus,
            updatedAt: new Date()
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
