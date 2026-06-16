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

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

async function startServer() {
  console.log("[STARTUP] Initializing server...");
  const app = express();
  
  app.use(express.json({ limit: "50mb" }));
  
  // Enable absolute CORS for custom domains calling this Cloud Run backend
  const corsOptions = {
    origin: (origin, callback) => {
      // Dynamic origin compliance: return the incoming origin directly to allow credentialed share, fallback to true if undefined
      callback(null, origin || true);
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
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions)); // Handle preflight OPTIONS requests explicitly for all routes
  
  // Load Firebase Config
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId } = firebaseConfig;
  const databaseId = (firebaseConfig.firestoreDatabaseId || "").trim() || "(default)";
  const FIREBASE_API_KEY = firebaseConfig.apiKey;
  let isPollingActive = false;

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

  console.log("[STARTUP] Express server started/restarted successfully (0 Firestore writes/reads on boot).");

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
        // If a custom domain like pyaresmmpanel.online or other unique backend is stored, we MUST overwrite it to ACTIVE_BACKEND_URL
        // because custom domains only host static frontends, which cannot receive API requests directly.
        if (data.backendApiUrl !== ACTIVE_BACKEND_URL) {
          await paymentRef.update({ backendApiUrl: ACTIVE_BACKEND_URL });
          console.log(`[INIT] ✅ Successfully updated backendApiUrl from ${data.backendApiUrl || "none"} to stable backend: ${ACTIVE_BACKEND_URL}`);
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
        
        await axios.patch(restUrl, {
          fields: {
            backendApiUrl: { stringValue: ACTIVE_BACKEND_URL }
          }
        }, { timeout: 10000 });
        console.log(`[INIT] ✅ Successfully patched backendApiUrl to ${ACTIVE_BACKEND_URL} via Firestore REST API.`);
      } catch (restErr: any) {
        console.error(`[INIT] ❌ REST patch fallback also failed: ${restErr.response?.data || restErr.message}`);
      }
    }
  };
  
  // Commented out to eliminate Firestore read/write on every container start (optimized for free tier Spark plan)
  // ensureBackendUrlIsSet();
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

    console.log(`[REST-DB] Posting to: ${url.split('?')[0]}`);
    return axios.post(url, { fields }, { headers });
  };

  // Verify DB access on startup and auto-fallback if named DB is restricted/missing
  console.log(`[INIT] Firestore connection verification deferred to run on demand (saves quota reads on start).`);

  // Health check
  app.get("/api/health", (req, res) => res.json({ 
    status: "ok", 
    configProjectId: projectId, 
    configDatabaseId: databaseId || "(default)",
    envProject: process.env.GOOGLE_CLOUD_PROJECT || "not-set",
    envDatabase: process.env.GOOGLE_CLOUD_DATABASE || "not-set",
    hasAdminApp: getApps().length > 0
  }));

  // Aggressive backend-side cache to protect Firestore read limits
  let serverCachedCourses: any[] | null = null;
  let serverCachedCoursesTime = 0;
  let serverCachedSettings: any = null;
  let serverCachedSettingsTime = 0;
  
  const BACKEND_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in-memory cache TTL by default

  // API endpoint to programmatically clear backend cache when an admin updates courses/settings
  app.post("/api/clear-cache", (req, res) => {
    serverCachedCourses = null;
    serverCachedCoursesTime = 0;
    serverCachedSettings = null;
    serverCachedSettingsTime = 0;
    console.log("[SERVER-CACHE] Server-side cache cleared on Admin update request!");
    res.json({ success: true, message: "Server-side cache cleared successfully" });
  });

  // Express API for Courses list with server-side in-memory caching
  app.get("/api/courses", async (req, res) => {
    const now = Date.now();
    if (serverCachedCourses && (now - serverCachedCoursesTime < BACKEND_CACHE_DURATION)) {
      console.log("[SERVER-CACHE] Serving courses from backend memory to save reads");
      return res.json(serverCachedCourses);
    }

    try {
      console.log("[SERVER-DB] Fetching published courses from Firestore to refresh cache...");
      const snapshot = await db.collection("courses")
        .where("status", "==", "published")
        .get();
      
      const courses: any[] = [];
      snapshot.forEach((doc: any) => {
        courses.push({ id: doc.id, ...doc.data() });
      });

      // Sort courses by category priority: Instagram first
      const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
      courses.sort((a: any, b: any) => {
        const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
        const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
        if (orderA !== orderB) return orderA - orderB;
        
        const timeA = a.createdAt?.seconds || a.createdAt?._seconds || 0;
        const timeB = b.createdAt?.seconds || b.createdAt?._seconds || 0;
        return timeB - timeA;
      });

      serverCachedCourses = courses;
      serverCachedCoursesTime = now;
      res.json(courses);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching courses from database via SDK:", err.message);
      
      try {
        console.log("[SERVER-REST] SDK Failed. Falling back to secure REST query for published courses...");
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents:runQuery?key=${FIREBASE_API_KEY}`;
        
        const queryPayload = {
          structuredQuery: {
            from: [{ collectionId: "courses" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "status" },
                op: "EQUAL",
                value: { stringValue: "published" }
              }
            }
          }
        };

        const response = await axios.post(runQueryUrl, queryPayload, { timeout: 10000 });
        const courses: any[] = [];
        
        if (response.data && Array.isArray(response.data)) {
          response.data.forEach((item: any) => {
            if (item.document && item.document.name) {
              const docName = item.document.name;
              const courseId = docName.split("/").pop();
              if (courseId) {
                courses.push({
                  id: courseId,
                  ...unwrapRestFields(item.document.fields || {})
                });
              }
            }
          });
        }
        
        // Sort courses by category priority: Instagram first
        const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
        courses.sort((a: any, b: any) => {
          const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
          const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
          if (orderA !== orderB) return orderA - orderB;
          
          const timeA = a.createdAt?.seconds || a.createdAt?._seconds || 0;
          const timeB = b.createdAt?.seconds || b.createdAt?._seconds || 0;
          return timeB - timeA;
        });

        serverCachedCourses = courses;
        serverCachedCoursesTime = now;
        return res.json(courses);
      } catch (restErr: any) {
        console.error("[SERVER-REST] Terminal error fetching courses via REST API:", restErr.message);
      }

      if (serverCachedCourses) {
        console.log("[SERVER-CACHE] Fallback to stale courses cache on DB error");
        return res.json(serverCachedCourses);
      }
      res.status(500).json({ error: "Failed to fetch courses of panel" });
    }
  });

  // Express API for Settings with server-side in-memory caching
  app.get("/api/settings", async (req, res) => {
    const now = Date.now();
    if (serverCachedSettings && (now - serverCachedSettingsTime < BACKEND_CACHE_DURATION)) {
      console.log("[SERVER-CACHE] Serving settings from backend memory to save reads");
      return res.json(serverCachedSettings);
    }

    try {
      console.log("[SERVER-DB] Fetching settings/payment from Firestore to refresh cache...");
      const snap = await getDocSafe("settings", "payment");
      
      let settingsData = {};
      if (snap.exists) {
        settingsData = snap.data() || {};
      }

      serverCachedSettings = settingsData;
      serverCachedSettingsTime = now;
      res.json(settingsData);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching settings from database:", err.message);
      if (serverCachedSettings) {
        console.log("[SERVER-CACHE] Fallback to stale settings cache on DB error");
        return res.json(serverCachedSettings);
      }
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Temporary developer debug endpoint to inspect orders and provider responses
  app.get("/api/debug-orders", async (req, res) => {
    try {
      console.log("[DEBUG] Fetching last 15 orders for diagnostic purposes...");
      let ordersList: any[] = [];
      try {
        const snapshot = await db.collection("orders")
          .orderBy("createdAt", "desc")
          .limit(15)
          .get();
        
        snapshot.forEach((doc: any) => {
          const data = doc.data();
          if (data.isSyslog !== true) {
            ordersList.push({
              id: doc.id,
              userId: data.userId,
              courseTitle: data.courseTitle,
              quantity: data.quantity,
              totalPrice: data.totalPrice,
              status: data.status,
              providerOrderId: data.providerOrderId,
              providerTransmissionStatus: data.providerTransmissionStatus,
              error: data.error,
              createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate() : data.createdAt) : null,
              providerRawResponse: data.providerRawResponse ? data.providerRawResponse.substring(0, 150) : null
            });
          }
        });
      } catch (sdkErr: any) {
        console.warn(`[DEBUG-ORDERS] SDK path failed, falling back to REST: ${sdkErr.message}`);
        const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
        const restUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/orders?key=${FIREBASE_API_KEY}&pageSize=50`;
        const restRes = await axios.get(restUrl);
        const docs = restRes.data.documents || [];
        
        const rawOrders = docs.map((d: any) => {
          const fields = d.fields || {};
          const id = d.name.split("/").pop();
          const isSys = fields.isSyslog?.booleanValue;
          const createdAtVal = fields.createdAt?.timestampValue || fields.createdAt?.stringValue;
          return {
            id,
            isSyslog: isSys === true,
            userId: fields.userId?.stringValue,
            courseTitle: fields.courseTitle?.stringValue,
            quantity: fields.quantity?.integerValue ? parseInt(fields.quantity.integerValue) : (fields.quantity?.doubleValue ? parseFloat(fields.quantity.doubleValue) : null),
            totalPrice: fields.totalPrice?.integerValue ? parseInt(fields.totalPrice.integerValue) : (fields.totalPrice?.doubleValue ? parseFloat(fields.totalPrice.doubleValue) : null),
            status: fields.status?.stringValue,
            providerOrderId: fields.providerOrderId?.stringValue,
            providerTransmissionStatus: fields.providerTransmissionStatus?.stringValue,
            error: fields.error?.stringValue,
            createdAt: createdAtVal ? new Date(createdAtVal) : null,
            providerRawResponse: fields.providerRawResponse?.stringValue ? fields.providerRawResponse.stringValue : null
          };
        }).filter((o: any) => !o.isSyslog);

        // Sort in memory
        rawOrders.sort((a: any, b: any) => {
          const tA = a.createdAt ? a.createdAt.getTime() : 0;
          const tB = b.createdAt ? b.createdAt.getTime() : 0;
          return tB - tA;
        });

        ordersList = rawOrders.slice(0, 15);
      }
      res.json({ success: true, count: ordersList.length, orders: ordersList });
    } catch (e: any) {
      console.error("[DEBUG] Error fetching orders debug data:", e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  });

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

      // Check if Admin has enabled Auto-Approve Deposits
      const sS = await getDocSafe("settings", "payment");
      const paymentSettings = sS.exists ? sS.data() : {};
      const autoApprove = paymentSettings.autoApproveDeposits === true;

      if (autoApprove) {
        // Create an already-approved deposit entry
        const depId = await addDocSafe("deposits", {
          userId, 
          userEmail: userEmail || "not-provided", 
          amount: Number(amount), 
          utr: cleanUtr, 
          screenshotUrl: screenshotUrl || "", 
          status: "approved", 
          createdAt: new Date(),
          updatedAt: new Date(),
          processedBy: "instant-auto-approval",
          source: "rest-safe-manual-instant"
        });

        if (depId) {
          // Immediately adjust user balance
          const balanceAdjusted = await adjustUserBalanceSafe(userId, Number(amount));
          if (balanceAdjusted) {
            console.log(`[DEPOSIT] Instant auto-approved & balance adjusted for User=${userId} by ₹${amount}`);
            res.json({ success: true, isAutoApproved: true });
          } else {
            console.error(`[DEPOSIT] Instant auto-approval wrote deposit ${depId} but failed to adjust balance for User=${userId}!`);
            res.json({ success: true, isAutoApproved: true, warning: "Balance update delayed" });
          }
        } else {
          throw new Error("Failed to write manual deposit to database.");
        }
      } else {
        // Fallback to standard pending deposit
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
          res.json({ success: true, isAutoApproved: false });
        } else {
          throw new Error("Failed to write manual deposit to database.");
        }
      }
    } catch (e: any) {
      console.error(`[DEPOSIT] Error submitting manual deposit: ${e.message}`);
      res.status(500).json({ error: e.message || "Failed to submit request." });
    }
  });

  // Automatic SMS/UPI Webhook for Android SMS Forwarder Integration
  app.post("/api/webhooks/sms-gateway", async (req, res) => {
    try {
      const querySecret = req.query.secret;
      const bodySecret = req.body?.secret;
      const expectedSecret = process.env.SMS_WEBHOOK_SECRET || "secure_sms_gateway_pwd_2026";

      if (querySecret !== expectedSecret && bodySecret !== expectedSecret) {
        console.warn("[SMS-WEBHOOK] Unauthorized access attempt detected. Secrets did not match.");
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid secret key." });
      }

      // Read text message body from the forwarded body
      // Standard SMS forwarder keys are: 'message' / 'text' / 'body' / 'msg' / 'content'
      const text = String(req.body?.text || req.body?.message || req.body?.body || req.body?.msg || req.body?.content || "").trim();
      const from = String(req.body?.from || req.body?.sender || req.body?.phone || "UNKNOWN").trim();

      console.log(`[SMS-WEBHOOK] Received forwarded SMS from: ${from}. Content: "${text}"`);

      if (!text) {
        return res.status(400).json({ success: false, error: "Empty message text." });
      }

      // 1. Parse UTR: Find all distinct sequences of exactly 12 contiguous digits.
      // E.g., 'UPI616880951111' -> '616880951111'.
      // This is extremely robust and bypasses \b word boundary limitations.
      const digitSequences = text.match(/\d+/g) || [];
      const candidateUtrs = Array.from(new Set(digitSequences.filter(seq => seq.length === 12)));

      console.log(`[SMS-WEBHOOK] Extracted candidate UTRs: ${JSON.stringify(candidateUtrs)}`);

      if (candidateUtrs.length === 0) {
        console.log("[SMS-WEBHOOK] Could not parse any 12-digit UTR from the SMS. Skipping automatic deposit.");
        return res.json({ 
          success: false, 
          message: "Parsed successfully but no 12-digit sequence found in details.", 
          detectedUtr: null 
        });
      }

      // 2. Parse Amount (Indian Rupees Format Rs, Rs., INR, ₹, etc., handling possible commas like 2,500.00)
      const cleanText = text.replace(/,/g, "");
      const amountMatch = cleanText.match(/(?:Rs\.?|INR|₹|amount of|Rs)\s*(\d+(?:\.\d{1,2})?)/i) || 
                          cleanText.match(/credited with\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i) ||
                          cleanText.match(/credited by\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i) ||
                          cleanText.match(/rec(?:eive|eived)\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
      
      const parsedAmount = amountMatch ? parseFloat(amountMatch[1]) : null;
      console.log(`[SMS-WEBHOOK] Extracted amount: ${parsedAmount}`);

      // 3. Find matching pending manual deposit in Firestore
      let depData: any = null;
      let depositId: string = "";
      let matchedUtr: string = "";

      // Loop through all candidate UTRs to find a match in Firestore
      for (const candidateUtr of candidateUtrs) {
        try {
          const depositsRef = db.collection("deposits");
          const querySnap = await depositsRef.where("utr", "==", candidateUtr).where("status", "==", "pending").get();
          if (!querySnap.empty) {
            const depDoc = querySnap.docs[0];
            depData = depDoc.data();
            depositId = depDoc.id;
            matchedUtr = candidateUtr;
            break; // Found matching pending deposit!
          }
        } catch (sdkErr: any) {
          console.warn(`[SMS-WEBHOOK] SDK Query failed for UTR ${candidateUtr}, trying REST fallback: ${sdkErr.message}`);
          try {
            const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
            const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents:runQuery?key=${FIREBASE_API_KEY}`;
            
            const queryPayload = {
              structuredQuery: {
                from: [{ collectionId: "deposits" }],
                where: {
                  compositeFilter: {
                    op: "AND",
                    filters: [
                      {
                        fieldFilter: {
                          field: { fieldPath: "utr" },
                          op: "EQUAL",
                          value: { stringValue: candidateUtr }
                        }
                      },
                      {
                        fieldFilter: {
                          field: { fieldPath: "status" },
                          op: "EQUAL",
                          value: { stringValue: "pending" }
                        }
                      }
                    ]
                  }
                }
              }
            };

            const response = await axios.post(runQueryUrl, queryPayload, { timeout: 10000 });
            if (response.data && Array.isArray(response.data) && response.data.length > 0 && response.data[0].document) {
              const doc = response.data[0].document;
              const nameParts = doc.name.split("/");
              depositId = nameParts[nameParts.length - 1];
              depData = unwrapRestFields(doc.fields || {});
              matchedUtr = candidateUtr;
              break; // Found matching pending deposit!
            }
          } catch (restErr: any) {
            console.error(`[SMS-WEBHOOK] REST fallback query failed for UTR ${candidateUtr}:`, restErr.message);
          }
        }
      }

      if (!depData || !depositId) {
        console.warn(`[SMS-WEBHOOK] No pending deposit matching any extracted UTRs ${JSON.stringify(candidateUtrs)} was found in the system.`);
        return res.json({ 
          success: false, 
          message: `Parsed UTRs ${JSON.stringify(candidateUtrs)} successfully, but no matching pending deposit found in database.`,
          candidateUtrs,
          parsedAmount
        });
      }

      const utr = matchedUtr;
      const originalAmount = Number(depData.amount || 0);
      console.log(`[SMS-WEBHOOK] Found matching pending deposit ${depositId} of amount ₹${originalAmount} for userId: ${depData.userId} using matched UTR: ${utr}`);

      // 4. Update the user balance & deposit status in a robust transaction
      let updateSuccess = false;
      try {
        await db.runTransaction(async (transaction: any) => {
          const userRef = db.collection("users").doc(depData.userId);
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists) throw new Error("User profile not found in system.");

          const currentBalance = Number(userSnap.data().balance || 0);
          
          // Update user balance
          transaction.update(userRef, { 
            balance: currentBalance + originalAmount, 
            updatedAt: new Date() 
          });

          // Approve the deposit
          const depositRef = db.collection("deposits").doc(depositId);
          transaction.update(depositRef, { 
            status: "approved", 
            updatedAt: new Date(),
            processedBy: "automatic-sms-gateway",
            actualSmsAmount: parsedAmount
          });
        });
        updateSuccess = true;
        console.log(`[SMS-WEBHOOK] Approved deposit via SDK Transaction`);
      } catch (txnErr: any) {
        console.warn(`[SMS-WEBHOOK] SDK Transaction failed (${txnErr.message}). Falling back to separate REST operations...`);
        
        // adjust user balance safely using REST
        const adjusted = await adjustUserBalanceSafe(depData.userId, originalAmount);
        if (adjusted) {
          // approve deposit using REST
          const approved = await updateDocSafe("deposits", depositId, {
            status: "approved",
            updatedAt: new Date(),
            processedBy: "automatic-sms-gateway-rest-fallback",
            actualSmsAmount: parsedAmount
          });
          if (approved) {
            updateSuccess = true;
            console.log(`[SMS-WEBHOOK] Approved deposit via REST Safe Operations`);
          } else {
            console.error(`[SMS-WEBHOOK] ❌ SYSTEM INCONSISTENCY: Balance was adjusted for user ${depData.userId} by ₹${originalAmount}, but we failed to update deposit ${depositId} status!`);
          }
        } else {
          console.error(`[SMS-WEBHOOK] ❌ REST balance adjustment failed for user ${depData.userId}`);
        }
      }

      if (updateSuccess) {
        console.log(`[SMS-WEBHOOK] ✅ Payment of ₹${originalAmount} automatically approved for User ${depData.userId} via UTR: ${utr}`);
        return res.json({ 
          success: true, 
          message: "Payment successfully parsed and automatically approved.", 
          utr, 
          originalAmount, 
          userId: depData.userId 
        });
      } else {
        throw new Error("Transacting balance update failed.");
      }

    } catch (err: any) {
      console.error("[SMS-WEBHOOK] Transaction / system error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
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
      // 0. Resolve orderData or fallback to Firestore fetch to avoid redundant DB reads
      let currentOrderData = orderData;
      if (!currentOrderData || !currentOrderData.userId || !currentOrderData.courseId) {
        console.log(`[TRANSMIT] Fetching order document ${orderId} from Firestore (slow path fallback)`);
        const snapObj = await getDocSafe("orders", orderId);
        if (!snapObj.exists) throw new Error("Order not found");
        currentOrderData = snapObj.data() || {};
        
        if (currentOrderData.providerOrderId) {
          console.log(`[TRANSMIT] Order ${orderId} already has providerOrderId registered: ${currentOrderData.providerOrderId}`);
          return { success: true, providerOrderId: currentOrderData.providerOrderId };
        }
        if (currentOrderData.providerTransmissionStatus === "completed") {
          console.log(`[TRANSMIT] Order ${orderId} transmission was already completed.`);
          return { success: true, providerOrderId: currentOrderData.providerOrderId || "SENT" };
        }
      }

      const orderAmount = Number(currentOrderData.totalPrice || 0);
      const courseId = currentOrderData.courseId;
      const userId = currentOrderData.userId;
      const targetLink = currentOrderData.targetLink || "";
      const quantity = currentOrderData.quantity;

      if (!courseId) {
        throw new Error("Missing required field: courseId");
      }

      // 1. Fetch User, Course details, and general Payment Settings IN PARALLEL (FAST PATH)
      console.log(`[TRANSMIT] Retrieving User, Course, and Settings in parallel for order ${orderId}`);
      const [userSnap, cS, sS] = await Promise.all([
        getDocSafe("users", userId),
        getDocSafe("courses", courseId),
        getDocSafe("settings", "payment")
      ]);

      if (!userSnap.exists) throw new Error("User profile not found");
      const userBalance = Number(userSnap.data().balance || 0);

      if (userBalance < orderAmount) {
        throw new Error(`Insufficient balance (Current: ₹${userBalance}, Required: ₹${orderAmount}). Order rejected.`);
      }

      if (!cS || !cS.exists) {
        throw new Error(`Service configuration with ID "${courseId}" does not exist in the database.`);
      }
      const c = cS.data();

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
      const maxAttempts = 2;

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
            timeout: 12000
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
              const rData = axiosError.response.data;
              if (rData) {
                if (typeof rData === "string") {
                  const trimmed = rData.trim();
                  if (trimmed.startsWith("<") || trimmed.includes("<!DOCTYPE") || trimmed.includes("<html") || trimmed.includes("<body")) {
                    providerErr = `HTTP ${axiosError.response.status} (Provider backend blocking / server configuration issue. Often caused by Cloudflare anti-bot checks)`;
                  } else {
                    providerErr = trimmed.substring(0, 200);
                  }
                } else if (typeof rData === "object" && rData !== null) {
                  providerErr = rData.error || rData.message || rData.msg || rData.errors || rData.reason || rData.error_message || JSON.stringify(rData);
                } else {
                  providerErr = `HTTP ${axiosError.response.status}`;
                }
              } else {
                providerErr = `HTTP ${axiosError.response.status}`;
              }
            } else if (axiosError.request) {
              providerErr = "No response from provider (Timeout/Network failure)";
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
        const rawError = resData?.error || resData?.message || resData?.msg || resData?.errors || resData?.ERR || resData?.status || resData?.reason || resData?.error_message || resData?.msg_error;
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
        } else if (typeof resData === "string" && resData.trim().length > 0) {
          errorMsg = resData.trim();
        } else if (typeof resData === "object" && resData !== null) {
          errorMsg = JSON.stringify(resData);
        }

        console.error(`[TRANSMIT] Provider rejected request: ${errorMsg}`);
        await logToDb("PROXY_PROVIDER_REJECTED", { error: errorMsg, resData, orderId });

        let finalErrorStr = typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);
        
        if (finalErrorStr.toLowerCase().includes("incorrect api key") || finalErrorStr.toLowerCase().includes("user disabled")) {
          finalErrorStr = "SMM Panel API credentials (API Key) are incorrect or your account/user is disabled on the SMM vendor panel. Please contact the admin/owner to update their provider credentials.";
        }

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

  // Secure REST Polling Loop Fallback to fetch pending orders securely using public key credentials
  async function startRESTBackupPollingLoop() {
    if (isPollingActive) return;
    isPollingActive = true;
    console.log(`[BACKGROUND-PROCESSOR] [REST-POLL] Initiating failsafe REST-based polling query loop...`);

    const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
    const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents:runQuery?key=${FIREBASE_API_KEY}`;

    setInterval(async () => {
      try {
        const queryPayload = {
          structuredQuery: {
            from: [{ collectionId: "orders" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "needsProviderTransmission" },
                op: "EQUAL",
                value: { booleanValue: true }
              }
            }
          }
        };

        const response = await axios.post(runQueryUrl, queryPayload, { timeout: 8000 });
        if (!response.data || !Array.isArray(response.data)) return;

        for (const item of response.data) {
          if (!item.document || !item.document.name) continue;
          
          const docName = item.document.name;
          const orderId = docName.split("/").pop();
          if (!orderId) continue;

          // Check memory lock
          if (processingOrders.has(orderId)) continue;

          const rawFields = item.document.fields || {};
          const orderData = unwrapRestFields(rawFields);

          if (orderData.needsProviderTransmission !== true) continue;

          if (orderData.providerTransmissionStatus === "processing" || 
              orderData.providerTransmissionStatus === "completed" || 
              orderData.providerTransmissionStatus === "failed") {
            continue;
          }

          if (orderData.providerOrderId) {
            await updateDocSafe("orders", orderId, {
              needsProviderTransmission: false,
              providerTransmissionStatus: "completed"
            });
            continue;
          }

          console.log(`[REST-POLL] 🔔 Pending custom-domain order ${orderId} detected via secure REST Firestore poller! Initiating automatic dispatch...`);

          (async () => {
            try {
              await updateDocSafe("orders", orderId, {
                providerTransmissionStatus: "processing",
                updatedAt: new Date()
              });

              await transmitOrderToProviderDirect(orderId, orderData);
            } catch (err: any) {
              console.error(`[REST-POLL] Task dispatcher error on ${orderId}:`, err.message);
            }
          })();
        }
      } catch (err: any) {
        console.error(`[BACKGROUND-PROCESSOR] [REST-POLL] Polling loop query failed: ${err.message}`);
      }
    }, 300000); // Check every 300 seconds (5 minutes). Primary listener uses direct HTTP api POST, so backup can be extremely lightweight and save reads!
  }

  // Background Live Snapshot Listener (Optimized for Spark Free tier - Deactivated real-time SDK listener to prevent permission-denied retry loop reads spam)
  function startBackgroundOrderListener(dbInstance: any) {
    console.log("[BACKGROUND-PROCESSOR] Initializing lightweight order manager background scheduler...");
    
    // REST Polling Backup loop activated as a solid, database-optimized failsafe (Runs once every 5 minutes)
    startRESTBackupPollingLoop();

    console.log("[BACKGROUND-PROCESSOR] In-memory orders scheduler active. SDK onSnapshot stream remains disabled to prevent credential block retries.");
  }

  // Improved Proxy for Provider with better logging and headers
  app.post("/api/proxy-provider", async (req, res) => {
    try {
      const { 
        userId, 
        userEmail, 
        courseId, 
        courseTitle, 
        category, 
        quantity, 
        targetLink, 
        totalPrice,
        orderId: passedOrderId
      } = req.body;

      let orderId = passedOrderId;

      // Check if this is a DIRECT Synchronous order creation request (contains userId & totalPrice)
      if (userId && totalPrice !== undefined) {
        orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        console.log(`[HTTP Direct Order] Creating synchronous order ${orderId} for user ${userId} and course ${courseId}`);

        // 1. Create order document first so transit methods can read/update it
        const orderData = {
          userId,
          userEmail: userEmail || "",
          courseId,
          courseTitle: courseTitle || "",
          category: category || "Other",
          quantity: Number(quantity),
          targetLink: targetLink.trim(),
          totalPrice: Number(totalPrice),
          status: "Pending",
          createdAt: new Date(),
          needsProviderTransmission: false,
          providerTransmissionStatus: "pending"
        };

        const createSuccess = await setDocSafe("orders", orderId, orderData);
        if (!createSuccess) {
          return res.status(500).json({ success: false, error: "Failed to initialize order record in database" });
        }
      }

      if (!orderId) {
        return res.status(400).json({ success: false, error: "Missing orderId or order parameters." });
      }

      console.log(`[HTTP Proxy] Order transmission call received for order: ${orderId}`);
      const payloadData = {
        userId,
        userEmail: userEmail || "",
        courseId,
        courseTitle: courseTitle || "",
        category: category || "Other",
        quantity: Number(quantity),
        targetLink: targetLink?.trim() || "",
        totalPrice: Number(totalPrice),
        status: "Pending"
      };
      const result = await transmitOrderToProviderDirect(orderId, payloadData);
      if (result.success) {
        return res.json({ success: true, providerOrderId: result.providerOrderId, orderId });
      } else {
        return res.status(400).json({ success: false, error: result.alreadyProcessing ? "Processing in-progress..." : result.error, orderId });
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
