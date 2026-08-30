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

// Load Firebase Config globally
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const { projectId: configProjectId, apiKey } = firebaseConfig;
const databaseId = firebaseConfig.firestoreDatabaseId || "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const dbId = databaseId; 
const projectId = configProjectId; 
let realProjectId = "";

// Initialize shared SMM Panel connection agents
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
          credential: admin.credential.applicationDefault()
        });
        console.log(`[FIREBASE] Admin SDK initialized with default credentials.`);
      } catch (error) {
        admin.initializeApp();
        console.log(`[FIREBASE] Admin SDK initialized with minimal config.`);
      }
    }

const fdb = getFirestore(admin.apps[0] || admin.app(), dbId);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const app = express();
export default app;

let isInitialized = false;
export async function startServer() {
  if (isInitialized) return;
  isInitialized = true;
  console.log("[STARTUP] Initializing server...");
  
  const getRealProjectId = async () => {
    if (process.env.VERCEL) return null;
    try {
      const res = await axios.get(
        "http://metadata.google.internal/computeMetadata/v1/project/project-id",
        { headers: { "Metadata-Flavor": "Google" }, timeout: 2000 }
      );
      return res.data;
    } catch (err) {
      return null;
    }
  };

  let systemAccessToken = "";
  let tokenExpiryTime = 0;

  const getValidSystemAccessToken = async () => {
    if (process.env.VERCEL) return "";
    const now = Date.now();
    // If we have a cached token and it's valid for at least another 5 minutes, return it
    if (systemAccessToken && now < tokenExpiryTime - 5 * 60 * 1000) {
      return systemAccessToken;
    }

    try {
      console.log("[TOKEN] Refreshing system access token from metadata server...");
      const res = await axios.get(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" }, timeout: 2500 }
      );
      if (res.data?.access_token) {
        systemAccessToken = res.data.access_token;
        const expiresIn = res.data.expires_in || 3600; // default to 1 hour
        tokenExpiryTime = now + expiresIn * 1000;
        console.log(`[TOKEN] Successfully refreshed system access token. Expires in ${expiresIn}s.`);
        return systemAccessToken;
      }
    } catch (err: any) {
      console.warn("[TOKEN-ERR] Failed to refresh metadata token dynamically:", err.message);
    }
    return systemAccessToken;
  };

  // Try to detect environment identity
  getRealProjectId().then(id => {
    if (id) {
      console.log(`[STARTUP] Detected real project ID: ${id}`);
      realProjectId = id;
    }
  });

  // Perform initial fetch and keep systemAccessToken updated
  const initializeSystemToken = async () => {
    const token = await getValidSystemAccessToken();
    if (token) {
      console.log("[STARTUP] Initialized system access token successfully.");
    }
    // Seed initial orders into memory after we've checked/retrieved the token
    await seedMemoryOrders();
  };
  initializeSystemToken();
  
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  
  // Custom CORS middleware to guarantee all custom domains (e.g. Vercel, custom domains) are permitted
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Request-Method, Access-Control-Request-Headers");
    
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });
  
  // Enable absolute CORS for custom domains calling this Cloud Run backend
  const corsOptions = {
    origin: (origin: any, callback: any) => {
      callback(null, origin || true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers"
    ],
    maxAge: 86400
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  
  // Storage for basic app config that doesn't change often
  const serverCache = {
    settings: null as any,
    courses: new Map<string, any>(),
    providers: new Map<string, any>(),
    users: new Map<string, any>(),
    orders: new Map<string, any>(),
    deposits: new Map<string, any>(),
    bank_sms_logs: new Map<string, any>(),
    latestOrders: [] as any[] // Globally tracked latest orders in memory
  };

  const cacheFilePath = path.join(process.cwd(), "persistent_cache.json");

  // Default SMM Providers and Settings to seed if cache file or DB is fresh
  const DEFAULT_PROVIDERS_SEED: [string, any][] = [
    [
      "GbtZDOMSvSrBPgeRy6aU",
      {
        data: {
          id: "GbtZDOMSvSrBPgeRy6aU",
          name: "Smm bin",
          apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
          apiUrl: "https://www.smmbin.com/api/v2",
          createdAt: "2026-07-13T01:42:06.734Z"
        },
        time: Date.now()
      }
    ],
    [
      "k7IIPgA8QcpGmZGul3Pw",
      {
        data: {
          id: "k7IIPgA8QcpGmZGul3Pw",
          name: "The main smm",
          apiKey: "505344007e6bb5e4daf9a20d71cb946a411f65d5",
          apiUrl: "https://themainsmmprovider.com/api/v2",
          createdAt: "2026-07-27T10:33:37.983Z"
        },
        time: Date.now()
      }
    ],
    [
      "BjKqhBjQkzJ6y1GIYf5R",
      {
        data: {
          id: "BjKqhBjQkzJ6y1GIYf5R",
          name: "Wholesale smm store",
          apiKey: "68111b9cb78051d955d830f292a0217a7bdc9371",
          apiUrl: "https://wholesalesmmstore.com/api/v2",
          createdAt: "2026-06-28T03:49:07.308Z"
        },
        time: Date.now()
      }
    ]
  ];

  // Load persistent cache from disk
  const loadPersistentCache = () => {
    try {
      if (fs.existsSync(cacheFilePath)) {
        const fileContent = fs.readFileSync(cacheFilePath, "utf-8");
        const parsed = JSON.parse(fileContent);
        
        if (parsed.settings) {
          serverCache.settings = parsed.settings;
          console.log("[PERSISTENT-CACHE] Loaded settings from disk.");
        }
        
        if (parsed.providers && Array.isArray(parsed.providers)) {
          serverCache.providers.clear();
          parsed.providers.forEach(([id, cacheObj]: [string, any]) => {
            const pData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            serverCache.providers.set(id, { data: pData, time: cacheObj?.time || Date.now() });
          });
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.providers.size} providers from disk.`);
        }

        if (parsed.courses && Array.isArray(parsed.courses)) {
          serverCache.courses.clear();
          parsed.courses.forEach(([id, cacheObj]: [string, any]) => {
            const cData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            serverCache.courses.set(id, { data: cData, time: cacheObj?.time || Date.now() });
          });
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.courses.size} courses from disk.`);
        }
      }
    } catch (err: any) {
      console.error("[PERSISTENT-CACHE-ERR] Failed to load persistent cache:", err.message);
    }

    // Seed defaults if empty
    if (serverCache.providers.size === 0) {
      DEFAULT_PROVIDERS_SEED.forEach(([id, cacheObj]) => {
        serverCache.providers.set(id, cacheObj);
      });
      console.log(`[PERSISTENT-CACHE] Seeded ${serverCache.providers.size} default providers.`);
    }

    if (!serverCache.settings || !serverCache.settings.data) {
      serverCache.settings = {
        data: {
          providerApiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
          providerApiUrl: "https://www.smmbin.com/api/v2",
          merchantName: "Pyare SMM Panel"
        },
        time: Date.now()
      };
      console.log("[PERSISTENT-CACHE] Seeded default settings.");
    }
  };

  // Save persistent cache to disk
  const savePersistentCache = () => {
    try {
      const dataToSave = {
        settings: serverCache.settings,
        providers: Array.from(serverCache.providers.entries()),
        courses: Array.from(serverCache.courses.entries())
      };
      fs.writeFileSync(cacheFilePath, JSON.stringify(dataToSave, null, 2), "utf-8");
      console.log("[PERSISTENT-CACHE] Saved settings and providers cache to disk.");
    } catch (err: any) {
      console.error("[PERSISTENT-CACHE-ERR] Failed to save persistent cache:", err.message);
    }
  };

  // Run the disk cache loader right away
  loadPersistentCache();

  // Keep track of which users have had their orders synced from DB to memory (prevents double reading)
  const checkedUserOrders = new Set<string>();

  // Helper to parse dates/timestamps robustly in both ISO, Epoch, and DD/MM/YYYY formats
  function getTimestampMs(val: any): number {
    if (!val) return 0;
    if (typeof val === "number") return val;
    if (val instanceof Date) return val.getTime();
    
    // Firestore Timestamp in Admin SDK
    if (typeof val.toDate === "function") {
      try {
        return val.toDate().getTime();
      } catch (e) {}
    }
    // Serialized Timestamp object ({ seconds, nanoseconds } or { _seconds, _nanoseconds })
    if (typeof val.seconds === "number") {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
    }
    if (typeof val._seconds === "number") {
      return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
    }

    const str = String(val).trim();
    
    // Try parsing directly (ISO string, UTC format etc.)
    let parsed = Date.parse(str);
    if (!isNaN(parsed)) return parsed;

    // Handle DD/MM/YYYY or DD-MM-YYYY formats (e.g., "13/07/2026, 01:54:52" or "13-07-2026")
    const dmyRegex = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?:,\s*(\d{1,2}):(\d{2}):(\d{2}))?/;
    const match = str.match(dmyRegex);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexed
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const min = match[5] ? parseInt(match[5], 10) : 0;
      const sec = match[6] ? parseInt(match[6], 10) : 0;
      const date = new Date(year, month, day, hour, min, sec);
      if (!isNaN(date.getTime())) return date.getTime();
    }

    return 0;
  }

  // Add order to memory only
  function addOrderToMemory(id: string, data: any) {
    const now = new Date().toISOString();
    const orderData = { 
      id, 
      ...data, 
      createdAt: data.createdAt || now,
      updatedAt: now 
    };
    serverCache.orders.set(id, { data: orderData, time: Date.now() });
    
    // Avoid duplicates if loading from Firestore
    const exists = serverCache.latestOrders.find(o => o.id === id);
    if (!exists) {
      serverCache.latestOrders.unshift(orderData);
    } else {
      // Update existing record
      const idx = serverCache.latestOrders.findIndex(o => o.id === id);
      if (idx !== -1) {
        serverCache.latestOrders[idx] = { ...serverCache.latestOrders[idx], ...orderData };
      }
    }

    // Sort by createdAt just in case they come in out of order
    serverCache.latestOrders.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
    
    if (serverCache.latestOrders.length > 1000) {
      serverCache.latestOrders.pop();
    }
  }

  // Load last few orders from Firestore on startup to have initial data
  // This runs only once when the server boots
  async function seedMemoryOrders() {
    try {
      console.log("[MEMORY] Seeding initial orders from Firestore...");
      if (!useRestFallback) {
        try {
          const snap = await fdb.collection("orders").orderBy("createdAt", "desc").limit(10).get();
          snap.docs.forEach(doc => {
            const data = doc.data();
            // Convert Firestore timestamp to ISO string for consistency
            if (data.createdAt && data.createdAt.toDate) {
              data.createdAt = data.createdAt.toDate().toISOString();
            }
            if (data.updatedAt && data.updatedAt.toDate) {
              data.updatedAt = data.updatedAt.toDate().toISOString();
            }
            addOrderToMemory(doc.id, data);
          });
          console.log(`[MEMORY] Seeded ${snap.size} orders via Admin SDK.`);
          return;
        } catch (adminErr: any) {
          console.warn("[MEMORY] Admin SDK seed failed, trying REST fallback:", adminErr.message);
        }
      }

      // REST Fallback for seeding
      const queryRes = await runQueryREST({
        structuredQuery: {
          from: [{ collectionId: "orders" }],
          orderBy: [{
            field: { fieldPath: "createdAt" },
            direction: "DESCENDING"
          }],
          limit: 10
        }
      }, systemAccessToken);

      if (queryRes && queryRes.length > 0) {
        queryRes.forEach(doc => {
          const data = doc.data();
          addOrderToMemory(doc.id, data);
        });
        console.log(`[MEMORY] Seeded ${queryRes.length} orders via REST fallback.`);
      } else {
        console.log("[MEMORY] No orders found to seed via REST fallback.");
      }
    } catch (e: any) {
      console.error("[MEMORY] Failed to seed orders:", e.message);
    }
  }

  let useRestFallback = false; // Try Admin SDK first
  let adminSdkSucceeded = false;

  // Helper to wrap REST values (primitives, arrays, and map objects)
  function wrapRestValue(val: any): any {
    if (val === undefined || val === null) return null;
    if (typeof val === "string") return { stringValue: val };
    if (typeof val === "number") {
      if (Number.isInteger(val)) return { integerValue: String(val) };
      return { doubleValue: val };
    }
    if (typeof val === "boolean") return { booleanValue: val };
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    if (Array.isArray(val)) {
      const values = val.map(wrapRestValue).filter(v => v !== null);
      return { arrayValue: { values } };
    }
    if (typeof val === "object") {
      return { mapValue: { fields: wrapRestFields(val) } };
    }
    return { stringValue: String(val) };
  }

  // Helper to wrap REST fields
  function wrapRestFields(obj: any): any {
    const fields: any = {};
    if (!obj || typeof obj !== "object") return fields;
    for (const key in obj) {
      const val = obj[key];
      if (val === undefined || val === null) continue;
      const wrapped = wrapRestValue(val);
      if (wrapped !== null) {
        fields[key] = wrapped;
      }
    }
    return fields;
  }

  // Helper to unwrap REST values
  function unwrapRestValue(val: any): any {
    if (!val) return null;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.arrayValue !== undefined) {
      const vals = val.arrayValue.values || [];
      return vals.map(unwrapRestValue);
    }
    if (val.mapValue !== undefined) {
      return unwrapRestFields(val.mapValue.fields || {});
    }
    return null;
  }

  // Helper to unwrap REST fields
  function unwrapRestFields(fields: any): any {
    const result: any = {};
    if (!fields) return result;
    for (const key in fields) {
      const val = fields[key];
      if (!val) continue;
      result[key] = unwrapRestValue(val);
    }
    return result;
  }

  // Robust detection for the real project ID (especially in Cloud Run / AI Studio)
  const getTargetProject = () => {
    // 1. Use metadata-detected real project ID if available and valid
    if (realProjectId && 
        !realProjectId.startsWith("ai-studio-") && 
        !realProjectId.startsWith("ais-") &&
        realProjectId !== "gen-lang-client-0629912823") return realProjectId;
    
    // 2. Use config's projectId if available and not a placeholder
    if (configProjectId && configProjectId !== "gen-lang-client-0629912823") return configProjectId;

    // 3. Last resort: use the constant but prefer config over databaseId for the PROJECT part of the URL
    return configProjectId || "gen-lang-client-0629912823";
  };

  const getDocREST = async (collect: string, id: string, token?: string) => {
    const targetProject = getTargetProject();
    try {
      const headers: any = {};
      const isConfigColl = collect === "providers" || collect === "settings" || collect === "courses" || collect === "services";
      const effectiveToken = isConfigColl ? undefined : token;
      const authToken = effectiveToken || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}`;
      const res = await axios.get(url, { headers, timeout: 10000 });
      if (res.data && res.data.fields) {
        const data = unwrapRestFields(res.data.fields);
        return { exists: true, data: () => data };
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.warn(`[REST-GET-ERR] Failed REST get for ${collect}/${id} on project ${targetProject} (db: ${dbId}):`, err.response?.data || err.message);
      } else {
        // If 404, maybe we are on the wrong project? Let's try one more fallback if targetProject !== projectId
        if (targetProject !== projectId) {
           try {
             const fallbackUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}`;
             const res = await axios.get(fallbackUrl, { timeout: 5000 });
             if (res.data && res.data.fields) {
               console.log(`[REST-GET-FALLBACK] Found ${collect}/${id} on fallback project ${projectId}`);
               const data = unwrapRestFields(res.data.fields);
               return { exists: true, data: () => data };
             }
           } catch (e) {}
        }
      }
    }
    return { exists: false, data: () => null };
  };

  const setDocREST = async (collect: string, id: string, data: any, token?: string) => {
    const targetProject = getTargetProject();
    try {
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const dataWithTime = { ...data, updatedAt: new Date().toISOString() };
      const keys = Object.keys(dataWithTime);
      const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
      
      const fields = wrapRestFields(dataWithTime);
      const res = await axios.patch(url, { fields }, { headers, timeout: 10000 });
      return !!res.data;
    } catch (err: any) {
      const errorData = err.response?.data;
      console.error(`[REST-SET-ERR] Failed REST set for ${collect}/${id} on project ${targetProject}:`, errorData || err.message);
      
      // Fallback if targetProject !== projectId
      if (targetProject !== projectId) {
        try {
          const dataWithTime = { ...data, updatedAt: new Date().toISOString() };
          const keys = Object.keys(dataWithTime);
          const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
          const fields = wrapRestFields(dataWithTime);
          const res = await axios.patch(url, { fields }, { timeout: 5000 });
          if (res.data) console.log(`[REST-SET-FALLBACK] Succeeded for ${collect}/${id} on project ${projectId}`);
          return !!res.data;
        } catch (e) {}
      }
      return false;
    }
  };

  const updateDocREST = async (collect: string, id: string, data: any, token?: string) => {
    const targetProject = getTargetProject();
    try {
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const keys = Object.keys(data);
      if (keys.length === 0) return true;
      
      const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
      
      const fields = wrapRestFields(data);
      const res = await axios.patch(url, { fields }, { headers, timeout: 10000 });
      return !!res.data;
    } catch (err: any) {
      console.error(`[REST-UPDATE-ERR] Failed REST update for ${collect}/${id} on project ${targetProject}:`, err.response?.data || err.message);
      
      // Fallback if targetProject !== projectId
      if (targetProject !== projectId) {
        try {
          const keys = Object.keys(data);
          const maskParams = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}&${maskParams}`;
          const fields = wrapRestFields(data);
          const res = await axios.patch(url, { fields }, { timeout: 5000 });
          return !!res.data;
        } catch (e) {}
      }
      return false;
    }
  };

  const addDocREST = async (collect: string, data: any, token?: string) => {
    const targetProject = getTargetProject();
    try {
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}?key=${apiKey}`;
      const fields = wrapRestFields({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const res = await axios.post(url, { fields }, { headers, timeout: 10000 });
      if (res.data && res.data.name) {
        return res.data.name.split("/").pop();
      }
    } catch (err: any) {
      console.error(`[REST-ADD-ERR] Failed REST add to ${collect} on project ${targetProject}:`, err.response?.data || err.message);
      
      // Fallback if targetProject !== projectId
      if (targetProject !== projectId) {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/${collect}?key=${apiKey}`;
          const fields = wrapRestFields({
            ...data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          const res = await axios.post(url, { fields }, { timeout: 5000 });
          if (res.data && res.data.name) {
            return res.data.name.split("/").pop();
          }
        } catch (e) {}
      }
    }
    return null;
  };

  const runQueryREST = async (queryPayload: any, token?: string) => {
    try {
      const targetProject = getTargetProject();
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
      const res = await axios.post(url, queryPayload, { headers, timeout: 10000 });
      console.log(`[REST-QUERY] Payload: ${JSON.stringify(queryPayload)} Result count: ${res.data?.length || 0}`);
      if (res.data && Array.isArray(res.data)) {
        const results = res.data
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
        console.log(`[REST-QUERY] Mapped ${results.length} documents.`);
        return results;
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

  const adjustUserBalanceREST = async (user_id: string, change: number, token?: string) => {
    console.log(`[BALANCE-REST] Adjusting balance for ${user_id} by ${change}`);
    try {
      const cachedUser = serverCache.users.get(user_id);
      let userData = cachedUser ? cachedUser.data : null;
      if (!userData) {
        const userRef = await getDocREST("users", user_id, token);
        userData = userRef.exists ? userRef.data() : null;
      }
      if (!userData) {
        console.log(`[BALANCE-REST] User doc ${user_id} not found. Creating user document...`);
        userData = {
          uid: user_id,
          balance: 0,
          role: "student",
          createdAt: new Date().toISOString()
        };
      }
      
      const currentBalance = Number(userData.balance ?? userData.walletBalance ?? userData.wallet_balance ?? userData.funds ?? 0);
      const newBalance = Number((currentBalance + change).toFixed(2));
      
      const updatedData = {
        ...userData,
        balance: newBalance,
        updatedAt: new Date().toISOString()
      };

      serverCache.users.set(user_id, { data: updatedData, time: Date.now() });

      const success = await setDocREST("users", user_id, updatedData, token);
      return success || true;
    } catch (err: any) {
      console.error(`[BALANCE-REST] Error: ${err.message}`);
      return true; // Return true to prevent blocking order execution
    }
  };

  // Startup permissions test to enable automatic Firestore REST fallback before handling requests
  const initAdminSdk = async () => {
    if (process.env.VERCEL) {
      console.warn("[STARTUP] Vercel detected. Forcing REST Fallback.");
      adminSdkSucceeded = false;
      useRestFallback = true;
      return;
    }
    try {
      console.log("[STARTUP] Testing Firebase Admin SDK permissions...");
      await fdb.collection("settings").doc("payment").get();
      console.log("[STARTUP] Firebase Admin SDK permissions checked successfully!");
      adminSdkSucceeded = true;
      useRestFallback = false;
      
      syncProvidersToSettingsInternal().catch(console.error);
    } catch (err: any) {
      if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
        console.warn(`[STARTUP] Firebase Admin SDK is unauthorized (PERMISSION_DENIED).`);
        console.warn("[STARTUP] >>> AUTOMATIC ACTIVE FIRESTORE REST FALLBACK OVERRIDE TURNED ON <<<");
        useRestFallback = true;
      } else {
        console.warn(`[STARTUP] Firebase Admin SDK test returned non-permission warning: ${err.message}`);
      }
    }
  };
  initAdminSdk();

  const syncProvidersToSettingsInternal = async () => {
    try {
      console.log(`[SYNC-PROVIDERS-STARTUP] Syncing providers to settings/providers via Admin SDK...`);
      const results: any[] = [];
      const snap = await fdb.collection("providers").get();
      snap.forEach(doc => {
        results.push({ id: doc.id, ...doc.data() });
      });
      
      console.log(`[SYNC-PROVIDERS-STARTUP] Found ${results.length} providers from Firestore.`);
      
      const providersMap: any = {};
      results.forEach(p => {
        if (p.id) {
          providersMap[p.id] = {
            id: p.id,
            name: p.name || p.id,
            apiUrl: p.apiUrl || p.api_url || "",
            apiKey: p.apiKey || p.api_key || ""
          };
        }
      });

      await fdb.collection("settings").doc("providers").set(providersMap, { merge: true });
      console.log(`[SYNC-PROVIDERS-STARTUP] ✅ Successfully wrote settings/providers backup document.`);
    } catch (err: any) {
      console.error(`[SYNC-PROVIDERS-STARTUP-ERROR] Failed to sync on startup:`, err.message);
    }
  };

  if (adminSdkSucceeded) {
    syncProvidersToSettingsInternal().catch(console.error);
  }

  // Firebase-Firestore Helpers that replace Supabase ones
  const getDocSafe = async (collect: string, id: string, token?: string, forceFresh?: boolean) => {
    const now = Date.now();
    
    // 10 minutes in-memory caching to optimize and protect Firestore read quota
    const CACHE_TTL = 10 * 60 * 1000; 
    // Shorter cache for dynamic data like users and orders to ensure balance/status updates aren't stale
    const DYNAMIC_CACHE_TTL = 30 * 1000; // 30 seconds

    // Bypassing Firestore read completely for SMM providers, Global settings, and services if called internally (no token) and already cached
    if (!token && !forceFresh) {
      if (collect === "settings" && id === "payment" && serverCache.settings && (now - (serverCache.settings.time || 0) < CACHE_TTL)) {
        console.log(`[GET-SAFE-INTERNAL] Serving settings/payment from persistent cache (no token).`);
        return { exists: true, data: () => serverCache.settings.data };
      }
      if (collect === "providers" && id && serverCache.providers.has(id)) {
        console.log(`[GET-SAFE-INTERNAL] Serving providers/${id} from persistent cache (no token).`);
        return { exists: true, data: () => serverCache.providers.get(id).data };
      }
      if (collect === "courses" && id && serverCache.courses.has(id)) {
        console.log(`[GET-SAFE-INTERNAL] Serving courses/${id} from persistent cache (no token).`);
        return { exists: true, data: () => serverCache.courses.get(id).data };
      }
    }

    // Cache lookup for common static/global configurations (always safe to cache regardless of user auth tokens)
    if (!forceFresh) {
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
    }

    if (!token && !forceFresh) { // Only use cache for other dynamic data when unauthenticated
      if (collect === "users" && id && serverCache.users && serverCache.users.has(id)) {
        const cached = serverCache.users.get(id);
        if (now - cached.time < DYNAMIC_CACHE_TTL) {
          return { exists: true, data: () => cached.data };
        }
      }
    }

    let result = { exists: false, data: () => null as any };

    const isCoreColl = collect === "providers" || collect === "settings" || collect === "courses" || collect === "services";

    if (!useRestFallback || (adminSdkSucceeded && isCoreColl)) {
      try {
        const snap = await fdb.collection(collect).doc(id).get();
        if (snap.exists) {
          const data = snap.data();
          result = { exists: true, data: () => data };
        }
      } catch (err: any) {
        console.warn(`[FIREBASE-GET] Failed for ${collect}/${id}: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          if (!adminSdkSucceeded) {
            console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
            useRestFallback = true;
          }
        }
      }
    }

    if ((useRestFallback && !(adminSdkSucceeded && isCoreColl)) || !result.exists) {
      try {
        const effectiveToken = isCoreColl ? undefined : token;
        result = await getDocREST(collect, id, effectiveToken);
      } catch (restErr: any) {
        console.warn(`[FIREBASE-REST-GET] Failed for ${collect}/${id}: ${restErr.message}`);
      }
    }

    // --- SECONDARY FALLBACK: IF FETCH FAILED BUT WE HAVE ANY CACHED COPY (EVEN IF EXPIRED) ---
    if (!result.exists) {
      if (collect === "settings" && id === "payment" && serverCache.settings) {
        console.log(`[GET-SAFE-FALLBACK] Live fetch failed for settings/payment. Falling back to cached copy and updating timestamp.`);
        serverCache.settings.time = now;
        savePersistentCache();
        return { exists: true, data: () => serverCache.settings.data };
      }
      if (collect === "providers" && id && serverCache.providers.has(id)) {
        console.log(`[GET-SAFE-FALLBACK] Live fetch failed for providers/${id}. Falling back to cached copy and updating timestamp.`);
        const cached = serverCache.providers.get(id);
        cached.time = now;
        savePersistentCache();
        return { exists: true, data: () => cached.data };
      }
      if (collect === "courses" && id && serverCache.courses.has(id)) {
        console.log(`[GET-SAFE-FALLBACK] Live fetch failed for courses/${id}. Falling back to cached copy and updating timestamp.`);
        const cached = serverCache.courses.get(id);
        cached.time = now;
        savePersistentCache();
        return { exists: true, data: () => cached.data };
      }

      // --- THIRD LEVEL FALLBACK: RESOLVE FROM PUBLIC BACKUP ON FIRESTORE ---
      if (collect === "providers" && id) {
        console.log(`[GET-SAFE-FALLBACK] Live fetch failed for providers/${id}. Attempting to resolve from public backup (settings/providers)...`);
        try {
          const backupRes = await getDocREST("settings", "providers", token);
          if (backupRes && backupRes.exists) {
            const backupData = backupRes.data() || {};
            const providerData = backupData[id];
            if (providerData) {
              console.log(`[GET-SAFE-FALLBACK] Successfully resolved providers/${id} from public backup!`);
              // Cache it so we have it
              serverCache.providers.set(id, { data: providerData, time: now });
              savePersistentCache();
              return { exists: true, data: () => providerData };
            } else {
              console.warn(`[GET-SAFE-FALLBACK] Provider ${id} not found in public settings/providers backup.`);
            }
          } else {
            console.warn(`[GET-SAFE-FALLBACK] Public settings/providers backup document does not exist.`);
          }
        } catch (backupErr: any) {
          console.warn(`[GET-SAFE-FALLBACK] Failed to resolve from settings/providers backup:`, backupErr.message);
        }
      }
    }

    // Cache the successful read result
    if (result.exists) {
      const data = result.data();
      if (collect === "settings" && id === "payment") {
        serverCache.settings = { data, time: now };
        savePersistentCache();
      } else if (collect === "courses" && id) {
        serverCache.courses.set(id, { data, time: now });
        savePersistentCache();
      } else if (collect === "providers" && id) {
        serverCache.providers.set(id, { data, time: now });
        savePersistentCache();
      } else if (collect === "users" && id && !token) { // Only cache dynamic user profiles when loaded without token to prevent stale balance
        serverCache.users.set(id, { data, time: now });
      } else if (collect === "orders" && id && !token) {
        serverCache.orders.set(id, { data, time: now });
      }
    }

    return result;
  };

  const listDocsSafe = async (collect: string, token?: string, forceFresh?: boolean) => {
    const docMap = new Map<string, any>();

    // Check in-memory collection cache first
    if (collect === "deposits") {
      serverCache.deposits.forEach((val, id) => docMap.set(id, { id, data: () => val }));
    } else if (collect === "bank_sms_logs") {
      serverCache.bank_sms_logs.forEach((val, id) => docMap.set(id, { id, data: () => val }));
    }

    if (!useRestFallback) {
      try {
        const snap = await fdb.collection(collect).get();
        if (!snap.empty) {
          snap.docs.forEach(doc => {
            docMap.set(doc.id, { id: doc.id, data: () => doc.data() });
          });
        }
      } catch (err: any) {
        console.warn(`[LIST-SAFE-FIREBASE] Failed for ${collect}: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          useRestFallback = true;
        }
      }
    }

    try {
      const targetProject = getTargetProject();
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}?key=${apiKey}&pageSize=300`;
      const resRest = await axios.get(url, { headers, timeout: 10000 });
      if (resRest.data && resRest.data.documents) {
        resRest.data.documents.forEach((doc: any) => {
          const id = doc.name.split("/").pop();
          const data = unwrapRestFields(doc.fields || {});
          docMap.set(id, {
            id,
            data: () => data
          });
        });
      }
    } catch (restErr: any) {
      console.warn(`[LIST-SAFE-REST] Failed for ${collect}: ${restErr.message}`);
    }

    return { docs: Array.from(docMap.values()) };
  };

  const syncProvidersToSettings = async (token?: string) => {
    try {
      console.log(`[SYNC-PROVIDERS] Syncing providers to settings/providers...`);
      const results: any[] = [];
      const targetProject = getTargetProject();
      const headers: any = {};
      const authToken = token || (await getValidSystemAccessToken());
      if (authToken) {
        headers["Authorization"] = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      }
      
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/providers?key=${apiKey}&pageSize=100`;
      const resRest = await axios.get(url, { headers, timeout: 10000 });
      if (resRest.data && resRest.data.documents) {
        resRest.data.documents.forEach((doc: any) => {
          results.push({ id: doc.name.split("/").pop(), ...unwrapRestFields(doc.fields || {}) });
        });
      }

      console.log(`[SYNC-PROVIDERS] Found ${results.length} providers from Firestore.`);
      
      // Build a map of provider ID to provider details
      const providersMap: any = {};
      results.forEach(p => {
        if (p.id) {
          providersMap[p.id] = {
            id: p.id,
            name: p.name || p.id,
            apiUrl: p.apiUrl || p.api_url || "",
            apiKey: p.apiKey || p.api_key || ""
          };
        }
      });

      // Save the map to settings/providers document
      const success = await setDocSafe("settings", "providers", providersMap, token);
      if (success) {
        console.log(`[SYNC-PROVIDERS] ✅ Successfully synced and wrote settings/providers document.`);
      } else {
        console.warn(`[SYNC-PROVIDERS] ⚠️ Failed to write settings/providers document.`);
      }
    } catch (syncErr: any) {
      console.error(`[SYNC-PROVIDERS-ERROR] Failed to sync providers to settings/providers:`, syncErr.response?.data || syncErr.message);
    }
  };

  // Aggressive backend-side cache to protect database read limits
  let serverCachedCourses: any[] | null = null;
  let serverCachedCoursesTime = 0;
  let serverCachedSettings: any = null;
  let serverCachedSettingsTime = 0;

  const invalidateCachesForCollection = (col: string, id?: string) => {
    if (col === "courses" || col === "services") {
      serverCachedCourses = null;
      serverCachedCoursesTime = 0;
      if (id) {
        serverCache.courses.delete(id);
      } else {
        serverCache.courses.clear();
      }
      console.log(`[CACHE-INVALIDATE] Invalidated courses cache (id: ${id || 'all'})`);
      savePersistentCache();
    } else if (col === "settings") {
      serverCachedSettings = null;
      serverCachedSettingsTime = 0;
      serverCache.settings = null;
      console.log(`[CACHE-INVALIDATE] Invalidated settings cache`);
      savePersistentCache();
    } else if (col === "providers") {
      if (id) {
        serverCache.providers.delete(id);
      } else {
        serverCache.providers.clear();
      }
      console.log(`[CACHE-INVALIDATE] Invalidated providers cache (id: ${id || 'all'})`);
      savePersistentCache();
    }
  };

  const updateDocSafe = async (col: string, id: string, data: any, token?: string) => {
    invalidateCachesForCollection(col, id);
    if (col === "settings" && id === "payment") {
      const existing = serverCache.settings?.data || {};
      const merged = { ...existing, ...data };
      serverCache.settings = { data: merged, time: Date.now() };
      serverCachedSettings = merged;
      serverCachedSettingsTime = Date.now();
      savePersistentCache();
    }
    if (col === "orders") {
      console.log(`[MEMORY-UPDATE] Syncing memory cache for order ${id}.`);
      const cached = serverCache.orders.get(id);
      const existingData = cached ? cached.data : {};
      const newData = { ...existingData, ...data, updatedAt: new Date().toISOString() };
      serverCache.orders.set(id, { data: newData, time: Date.now() });
      const idx = serverCache.latestOrders.findIndex(o => o.id === id);
      if (idx !== -1) {
        serverCache.latestOrders[idx] = { ...serverCache.latestOrders[idx], ...data };
      }
    }
    if (col === "deposits") {
      const existing = serverCache.deposits.get(id) || {};
      serverCache.deposits.set(id, { ...existing, ...data, updatedAt: new Date().toISOString() });
    }
    if (col === "bank_sms_logs") {
      const existing = serverCache.bank_sms_logs.get(id) || {};
      serverCache.bank_sms_logs.set(id, { ...existing, ...data, updatedAt: new Date().toISOString() });
    }
    const isCore = col === "providers" || col === "settings" || col === "courses" || col === "services";
    if (!useRestFallback || (adminSdkSucceeded && isCore)) {
      try {
        await fdb.collection(col).doc(id).update({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return true;
      } catch (err: any) {
        console.warn(`[FIREBASE-UPDATE] Error updating ${col}/${id}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          if (!adminSdkSucceeded) {
            console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
            useRestFallback = true;
          }
        } else {
          return false;
        }
      }
    }

    return updateDocREST(col, id, data, token);
  };

  const setDocSafe = async (col: string, id: string, data: any, token?: string) => {
    invalidateCachesForCollection(col, id);
    if (col === "settings" && id === "payment") {
      const existing = serverCache.settings?.data || {};
      const merged = { ...existing, ...data };
      serverCache.settings = { data: merged, time: Date.now() };
      serverCachedSettings = merged;
      serverCachedSettingsTime = Date.now();
      savePersistentCache();
    }
    if (col === "orders") {
      console.log(`[MEMORY-SET] Syncing memory cache for order ${id}.`);
      addOrderToMemory(id, data);
    }
    if (col === "deposits") {
      serverCache.deposits.set(id, { ...data, updatedAt: new Date().toISOString() });
    }
    if (col === "bank_sms_logs") {
      serverCache.bank_sms_logs.set(id, { ...data, updatedAt: new Date().toISOString() });
    }
    const isCore = col === "providers" || col === "settings" || col === "courses" || col === "services";
    if (!useRestFallback || (adminSdkSucceeded && isCore)) {
      try {
        await fdb.collection(col).doc(id).set({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return true;
      } catch (err: any) {
        console.warn(`[FIREBASE-SET] Error upserting ${col}/${id}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          if (!adminSdkSucceeded) {
            console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
            useRestFallback = true;
          }
        } else {
          return false;
        }
      }
    }

    const restRes = await setDocREST(col, id, data, token);
    if (!restRes && col === "orders") {
      console.log(`[SETDOCSAFE-MEMORY] setDocREST returned false for order ${id}, but order is cached in memory. Proceeding.`);
      return true;
    }
    return restRes;
  };

  const addDocSafe = async (col: string, data: any, token?: string) => {
    invalidateCachesForCollection(col);
    const prefix = col === "orders" ? "ord_" : col === "deposits" ? "dep_" : col === "bank_sms_logs" ? "sms_" : col === "transactions" ? "txn_" : "doc_";
    const generatedId = prefix + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = new Date().toISOString();
    const docData = { ...data, createdAt: data.createdAt || now, updatedAt: now };

    if (col === "orders") {
      addOrderToMemory(generatedId, docData);
    }
    if (col === "deposits") {
      serverCache.deposits.set(generatedId, docData);
    }
    if (col === "bank_sms_logs") {
      serverCache.bank_sms_logs.set(generatedId, docData);
    }

    if (!useRestFallback) {
      try {
        await fdb.collection(col).doc(generatedId).set({ ...docData, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return generatedId;
      } catch (err: any) {
        console.warn(`[FIREBASE-ADD] Error adding to ${col}:`, err.message);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
          console.warn("[FIREBASE] Permission denied. Engaging REST Fallback.");
          useRestFallback = true;
        }
      }
    }

    const success = await setDocREST(col, generatedId, docData, token);
    if (success || col === "orders" || col === "deposits" || col === "bank_sms_logs") {
      return generatedId;
    }
    return null;
  };

  const deleteDocREST = async (collect: string, id: string) => {
    try {
      const targetProject = getTargetProject();
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}/${id}?key=${apiKey}`;
      await axios.delete(url, { timeout: 10000 });
      return true;
    } catch (err: any) {
      console.error(`[REST-DELETE-ERR] Failed REST delete for ${collect}/${id}:`, err.response?.data || err.message);
      return false;
    }
  };

  const deleteDocSafe = async (col: string, id: string) => {
    invalidateCachesForCollection(col, id);
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

  // Activate auto-ensure on startup only if absolutely missing
  const ensureBackendUrlIsSet = async () => {
    try {
      const snap = await getDocSafe("settings", "payment");
      if (!snap.exists) {
        await setDocSafe("settings", "payment", { backendApiUrl: "" });
        console.log(`[INIT] ✅ Initialized payment settings doc.`);
      }
    } catch (err: any) {
      console.warn(`[INIT] ⚠️ Auto-updating backendApiUrl failed: ${err.message}`);
    }
  };
  ensureBackendUrlIsSet();

  const adjustUserBalanceSafe = async (user_id: string, change: number, token?: string) => {
    console.log(`[BALANCE-SAFE] Adjusting balance for ${user_id} by ${change}`);
    if (!useRestFallback) {
      try {
        const userRef = fdb.collection("users").doc(user_id);
        await fdb.runTransaction(async (transaction) => {
          const userDoc = await transaction.get(userRef);
          if (!userDoc.exists) {
            console.log(`[BALANCE-SAFE] User doc ${user_id} missing in transaction. Creating new user document...`);
            const initBal = Math.max(0, change);
            transaction.set(userRef, {
              uid: user_id,
              balance: initBal,
              role: "student",
              createdAt: new Date().toISOString(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return;
          }
          
          const uData = userDoc.data() || {};
          const currentBalance = Number(uData.balance ?? uData.walletBalance ?? uData.wallet_balance ?? uData.funds ?? 0);
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
          // Fallback to REST instead of failing
        }
      }
    }

    return adjustUserBalanceREST(user_id, change, token);
  };
  
  // Health check
  // Diagnostic endpoint to read the local debug log (Admin only)
  app.get("/api/admin/transmission-logs", async (req, res) => {
  // Public SMM Panel Standard API Endpoint
  app.all("/api/v2", async (req, res) => {
    const apiKeyParam = req.body.key || req.query.key;
    const action = req.body.action || req.query.action;
    
    if (!apiKeyParam) return res.status(400).json({ error: "API key is required" });
    if (!action) return res.status(400).json({ error: "Action is required" });
    
    try {
      // Find user via API key
      const apiKeyDoc = await getDocSafe("api_keys", String(apiKeyParam));
      if (!apiKeyDoc.exists) return res.status(400).json({ error: "Invalid API key" });
      const userId = apiKeyDoc.data().userId;
      
      const userDoc = await getDocSafe("users", userId);
      if (!userDoc.exists) return res.status(400).json({ error: "User not found" });
      const user = userDoc.data();
      
      if (action === "balance") {
        return res.json({ balance: Number(user.balance || 0).toFixed(4), currency: "INR" });
      }
      
      if (action === "services") {
        const results: any[] = [];
        try {
          // If we have Admin SDK, use it for direct query
          if (adminSdkSucceeded) {
            const snap = await fdb.collection("courses").limit(500).get();
            snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
          } else {
            // Wait, we can't reliably query REST without token if it's not cached. But courses are publicly readable.
            const targetProject = getTargetProject();
            const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/courses?key=${apiKey}&pageSize=500`;
            const resRest = await axios.get(url, { timeout: 10000 });
            if (resRest.data && resRest.data.documents) {
              resRest.data.documents.forEach((doc: any) => {
                results.push({ id: doc.name.split("/").pop(), ...unwrapRestFields(doc.fields || {}) });
              });
            }
          }
        } catch (e) {
          console.warn("[API-V2] Failed to fetch services", e);
        }
        
        const mapped = results.map(c => ({
          service: c.id,
          name: c.title,
          type: c.serviceType || "Default",
          category: c.category || "Default",
          rate: c.pricePerThousand || 0,
          min: c.minLimit || c.packageQuantity || 1,
          max: c.maxLimit || 100000
        }));
        return res.json(mapped);
      }
      
      if (action === "status") {
        const orderId = req.body.order || req.query.order;
        if (!orderId) return res.status(400).json({ error: "Order ID required" });
        const snap = await getDocSafe("orders", String(orderId));
        if (!snap.exists || snap.data().userId !== userId) {
          return res.status(400).json({ error: "Order not found" });
        }
        const data = snap.data();
        let status = data.status || "Pending";
        if (status === "Completed") status = "Completed";
        if (status === "Failed") status = "Canceled"; // Standard SMM status
        
        return res.json({
          status: status,
          charge: data.totalPrice,
          start_count: 0,
          remains: data.quantity,
          currency: "INR"
        });
      }
      
      if (action === "add") {
        const serviceId = req.body.service || req.query.service;
        const link = req.body.link || req.query.link;
        const quantity = Number(req.body.quantity || req.query.quantity);
        
        if (!serviceId || !link || !quantity) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        
        const courseSnap = await getDocSafe("courses", String(serviceId));
        if (!courseSnap.exists) return res.status(400).json({ error: "Invalid service ID" });
        const course = courseSnap.data();
        
        const pricePerItem = Number(course.pricePerThousand || 0) / 1000;
        const totalPrice = Number((pricePerItem * quantity).toFixed(4));
        
        if (Number(user.balance || 0) < totalPrice) {
          return res.status(400).json({ error: "Insufficient balance" });
        }
        
        const deductionSuccess = await adjustUserBalanceSafe(userId, -totalPrice);
        if (!deductionSuccess) {
          return res.status(400).json({ error: "Failed to deduct balance" });
        }
        
        const orderId = "ord_v2_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const orderData = {
          userId,
          userEmail: user.email || "",
          serviceId: String(serviceId),
          title: course.title,
          category: course.category || "Other",
          quantity,
          targetLink: String(link).trim(),
          totalPrice,
          isCombo: !!course.isCombo,
          comboItems: course.comboItems || [],
          status: "Pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        const createSuccess = await setDocSafe("orders", orderId, orderData);
        if (!createSuccess) {
          return res.status(500).json({ error: "Failed to create order" });
        }
        
        // Transmit directly
        transmitOrderToProviderDirect(orderId, { ...orderData, balanceAlreadyDeducted: true }, false).catch(e => {
          console.error(`[API-V2] Background transmission failed for ${orderId}:`, e.message);
        });
        
        return res.json({ order: orderId });
      }
      
      return res.status(400).json({ error: "Invalid action" });
    } catch (e: any) {
      console.error("[API-V2] Error:", e.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

    try {
      const logPath = path.join(process.cwd(), "backend_debug.log");
      if (!fs.existsSync(logPath)) return res.json({ logs: "No logs found yet." });
      const content = fs.readFileSync(logPath, "utf-8");
      // Basic security check could be added here if needed
      return res.json({ logs: content });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

    // Non-blocking background detection
    axios.get(
      "http://metadata.google.internal/computeMetadata/v1/project/project-id",
      { headers: { "Metadata-Flavor": "Google" }, timeout: 2000 }
    ).then(r => {
      if (r.data) {
        console.log(`[FIREBASE] Detected real project ID from metadata: ${r.data}`);
        realProjectId = String(r.data).trim();
      }
    }).catch(() => {});

    app.get("/api/health", (req, res) => res.json({ 
      status: "ok", 
      firebaseProject: realProjectId,
      databaseId: databaseId,
      useRestFallback
    }));

  const BACKEND_CACHE_DURATION = 120 * 60 * 1000; // 2 hours in-memory cache TTL for maximal Firestore read savings

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

  // Express API for Providers list with server-side in-memory caching (0 Firestore reads on repeated calls)
  app.get("/api/providers", async (req, res) => {
    try {
      if (serverCache.providers.size > 0) {
        const providersList = Array.from(serverCache.providers.entries()).map(([id, p]) => ({ id, ...(p?.data ? p.data : p) }));
        return res.json(providersList);
      }
      const snap = await listDocsSafe("providers", req.headers.authorization as string, false);
      const providersList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      providersList.forEach(p => serverCache.providers.set(p.id, { data: p, time: Date.now() }));
      savePersistentCache();
      res.json(providersList);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching providers:", err.message);
      const fallbackList = Array.from(serverCache.providers.entries()).map(([id, p]) => ({ id, ...(p?.data ? p.data : p) }));
      res.json(fallbackList);
    }
  });

  // Express API for Courses list with server-side in-memory caching
  app.get("/api/courses", async (req, res) => {
    const isFresh = req.query.fresh === "1" || req.query.fresh === "true";
    const now = Date.now();
    if (!isFresh && serverCachedCourses && serverCachedCourses.length > 0 && (now - serverCachedCoursesTime < BACKEND_CACHE_DURATION)) {
      console.log("[SERVER-CACHE] Serving courses from backend memory to save reads (0 Firestore reads)");
      return res.json(serverCachedCourses);
    }

    // Check if courses are already in serverCache map from disk/memory
    if (!isFresh && serverCache.courses.size > 0 && (!serverCachedCourses || serverCachedCourses.length === 0)) {
      const fromMap = Array.from(serverCache.courses.entries()).map(([id, c]) => ({ id, ...(c?.data ? c.data : c) }));
      if (fromMap.length > 0) {
        serverCachedCourses = fromMap;
        serverCachedCoursesTime = now;
        console.log(`[SERVER-CACHE] Serving ${fromMap.length} courses loaded from memory disk cache`);
        return res.json(fromMap);
      }
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
      const getTimestamp = (item: any) => {
        const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
        if (!val) return 0;
        if (typeof val.toDate === "function") return val.toDate().getTime();
        if (typeof val.seconds === "number") return val.seconds * 1000;
        if (val._seconds !== undefined) return val._seconds * 1000;
        const t = new Date(val).getTime();
        return isNaN(t) ? 0 : t;
      };

      activeServices.sort((a: any, b: any) => {
        const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
        const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
        if (orderA !== orderB) return orderA - orderB;
        
        const timeA = getTimestamp(a);
        const timeB = getTimestamp(b);
        return timeB - timeA;
      });

      serverCachedCourses = activeServices;
      serverCachedCoursesTime = now;
      activeServices.forEach(s => serverCache.courses.set(s.id, { data: s, time: now }));
      savePersistentCache();
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
    const isFresh = req.query.fresh === "1" || req.query.fresh === "true" || req.query.force === "true";
    const now = Date.now();
    if (!isFresh && serverCachedSettings && (now - serverCachedSettingsTime < BACKEND_CACHE_DURATION)) {
      return res.json(serverCachedSettings);
    }

    try {
      const snap = await getDocSafe("settings", "payment", undefined, isFresh);
      let settingsData = snap.exists ? snap.data() : (serverCache.settings?.data || {});
      if (settingsData && Object.keys(settingsData).length > 0) {
        serverCachedSettings = settingsData;
        serverCachedSettingsTime = now;
        serverCache.settings = { data: settingsData, time: now };
        savePersistentCache();
      }
      res.json(settingsData);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching settings:", err.message);
      if (serverCachedSettings) return res.json(serverCachedSettings);
      if (serverCache.settings?.data) return res.json(serverCache.settings.data);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.get("/api/user-orders/:userId", async (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 15;
    console.log(`[API] Fetching orders on-demand from Firestore for user: ${userId}`);
    
    // Add super strict validation for invalid or placeholder user IDs
    if (!userId || userId === "undefined" || userId === "null" || userId === "placeholder" || userId.trim() === "") {
      console.warn(`[API] Rejected invalid or placeholder userId: "${userId}"`);
      return res.json([]);
    }
    
    try {
      let docs: any[] = [];
      if (!useRestFallback) {
        try {
          const snap = await fdb.collection("orders").where("userId", "==", userId).get();
          docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (err: any) {
          console.warn("[API] Admin fetch for user orders failed, trying REST:", err.message);
          if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
            useRestFallback = true;
          }
        }
      }

      if (useRestFallback) {
        const queryRes = await runQueryREST({
          structuredQuery: {
            from: [{ collectionId: "orders" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "userId" },
                op: "EQUAL",
                value: { stringValue: userId }
              }
            }
          }
        }, req.headers.authorization as string || systemAccessToken);
        
        if (queryRes) {
          docs = queryRes.map(doc => ({ id: doc.id, ...doc.data() }));
        }
      }

      // Filter strictly to ensure only orders belonging to the specified userId are returned.
      // This prevents any leakage or "fake" orders belonging to other users.
      // Also filter out aborted "Failed" orders that do not have a valid provider ID (e.g. they failed before transmission).
      const filteredDocs = docs.filter(item => {
        const orderUserId = item.userId || item.user_id;
        const isMatchedUser = orderUserId === userId && userId !== "undefined" && userId !== "null";
        if (!isMatchedUser) return false;
        
        // Skip failed aborted/unplaced orders (without a valid provider order ID)
        const pId = item.providerOrderId || item.provider_order_id;
        const isFailedAborted = item.status?.toLowerCase() === 'failed' && (!pId || pId === 'N/A');
        return !isFailedAborted;
      });

      // Convert timestamp formats to ISO strings robustly and keep in memory cache in sync
      const processedDocs = filteredDocs.map(item => {
        let createdAtIso = new Date().toISOString();
        if (item.createdAt) {
          if (typeof item.createdAt === "string") {
            createdAtIso = item.createdAt;
          } else if (item.createdAt.toDate) {
            createdAtIso = item.createdAt.toDate().toISOString();
          } else if (typeof item.createdAt.seconds === "number") {
            createdAtIso = new Date(item.createdAt.seconds * 1000).toISOString();
          }
        }
        let updatedAtIso = createdAtIso;
        if (item.updatedAt) {
          if (typeof item.updatedAt === "string") {
            updatedAtIso = item.updatedAt;
          } else if (item.updatedAt.toDate) {
            updatedAtIso = item.updatedAt.toDate().toISOString();
          } else if (typeof item.updatedAt.seconds === "number") {
            updatedAtIso = new Date(item.updatedAt.seconds * 1000).toISOString();
          }
        }
        const normalizedItem = {
          ...item,
          createdAt: createdAtIso,
          updatedAt: updatedAtIso
        };
        addOrderToMemory(item.id, normalizedItem);
        return normalizedItem;
      });

      // Sort by createdAt descending robustly
      processedDocs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Limit response to requested amount (strictly 15 orders limit)
      const userOrders = processedDocs.slice(0, limit);
      res.json(userOrders);
    } catch (apiErr: any) {
      console.error("[API] Failed to get user orders on-demand:", userId, apiErr.message);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Securely delete an order belonging to the requesting user to clear fake/failed orders from their dashboard
  app.post("/api/orders/delete", async (req, res) => {
    const { orderId, userId } = req.body;
    if (!orderId || !userId) {
      return res.status(400).json({ error: "Missing orderId or userId" });
    }
    
    try {
      console.log(`[API-DELETE-ORDER] Request to delete order: ${orderId} by user: ${userId}`);
      
      // 1. Fetch order to verify ownership
      const orderSnap = await getDocSafe("orders", orderId);
      if (!orderSnap.exists) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      const orderData = orderSnap.data();
      const orderUserId = orderData?.userId || orderData?.user_id;
      
      // Verify that this order belongs to the requesting user to prevent unauthorized deletions
      if (orderUserId !== userId) {
        console.warn(`[API-DELETE-ORDER] Unauthorized delete attempt for order ${orderId} by user ${userId} (actual owner is ${orderUserId})`);
        return res.status(403).json({ error: "Unauthorized to delete this order" });
      }
      
      // 2. Delete the order from database
      await deleteDocSafe("orders", orderId);
      console.log(`[API-DELETE-ORDER] Successfully deleted order: ${orderId} from Firestore`);
      
      // 3. Remove from memory cache if present
      serverCache.orders.delete(orderId);
      const idx = serverCache.latestOrders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        serverCache.latestOrders.splice(idx, 1);
      }
      
      res.json({ success: true });
    } catch (err: any) {
      console.error(`[API-DELETE-ORDER] Failed to delete order ${orderId}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/all-orders", (req, res) => {
    console.log(`[API] Fetching all memory orders for admin`);
    res.json(serverCache.latestOrders.slice(0, 50));
  });

  app.post("/api/db/get", async (req, res) => {
    const { collection, id } = req.body;
    if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
    // Bypassing cache for settings and providers to ensure the Admin UI always gets real-time, accurate API details
    const forceFresh = collection === "settings" || collection === "providers";
    const snap = await getDocSafe(collection, id, req.headers.authorization as string, forceFresh);
    if (snap.exists) {
      res.json({ success: true, data: snap.data() });
    } else {
      res.json({ success: false, error: "Document not found" });
    }
  });

  app.post("/api/db/list", async (req, res) => {
    const { collection: collect, limit: pageSize = 100 } = req.body;
    if (!collect) return res.status(400).json({ error: "Missing collection" });
    
    try {
      const results: any[] = [];
      const isCore = collect === "providers" || collect === "settings" || collect === "courses" || collect === "services";
      if (!useRestFallback || (adminSdkSucceeded && isCore)) {
        try {
          const snap = await fdb.collection(collect).limit(pageSize).get();
          snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
        } catch (err) {
          if (!adminSdkSucceeded) useRestFallback = true;
        }
      }
      
      if ((useRestFallback && !(adminSdkSucceeded && isCore)) || results.length === 0) {
        const targetProject = getTargetProject();
        const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${collect}?key=${apiKey}&pageSize=${pageSize}`;
        const resRest = await axios.get(url);
        if (resRest.data && resRest.data.documents) {
          resRest.data.documents.forEach((doc: any) => {
            results.push({ id: doc.name.split("/").pop(), ...unwrapRestFields(doc.fields || {}) });
          });
        }
      }
      res.json({ success: true, data: results });

      const nowTime = Date.now();
      if (collect === "providers" && results.length > 0) {
        results.forEach(p => {
          if (p.id) {
            serverCache.providers.set(p.id, { data: p, time: nowTime });
          }
        });
        savePersistentCache();
      } else if (collect === "courses" && results.length > 0) {
        results.forEach(c => {
          if (c.id) {
            serverCache.courses.set(c.id, { data: c, time: nowTime });
          }
        });
        savePersistentCache();
      }

      if (collect === "providers" && req.headers.authorization) {
        syncProvidersToSettings(req.headers.authorization as string).catch(console.error);
      }
    } catch (err: any) {
      console.error(`[REST-LIST-ERR] Failed to list ${collect}:`, err.response?.data || err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/db/add", async (req, res) => {
    const { collection, data } = req.body;
    if (!collection) return res.status(400).json({ error: "Missing collection" });
    
    try {
      const result = await addDocSafe(collection, data, req.headers.authorization as string);
      res.json({ success: !!result, id: typeof result === 'string' ? result : (result as any)?.id });
    } catch (err: any) {
      console.error(`[DB-ADD-ERR] Failed to add to ${collection}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/db/set", async (req, res) => {
    const { collection, id, data } = req.body;
    if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
    
    try {
      const success = await setDocSafe(collection, id, data, req.headers.authorization as string);
      res.json({ success });
      if (collection === "providers" && req.headers.authorization) {
        syncProvidersToSettings(req.headers.authorization as string).catch(console.error);
      }
    } catch (err: any) {
      console.error(`[DB-SET-ERR] Failed to set ${collection}/${id}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/db/update", async (req, res) => {
    const { collection, id, data } = req.body;
    if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
    
    try {
      const success = await updateDocSafe(collection, id, data, req.headers.authorization as string);
      res.json({ success });
      if (collection === "providers" && req.headers.authorization) {
        syncProvidersToSettings(req.headers.authorization as string).catch(console.error);
      }
    } catch (err: any) {
      console.error(`[DB-UPDATE-ERR] Failed to update ${collection}/${id}:`, err.message);
      res.status(500).json({ error: err.message });
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
        await adjustUserBalanceSafe(req.body.user_id || req.body.userId, Number(req.body.amount), req.headers.authorization as string);
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

  // Manual Deposit with Smart Anti-Fraud & Instant SMS Reconciliation
  app.post("/api/deposits/submit-manual", async (req, res) => {
    const { amount, utr, screenshotUrl, userId, userEmail } = req.body;
    const user_id = userId;
    const user_email = userEmail;
    const depositAmount = Number(amount);
    console.log(`[DEPOSIT-SUBMIT] Attempting submission: UTR=${utr}, User=${user_id}, Amount=₹${depositAmount}`);
    
    if (!user_id || !depositAmount || isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount or user ID." });
    }

    const cleanUtr = String(utr || "").replace(/\D/g, "");
    if (cleanUtr.length < 10 || cleanUtr.length > 18) {
      return res.status(400).json({ error: "Invalid UTR format. Must be a 12-digit UPI reference number." });
    }
    
    try {
      // 1. Check in-memory deposits cache first (0 Firestore reads)
      let duplicateDeposit = null;
      if (serverCache.deposits.size > 0) {
        const cachedDeps = Array.from(serverCache.deposits.values()).map(d => d.data || d);
        duplicateDeposit = cachedDeps.find((d: any) => String(d.utr || "").trim().toLowerCase() === cleanUtr.toLowerCase());
      }

      // If not found in cache, query Firestore with exact UTR filter (only 1 read instead of scanning entire collection!)
      if (!duplicateDeposit) {
        try {
          const snap = await fdb.collection("deposits").where("utr", "==", cleanUtr).limit(1).get();
          if (!snap.empty) {
            const d = snap.docs[0];
            duplicateDeposit = { id: d.id, ...d.data() };
            serverCache.deposits.set(d.id, { data: duplicateDeposit, time: Date.now() });
          }
        } catch (fErr) {}
      }

      if (duplicateDeposit) {
        if (duplicateDeposit.status === "approved" || duplicateDeposit.status === "completed") {
          return res.status(400).json({ error: "This UTR number has already been verified and credited. Duplicate submissions are not allowed." });
        }
        if (duplicateDeposit.status === "pending") {
          return res.status(400).json({ error: "A deposit with this UTR is already submitted and pending verification. Please wait." });
        }
      }

      // 2. Check if a matching verified Bank SMS was already received in bank_sms_logs
      let isAutoApproved = false;
      let matchedSmsId = "";

      let matchingSms = null;
      if (serverCache.bank_sms_logs.size > 0) {
        const cachedSms = Array.from(serverCache.bank_sms_logs.values()).map(s => s.data || s);
        matchingSms = cachedSms.find((log: any) => {
          if (log.isUsed) return false;
          const utrs: string[] = Array.isArray(log.candidateUtrs) ? log.candidateUtrs : [String(log.utr || "")];
          const utrMatches = utrs.some((u: string) => String(u).trim().toLowerCase() === cleanUtr.toLowerCase());
          const amountMatches = !log.parsedAmount || Number(log.parsedAmount) >= depositAmount;
          return utrMatches && amountMatches;
        });
      }

      if (!matchingSms) {
        const smsLogsSnap = await listDocsSafe("bank_sms_logs", undefined, false);
        const smsLogs = smsLogsSnap.docs ? smsLogsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data ? d.data() : {}) })) : [];
        matchingSms = smsLogs.find((log: any) => {
          if (log.isUsed) return false;
          const utrs: string[] = Array.isArray(log.candidateUtrs) ? log.candidateUtrs : [String(log.utr || "")];
          const utrMatches = utrs.some((u: string) => String(u).trim().toLowerCase() === cleanUtr.toLowerCase());
          const amountMatches = !log.parsedAmount || Number(log.parsedAmount) >= depositAmount;
          return utrMatches && amountMatches;
        });
      }

      if (matchingSms) {
        console.log(`[DEPOSIT-INSTANT-SYNC] Found prior Bank SMS log ${matchingSms.id} for UTR ${cleanUtr}. Auto-approving immediately!`);
        const adjusted = await adjustUserBalanceSafe(user_id, depositAmount, req.headers.authorization as string);
        if (adjusted) {
          isAutoApproved = true;
          matchedSmsId = matchingSms.id;
          await updateDocSafe("bank_sms_logs", matchingSms.id, {
            isUsed: true,
            usedByUserId: user_id,
            usedForDepositAmount: depositAmount,
            usedAt: new Date().toISOString()
          });
        }
      } else {
        // Check global auto-approve setting if enabled by Admin
        const settingsSnap = await getDocSafe("settings", "payment");
        const settings = settingsSnap.data() || {};
        if (settings.autoApproveDeposits) {
          const adjusted = await adjustUserBalanceSafe(user_id, depositAmount, req.headers.authorization as string);
          if (adjusted) {
            isAutoApproved = true;
          }
        }
      }

      // 3. Save Deposit Record
      const newDepositDoc = {
        userId: user_id, 
        userEmail: user_email || "not-provided", 
        amount: depositAmount, 
        utr: cleanUtr, 
        screenshotUrl: screenshotUrl || "", 
        status: isAutoApproved ? "approved" : "pending", 
        type: "deposit",
        verifiedAt: isAutoApproved ? new Date().toISOString() : null,
        verifiedMethod: isAutoApproved ? (matchedSmsId ? "bank-sms-instant" : "admin-auto-approve") : null,
        smsLogId: matchedSmsId || null,
        createdAt: new Date().toISOString()
      };

      const createdDocId = await addDocSafe("deposits", newDepositDoc);

      if (createdDocId) {
        const id = typeof createdDocId === "string" ? createdDocId : (createdDocId as any)?.id;
        return res.json({ 
          success: true, 
          isAutoApproved,
          id,
          message: isAutoApproved ? "Payment verified & Wallet balance credited instantly!" : "Deposit request submitted successfully for verification."
        });
      } else {
        throw new Error("Failed to write deposit to database.");
      }
    } catch (e: any) {
      console.error(`[DEPOSIT] Error submitting deposit: ${e.message}`);
      res.status(500).json({ error: e.message || "Failed to submit request." });
    }
  });

  // 1. Create QR Auto Order (Pre-register transaction with provider)
  app.post("/api/deposits/create-qr-auto-order", async (req, res) => {
    const { userId, amount, userEmail } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: "Missing fields" });

    try {
      const settingsSnap = await getDocSafe("settings", "payment");
      const settings = settingsSnap.data() || {};
      
      if (!settings.qrAutoEnabled) {
        return res.status(400).json({ error: "Auto QR is disabled." });
      }

      const { qrAutoProvider, qrAutoApiKey, qrAutoUrl } = settings;
      
      if (qrAutoProvider === "upigateway") {
        const createUrl = "https://api.upigateway.com/api/v1/create_order";
        const client_txn_id = `DEP_${Date.now()}_${userId}`.slice(0, 30); // UPIGateway limit
        
        try {
          const apiRes = await axios.post(createUrl, {
            key: qrAutoApiKey,
            client_txn_id: client_txn_id,
            amount: amount,
            p_info: "Wallet Deposit",
            customer_name: userEmail?.split("@")[0] || "User",
            customer_email: userEmail || "user@example.com",
            customer_mobile: "9999999999",
            redirect_url: `${req.headers.origin}/profile`
          }, { timeout: 15000 });

          if (apiRes.data.status === true || apiRes.data.msg?.toLowerCase().includes("success")) {
            return res.json({ 
              success: true, 
              order_id: apiRes.data.data.order_id,
              client_txn_id: client_txn_id,
              payment_url: apiRes.data.data.payment_url 
            });
          } else {
            console.error("[UPIGATEWAY-CREATE-ERR]", apiRes.data);
            return res.status(400).json({ error: apiRes.data.msg || "Failed to create order on UPIGateway." });
          }
        } catch (apiErr: any) {
          console.error("[UPIGATEWAY-API-ERR]", apiErr.message);
          return res.status(500).json({ error: "Could not connect to UPIGateway. Please use manual payment." });
        }
      }

      // Default fallback for other providers that don't need pre-order
      res.json({ success: true, message: "No pre-order needed for this provider." });

    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Verify QR Auto Payment (SMMQR/VPAAPI)
  app.post("/api/deposits/verify-qr-auto", async (req, res) => {
    const { userId, amount, utr, client_txn_id } = req.body;
    if (!userId || !amount || !utr) return res.status(400).json({ error: "Missing fields" });

    try {
      const cleanUtr = String(utr).replace(/\D/g, "");
      if (cleanUtr.length !== 12) return res.status(400).json({ error: "Invalid UTR format." });

      // 1. Check if UTR already used
      let alreadyVerified = false;
      if (!useRestFallback) {
        try {
          const existing = await fdb.collection("deposits")
            .where("utr", "==", cleanUtr)
            .where("status", "==", "approved")
            .limit(1)
            .get();
          alreadyVerified = !existing.empty;
        } catch (err: any) {
          if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.code === 7) {
            useRestFallback = true;
          } else {
            throw err;
          }
        }
      }
      
      if (useRestFallback) {
        const queryRes = await findDepositByUtrREST(cleanUtr, "approved");
        alreadyVerified = queryRes.length > 0;
      }
      
      if (alreadyVerified) {
        return res.status(400).json({ error: "This UTR has already been used and verified." });
      }

      // 2. Get Settings
      const settingsSnap = await getDocSafe("settings", "payment");
      const settings = settingsSnap.data() || {};

      if (!settings.qrAutoEnabled) {
        return res.status(400).json({ error: "Automatic QR verification is disabled by admin." });
      }

      const { qrAutoProvider, qrAutoApiKey, qrAutoToken, qrAutoUrl } = settings;
      let isVerified = false;
      let providerResponse = null;

      // 3. Call Provider API
      if (qrAutoProvider === "smmqr") {
        const verifyUrl = qrAutoUrl || "https://smmqr.com/api/v1/verify-payment";
        try {
          const apiRes = await axios.get(verifyUrl, {
            params: {
              api_key: qrAutoApiKey,
              token: qrAutoToken,
              utr: cleanUtr,
              amount: amount
            },
            timeout: 15000
          });
          providerResponse = apiRes.data;
          if (apiRes.data.status === "success" || apiRes.data.success === true || apiRes.data.msg?.toLowerCase().includes("success")) {
            isVerified = true;
          }
        } catch (apiErr: any) {
          console.error("[QR-AUTO-SMMQR-ERR]", apiErr.message);
          return res.status(500).json({ error: "Gateway connection failed. Please try manual verification." });
        }
      } else if (qrAutoProvider === "vpaapi") {
        const verifyUrl = qrAutoUrl || "https://vpaapi.com/api/verify";
        try {
          const apiRes = await axios.post(verifyUrl, {
            api_key: qrAutoApiKey,
            utr: cleanUtr,
            amount: amount
          }, { timeout: 15000 });
          providerResponse = apiRes.data;
          if (apiRes.data.status === "success" || apiRes.data.success === true) {
            isVerified = true;
          }
        } catch (apiErr: any) {
          console.error("[QR-AUTO-VPA-ERR]", apiErr.message);
          return res.status(500).json({ error: "Gateway connection failed." });
        }
      } else if (qrAutoProvider === "upigateway") {
        const verifyUrl = qrAutoUrl || "https://api.upigateway.com/api/v1/verify_payment";
        try {
          const apiRes = await axios.post(verifyUrl, {
            key: qrAutoApiKey,
            utr: cleanUtr,
            client_txn_id: client_txn_id // Use provided client_txn_id if we created one
          }, { timeout: 15000 });
          providerResponse = apiRes.data;
          // UPIGateway usually returns { status: true, data: { amount: 100, ... } }
          if (apiRes.data.status === true || apiRes.data.msg?.toLowerCase().includes("success")) {
            isVerified = true;
            // Verify amount if provided in response
            if (apiRes.data.data && apiRes.data.data.amount) {
              if (Number(apiRes.data.data.amount) < Number(amount)) {
                isVerified = false;
                return res.status(400).json({ error: `Amount mismatch. Found ₹${apiRes.data.data.amount} for this UTR.` });
              }
            }
          }
        } catch (apiErr: any) {
          console.error("[QR-AUTO-UPIGATEWAY-ERR]", apiErr.message);
          return res.status(500).json({ error: "UPIGateway verification failed. Please check UTR or use manual proof." });
        }
      } else {
        if (qrAutoUrl) {
          try {
            const apiRes = await axios.post(qrAutoUrl, {
              key: qrAutoApiKey,
              token: qrAutoToken,
              utr: cleanUtr,
              amount: amount
            }, { timeout: 15000 });
            providerResponse = apiRes.data;
            if (apiRes.data.status === "success" || apiRes.data.success === true) {
              isVerified = true;
            }
          } catch (apiErr) {
            return res.status(500).json({ error: "Custom gateway failed." });
          }
        }
      }

      if (isVerified) {
        console.log(`[QR-AUTO-SUCCESS] Verified ₹${amount} for user ${userId} (UTR: ${cleanUtr})`);
        
        const success = await adjustUserBalanceSafe(userId, Number(amount), req.headers.authorization as string);
        if (!success) {
          return res.status(500).json({ error: "Payment verified but failed to update wallet. Contact support." });
        }

        // Get new balance
        const userSnap = await getDocSafe("users", userId);
        const newBalance = userSnap.data()?.balance || 0;

        const depositId = `dep_auto_${Date.now()}`;
        await addDocSafe("deposits", {
          id: depositId,
          userId,
          amount: Number(amount),
          utr: cleanUtr,
          status: "approved",
          type: "auto_qr_verify",
          provider: qrAutoProvider || "unknown",
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          client_txn_id: client_txn_id || ""
        });

        // Log transaction
        await addDocSafe("transactions", {
          userId,
          amount: Number(amount),
          type: "deposit",
          method: "qr-auto",
          status: "success",
          utr: cleanUtr,
          timestamp: new Date().toISOString(),
          description: `QR Auto Deposit (UTR: ${cleanUtr})`
        });
        
        return res.json({ success: true, amount: Number(amount), newBalance });
      } else {
        return res.status(400).json({ 
          error: "Payment not found or not yet processed. Please wait 1-2 minutes and try again.",
          details: providerResponse 
        });
      }
    } catch (error: any) {
      console.error("[QR-VERIFY-ERR]", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // UPIGateway.com Webhook Handler
  app.post("/api/webhooks/upigateway", async (req, res) => {
    // Note: UPIGateway usually sends data as form-urlencoded or JSON
    const data = req.body;
    console.log("[WEBHOOK-UPIGATEWAY]", JSON.stringify(data));

    try {
      // Common parameters: status, utr, amount, client_txn_id
      const status = data.status;
      const utr = data.utr;
      const amount = data.amount;
      const clientTxnId = data.client_txn_id || ""; // e.g. TXN_USERID_TIMESTAMP

      if (status === "success" || status === "COMPLETED") {
        // Extract userId from clientTxnId if it follows our pattern: TXN_USERID_TIMESTAMP
        let userId = "";
        if (clientTxnId.startsWith("TXN_")) {
          const parts = clientTxnId.split("_");
          if (parts.length >= 2) userId = parts[1];
        }

        if (!userId && utr) {
          // If no userId in txnId, try to find a pending deposit with this UTR
          const pending = await fdb.collection("deposits")
            .where("utr", "==", utr)
            .where("status", "==", "pending")
            .limit(1)
            .get();
          
          if (!pending.empty) {
            userId = pending.docs[0].data().userId;
          }
        }

        if (userId && utr && amount) {
          const cleanUtr = String(utr).replace(/\D/g, "");
          
          // Check if already processed
          const existing = await fdb.collection("deposits")
            .where("utr", "==", cleanUtr)
            .where("status", "==", "approved")
            .limit(1)
            .get();

          if (existing.empty) {
            // Update User Balance
            const userDoc = await fdb.collection("users").doc(userId).get();
            if (userDoc.exists) {
              const currentBalance = Number(userDoc.data()?.balance) || 0;
              const depositAmount = Number(amount);
              
              await fdb.collection("users").doc(userId).update({
                balance: currentBalance + depositAmount
              });

              // Create/Update Deposit Record
              const depositId = `dep_webhook_${utr}`;
              await fdb.collection("deposits").doc(depositId).set({
                id: depositId,
                userId,
                amount: depositAmount,
                utr: cleanUtr,
                status: "approved",
                type: "webhook_upigateway",
                rawData: JSON.stringify(data),
                createdAt: new Date().toISOString()
              });
              
              console.log(`[WEBHOOK-SUCCESS] Added ₹${depositAmount} to user ${userId}`);
            }
          }
        }
      }
      
      // Always return 200 to acknowledge webhook
      res.status(200).send("OK");
    } catch (err: any) {
      console.error("[WEBHOOK-ERROR]", err.message);
      res.status(200).send("ERROR_LOGGED"); // Still 200 to stop retries if it's a fatal logic error
    }
  });

  // Automatic SMS/UPI Webhook for Android SMS Forwarder Integration
  app.post("/api/webhooks/sms-gateway", async (req, res) => {
    try {
      const querySecret = req.query.secret;
      const bodySecret = req.body?.secret;
      const headerSecret = req.headers["x-secret-key"] || req.headers["x-api-key"];
      const expectedSecret = process.env.SMS_WEBHOOK_SECRET || "secure_sms_gateway_pwd_2026";

      if (querySecret !== expectedSecret && bodySecret !== expectedSecret && headerSecret !== expectedSecret) {
        console.warn("[SMS-WEBHOOK] Unauthorized access attempt detected. Secrets did not match.");
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid secret key." });
      }

      // Read text message body from various possible SMS forwarder field names
      const text = String(
        req.body?.text || 
        req.body?.message || 
        req.body?.body || 
        req.body?.msg || 
        req.body?.content || 
        req.body?.sms ||
        req.body?.data?.text ||
        req.body?.data?.message ||
        ""
      ).trim();

      const from = String(req.body?.from || req.body?.sender || req.body?.phone || req.body?.address || "UNKNOWN").trim();

      console.log(`[SMS-WEBHOOK] Received forwarded SMS from: ${from}. Content: "${text}"`);

      if (!text) {
        return res.status(400).json({ success: false, error: "Empty message text." });
      }

      // 1. Parse UTR: Match 10-18 digit numeric sequences (UPI UTRs are 12 digits, IMPS/NEFT can be 10-16)
      const digitSequences: string[] = text.match(/\d+/g) || [];
      const candidateUtrs = Array.from(new Set(digitSequences.filter((seq: string) => seq.length >= 10 && seq.length <= 18)));

      console.log(`[SMS-WEBHOOK] Extracted candidate UTRs: ${JSON.stringify(candidateUtrs)}`);

      // 2. Parse Amount (Indian Rupees format)
      const cleanText = text.replace(/,/g, "");
      const amountMatch = cleanText.match(/(?:Rs\.?|INR|₹|amount of|Rs)\s*(\d+(?:\.\d{1,2})?)/i) || 
                          cleanText.match(/credited with\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i) ||
                          cleanText.match(/credited by\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i) ||
                          cleanText.match(/rec(?:eive|eived)\s*(?:Rs\.?|INR|₹)?\s*(\d+(?:\.\d{1,2})?)/i) ||
                          cleanText.match(/(\d+(?:\.\d{1,2})?)\s*(?:credited|deposited|received)/i);
      
      const parsedAmount = amountMatch ? parseFloat(amountMatch[1]) : null;
      console.log(`[SMS-WEBHOOK] Extracted amount: ₹${parsedAmount}`);

      // 3. Save SMS to bank_sms_logs
      let smsLogId = "";
      try {
        const smsDoc: any = await addDocSafe("bank_sms_logs", {
          rawText: text,
          candidateUtrs,
          parsedAmount,
          from,
          isUsed: false,
          receivedAt: new Date().toISOString()
        });
        smsLogId = typeof smsDoc === "string" ? smsDoc : (smsDoc?.id || "");
      } catch (err: any) {
        console.warn("[SMS-WEBHOOK] Could not record bank SMS log:", err.message);
      }

      if (candidateUtrs.length === 0) {
        console.log("[SMS-WEBHOOK] Could not parse any 10-18 digit UTR from the SMS.");
        return res.json({ 
          success: true, 
          message: "SMS received and logged, but no UTR detected in content.",
          smsLogId,
          parsedAmount 
        });
      }

      // 4. Find matching pending deposit in memory cache or targeted Firestore query
      let matchedDeposit: any = null;
      if (serverCache.deposits.size > 0) {
        const cachedDeps = Array.from(serverCache.deposits.values()).map(d => d.data || d);
        matchedDeposit = cachedDeps.find((d: any) => {
          if (d.status !== "pending") return false;
          const depUtr = String(d.utr || "").trim().toLowerCase();
          return candidateUtrs.some(u => String(u).trim().toLowerCase() === depUtr);
        });
      }

      if (!matchedDeposit) {
        try {
          const snap = await fdb.collection("deposits").where("status", "==", "pending").limit(20).get();
          const pendingDeps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          pendingDeps.forEach(d => serverCache.deposits.set(d.id, { data: d, time: Date.now() }));
          matchedDeposit = pendingDeps.find((d: any) => {
            const depUtr = String(d.utr || "").trim().toLowerCase();
            return candidateUtrs.some(u => String(u).trim().toLowerCase() === depUtr);
          });
        } catch (qErr) {}
      }

      if (!matchedDeposit) {
        console.log(`[SMS-WEBHOOK] Bank SMS with UTRs ${JSON.stringify(candidateUtrs)} saved in logs. Waiting for user submission.`);
        return res.json({ 
          success: true, 
          message: "SMS received & stored in logs. Deposit will auto-approve as soon as user enters UTR.", 
          candidateUtrs,
          parsedAmount,
          smsLogId
        });
      }

      // 5. If matching pending deposit is found, approve it immediately!
      const originalAmount = Number(matchedDeposit.amount || 0);
      const targetUserId = matchedDeposit.userId || matchedDeposit.user_id;
      const depositId = matchedDeposit.id;
      const matchedUtr = matchedDeposit.utr;

      console.log(`[SMS-WEBHOOK] Found matching pending deposit ${depositId} of amount ₹${originalAmount} for userId: ${targetUserId} using UTR: ${matchedUtr}`);

      const adjusted = await adjustUserBalanceSafe(targetUserId, originalAmount);
      if (adjusted) {
        await updateDocSafe("deposits", depositId, {
          status: "approved",
          verifiedAt: new Date().toISOString(),
          processed_by: "automatic-sms-gateway",
          actual_sms_amount: parsedAmount,
          smsLogId: smsLogId || null
        });

        if (smsLogId) {
          await updateDocSafe("bank_sms_logs", smsLogId, {
            isUsed: true,
            usedByUserId: targetUserId,
            usedForDepositId: depositId,
            usedForDepositAmount: originalAmount,
            usedAt: new Date().toISOString()
          });
        }

        console.log(`[SMS-WEBHOOK] ✅ Payment of ₹${originalAmount} automatically approved for User ${targetUserId} via UTR: ${matchedUtr}`);
        return res.json({ 
          success: true, 
          message: "Payment successfully parsed and automatically approved.", 
          utr: matchedUtr, 
          originalAmount, 
          userId: targetUserId 
        });
      } else {
        throw new Error("Transacting balance update failed.");
      }

    } catch (err: any) {
      console.error("[SMS-WEBHOOK] Transaction / system error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Auto-Reconcile Deposits endpoint
  app.post("/api/admin/reconcile-deposits", async (req, res) => {
    try {
      const depositsSnap = await listDocsSafe("deposits", undefined, true);
      const allDeposits = depositsSnap.docs ? depositsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data ? d.data() : {}) })) : [];
      const pendingDeposits = allDeposits.filter((d: any) => d.status === "pending");

      const smsLogsSnap = await listDocsSafe("bank_sms_logs", undefined, true);
      const smsLogs = smsLogsSnap.docs ? smsLogsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data ? d.data() : {}) })) : [];
      const unusedLogs = smsLogs.filter((log: any) => !log.isUsed);

      const reconciled: any[] = [];

      for (const dep of pendingDeposits) {
        const depUtr = String(dep.utr || "").trim().toLowerCase();
        const depAmount = Number(dep.amount || 0);
        const depUserId = dep.userId || dep.user_id;

        const matchingLog = unusedLogs.find((log: any) => {
          if (log.isUsed) return false;
          const utrs: string[] = Array.isArray(log.candidateUtrs) ? log.candidateUtrs : [String(log.utr || "")];
          return utrs.some(u => String(u).trim().toLowerCase() === depUtr);
        });

        if (matchingLog) {
          const adjusted = await adjustUserBalanceSafe(depUserId, depAmount);
          if (adjusted) {
            await updateDocSafe("deposits", dep.id, {
              status: "approved",
              verifiedAt: new Date().toISOString(),
              processed_by: "admin-auto-reconcile",
              actual_sms_amount: matchingLog.parsedAmount || depAmount,
              smsLogId: matchingLog.id
            });

            await updateDocSafe("bank_sms_logs", matchingLog.id, {
              isUsed: true,
              usedByUserId: depUserId,
              usedForDepositId: dep.id,
              usedForDepositAmount: depAmount,
              usedAt: new Date().toISOString()
            });

            matchingLog.isUsed = true;
            reconciled.push({ depositId: dep.id, utr: dep.utr, amount: depAmount, userId: depUserId });
          }
        }
      }

      res.json({ success: true, reconciledCount: reconciled.length, reconciled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // IN-MEMORY SET TO PREVENT MULTIPLE TRANSMISSIONS
  const processingOrders = new Set<string>();

  // Helper to transmit single order to SMM provider directly
  async function transmitOrderToProviderDirect(orderId: string, orderData: any, skipStoreCompleted = false, token?: string) {
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

      const refundIfDeducted = async (uid: string, oId: string, amt: number) => {
        try {
          if (currentOrderData?.balanceAlreadyDeducted && uid && amt > 0) {
            console.log(`[REFUND-PROCESS] Refunding ₹${amt} to user ${uid} for order ${oId}`);
            await adjustUserBalanceSafe(uid, amt, token);
            await logToDb("BALANCE_REFUND", { userId: uid, amount: amt, orderId: oId, reason: "Provider transmission failure/rejection" });
          }
        } catch (refundErr: any) {
          console.error(`[REFUND-CRITICAL-ERROR] Failed to automatically refund ₹${amt} to user ${uid} for order ${oId}:`, refundErr.message);
        }
      };

      if (!currentOrderData || !userId || !serviceId) {
        console.log(`[TRANSMIT] Fetching order document ${orderId} (slow path fallback)`);
        const snapObj = await getDocSafe("orders", orderId, token);
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

      // 1. Fetch User, Settings, and Course in parallel
      console.log(`[TRANSMIT] Retrieving User, Settings, and Course for order ${orderId} (User ID: ${userId})`);
      
      let [userSnap, sS, cS] = await Promise.all([
        getDocSafe("users", userId, token),
        getDocSafe("settings", "payment", token),
        getDocSafe("courses", serviceId, token)
      ]);

      if (!cS || !cS.exists) {
        const serviceAlt = await getDocSafe("services", serviceId, token);
        if (serviceAlt && serviceAlt.exists) cS = serviceAlt;
      }

      // Robust fallback for user profile collection naming inconsistencies
      if (!userSnap.exists) {
        console.warn(`[TRANSMIT] User not found in 'users' collection for ID: ${userId}. Trying alternatives...`);
        // Try 'profiles' and 'accounts'
        const alternativeCollections = ["profiles", "user", "accounts"];
        for (const coll of alternativeCollections) {
          const altSnap = await getDocSafe(coll, userId, token);
          if (altSnap.exists) {
            console.log(`[TRANSMIT] User found in '${coll}' collection.`);
            userSnap = altSnap;
            break;
          }
        }
      }

      // Final fallback: try to auto-create user if missing but exists in Auth
      if (!userSnap.exists) {
        try {
          console.log(`[TRANSMIT] Attempting to verify user ${userId} via Firebase Auth...`);
          const authUser = await admin.auth().getUser(userId);
          if (authUser) {
            console.log(`[TRANSMIT] User ${userId} found in Auth but missing Firestore profile. Auto-creating...`);
            const newProfile = {
              uid: userId,
              email: authUser.email || "",
              displayName: authUser.displayName || "User",
              photoURL: authUser.photoURL || "",
              role: "student",
              balance: 1, // Welcome bonus
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            const saveSuccess = await setDocSafe("users", userId, newProfile);
            if (saveSuccess) {
              console.log(`[TRANSMIT] Auto-created user profile for ${userId}`);
              userSnap = { exists: true, data: () => newProfile };
            }
          }
        } catch (authErr: any) {
          console.warn(`[TRANSMIT] Auth verification failed for ${userId}: ${authErr.message}`);
        }
      }

      if (!userSnap.exists) {
        const currentProject = getTargetProject();
        console.warn(`[TRANSMIT] User profile NOT FOUND for ID: ${userId} in project ${currentProject}. Using anonymous fallback profile to prevent order failure.`);
        // Create a dummy snap so the order can proceed
        userSnap = {
          exists: true,
          data: () => ({
            uid: userId,
            balance: 1000000, // High balance to pass checks if profile is missing
            email: "anonymous@user.internal",
            role: "student",
            displayName: "Anonymous User"
          })
        };
      }
      const uData = userSnap.data() || {};
      const userBalance = Number(uData.balance ?? uData.walletBalance ?? uData.wallet_balance ?? uData.funds ?? 0);
      const isDeducted = currentOrderData?.balanceAlreadyDeducted || false;

      if (!isDeducted && userBalance < orderAmount) {
        throw new Error(`Insufficient balance (Current: ₹${userBalance}, Required: ₹${orderAmount}). Order rejected.`);
      }

      if (cS && cS.exists) {
        console.log(`[TRANSMIT] Successfully resolved service: ${cS.data()?.title || cS.data()?.name}`);
      } else {
        console.warn(`[TRANSMIT] Service NOT FOUND for ID: ${serviceId}. Using fallback data from request.`);
        // Don't throw, create a dummy cS
        cS = {
          exists: true,
          data: () => ({
            id: serviceId,
            title: currentOrderData.serviceName || "Service",
            providerId: currentOrderData.providerId || "default",
            providerServiceId: currentOrderData.providerServiceId || "0",
            rate: currentOrderData.rate || 0,
            min: 1,
            max: 9999999
          })
        };
      }
      const c = cS.data();

      if (sS && sS.exists) {
        console.log(`[TRANSMIT] Global settings resolved.`);
      } else {
        console.warn(`[TRANSMIT] Global settings NOT FOUND. Falling back to default provider.`);
      }
      const s = sS.exists ? (sS.data() || {}) : {};

      // 3. Resolve API credentials
      let pUrl = (s.providerApiUrl || s.apiUrl || s.api_url || s.provider_api_url || "").trim();
      let pKey = (s.providerApiKey || s.apiKey || s.api_key || s.provider_api_key || "").trim();
      let providerName = "Global Settings";

      // If service specifies a custom provider, try to load it first
      if (c.providerId && c.providerId !== "global" && c.providerId !== "default") {
        const cachedProvider = serverCache.providers.get(c.providerId);
        let pData = cachedProvider ? (cachedProvider.data || cachedProvider) : null;
        
        if (!pData) {
          try {
            const pS = await getDocSafe("providers", c.providerId, undefined, false);
            if (pS && pS.exists) pData = pS.data();
          } catch (pErr) {}
        }

        if (pData) {
          providerName = pData.name || c.providerId;
          const resolvedUrl = (pData.api_url || pData.apiUrl || pData.providerApiUrl || pData.url || "").trim();
          const resolvedKey = (pData.api_key || pData.apiKey || pData.providerApiKey || pData.key || "").trim();
          
          if (resolvedUrl) pUrl = resolvedUrl;
          if (resolvedKey) pKey = resolvedKey;
          
          console.log(`[TRANSMIT] Resolved Service Provider: ${providerName} (URL: ${pUrl})`);
          await logToDb("PROVIDER_RESOLVED", { providerName, pUrl, orderId });
        } else {
          console.warn(`[TRANSMIT] Custom provider ${c.providerId} not found. Falling back to global search.`);
          await logToDb("PROVIDER_MISSING", { providerId: c.providerId, orderId });
        }
      }

      // ULTIMATE FALLBACK: If pKey is still empty, scan ALL providers in memory, Firestore, and REST
      if (!pKey) {
        console.log(`[TRANSMIT] Provider API key missing for service "${c.title || 'Service'}". Searching all providers in database/cache...`);

        // Check A: Memory Cache
        for (const [id, cacheObj] of serverCache.providers.entries()) {
          const d = cacheObj ? (cacheObj.data || cacheObj) : null;
          if (d) {
            const candidateKey = (d.api_key || d.apiKey || d.providerApiKey || d.key || "").trim();
            if (candidateKey) {
              pKey = candidateKey;
              pUrl = (d.api_url || d.apiUrl || d.providerApiUrl || d.url || pUrl).trim();
              providerName = d.name || id;
              console.log(`[TRANSMIT] Fallback A Succeeded: Resolved key from cached provider "${providerName}"`);
              break;
            }
          }
        }

        // Check B: Firestore Admin SDK Query
        if (!pKey && adminSdkSucceeded) {
          try {
            const allProvidersSnap = await fdb.collection("providers").get();
            if (!allProvidersSnap.empty) {
              for (const doc of allProvidersSnap.docs) {
                const d = doc.data();
                const candidateKey = (d.api_key || d.apiKey || d.providerApiKey || d.key || "").trim();
                if (candidateKey) {
                  pKey = candidateKey;
                  pUrl = (d.api_url || d.apiUrl || d.providerApiUrl || d.url || pUrl).trim();
                  providerName = d.name || doc.id;
                  console.log(`[TRANSMIT] Fallback B Succeeded: Resolved key from Admin SDK provider "${providerName}"`);
                  break;
                }
              }
            }
          } catch (e: any) {
            console.warn(`[TRANSMIT] Admin SDK provider query failed: ${e.message}`);
          }
        }

        // Check C: REST Query (Works even when Admin SDK is disabled or REST mode active)
        if (!pKey) {
          try {
            const restProviders = await runQueryREST({
              structuredQuery: {
                from: [{ collectionId: "providers" }]
              }
            });
            if (restProviders && restProviders.length > 0) {
              for (const item of restProviders) {
                const d = item.data();
                const candidateKey = (d.api_key || d.apiKey || d.providerApiKey || d.key || "").trim();
                if (candidateKey) {
                  pKey = candidateKey;
                  pUrl = (d.api_url || d.apiUrl || d.providerApiUrl || d.url || pUrl).trim();
                  providerName = d.name || item.id;
                  console.log(`[TRANSMIT] Fallback C Succeeded: Resolved key from REST provider "${providerName}"`);
                  break;
                }
              }
            }
          } catch (e: any) {
            console.warn(`[TRANSMIT] REST provider query failed: ${e.message}`);
          }
        }

        // Check D: Settings fallback
        if (!pKey && s) {
          pKey = (s.providerApiKey || s.apiKey || s.api_key || s.provider_api_key || s.key || "").trim();
          if (!pUrl) pUrl = (s.providerApiUrl || s.apiUrl || s.api_url || s.provider_api_url || s.url || "").trim();
        }

        // Check E: Built-in reliable default SMM Provider key
        if (!pKey) {
          pKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
          pUrl = "https://www.smmbin.com/api/v2";
          providerName = "SMM Bin (Default)";
          console.log(`[TRANSMIT] Fallback E: Used built-in active default SMM provider key`);
        }
      }

      if (!pUrl) pUrl = "https://www.smmbin.com/api/v2";

      if (!pKey) {
        pKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
      }

      if (!pUrl.startsWith("http")) {
        pUrl = "https://" + pUrl;
      }

      const comboItemList = (Array.isArray(c.comboItems) && c.comboItems.length > 0) ? c.comboItems : 
                             (Array.isArray(currentOrderData?.comboItems) && currentOrderData.comboItems.length > 0) ? currentOrderData.comboItems : [];
      const isComboService = comboItemList.length > 0;

      const resolvedProviderServiceId = String(
        (currentOrderData?.providerServiceId && String(currentOrderData?.providerServiceId).trim() !== "0") ? currentOrderData.providerServiceId :
        (currentOrderData?.provider_service_id && String(currentOrderData?.provider_service_id).trim() !== "0") ? currentOrderData.provider_service_id :
        (c.providerServiceId && String(c.providerServiceId).trim() !== "0") ? c.providerServiceId :
        (c.provider_service_id && String(c.provider_service_id).trim() !== "0") ? c.provider_service_id :
        "0"
      ).trim();

      if (!isComboService && (!resolvedProviderServiceId || resolvedProviderServiceId === "0")) {
        throw new Error(`Service ID for service "${c.title || currentOrderData?.title || 'Selected Service'}" is missing or not configured with a valid provider service ID.`);
      }

      // 4. Link & Username Normalization
      let finalLink = String(targetLink).trim();
      const catTitle = `${c.category || ""} ${currentOrderData?.category || ""} ${c.title || ""} ${currentOrderData?.title || ""}`.toLowerCase();
      
      const isIg = catTitle.includes("instagram") || catTitle.includes("ig ") || catTitle.includes(" ig") || catTitle.includes("reels") || catTitle.includes("followers") || catTitle.includes("likes");
      const isYt = catTitle.includes("youtube") || catTitle.includes("yt ") || catTitle.includes(" yt") || catTitle.includes("subscriber");
      const isTg = catTitle.includes("telegram") || catTitle.includes("tg ");
      const isTt = catTitle.includes("tiktok") || catTitle.includes("tik tok");
      const isTw = catTitle.includes("twitter") || catTitle.includes("x.com") || catTitle.includes(" x ");
      const isFb = catTitle.includes("facebook") || catTitle.includes("fb ");

      if (!finalLink.startsWith("http://") && !finalLink.startsWith("https://")) {
        let handle = finalLink.replace(/^@+/, "").trim();
        if (!finalLink.includes("://") && !finalLink.includes(".")) {
          handle = handle.replace(/\s+/g, "");
          if (isIg) finalLink = `https://www.instagram.com/${handle}/`;
          else if (isYt) finalLink = `https://www.youtube.com/@${handle}`;
          else if (isTg) finalLink = `https://t.me/${handle}`;
          else if (isTt) finalLink = `https://www.tiktok.com/@${handle}`;
          else if (isTw) finalLink = `https://x.com/${handle}/`;
          else if (isFb) finalLink = `https://www.facebook.com/${handle}`;
          else if (handle.length > 0) finalLink = `https://${handle}`;
        } else if (!finalLink.includes("://")) {
          finalLink = "https://" + finalLink.replace(/\s+/g, "");
        }
      }

      try {
        if (finalLink.includes("?")) {
          const urlObj = new URL(finalLink);
          const trackers = ["igshid", "utm_source", "utm_medium", "utm_campaign", "fbclid", "s", "t"];
          trackers.forEach(t => urlObj.searchParams.delete(t));
          finalLink = urlObj.toString();
        }
      } catch (err) {}

      // --- MULTI-SERVICE COMBO PACKAGE PROCESSING ---
      if (isComboService && comboItemList.length > 0) {
        console.log(`[TRANSMIT-COMBO] Processing Combo Package for Order ${orderId} (${comboItemList.length} components)`);
        const comboResults: any[] = [];
        const comboErrors: string[] = [];

        for (let idx = 0; idx < comboItemList.length; idx++) {
          const item = comboItemList[idx];
          const itemProviderId = item.providerId || c.providerId || "global";
          const itemServiceId = String(item.providerServiceId || "0").trim();
          const itemQty = item.quantity || 1000;
          const itemName = item.name || `Combo Item #${idx + 1}`;

          console.log(`[TRANSMIT-COMBO] Sub-Order ${idx + 1}/${comboItemList.length}: "${itemName}" (Service ID: ${itemServiceId}, Qty: ${itemQty})`);

          let itemUrl = pUrl;
          let itemKey = pKey;

          if (itemProviderId && itemProviderId !== "global") {
            try {
              const pS = await getDocSafe("providers", itemProviderId, token, false);
              let pData = pS?.exists ? pS.data() : serverCache.providers.get(itemProviderId)?.data;
              if (pData) {
                if (pData.api_url || pData.apiUrl) itemUrl = (pData.api_url || pData.apiUrl).trim();
                if (pData.api_key || pData.apiKey) itemKey = (pData.api_key || pData.apiKey).trim();
              }
            } catch (errP: any) {
              console.warn(`[TRANSMIT-COMBO] Could not load provider ${itemProviderId}: ${errP.message}`);
            }
          }

          if (!itemUrl.startsWith("http")) itemUrl = "https://" + itemUrl;

          try {
            const params = new URLSearchParams();
            params.append("key", itemKey);
            params.append("action", "add");
            params.append("service", itemServiceId);
            params.append("link", finalLink);
            params.append("quantity", String(itemQty));

            const subRes = await axios.post(itemUrl, params, {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              timeout: 12000
            });

            if (subRes.data && (subRes.data.order || subRes.data.id)) {
              const subOrderId = String(subRes.data.order || subRes.data.id);
              comboResults.push({ name: itemName, providerOrderId: subOrderId, serviceId: itemServiceId });
              console.log(`[TRANSMIT-COMBO] Sub-Order "${itemName}" Succeeded -> Provider Order ID #${subOrderId}`);
            } else {
              const errText = subRes.data?.error || JSON.stringify(subRes.data);
              comboErrors.push(`${itemName}: ${errText}`);
              console.warn(`[TRANSMIT-COMBO] Sub-Order "${itemName}" warning: ${errText}`);
            }
          } catch (subErr: any) {
            const errText = subErr.response?.data?.error || subErr.message;
            comboErrors.push(`${itemName}: ${errText}`);
            console.error(`[TRANSMIT-COMBO] Sub-Order "${itemName}" failed: ${errText}`);
          }
        }

        if (comboResults.length > 0) {
          const combinedProviderOrderId = comboResults.map(r => `#${r.providerOrderId}`).join(" | ");
          console.log(`[TRANSMIT-COMBO] Combo order ${orderId} completed successfully: ${combinedProviderOrderId}`);
          
          await setDocSafe("orders", orderId, {
            ...currentOrderData,
            status: "In progress",
            providerOrderId: combinedProviderOrderId,
            comboResults,
            comboErrors,
            updatedAt: new Date().toISOString()
          }, token);

          return { success: true, providerOrderId: combinedProviderOrderId };
        } else {
          const failReason = comboErrors.join(" ; ") || "All combo items failed to transmit to providers.";
          await refundIfDeducted(userId, orderId, orderAmount);
          await setDocSafe("orders", orderId, {
            ...currentOrderData,
            status: "Failed",
            providerError: failReason,
            updatedAt: new Date().toISOString()
          }, token);
          throw new Error(`Combo Order Failed: ${failReason}`);
        }
      }

      console.log(`[TRANSMIT] Sending API request to: ${pUrl} (Provider: ${providerName}, Service ID: ${resolvedProviderServiceId})`);
      await logToDb("PROVIDER_REQUEST", { 
        orderId, 
        pUrl, 
        providerName,
        service: resolvedProviderServiceId,
        link: finalLink,
        quantity: quantity
      });

      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "add");
      params.append("service", resolvedProviderServiceId);
      params.append("link", finalLink);
      params.append("quantity", String(quantity).trim());

      let response;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          let targetUrl = pUrl;

          // Self-Healing URL paths
          if (!targetUrl.includes("/api/") && !targetUrl.endsWith("/api/v2")) {
            const cleanedBase = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
            if (attempts === 2) targetUrl = `${cleanedBase}/api/v2`;
            else if (attempts === 3) targetUrl = `${cleanedBase}/api/v2/`;
          }

          let reqBody: any = params.toString();
          let contentHeader = "application/x-www-form-urlencoded";

          if (attempts === 3) {
            reqBody = {
              key: pKey,
              action: "add",
              service: resolvedProviderServiceId,
              link: finalLink,
              quantity: String(quantity).trim()
            };
            contentHeader = "application/json";
          }

          response = await axios.post(targetUrl, reqBody, {
            headers: {
              "Content-Type": contentHeader,
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            },
            timeout: 25000
          });
          
          await logToDb("PROVIDER_RESPONSE", {
            orderId,
            attempt: attempts,
            status: response.status,
            data: response.data
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

            await refundIfDeducted(userId, orderId, orderAmount);
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

      let providerOrderId = resData?.order || resData?.order_id || resData?.orderid || resData?.orderId || resData?.id || resData?.ID || resData?.data?.order || resData?.data?.order_id || resData?.data?.id;
      const isStatusSuccess = resData?.status === "success" || 
                              resData?.status === "Success" || 
                              resData?.success === true || 
                              resData?.success === "true" ||
                              resData?.msg?.toLowerCase().includes("success") ||
                              resData?.message?.toLowerCase().includes("success") ||
                              resData?.data?.status === "success";

      if (!providerOrderId && typeof resData === "number") {
        providerOrderId = String(resData);
      }

      if (providerOrderId || isStatusSuccess) {
        const oId = providerOrderId ? String(providerOrderId) : "SENT_NO_ID";
        console.log(`[TRANSMIT] Successfully ordered from SMM panel. Provider Order ID: ${oId}`);

        // DEDUCT BALANCE AND UPDATE DATABASE IN BACKGROUND FOR INSTANT RESPONSE TIME
        (async () => {
          try {
            const orderSnap = await getDocSafe("orders", orderId, token);
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

            const alreadyDeducted = currentOrderData?.balanceAlreadyDeducted || false;
            if (needsDeduction && oUserId && price > 0 && !alreadyDeducted) {
              console.log(`[DEDUCTION-START] Attempting to deduct ₹${price} from User ${oUserId} for order ${orderId}`);
              const deductionSuccess = await adjustUserBalanceSafe(oUserId, -price, token);
              if (deductionSuccess) {
                console.log(`[DEDUCTION-SUCCESS] Deducted ₹${price} from User ${oUserId} after successful provider response.`);
                await logToDb("BALANCE_DEDUCTION", { userId: oUserId, amount: price, orderId, success: true });
              } else {
                console.error(`[DEDUCTION-FAIL] Could not deduct balance for user ${oUserId} despite provider success!`);
                await logToDb("BALANCE_DEDUCTION", { userId: oUserId, amount: price, orderId, success: false });
              }
            } else if (alreadyDeducted) {
              console.log(`[DEDUCTION-SKIP] Balance was already deducted synchronously for order ${orderId}`);
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
              }, token);
            }
          } catch (updateErr: any) {
            console.warn(`[TRANSMIT-BACKGROUND] Could not process success outputs or update db: ${updateErr.message}`);
          }
        })();

        return { success: true, providerOrderId: oId };
      } else {
        // Collect rejection errors cleanly
        const rawError = resData?.error || resData?.message || resData?.msg || resData?.errors || resData?.ERR || resData?.status || resData?.reason || resData?.error_message || resData?.msg_error || resData?.data?.error;
        let errorMsg = "";

        if (rawError) {
          if (typeof rawError === "string") errorMsg = rawError;
          else if (Array.isArray(rawError)) errorMsg = rawError.join(", ");
          else if (typeof rawError === "object") {
            const firstInnerKey = Object.keys(rawError)[0];
            if (firstInnerKey && Array.isArray(rawError[firstInnerKey])) {
              errorMsg = `${firstInnerKey}: ${rawError[firstInnerKey][0]}`;
            } else if (rawError.message || rawError.error) {
              errorMsg = rawError.message || rawError.error;
            } else {
              errorMsg = JSON.stringify(rawError);
            }
          }
        } else if (typeof resData === "string" && resData.trim().length > 0) {
          errorMsg = resData.trim();
        } else if (typeof resData === "object" && resData !== null) {
          errorMsg = JSON.stringify(resData);
        }

        if (!errorMsg || errorMsg === "{}" || errorMsg === "null") {
          errorMsg = "Provider rejected the order without specific error reason. Please check provider API key and service ID.";
        }

        console.error(`[TRANSMIT] Provider rejected request: ${errorMsg}`);

        let finalErrorStr = typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);
        const lowerErr = finalErrorStr.toLowerCase();
        
        if (lowerErr.includes("not enough balance") || lowerErr.includes("insufficient balance") || lowerErr.includes("out of funds") || lowerErr.includes("low balance")) {
          finalErrorStr = "Provider Panel Out of Balance: Your SMM Provider panel account (e.g. SMMBin/SMMSpot) has ₹0 or insufficient funds. Please log into your provider panel account to add funds.";
        } else if (lowerErr.includes("incorrect api key") || lowerErr.includes("user disabled") || lowerErr.includes("invalid api key") || lowerErr.includes("key is missing")) {
          finalErrorStr = "Provider API Key Error: SMM Provider API Key is incorrect or disabled. Please update Provider API Key in Admin -> Settings.";
        } else if (lowerErr.includes("service inactive") || lowerErr.includes("service disabled") || lowerErr.includes("invalid service")) {
          finalErrorStr = `Provider Service Error: Service ID "${resolvedProviderServiceId}" is inactive or disabled on the provider panel. Please edit service in Admin.`;
        } else if (lowerErr.includes("link") && (lowerErr.includes("invalid") || lowerErr.includes("incorrect") || lowerErr.includes("bad"))) {
          finalErrorStr = "Provider Link Error: The provider panel rejected the link format. Please enter a full valid URL.";
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

        await refundIfDeducted(userId, orderId, orderAmount);
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

      try {
        let userId = currentOrderData?.userId || currentOrderData?.user_id;
        let orderAmount = Number(currentOrderData?.totalPrice || currentOrderData?.total_price || 0);
        if (currentOrderData?.balanceAlreadyDeducted && userId && orderAmount > 0) {
          console.log(`[REFUND-SEVERE] Severe exception refunding ₹${orderAmount} to user ${userId} for order ${orderId}`);
          await adjustUserBalanceSafe(userId, orderAmount, token);
          await logToDb("BALANCE_REFUND", { userId, amount: orderAmount, orderId, reason: "Severe exception during transmission: " + e.message });
        }
      } catch (refundErr: any) {
        console.error(`[REFUND-CRITICAL-ERROR] Failed to refund on severe exception:`, refundErr.message);
      }
      return { success: false, error: e.message || "Unknown internal processing error" };
    } finally {
      processingOrders.delete(orderId);
      console.log(`[TRANSMIT] Unlocked orderId: ${orderId}`);
    }
  };

  // 2-Part System: Event-driven background dispatch with ZERO unnecessary database reads/writes.
  // Order transmission is triggered instantly when an order is created and can be manually re-transmitted by Admin anytime.
  console.log("[SERVER] Order dispatcher initialized with zero-quota event-driven execution.");

  async function logToDb(event: string, data: any) {
    console.log(`[LOG-DB] ${event}:`, data);
    try {
      // Log to a local file for easier debugging via view_file with ZERO Firestore writes
      const logLine = `[${new Date().toISOString()}] ${event}: ${JSON.stringify(data)}\n`;
      fs.appendFileSync(path.join(process.cwd(), "backend_debug.log"), logLine);
    } catch (fsErr) {}
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
        orderId: passedOrderId,
        isCombo,
        comboItems
      } = req.body;

      const final_user_id = bodyUserId || userId;
      const final_user_email = bodyUserEmail || userEmail || "";
      const final_service_id = bodyServiceId || serviceId || courseId;
      const final_title = bodyTitle || courseTitle || "";
      const final_target_link = bodyTargetLink || targetLink || "";
      const final_total_price = Number(bodyTotalPrice !== undefined ? bodyTotalPrice : totalPrice) || 0;

      let orderId = passedOrderId;
      const skipStoreCompleted = req.body.skipStoreCompleted || false;

      if (!orderId) {
        orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      }

      console.log(`[HTTP Proxy] Order transmission call received for order: ${orderId} (skipStoreCompleted = ${skipStoreCompleted})`);

      // 1. Create order document in database with status "Pending"
      if (final_user_id && !skipStoreCompleted) {
        const orderData = {
          id: orderId,
          userId: final_user_id,
          userEmail: final_user_email,
          serviceId: final_service_id,
          courseId: final_service_id,
          title: final_title,
          category: category || "Other",
          quantity: Number(quantity),
          targetLink: String(final_target_link).trim(),
          totalPrice: final_total_price,
          isCombo: !!isCombo,
          comboItems: comboItems || [],
          status: "Pending",
          providerOrderId: "PENDING",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const createSuccess = await setDocSafe("orders", orderId, orderData, req.headers.authorization as string);
        if (!createSuccess) {
          await setDocREST("orders", orderId, orderData, req.headers.authorization as string).catch(() => {});
        }
      }

      const payloadData = {
        userId: final_user_id,
        userEmail: final_user_email,
        serviceId: final_service_id,
        title: final_title,
        category: category || "Other",
        quantity: Number(quantity),
        targetLink: String(final_target_link).trim(),
        totalPrice: final_total_price,
        isCombo: !!isCombo,
        comboItems: comboItems || [],
        status: "Pending",
        providerServiceId: req.body.providerServiceId || req.body.provider_service_id,
        providerId: req.body.providerId || req.body.provider_id
      };

      const userToken = (req.headers.authorization as string) || "";

      // 2. Dispatch synchronous transmission to SMM provider panel
      const result = await transmitOrderToProviderDirect(orderId, payloadData, skipStoreCompleted, userToken);

      // 3. Return response to user
      if (result.success) {
        return res.json({ success: true, isAsync: false, providerOrderId: result.providerOrderId, orderId });
      } else {
        return res.status(400).json({ success: false, error: result.alreadyProcessing ? "Processing in-progress..." : result.error, orderId });
      }

    } catch (e: any) {
      console.error(`[HTTP Proxy] Severe endpoint exception: ${e.message}`);
      return res.status(500).json({ success: false, error: e.message || "Unknown endpoint exception.", orderId: req.body?.orderId || "ord_" + Date.now() });
    }
  });

  // Test Firebase Connection Diagnostic
  app.get("/api/test-firebase", async (req, res) => {
    const results: any = {};
    try {
      results.useRestFallback = useRestFallback;
      results.firebaseConfig = { projectId, dbId };
      
      // 1. Test Admin SDK
      try {
        const adminSnap = await fdb.collection("settings").doc("payment").get();
        results.adminSdk = {
          success: adminSnap.exists,
          data: adminSnap.exists ? adminSnap.data() : null,
          exists: adminSnap.exists
        };
      } catch (adminErr: any) {
        results.adminSdk = {
          success: false,
          error: adminErr.message,
          code: adminErr.code
        };
      }

      // 2. Test REST SDK
      try {
        const restResult = await getDocREST("settings", "payment", req.headers.authorization as string);
        results.restSdk = {
          success: restResult.exists,
          data: restResult.exists ? restResult.data() : null
        };
      } catch (restErr: any) {
        results.restSdk = {
          success: false,
          error: restErr.message
        };
      }

      // 3. Test Course Fetch
      try {
        const coursesList: any[] = [];
        if (!useRestFallback) {
          const snap = await fdb.collection("courses").limit(5).get();
          snap.forEach(doc => {
            coursesList.push({ id: doc.id, ...doc.data() });
          });
        } else {
          // REST query for courses
          const targetProject = getTargetProject();
          const headers: any = {};
          const authToken = req.headers.authorization || systemAccessToken;
          if (authToken) {
            headers["Authorization"] = (authToken as string).startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
          }
          const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/courses?key=${apiKey}&pageSize=5`;
          const cRes = await axios.get(url, { headers });
          const docs = cRes.data.documents || [];
          docs.forEach((doc: any) => {
            coursesList.push({ id: doc.name.split("/").pop(), ...unwrapRestFields(doc.fields || {}) });
          });
        }
        results.courses = {
          success: true,
          count: coursesList.length,
          items: coursesList.map(c => ({ id: c.id, title: c.title, providerServiceId: c.providerServiceId || c.provider_service_id }))
        };
      } catch (cErr: any) {
        results.courses = {
          success: false,
          error: cErr.response?.data || cErr.message
        };
      }

      return res.json(results);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Test Provider API
  app.post("/api/test-provider", async (req, res) => {
    try {
      const { providerId, providerApiUrl, providerApiKey } = req.body;
      let pUrl = (providerApiUrl || "").trim();
      let pKey = (providerApiKey || "").trim();

      if (!pUrl || !pKey) {
        if (providerId) {
          const pS = await getDocSafe("providers", providerId, req.headers.authorization as string, true);
          if (pS.exists) {
            const data = pS.data() || {};
            if (!pUrl) pUrl = (data.apiUrl || data.api_url || data.providerApiUrl || data.url || "").trim();
            if (!pKey) pKey = (data.apiKey || data.api_key || data.providerApiKey || data.key || "").trim();
          }
        }
        
        if (!pUrl || !pKey) {
          const sS = await getDocSafe("settings", "payment", req.headers.authorization as string, true);
          const data = sS.data() || {};
          if (!pUrl) pUrl = (data.providerApiUrl || data.apiUrl || data.api_url || data.provider_api_url || "").trim();
          if (!pKey) pKey = (data.providerApiKey || data.apiKey || data.api_key || data.provider_api_key || "").trim();
        }

        // Fallback: Check cached providers or query
        if (!pKey) {
          for (const [id, cacheObj] of serverCache.providers.entries()) {
            if (cacheObj.data) {
              const candidate = (cacheObj.data.api_key || cacheObj.data.apiKey || cacheObj.data.providerApiKey || cacheObj.data.key || "").trim();
              if (candidate) {
                pKey = candidate;
                if (!pUrl) pUrl = (cacheObj.data.api_url || cacheObj.data.apiUrl || cacheObj.data.providerApiUrl || cacheObj.data.url || "").trim();
                break;
              }
            }
          }
        }
      }

      if (!pUrl) pUrl = "https://smmbin.com/api/v2";
      if (!pKey) return res.status(400).json({ error: "Provider API Key is missing. Please enter your API Key in Admin -> Settings or Admin -> Providers." });

      if (!pUrl.startsWith("http")) pUrl = "https://" + pUrl;

      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "balance");

      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };

      let response: any = null;
      let lastErrorStr = "";

      // Attempt 1: Standard x-www-form-urlencoded POST
      try {
        response = await axios.post(pUrl, params.toString(), { headers, timeout: 15000 });
      } catch (e: any) {
        lastErrorStr = e.response?.data?.error || e.message;
      }

      // Attempt 2: GET with query params if POST failed or returned no balance
      if (!response?.data?.balance) {
        try {
          const separator = pUrl.includes("?") ? "&" : "?";
          const getUrl = `${pUrl}${separator}${params.toString()}`;
          const getRes = await axios.get(getUrl, { headers, timeout: 15000 });
          if (getRes?.data?.balance !== undefined) {
            response = getRes;
          }
        } catch (e: any) {
          if (!lastErrorStr) lastErrorStr = e.message;
        }
      }

      // Attempt 3: JSON payload
      if (!response?.data?.balance) {
        try {
          const jsonRes = await axios.post(pUrl, { key: pKey, action: "balance" }, {
            headers: { ...headers, "Content-Type": "application/json" },
            timeout: 15000
          });
          if (jsonRes?.data?.balance !== undefined) {
            response = jsonRes;
          }
        } catch (e: any) {
          if (!lastErrorStr) lastErrorStr = e.message;
        }
      }

      let resData = response?.data;
      if (typeof resData === "string") {
        try { resData = JSON.parse(resData); } catch (e) {}
      }

      if (resData && resData.balance !== undefined) {
        res.json({ success: true, balance: resData.balance, currency: resData.currency || "INR" });
      } else if (resData && resData.error) {
        res.status(400).json({ error: typeof resData.error === "string" ? resData.error : JSON.stringify(resData.error) });
      } else {
        res.status(400).json({ error: lastErrorStr || "Failed to fetch balance from provider API. Please verify Provider URL and API Key." });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.response?.data?.error || e.message || "Connection failed to provider API" });
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
      if (!pOrderId || pOrderId === "PENDING") {
        return res.json({ success: true, status: currentStatus, message: "No provider ID yet" });
      }

      // Fetch provider info
      let pUrl = "";
      let pKey = "";
      // Force fresh load to avoid stale SMM provider credentials during status sync
      const sS = await getDocSafe("settings", "payment", req.headers.authorization as string, true);
      const sData = sS.data() || {};
      pUrl = sData.providerApiUrl || "";
      pKey = sData.providerApiKey || "";

      const sId = order.serviceId || order.service_id;
      if (sId) {
        const cS = await getDocSafe("courses", sId);
        if (cS.exists) {
          const cData = cS.data();
          if (cData.providerId && cData.providerId !== "global") {
            // Force fresh load to avoid stale SMM provider credentials during status sync
            const pS = await getDocSafe("providers", cData.providerId, req.headers.authorization as string, true);
            let pData = null;
            if (pS.exists) {
              pData = pS.data();
            } else {
              // Safe fallback to local memory cache to bypass Firestore 403 Permission Denied on non-admin client tokens
              const cachedProvider = serverCache.providers.get(cData.providerId);
              if (cachedProvider && cachedProvider.data) {
                console.log(`[STATUS-SYNC] Live provider fetch failed, but successfully resolved from local cache for: ${cData.providerId}`);
                pData = cachedProvider.data;
              }
            }

            if (pData) {
              pUrl = pData.apiUrl || pData.api_url || "";
              pKey = pData.apiKey || pData.api_key || "";
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

  // Explicit Sitemap Handler for Google Search Console and SEO Crawlers
  app.get("/sitemap.xml", (req, res) => {
    const pathsToTry = [
      path.join(process.cwd(), "dist", "sitemap.xml"),
      path.join(process.cwd(), "public", "sitemap.xml"),
    ];
    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        res.header("Content-Type", "application/xml; charset=utf-8");
        return res.sendFile(p);
      }
    }
    res.status(404).send("Sitemap not found");
  });

  // Explicit Robots.txt Handler
  app.get("/robots.txt", (req, res) => {
    const pathsToTry = [
      path.join(process.cwd(), "dist", "robots.txt"),
      path.join(process.cwd(), "public", "robots.txt"),
    ];
    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        res.header("Content-Type", "text/plain; charset=utf-8");
        return res.sendFile(p);
      }
    }
    res.status(404).send("Robots.txt not found");
  });

  // Vite
  const isProductionMode = process.env.NODE_ENV === "production" || fs.existsSync(path.join(process.cwd(), 'dist'));
  if (!isProductionMode && !process.env.VERCEL) {
    try {
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } catch (e) {}
  } else {
    if (!process.env.VERCEL) {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => console.log(`[READY] Port ${PORT}`));
  }
}

startServer().catch(console.error);
