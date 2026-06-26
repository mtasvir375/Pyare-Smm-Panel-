import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import https from "https";
import http from "http";

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// Initialize shared SMM Panel connection agents to reuse TCP and SSL sockets for maximum performance
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  keepAliveMsecs: 30000,
  timeout: 15000,
});

const keepAliveHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  keepAliveMsecs: 30000,
  timeout: 15000,
});

// Configure Axios defaults to use keep-alive by default for all requests
axios.defaults.httpsAgent = keepAliveAgent;
axios.defaults.httpAgent = keepAliveHttpAgent;


// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseId: "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c"
    } as any);
    console.log("[FIREBASE] Admin SDK initialized with default credentials.");
  } catch (error) {
    // Fallback for local development if applicationDefault fails
    admin.initializeApp({
      projectId: "gen-lang-client-0629912823",
      databaseId: "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c"
    } as any);
    console.log("[FIREBASE] Admin SDK initialized with project ID fallback.");
  }
}

const fdb = getFirestore(admin.apps[0] || admin.app(), "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c");

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const app = express();
export default app;

async function startServer() {
  console.log("[STARTUP] Initializing server...");
  
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
  
  // Storage for basic app config that doesn't change often
  const serverCache = {
    settings: null as any,
    courses: new Map<string, any>(),
    providers: new Map<string, any>(),
  };

  // Load Firebase Config to provide direct REST Client Web API Key bypass on permission issues
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId, apiKey } = firebaseConfig;
  const dbId = firebaseConfig.firestoreDatabaseId || "(default)";

  let useRestFallback = false;

  // Helper to wrap REST fields
  function wrapRestFields(obj: any): any {
    const fields: any = {};
    for (const key in obj) {
      const val = obj[key];
      if (val === undefined || val === null) continue;
      
      if (typeof val === "string") {
        fields[key] = { stringValue: val };
      } else if (typeof val === "number") {
        if (Number.isInteger(val)) {
          fields[key] = { integerValue: String(val) };
        } else {
          fields[key] = { doubleValue: val };
        }
      } else if (typeof val === "boolean") {
        fields[key] = { booleanValue: val };
      } else if (val instanceof Date) {
        fields[key] = { timestampValue: val.toISOString() };
      } else if (typeof val === "object") {
        if (Array.isArray(val)) {
          const values: any[] = [];
          for (const item of val) {
            if (typeof item === "string") values.push({ stringValue: item });
            else if (typeof item === "number") values.push(Number.isInteger(item) ? { integerValue: String(item) } : { doubleValue: item });
            else if (typeof item === "boolean") values.push({ booleanValue: item });
          }
          fields[key] = { arrayValue: { values } };
        } else {
          fields[key] = { mapValue: { fields: wrapRestFields(val) } };
        }
      }
    }
    return fields;
  }

  // Helper to unwrap REST fields
  function unwrapRestFields(fields: any): any {
    const result: any = {};
    if (!fields) return result;
    for (const key in fields) {
      const val = fields[key];
      if (!val) continue;
      if (val.stringValue !== undefined) result[key] = val.stringValue;
      else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue, 10);
      else if (val.doubleValue !== undefined) result[key] = parseFloat(val.doubleValue);
      else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
      else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
      else if (val.arrayValue !== undefined) {
        const vals = val.arrayValue.values || [];
        result[key] = vals.map((v: any) => {
          if (v.stringValue !== undefined) return v.stringValue;
          if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
          if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
          if (v.booleanValue !== undefined) return v.booleanValue;
          return null;
        });
      } else if (val.mapValue !== undefined) {
        result[key] = unwrapRestFields(val.mapValue.fields || {});
      }
    }
    return result;
  }

  const getDocREST = async (collect: string, id: string) => {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}`;
      const res = await axios.get(url, { timeout: 10000 });
      if (res.data && res.data.fields) {
        const data = unwrapRestFields(res.data.fields);
        return { exists: true, data: () => data };
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.warn(`[REST-GET-ERR] Failed REST get for ${collect}/${id}:`, err.response?.data || err.message);
      }
    }
    return { exists: false, data: () => null };
  };

  const setDocREST = async (collect: string, id: string, data: any) => {
    try {
      const dataWithTime = {
        ...data,
        updatedAt: new Date().toISOString()
      };
      const keys = Object.keys(dataWithTime);
      const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
      
      const fields = wrapRestFields(dataWithTime);
      const res = await axios.patch(url, { fields }, { timeout: 10000 });
      return !!res.data;
    } catch (err: any) {
      console.error(`[REST-SET-ERR] Failed REST set for ${collect}/${id}:`, err.response?.data || err.message);
      return false;
    }
  };

  const updateDocREST = async (collect: string, id: string, data: any) => {
    try {
      const keys = Object.keys(data);
      if (keys.length === 0) return true;
      
      const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
      
      const fields = wrapRestFields(data);
      const res = await axios.patch(url, { fields }, { timeout: 10000 });
      return !!res.data;
    } catch (err: any) {
      console.error(`[REST-UPDATE-ERR] Failed REST update for ${collect}/${id}:`, err.response?.data || err.message);
      return false;
    }
  };

  const addDocREST = async (collect: string, data: any) => {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}?key=${apiKey}`;
      const fields = wrapRestFields({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const res = await axios.post(url, { fields }, { timeout: 10000 });
      if (res.data && res.data.name) {
        return res.data.name.split("/").pop();
      }
    } catch (err: any) {
      console.error(`[REST-ADD-ERR] Failed REST add to ${collect}:`, err.response?.data || err.message);
    }
    return null;
  };

  const runQueryREST = async (queryPayload: any) => {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
      const res = await axios.post(url, queryPayload, { timeout: 10000 });
      if (res.data && Array.isArray(res.data)) {
        return res.data
          .filter((item: any) => item.document)
          .map((item: any) => {
            const doc = item.document;
            const id = doc.name.split("/").pop();
            const fields = unwrapRestFields(doc.fields || {});
            return {
              id,
              exists: true,
              data: () => fields
            };
          });
      }
    } catch (err: any) {
      console.error("[REST-QUERY-ERR] Run query failed:", err.response?.data || err.message);
    }
    return [];
  };

  const findDepositByUtrREST = async (utr: string, status?: string) => {
    const filters: any[] = [
      {
        fieldFilter: {
          field: { fieldPath: "utr" },
          op: "EQUAL",
          value: { stringValue: utr }
        }
      }
    ];
    if (status) {
      filters.push({
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: status }
        }
      });
    }

    const payload = {
      structuredQuery: {
        from: [{ collectionId: "deposits" }],
        where: status ? {
          andFilter: { filters }
        } : filters[0],
        limit: 1
      }
    };
    return runQueryREST(payload);
  };

  const adjustUserBalanceREST = async (user_id: string, change: number) => {
    console.log(`[BALANCE-REST] Adjusting balance for ${user_id} by ${change}`);
    try {
      const userRef = await getDocREST("users", user_id);
      if (!userRef.exists) throw new Error("User not found");
      
      const userData = userRef.data();
      const currentBalance = Number(userData?.balance || 0);
      const newBalance = Number((currentBalance + change).toFixed(2));
      
      const success = await setDocREST("users", user_id, {
        ...userData,
        balance: newBalance,
        updatedAt: new Date().toISOString()
      });
      return success;
    } catch (err: any) {
      console.error(`[BALANCE-REST] Error: ${err.message}`);
      return false;
    }
  };

  // Startup permissions test to enable automatic Firestore REST fallback before handling requests
  try {
    console.log("[STARTUP] Testing Firebase Admin SDK permissions...");
    await fdb.collection("settings").doc("payment").get();
    console.log("[STARTUP] Firebase Admin SDK permissions checked successfully!");
  } catch (err: any) {
    if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
      console.warn(`[STARTUP] Firebase Admin SDK is unauthorized (PERMISSION_DENIED).`);
      console.warn("[STARTUP] >>> AUTOMATIC ACTIVE FIRESTORE REST FALLBACK OVERRIDE TURNED ON <<<");
      useRestFallback = true;
    } else {
      console.warn(`[STARTUP] Firebase Admin SDK test returned non-permission warning: ${err.message}`);
    }
  }

  // Firebase-Firestore Helpers that replace Supabase ones
  const getDocSafe = async (collect: string, id: string) => {
    const now = Date.now();
    
    // 10 minutes in-memory caching to reduce checkout latency and Firestore read costs
    const CACHE_TTL = 600000; 

    if (collect === "settings" && id === "payment" && serverCache.settings && now - serverCache.settings.time < CACHE_TTL) {
      return { exists: true, data: () => serverCache.settings.data };
    }
    if (collect === "courses" && id && serverCache.courses && serverCache.courses.has(id)) {
      const cached = serverCache.courses.get(id);
      if (now - cached.time < CACHE_TTL) {
        return { exists: true, data: () => cached.data };
      }
    }
    if (collect === "providers" && id && serverCache.providers && serverCache.providers.has(id)) {
      const cached = serverCache.providers.get(id);
      if (now - cached.time < CACHE_TTL) {
        return { exists: true, data: () => cached.data };
      }
    }

    let result = { exists: false, data: () => null as any };

    if (!useRestFallback) {
      try {
        const snap = await fdb.collection(collect).doc(id).get();
        if (snap.exists) {
          const data = snap.data();
          result = { exists: true, data: () => data };
        }
      } catch (err: any) {
        console.warn(`[FIREBASE-GET] Failed for ${collect}/${id}: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        }
      }
    }

    if (useRestFallback || !result.exists) {
      result = await getDocREST(collect, id);
    }

    // Cache the successful read result
    if (result.exists) {
      const data = result.data();
      if (collect === "settings" && id === "payment") {
        serverCache.settings = { data, time: now };
      } else if (collect === "courses" && id) {
        serverCache.courses.set(id, { data, time: now });
      } else if (collect === "providers" && id) {
        serverCache.providers.set(id, { data, time: now });
      }
    }

    return result;
  };

  const updateDocSafe = async (col: string, id: string, data: any) => {
    if (!useRestFallback) {
      try {
        await fdb.collection(col).doc(id).update({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      } catch (err: any) {
        console.warn(`[FIREBASE-UPDATE] Error updating ${col}/${id}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        } else {
          return false;
        }
      }
    }

    return updateDocREST(col, id, data);
  };

  const setDocSafe = async (col: string, id: string, data: any) => {
    if (!useRestFallback) {
      try {
        await fdb.collection(col).doc(id).set({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return true;
      } catch (err: any) {
        console.warn(`[FIREBASE-SET] Error upserting ${col}/${id}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        } else {
          return false;
        }
      }
    }

    return setDocREST(col, id, data);
  };

  const addDocSafe = async (col: string, data: any) => {
    if (!useRestFallback) {
      try {
        const docRef = await fdb.collection(col).add({ ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return docRef.id;
      } catch (err: any) {
        console.warn(`[FIREBASE-ADD] Error adding to ${col}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        } else {
          return null;
        }
      }
    }

    return addDocREST(col, data);
  };

  const deleteDocREST = async (collect: string, id: string) => {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}`;
      await axios.delete(url, { timeout: 10000 });
      return true;
    } catch (err: any) {
      console.error(`[REST-DELETE-ERR] Failed REST delete for ${collect}/${id}:`, err.response?.data || err.message);
      return false;
    }
  };

  const deleteDocSafe = async (col: string, id: string) => {
    if (!useRestFallback) {
      try {
        await fdb.collection(col).doc(id).delete();
        return true;
      } catch (err: any) {
        console.warn(`[FIREBASE-DELETE] Error deleting ${col}/${id}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        } else {
          return false;
        }
      }
    }

    return deleteDocREST(col, id);
  };

  // Activate auto-ensure on startup
  const ensureBackendUrlIsSet = async () => {
    const ACTIVE_BACKEND_URL = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    try {
      console.log(`[INIT] Auto-ensuring backend URL in database: ${ACTIVE_BACKEND_URL}`);
      const snap = await getDocSafe("settings", "payment");
      
      if (snap.exists) {
        const data = snap.data();
        if (data?.backendApiUrl !== ACTIVE_BACKEND_URL) {
          await updateDocSafe("settings", "payment", { backendApiUrl: ACTIVE_BACKEND_URL });
          console.log(`[INIT] ✅ Firebase backendApiUrl updated.`);
        }
      } else {
        await setDocSafe("settings", "payment", { backendApiUrl: ACTIVE_BACKEND_URL });
      }
    } catch (err: any) {
      console.warn(`[INIT] ⚠️ Auto-updating backendApiUrl failed: ${err.message}`);
    }
  };
  ensureBackendUrlIsSet();

  const adjustUserBalanceSafe = async (user_id: string, change: number) => {
    console.log(`[BALANCE-SAFE] Adjusting balance for ${user_id} by ${change}`);
    if (!useRestFallback) {
      try {
        const userRef = fdb.collection("users").doc(user_id);
        await fdb.runTransaction(async (transaction) => {
          const userDoc = await transaction.get(userRef);
          if (!userDoc.exists) throw new Error("User not found");
          
          const currentBalance = Number(userDoc.data()?.balance || 0);
          const newBalance = Number((currentBalance + change).toFixed(2));
          transaction.update(userRef, { 
            balance: newBalance,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() 
          });
        });
        console.log(`[BALANCE-SAFE] Balance adjusted successfully via transaction.`);
        return true;
      } catch (err: any) {
        console.error(`[BALANCE-SAFE] Error: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied in transaction. Engaging REST Fallback.");
          useRestFallback = true;
        } else {
          return false;
        }
      }
    }

    return adjustUserBalanceREST(user_id, change);
  };
  
  // Health check
  app.get("/api/health", (req, res) => res.json({ 
    status: "ok", 
    firebaseProject: admin.app().options.projectId,
    databaseId: (admin.app().options as any).databaseId
  }));

  // Aggressive backend-side cache to protect database read limits
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
    
    // Also reset local lookup cache maps
    serverCache.settings = null;
    serverCache.courses.clear();
    serverCache.providers.clear();
    
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
      console.log("[SERVER-DB] Fetching courses from Firestore to refresh cache...");
      let services: any[] = [];
      if (!useRestFallback) {
        try {
          const snap = await fdb.collection("courses").get();
          services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e: any) {
          if (e.message?.includes("permissions") || e.message?.includes("PERMISSION_DENIED") || e.code === 7) {
            console.warn("[COURSES] Permission denied on courses fetch. Activating REST fallback.");
            useRestFallback = true;
          } else {
            throw e;
          }
        }
      }

      if (useRestFallback) {
        const queryRes = await runQueryREST({
          structuredQuery: {
            from: [{ collectionId: "courses" }]
          }
        });
        services = queryRes.map(item => ({ id: item.id, ...item.data() }));
      }

      // Only show services that are not explicitly 'archived' or 'hidden'
      const activeServices = services.filter((s: any) => s.status !== "archived" && s.status !== "hidden");

      // Sort services by category priority
      const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
      activeServices.sort((a: any, b: any) => {
        const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
        const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
        if (orderA !== orderB) return orderA - orderB;
        
        const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
        const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
        return timeB - timeA;
      });

      serverCachedCourses = activeServices;
      serverCachedCoursesTime = now;
      res.json(activeServices);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching services from database:", err.message);
      if (serverCachedCourses) {
        console.log("[SERVER-CACHE] Fallback to stale services cache on DB error");
        return res.json(serverCachedCourses);
      }
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  // Express API for Settings with server-side in-memory caching
  app.get("/api/settings", async (req, res) => {
    const now = Date.now();
    if (serverCachedSettings && (now - serverCachedSettingsTime < BACKEND_CACHE_DURATION)) {
      return res.json(serverCachedSettings);
    }

    try {
      const snap = await getDocSafe("settings", "payment");
      let settingsData = snap.exists ? snap.data() : {};
      serverCachedSettings = settingsData;
      serverCachedSettingsTime = now;
      res.json(settingsData);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching settings:", err.message);
      if (serverCachedSettings) return res.json(serverCachedSettings);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Temporary developer debug endpoint to inspect orders
  app.get("/api/debug-orders", async (req, res) => {
    try {
      let ordersList: any[] = [];
      if (!useRestFallback) {
        try {
          const snap = await fdb.collection("orders").orderBy("createdAt", "desc").limit(15).get();
          ordersList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e: any) {
          if (e.message?.includes("permissions") || e.message?.includes("PERMISSION_DENIED") || e.code === 7) {
            console.warn("[DEBUG-ORDERS] Permission denied on orders fetch. Activating REST fallback.");
            useRestFallback = true;
          } else {
            throw e;
          }
        }
      }

      if (useRestFallback) {
        const queryRes = await runQueryREST({
          structuredQuery: {
            from: [{ collectionId: "orders" }],
            orderBy: [{
              field: { fieldPath: "createdAt" },
              direction: "DESCENDING"
            }],
            limit: 15
          }
        });
        ordersList = queryRes.map(item => ({ id: item.id, ...item.data() }));
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
        await adjustUserBalanceSafe(req.body.user_id || req.body.userId, Number(req.body.amount));
        await addDocSafe("deposits", { ...req.body, status: "approved", createdAt: new Date() });
        res.json({ success: true });
      } else res.status(400).json({ error: "Invalid sig" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Paytm Signature and Encryption helpers (matching official Paytm merchant API AES-128-CBC)
  function encryptPaytm(toEncrypt: string, key: string) {
    const iv = "@@@@&&&&####$$$$";
    const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
    let encrypted = cipher.update(toEncrypt, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
  }

  function generatePaytmSignature(params: string, key: string) {
    const salt = crypto.randomBytes(4).toString("hex"); 
    const stringToSign = params + "|" + salt;
    const hash = crypto.createHash("sha256").update(stringToSign).digest("hex");
    return encryptPaytm(hash + salt, key);
  }

  // PhonePe Create Order
  app.post("/api/phonepe/create-order", async (req, res) => {
    try {
      const { amount, userId, userEmail } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const sS = await getDocSafe("settings", "payment");
      const s = sS.data();
      if (!s || !s.phonepeEnabled) {
        return res.status(400).json({ error: "PhonePe gateway is not enabled by admin" });
      }

      const merchantId = s.phonepeMerchantId;
      const saltKey = s.phonepeSaltKey;
      const saltIndex = s.phonepeSaltIndex || "1";
      const env = s.phonepeEnv || "sandbox";

      const merchantTransactionId = "TXN_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
      
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const domain = `${protocol}://${host}`;

      const payload = {
        merchantId: merchantId,
        merchantTransactionId: merchantTransactionId,
        merchantUserId: userId || "U_" + Date.now(),
        amount: Math.round(Number(amount) * 100), // in paise
        redirectUrl: `${domain}/api/phonepe/callback?userId=${userId}&amount=${amount}&userEmail=${encodeURIComponent(userEmail || "")}`,
        redirectMode: "REDIRECT",
        callbackUrl: `${domain}/api/phonepe/callback?userId=${userId}&amount=${amount}&userEmail=${encodeURIComponent(userEmail || "")}`,
        paymentInstrument: {
          type: "PAY_PAGE"
        }
      };

      const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
      const stringToSign = base64Payload + "/pg/v1/pay" + saltKey;
      const sha256 = crypto.createHash("sha256").update(stringToSign).digest("hex");
      const xVerify = sha256 + "###" + saltIndex;

      const apiEndpoint = env === "production"
        ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"
        : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay";

      console.log(`[PHONEPE-INIT] Initiating transaction ${merchantTransactionId} for amount ₹${amount}`);
      const response = await axios.post(apiEndpoint, {
        request: base64Payload
      }, {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
          "accept": "application/json"
        }
      });

      if (response.data && response.data.success && response.data.data.instrumentResponse?.redirectInfo?.url) {
        res.json({
          success: true,
          redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
          transactionId: merchantTransactionId
        });
      } else {
        throw new Error(response.data.message || "Failed to get redirect URL from PhonePe");
      }
    } catch (e: any) {
      console.error("[PHONEPE-ERROR]", e.response?.data || e.message);
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  // PhonePe Callback/Webhook
  const handlePhonePeCallback = async (req: any, res: any) => {
    try {
      console.log("[PHONEPE-CALLBACK] Callback received:", req.method, req.query, req.body);
      
      const sS = await getDocSafe("settings", "payment");
      const s = sS.data();
      if (!s) {
        return res.send("<h2>Payment Settings Not Found</h2>");
      }

      const merchantId = s.phonepeMerchantId;
      const saltKey = s.phonepeSaltKey;
      const saltIndex = s.phonepeSaltIndex || "1";
      const env = s.phonepeEnv || "sandbox";

      let transactionId = req.query.transactionId || req.body.transactionId;
      let userId = req.query.userId || req.body.userId;
      let amount = Number(req.query.amount || req.body.amount || 0);
      let userEmail = req.query.userEmail || req.body.userEmail || "not-provided";

      // If PhonePe posted a base64 response body
      if (req.body && req.body.response) {
        try {
          const decoded = JSON.parse(Buffer.from(req.body.response, "base64").toString("utf-8"));
          console.log("[PHONEPE-CALLBACK] Decoded body:", decoded);
          if (decoded.data) {
            transactionId = decoded.data.merchantTransactionId;
            amount = Number(decoded.data.amount) / 100;
          }
        } catch (deErr) {
          console.error("[PHONEPE-CALLBACK] Error decoding body response:", deErr);
        }
      }

      if (!transactionId) {
        const responseData = req.body || {};
        transactionId = responseData.merchantTransactionId || req.query.merchantTransactionId;
      }

      if (!transactionId) {
        return res.send("<h2>Invalid PhonePe callback transaction. Missing Transaction ID.</h2>");
      }

      // Secure Status Check Call (Server to Server API)
      const statusUrl = env === "production"
        ? `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`
        : `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status/${merchantId}/${transactionId}`;

      const stringToSign = `/pg/v1/status/${merchantId}/${transactionId}` + saltKey;
      const sha256 = crypto.createHash("sha256").update(stringToSign).digest("hex");
      const xVerify = sha256 + "###" + saltIndex;

      console.log(`[PHONEPE-VERIFY] Querying PhonePe status for transaction ${transactionId}`);
      const response = await axios.get(statusUrl, {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": xVerify,
          "X-MERCHANT-ID": merchantId,
          "accept": "application/json"
        }
      });

      console.log("[PHONEPE-VERIFY] Response code:", response.data?.code);

      if (response.data && response.data.code === "PAYMENT_SUCCESS") {
        const amountPaid = Number(response.data.data.amount) / 100; // in Rupees
        const finalAmount = amountPaid || amount;

        // Verify if this transaction is already processed
        let alreadyProcessed = false;
        try {
          if (!useRestFallback) {
            const snap = await fdb.collection("deposits").where("utr", "==", transactionId).limit(1).get();
            alreadyProcessed = !snap.empty;
          } else {
            const queryRes = await findDepositByUtrREST(transactionId);
            alreadyProcessed = queryRes.length > 0;
          }
        } catch (dbErr) {
          console.error("[PHONEPE-VERIFY] Error searching duplicate transaction:", dbErr);
        }

        if (!alreadyProcessed) {
          console.log(`[PHONEPE-VERIFY] Processing credit of ₹${finalAmount} for user ${userId}`);
          await adjustUserBalanceSafe(userId, finalAmount);
          await addDocSafe("deposits", {
            userId: userId,
            userEmail: decodeURIComponent(userEmail),
            amount: finalAmount,
            utr: transactionId,
            screenshotUrl: "",
            status: "approved",
            type: "deposit",
            gateway: "PhonePe",
            createdAt: new Date().toISOString()
          });
        }

        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
              <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
                <div style="color: #4caf50; font-size: 60px; margin-bottom: 20px;">✓</div>
                <h2 style="color: #333; margin-bottom: 10px;">Payment Successful!</h2>
                <p style="color: #666; font-size: 14px; margin-bottom: 25px;">₹${finalAmount.toFixed(2)} has been successfully added to your wallet.</p>
                <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Go back to Profile</button>
              </div>
            </body>
          </html>
        `);
      } else {
        console.warn(`[PHONEPE-VERIFY] Payment status was not success:`, response.data);
        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
              <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
                <div style="color: #f44336; font-size: 60px; margin-bottom: 20px;">✗</div>
                <h2 style="color: #333; margin-bottom: 10px;">Payment Failed!</h2>
                <p style="color: #666; font-size: 14px; margin-bottom: 25px;">PhonePe reported a status of: ${response.data?.code || "FAILED"}. If funds were deducted, they will be refunded shortly.</p>
                <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Try Again</button>
              </div>
            </body>
          </html>
        `);
      }
    } catch (e: any) {
      console.error("[PHONEPE-CALLBACK-ERROR]", e.message);
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
            <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
              <div style="color: #ff9800; font-size: 60px; margin-bottom: 20px;">⚠</div>
              <h2 style="color: #333; margin-bottom: 10px;">Payment Verification Pending</h2>
              <p style="color: #666; font-size: 14px; margin-bottom: 25px;">There was a temporary connection delay with the gateway. Your balance will update automatically in a few minutes.</p>
              <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Go back to Profile</button>
            </div>
          </body>
        </html>
      `);
    }
  };

  app.get("/api/phonepe/callback", handlePhonePeCallback);
  app.post("/api/phonepe/callback", handlePhonePeCallback);

  // Paytm Create Order
  app.post("/api/paytm/create-order", async (req, res) => {
    try {
      const { amount, userId, userEmail } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const sS = await getDocSafe("settings", "payment");
      const s = sS.data();
      if (!s || !s.paytmEnabled) {
        return res.status(400).json({ error: "Paytm gateway is not enabled by admin" });
      }

      const mid = s.paytmMid;
      const mkey = s.paytmMerchantKey;
      const env = s.paytmEnv || "sandbox";

      const orderId = "PAYTM_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const domain = `${protocol}://${host}`;

      const callbackUrl = `${domain}/api/paytm/callback?userId=${userId}&amount=${amount}&userEmail=${encodeURIComponent(userEmail || "")}`;

      const paytmParamsBody = {
        requestType: "Payment",
        mid: mid,
        websiteName: env === "production" ? "DEFAULT" : "WEBSTAGING",
        orderId: orderId,
        callbackUrl: callbackUrl,
        txnAmount: {
          value: Number(amount).toFixed(2),
          currency: "INR"
        },
        userInfo: {
          custId: userId || "CUST_" + Date.now()
        }
      };

      const bodyString = JSON.stringify(paytmParamsBody);
      const signature = generatePaytmSignature(bodyString, mkey);

      const apiEndpoint = env === "production"
        ? `https://securegw.paytm.in/theia/api/v1/initiateTransaction?mid=${mid}&orderId=${orderId}`
        : `https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction?mid=${mid}&orderId=${orderId}`;

      console.log(`[PAYTM-INIT] Initiating transaction ${orderId} for amount ₹${amount}`);
      const response = await axios.post(apiEndpoint, {
        body: paytmParamsBody,
        head: {
          signature: signature
        }
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });

      if (response.data && response.data.body && response.data.body.txnToken) {
        const txnToken = response.data.body.txnToken;
        const checkoutPageUrl = env === "production"
          ? `https://securegw.paytm.in/theia/api/v1/showPaymentPage?mid=${mid}&orderId=${orderId}`
          : `https://securegw-stage.paytm.in/theia/api/v1/showPaymentPage?mid=${mid}&orderId=${orderId}`;

        res.json({
          success: true,
          txnToken: txnToken,
          orderId: orderId,
          mid: mid,
          checkoutPageUrl: checkoutPageUrl
        });
      } else {
        throw new Error(response.data?.body?.resultInfo?.resultMsg || "Failed to initiate Paytm transaction");
      }
    } catch (e: any) {
      console.error("[PAYTM-ERROR]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Paytm Callback (POST from Paytm system)
  app.post("/api/paytm/callback", async (req, res) => {
    try {
      console.log("[PAYTM-CALLBACK] Callback received:", req.body);
      const { ORDERID, TXNID, TXNAMOUNT, STATUS, RESPMSG } = req.body;
      
      const sS = await getDocSafe("settings", "payment");
      const s = sS.data();
      if (!s) {
        return res.send("<h2>Payment Settings Not Found</h2>");
      }

      const mid = s.paytmMid;
      const mkey = s.paytmMerchantKey;
      const env = s.paytmEnv || "sandbox";

      const userId = req.query.userId || req.body.userId;
      const userEmail = req.query.userEmail || req.body.userEmail || "not-provided";
      const amount = Number(TXNAMOUNT || req.query.amount || 0);
      const transactionId = TXNID || ORDERID;

      if (!ORDERID) {
        return res.send("<h2>Invalid Paytm callback. Missing Order ID.</h2>");
      }

      // Secure Order Status Check Call (Server to Server API)
      const statusUrl = env === "production"
        ? "https://securegw.paytm.in/v3/order/status"
        : "https://securegw-stage.paytm.in/v3/order/status";

      const statusParamsBody = {
        mid: mid,
        orderId: ORDERID
      };

      const bodyString = JSON.stringify(statusParamsBody);
      const signature = generatePaytmSignature(bodyString, mkey);

      console.log(`[PAYTM-VERIFY] Querying Paytm status for order ${ORDERID}`);
      const response = await axios.post(statusUrl, {
        body: statusParamsBody,
        head: {
          signature: signature
        }
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });

      console.log("[PAYTM-VERIFY] Response status:", response.data?.body?.resultInfo?.resultStatus);

      if (response.data && response.data.body && response.data.body.resultInfo?.resultStatus === "TXN_SUCCESS") {
        const verifiedAmount = Number(response.data.body.txnAmount);
        const finalAmount = verifiedAmount || amount;

        // Verify if already processed
        let alreadyProcessed = false;
        try {
          if (!useRestFallback) {
            const snap = await fdb.collection("deposits").where("utr", "==", transactionId).limit(1).get();
            alreadyProcessed = !snap.empty;
          } else {
            const queryRes = await findDepositByUtrREST(transactionId);
            alreadyProcessed = queryRes.length > 0;
          }
        } catch (dbErr) {
          console.error("[PAYTM-VERIFY] Error searching duplicate transaction:", dbErr);
        }

        if (!alreadyProcessed) {
          console.log(`[PAYTM-VERIFY] Processing credit of ₹${finalAmount} for user ${userId}`);
          await adjustUserBalanceSafe(userId, finalAmount);
          await addDocSafe("deposits", {
            userId: userId,
            userEmail: decodeURIComponent(userEmail),
            amount: finalAmount,
            utr: transactionId,
            screenshotUrl: "",
            status: "approved",
            type: "deposit",
            gateway: "Paytm",
            createdAt: new Date().toISOString()
          });
        }

        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
              <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
                <div style="color: #4caf50; font-size: 60px; margin-bottom: 20px;">✓</div>
                <h2 style="color: #333; margin-bottom: 10px;">Payment Successful!</h2>
                <p style="color: #666; font-size: 14px; margin-bottom: 25px;">₹${finalAmount.toFixed(2)} has been successfully added to your wallet.</p>
                <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Go back to Profile</button>
              </div>
            </body>
          </html>
        `);
      } else {
        console.warn(`[PAYTM-VERIFY] Paytm status not successful:`, response.data);
        return res.send(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
              <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
                <div style="color: #f44336; font-size: 60px; margin-bottom: 20px;">✗</div>
                <h2 style="color: #333; margin-bottom: 10px;">Payment Failed!</h2>
                <p style="color: #666; font-size: 14px; margin-bottom: 25px;">Paytm reported a status of: ${response.data?.body?.resultInfo?.resultMsg || RESPMSG || "FAILED"}.</p>
                <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Try Again</button>
              </div>
            </body>
          </html>
        `);
      }
    } catch (e: any) {
      console.error("[PAYTM-CALLBACK-ERROR]", e.message);
      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f7f9fc;">
            <div style="background-color: white; padding: 40px; border-radius: 20px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 400px; width: 100%;">
              <div style="color: #ff9800; font-size: 60px; margin-bottom: 20px;">⚠</div>
              <h2 style="color: #333; margin-bottom: 10px;">Payment Verification Pending</h2>
              <p style="color: #666; font-size: 14px; margin-bottom: 25px;">There was a temporary verification delay with Paytm. Your balance will update in a few moments.</p>
              <button onclick="window.location.href='/profile'" style="background-color: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px;">Go back to Profile</button>
            </div>
          </body>
        </html>
      `);
    }
  });

  // Manual Deposit
  app.post("/api/deposits/submit-manual", async (req, res) => {
    const { amount, utr, screenshotUrl, userId, userEmail } = req.body;
    const user_id = userId;
    const user_email = userEmail;
    console.log(`[DEPOSIT] Attempting submission: UTR=${utr}, User=${user_id}`);
    
    const cleanUtr = String(utr).replace(/\D/g, "");
    if (cleanUtr.length !== 12) return res.status(400).json({ error: "Invalid UTR format. Must be 12 digits." });
    
    try {
      let empty = true;
      if (!useRestFallback) {
        try {
          const snap = await fdb.collection("deposits").where("utr", "==", cleanUtr).limit(1).get();
          empty = snap.empty;
        } catch (e: any) {
          if (e.message?.includes("permissions") || e.message?.includes("PERMISSION_DENIED") || e.code === 7) {
            console.warn("[MANUAL-DEPOSIT] Permission denied on UTR search. Activating REST fallback.");
            useRestFallback = true;
          } else {
            throw e;
          }
        }
      }

      if (useRestFallback) {
        const queryRes = await findDepositByUtrREST(cleanUtr);
        empty = queryRes.length === 0;
      }

      if (!empty) {
        return res.status(400).json({ error: "This UTR number has already been used." });
      }

      // Save as pending manual deposit
      const depId = await addDocSafe("deposits", {
        userId: user_id, 
        userEmail: user_email || "not-provided", 
        amount: Number(amount), 
        utr: cleanUtr, 
        screenshotUrl: screenshotUrl || "", 
        status: "pending", 
        type: "deposit",
        createdAt: new Date().toISOString()
      });

      if (depId) {
        res.json({ success: true, isAutoApproved: false });
      } else {
        throw new Error("Failed to write manual deposit to database.");
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
          let matchedDoc: any = null;
          if (!useRestFallback) {
            try {
              const snap = await fdb.collection("deposits")
                .where("utr", "==", candidateUtr)
                .where("status", "==", "pending")
                .limit(1)
                .get();

              if (!snap.empty) {
                const doc = snap.docs[0];
                matchedDoc = {
                  id: doc.id,
                  data: doc.data()
                };
              }
            } catch (err: any) {
              if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
                console.warn("[SMS-WEBHOOK] Permission denied. Activating REST fallback.");
                useRestFallback = true;
              } else {
                throw err;
              }
            }
          }

          if (useRestFallback) {
            const queryRes = await findDepositByUtrREST(candidateUtr, "pending");
            if (queryRes.length > 0) {
              matchedDoc = {
                id: queryRes[0].id,
                data: queryRes[0].data()
              };
            }
          }

          if (matchedDoc) {
            depData = matchedDoc.data;
            depositId = matchedDoc.id;
            matchedUtr = candidateUtr;
            break; // Found matching pending deposit!
          }
        } catch (err: any) {
          console.warn(`[SMS-WEBHOOK] Firestore Query failed for UTR ${candidateUtr}: ${err.message}`);
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
      console.log(`[SMS-WEBHOOK] Found matching pending deposit ${depositId} of amount ₹${originalAmount} for userId: ${depData.user_id} using matched UTR: ${utr}`);

      // 4. Update the user balance & deposit status
      let updateSuccess = false;
      const adjusted = await adjustUserBalanceSafe(depData.user_id, originalAmount);
      if (adjusted) {
        // approve deposit
        const approved = await updateDocSafe("deposits", depositId, {
          status: "approved",
          updated_at: new Date(),
          processed_by: "automatic-sms-gateway",
          actual_sms_amount: parsedAmount
        });
        if (approved) {
          updateSuccess = true;
          console.log(`[SMS-WEBHOOK] Approved deposit successfully`);
        } else {
          console.error(`[SMS-WEBHOOK] ❌ SYSTEM INCONSISTENCY: Balance was adjusted for user ${depData.user_id} by ₹${originalAmount}, but we failed to update deposit ${depositId} status!`);
        }
      } else {
        console.error(`[SMS-WEBHOOK] ❌ Balance adjustment failed for user ${depData.user_id}`);
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
  async function transmitOrderToProviderDirect(orderId: string, orderData: any, skipStoreCompleted = false) {
    // Look up lock first
    if (processingOrders.has(orderId)) {
      console.log(`[LOCK] Order ${orderId} is currently being processed by another worker path. Skipping.`);
      return { success: true, alreadyProcessing: true };
    }

    processingOrders.add(orderId);
    console.log(`[TRANSMIT] Locking & processing orderId: ${orderId} (skipStoreCompleted = ${skipStoreCompleted})`);

    let currentOrderData = orderData;
    try {
      // 0. Resolve orderData or fallback to Supabase fetch to avoid redundant DB reads
      let userId = currentOrderData?.userId || currentOrderData?.user_id;
      let serviceId = currentOrderData?.serviceId || currentOrderData?.service_id;

      if (!currentOrderData || !userId || !serviceId) {
        console.log(`[TRANSMIT] Fetching order document ${orderId} (slow path fallback)`);
        const snapObj = await getDocSafe("orders", orderId);
        if (!snapObj.exists) throw new Error("Order not found");
        currentOrderData = snapObj.data() || {};
        userId = currentOrderData.userId || currentOrderData.user_id;
        serviceId = currentOrderData.serviceId || currentOrderData.service_id;
        
        if (currentOrderData.providerOrderId) {
          console.log(`[TRANSMIT] Order ${orderId} already has providerOrderId registered: ${currentOrderData.providerOrderId}`);
          return { success: true, providerOrderId: currentOrderData.providerOrderId };
        }
      }

      const orderAmount = Number(currentOrderData.totalPrice || currentOrderData.total_price || 0);
      const targetLink = currentOrderData.targetLink || currentOrderData.target_link || "";
      const quantity = currentOrderData.quantity;

      if (!serviceId) {
        throw new Error("Missing required field: service_id");
      }

      // 1. Fetch User, Service details, and general Payment Settings IN PARALLEL (FAST PATH)
      console.log(`[TRANSMIT] Retrieving User, Service, and Settings in parallel for order ${orderId}`);
      const [userSnap, cS, sS] = await Promise.all([
        getDocSafe("users", userId),
        getDocSafe("courses", serviceId),
        getDocSafe("settings", "payment")
      ]);

      if (!userSnap.exists) throw new Error(`User profile not found for ID: ${userId}`);
      const userBalance = Number(userSnap.data().balance || 0);

      if (userBalance < orderAmount) {
        throw new Error(`Insufficient balance (Current: ₹${userBalance}, Required: ₹${orderAmount}). Order rejected.`);
      }

      if (!cS || !cS.exists) {
        throw new Error(`Service configuration with ID "${serviceId}" does not exist in the database.`);
      }
      const c = cS.data();

      const s = sS.exists ? (sS.data() || {}) : {};

      // 3. Resolve API credentials
      let pUrl = (s.providerApiUrl || "").trim() || "https://smmbin.com/api/v2";
      let pKey = (s.providerApiKey || "").trim();

      if (c.providerId && c.providerId !== "global") {
        console.log(`[TRANSMIT] Course ${serviceId} is using a custom provider: ${c.providerId}`);
        const pS = await getDocSafe("providers", c.providerId);
        if (pS && pS.exists) {
          const pData = pS.data() || {};
          pUrl = (pData.api_url || "").trim() || (pData.apiUrl || "").trim();
          pKey = (pData.api_key || "").trim() || (pData.apiKey || "").trim();
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
              service: String(c.provider_service_id).trim(),
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

            if (skipStoreCompleted) {
              console.log("[TRANSMIT] skipStoreCompleted is enabled. Skipping saving failed order document to Firestore to optimize quota.");
            } else {
              await updateDocSafe("orders", orderId, {
                status: "Failed",
                needsProviderTransmission: false,
                providerTransmissionStatus: "failed",
                error: `API Connection Error (${stringErr.substring(0, 400)})`,
                updatedAt: new Date()
              });
            }

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

        // DEDUCT BALANCE NOW - Order was successful with provider
        try {
          const orderSnap = await getDocSafe("orders", orderId);
          let needsDeduction = false;
          let price = Number(currentOrderData.totalPrice || currentOrderData.total_price || 0);
          let oUserId = currentOrderData.userId || currentOrderData.user_id;

          if (orderSnap.exists) {
            const currentData = orderSnap.data();
            needsDeduction = ["Pending", "Processing", "Failed", "Refunded", "Awaiting-Validation"].includes(currentData.status);
            price = Number(currentData.totalPrice || currentData.total_price || price);
            oUserId = currentData.userId || currentData.user_id || oUserId;
          } else {
            needsDeduction = true; 
          }

          if (needsDeduction && oUserId && price > 0) {
            const deductionSuccess = await adjustUserBalanceSafe(oUserId, -price);
            if (deductionSuccess) {
              console.log(`[DEDUCTION] Deducted ₹${price} from User ${oUserId} after successful provider response.`);
            } else {
              console.error(`[DEDUCTION-FAIL] Could not deduct balance for user ${oUserId} despite provider success!`);
            }
          }

          if (skipStoreCompleted) {
            console.log(`[TRANSMIT] skipStoreCompleted is enabled. Deleting any transient/pending order doc and skipping completed doc save.`);
            if (orderSnap.exists) {
              await deleteDocSafe("orders", orderId);
            }
          } else {
            await updateDocSafe("orders", orderId, {
              status: "Completed",
              providerOrderId: oId,
              needsProviderTransmission: false,
              providerTransmissionStatus: "completed",
              error: null,
              updatedAt: new Date().toISOString(),
              providerRawResponse: JSON.stringify(resData).substring(0, 800)
            });
          }
        } catch (updateErr: any) {
          console.warn(`[TRANSMIT] Could not process success outputs or update db: ${updateErr.message}`);
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

        let finalErrorStr = typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);
        
        if (finalErrorStr.toLowerCase().includes("incorrect api key") || finalErrorStr.toLowerCase().includes("user disabled")) {
          finalErrorStr = "SMM Panel API credentials (API Key) are incorrect or your account/user is disabled on the SMM vendor panel. Please contact the admin/owner to update their provider credentials.";
        }

        if (skipStoreCompleted) {
          await setDocSafe("orders", orderId, {
            ...currentOrderData,
            status: "Failed",
            needsProviderTransmission: false,
            providerTransmissionStatus: "failed",
            error: `Provider Rejected Order (${finalErrorStr.substring(0, 400)})`,
            updatedAt: new Date().toISOString()
          });
        } else {
          await updateDocSafe("orders", orderId, {
            status: "Failed",
            needsProviderTransmission: false,
            providerTransmissionStatus: "failed",
            error: `Provider Rejected Order (${finalErrorStr.substring(0, 400)})`,
            updatedAt: new Date().toISOString()
          });
        }

        return { success: false, error: finalErrorStr };
      }
    } catch (e: any) {
      console.error(`[TRANSMIT] Severe Exception: ${e.message}`);
      if (skipStoreCompleted) {
        await setDocSafe("orders", orderId, {
          ...currentOrderData,
          status: "Failed",
          needsProviderTransmission: false,
          providerTransmissionStatus: "failed",
          error: e.message || "Internal transmission handler error",
          updatedAt: new Date().toISOString()
        }).catch(err => {
          console.error(`[TRANSMIT] Failed to set order status to Failed after severe exception: ${err.message}`);
        });
      } else {
        await updateDocSafe("orders", orderId, {
          status: "Failed",
          needsProviderTransmission: false,
          providerTransmissionStatus: "failed",
          error: e.message || "Internal transmission handler error",
          updatedAt: new Date().toISOString()
        }).catch(err => {
          console.error(`[TRANSMIT] Failed to set order status to Failed after severe exception: ${err.message}`);
        });
      }
      return { success: false, error: e.message || "Unknown internal processing error" };
    } finally {
      processingOrders.delete(orderId);
      console.log(`[TRANSMIT] Unlocked orderId: ${orderId}`);
    }
  };

  // In-memory scheduler disabled completely to prevent periodic query/read quota consumption.
  // All orders are dispatched synchronously and status updates triggered manually or on-demand.
  console.log("[SERVER] Order dispatcher initialized.");

  async function logToDb(event: string, data: any) {
    console.log(`[LOG-DB] ${event}:`, data);
  }

  // Improved Proxy for Provider with better logging and headers
  app.post("/api/proxy-provider", async (req, res) => {
    try {
      const { 
        userId, 
        user_id: bodyUserId,
        userEmail, 
        user_email: bodyUserEmail,
        courseId, 
        serviceId,
        service_id: bodyServiceId,
        courseTitle, 
        title: bodyTitle,
        category, 
        quantity, 
        targetLink, 
        target_link: bodyTargetLink,
        totalPrice,
        total_price: bodyTotalPrice,
        orderId: passedOrderId
      } = req.body;

      const final_user_id = bodyUserId || userId;
      const final_user_email = bodyUserEmail || userEmail || "";
      const final_service_id = bodyServiceId || serviceId || courseId;
      const final_title = bodyTitle || courseTitle || "";
      const final_target_link = bodyTargetLink || targetLink || "";
      const final_total_price = bodyTotalPrice !== undefined ? bodyTotalPrice : totalPrice;

      let orderId = passedOrderId;
      const skipStoreCompleted = req.body.skipStoreCompleted || false;

      // Check if this is a DIRECT Synchronous order creation request (contains userId & totalPrice)
      if (final_user_id && final_total_price !== undefined && !skipStoreCompleted) {
        if (!orderId) {
          orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        }
        console.log(`[HTTP Direct Order] Creating order document ${orderId} in database`);

        // 1. Create order document first so transit methods can read/update it
        const orderData = {
          userId: final_user_id,
          userEmail: final_user_email,
          serviceId: final_service_id,
          title: final_title,
          category: category || "Other",
          quantity: Number(quantity),
          targetLink: final_target_link.trim(),
          totalPrice: Number(final_total_price),
          status: "Pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const createSuccess = await setDocSafe("orders", orderId, orderData);
        if (!createSuccess) {
          return res.status(500).json({ success: false, error: "Failed to initialize order record in database" });
        }
      }

      if (!orderId) {
        orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      }

      console.log(`[HTTP Proxy] Order transmission call received for order: ${orderId} (skipStoreCompleted = ${skipStoreCompleted})`);
      const payloadData = {
        userId: final_user_id,
        userEmail: final_user_email,
        serviceId: final_service_id,
        title: final_title,
        category: category || "Other",
        quantity: Number(quantity),
        targetLink: final_target_link?.trim() || "",
        totalPrice: Number(final_total_price),
        status: "Pending"
      };

      if (req.body.isAsync) {
        console.log(`[HTTP Proxy] Dispatching asynchronous background order transit for order: ${orderId}`);
        // Run background transmittal immediately and return milliseconds response to client
        transmitOrderToProviderDirect(orderId, payloadData, skipStoreCompleted).catch(err => {
          console.error(`[ASYNC-TRANSMIT-ERROR] Background transmission exception for ${orderId}:`, err.message);
        });
        return res.json({ success: true, isAsync: true, providerOrderId: "PENDING", orderId });
      }

      const result = await transmitOrderToProviderDirect(orderId, payloadData, skipStoreCompleted);
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

      const pOrderId = order.providerOrderId || order.provider_order_id;
      if (!pOrderId) {
        return res.json({ success: true, status: currentStatus, message: "No provider ID yet" });
      }

      // Fetch provider info
      let pUrl = "";
      let pKey = "";
      const sS = await getDocSafe("settings", "payment");
      const sData = sS.data() || {};
      pUrl = sData.providerApiUrl || "";
      pKey = sData.providerApiKey || "";

      const sId = order.serviceId || order.service_id;
      if (sId) {
        const cS = await getDocSafe("courses", sId);
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
      params.append("order", String(pOrderId));

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

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => console.log(`[READY] Port ${PORT}`));
  }
}

startServer().catch(console.error);
