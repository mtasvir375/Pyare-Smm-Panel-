import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";
import https from "https";
import http from "http";
import {
  getTursoStatus,
  saveTursoConfig,
  testTursoConnection,
  syncAllLocalDataToTurso,
  tursoSetDoc,
  tursoDeleteDoc,
  tursoGetDoc,
  tursoListDocs,
  isTursoConnected,
  getTursoClient,
  getTursoDoc,
  setTursoDoc,
  listTursoDocs,
  deleteTursoDoc
} from "./server/tursoDb";
import {
  getLocalSqliteDb,
  getLocalDoc,
  setLocalDoc,
  updateLocalDoc,
  addLocalDoc,
  listLocalDocs,
  deleteLocalDoc,
  getAllLocalCollections
} from "./api/localDb";
import { migrateAllFromFirebase } from "./api/migrateFromFirebase";

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  initTelegramBotService,
  getBankAlerts,
  getTelegramStatus,
  getTelegramConfig,
  startTelegramPolling,
  stopTelegramPolling,
  saveTelegramConfig,
  simulateBankSms,
  verifyAndClaimAlert,
  clearTelegramWebhook,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  processTelegramUpdate,
  parseBankSms as parseBankSmsFromService,
  addBankAlert,
  createPaymentIntent,
  getPaymentIntent,
  getAllPaymentIntents,
  registerPaymentIntentCallback,
  sendTelegramReply,
  tryMatchAndCompleteIntent,
  reconcilePendingIntentsWithAlerts,
  recordIncomingMessage
} from "./telegramBotService";

dotenv.config();

// Global process crash guards to ensure dev server remains resilient and never terminates unexpectedly
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.warn("[WARNING] Unhandled rejection:", reason);
});

// Load Firebase Config globally
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
} catch (e) {
  console.warn("[FIREBASE] Could not read firebase-applet-config.json from cwd, using defaults");
}
const configProjectId = firebaseConfig.projectId || "gen-lang-client-0629912823";
const apiKey = firebaseConfig.apiKey || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";
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


    // Initialize Firebase Admin safely
    let adminApp: any = null;
    if (!admin.apps.length) {
      try {
        adminApp = admin.initializeApp({
          projectId: configProjectId,
          credential: admin.credential.applicationDefault()
        });
        console.log(`[FIREBASE] Admin SDK initialized with default credentials.`);
      } catch (error) {
        try {
          adminApp = admin.initializeApp();
          console.log(`[FIREBASE] Admin SDK initialized with minimal config.`);
        } catch (e2) {
          console.warn("[FIREBASE] Admin SDK init failed, will use REST API fallback:", e2);
        }
      }
    } else {
      adminApp = admin.apps[0];
    }

let fdb: any = null;
try {
  fdb = getFirestore(adminApp || admin.app(), dbId);
} catch (e1) {
  try {
    fdb = getFirestore();
  } catch (e2) {
    console.warn("[FIREBASE] getFirestore fallback:", e2);
  }
}

const PORT = 3000;

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
    // Return empty string because container compute metadata token belongs to the hosting Cloud Run project,
    // which does not have IAM access to the external Firebase project. Firestore REST calls authenticate
    // directly via ?key=${apiKey} per firestore.rules.
    return "";
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
  initializeSystemToken().catch(e => console.warn("[STARTUP] Token init non-blocking warning:", e?.message));
  
  app.use(express.json({
    limit: "50mb",
    verify: (req: any, res, buf) => {
      req.rawBody = buf ? buf.toString() : "";
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.text({ type: ["text/plain", "text/*"], limit: "50mb" }));
  
  // Guard against malformed JSON from SMS forwarder apps (e.g. unescaped newlines/quotes in SMS)
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && "body" in err) {
      if (req.url?.includes("sms") || req.url?.includes("forwarder")) {
        console.warn("[SMS-FORWARDER-RAW-RECOVERY] Malformed JSON recovered from raw body for SMS webhook");
        req.body = req.rawBody || "";
        return next();
      }
      return res.status(400).json({ error: "Invalid JSON format" });
    }
    next(err);
  });
  
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

  // Global Cache-Control middleware to prevent CDN / Cloudflare / Vercel edge caching on custom domain
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });
  
  // Storage for basic app config that doesn't change often
  const serverCache = {
    settings: null as any,
    courses: new Map<string, any>(),
    providers: new Map<string, any>(),
    users: new Map<string, any>(),
    orders: new Map<string, any>(),
    deposits: new Map<string, any>(),
    received_gateway_payments: new Map<string, any>(), // Track real-time payments from Paytm/PhonePe/UPIGateway/SMS webhooks
    sms_forwarder_logs: [] as any[], // Real-time logs for SMS forwarder webhook
    pending_user_utrs: new Map<string, { userId: string; userEmail?: string; amount: number; timestamp: number }>(), // Pending UTR claims waiting for SMS
    latestOrders: [] as any[] // Globally tracked latest orders in memory
  };

  const cacheFilePath = path.join(process.cwd(), "persistent_cache.json");

  // Default SMM Providers and Settings to seed if cache file or DB is fresh
  const DEFAULT_PROVIDERS_SEED: [string, any][] = [
    [
      "talVdnSEg8QGpNVpaUTi",
      {
        data: {
          id: "talVdnSEg8QGpNVpaUTi",
          name: "Wholesale Smm Store",
          apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8",
          apiUrl: "https://wholesalesmmstore.com/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
        },
        time: Date.now()
      }
    ],
    [
      "BjKqhBjQkzJ6y1GIYf5R",
      {
        data: {
          id: "BjKqhBjQkzJ6y1GIYf5R",
          name: "Wholesale Smm Store",
          apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8",
          apiUrl: "https://wholesalesmmstore.com/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
        },
        time: Date.now()
      }
    ],
    [
      "z4luhVVgYKgHULKPXj8j",
      {
        data: {
          id: "z4luhVVgYKgHULKPXj8j",
          name: "The main smm provider",
          apiKey: "e104906e7686a6177f614c7ddbe0a240124a1795",
          apiUrl: "https://themainsmmprovider.com/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
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
          apiKey: "e104906e7686a6177f614c7ddbe0a240124a1795",
          apiUrl: "https://themainsmmprovider.com/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
        },
        time: Date.now()
      }
    ],
    [
      "z9lfdj7ByNCeGNO6WbGZ",
      {
        data: {
          id: "z9lfdj7ByNCeGNO6WbGZ",
          name: "Smm bin",
          apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
          apiUrl: "https://smmbin.com/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
        },
        time: Date.now()
      }
    ],
    [
      "GbtZDOMSvSrBPgeRy6aU",
      {
        data: {
          id: "GbtZDOMSvSrBPgeRy6aU",
          name: "Smm bin",
          apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
          apiUrl: "https://smmbin.com/api/v2",
          createdAt: "2026-07-13T01:42:06.734Z"
        },
        time: Date.now()
      }
    ],
    [
      "1RmzJhc5ZeyOCU23uZMy",
      {
        data: {
          id: "1RmzJhc5ZeyOCU23uZMy",
          name: "MainSMMpanel ♥️",
          apiKey: "5a2749e1fdafdf50cd81f2137f9b5806",
          apiUrl: "https://mainsmmpanel.in/api/v2",
          createdAt: "2026-09-05T23:14:00.000Z"
        },
        time: Date.now()
      }
    ]
  ];



  let firestoreQuotaExceeded = false;
  let firestoreQuotaExceededUntil = 0;

  function checkQuotaCooldown(): boolean {
    if (firestoreQuotaExceeded && Date.now() < firestoreQuotaExceededUntil) {
      return true;
    }
    firestoreQuotaExceeded = false;
    return false;
  }

  function handleFirestoreQuotaError(err: any) {
    const msg = String(err?.message || err?.response?.data?.error?.message || "");
    const code = err?.code || err?.response?.status;
    if (code === 429 || msg.includes("Quota limit exceeded") || msg.includes("RESOURCE_EXHAUSTED")) {
      console.warn("[QUOTA-CIRCUIT-BREAKER] Firestore Quota Exhausted (429)! Activating 15-minute read shield.");
      firestoreQuotaExceeded = true;
      firestoreQuotaExceededUntil = Date.now() + 15 * 60 * 1000;
    }
  }

  // Aggressive backend-side cache to protect database read limits
  let serverCachedCourses: any[] | null = null;
  let serverCachedCoursesTime = 0;
  let serverCachedSettings: any = null;
  let serverCachedSettingsTime = 0;

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
          if (serverCache.courses.size > 0) {
            serverCachedCourses = Array.from(serverCache.courses.values()).map(c => c.data);
            serverCachedCoursesTime = Date.now();
            console.log(`[PERSISTENT-CACHE] Populated ${serverCachedCourses.length} in-memory courses (0 Firestore reads required).`);
          }
        }



        if (parsed.users && Array.isArray(parsed.users)) {
          serverCache.users.clear();
          const emailToUid = new Map<string, string>();
          // First pass: identify real UIDs
          parsed.users.forEach(([id, cacheObj]: [string, any]) => {
            const uData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            const uid = String(uData.uid || uData.id || id).trim();
            const email = String(uData.email || uData.userEmail || "").trim().toLowerCase();
            if (uid && !uid.includes("@") && email) {
              emailToUid.set(email, uid);
            }
          });
          // Second pass: load deduplicated
          parsed.users.forEach(([id, cacheObj]: [string, any]) => {
            const uData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            const email = String(uData.email || uData.userEmail || "").trim().toLowerCase();
            let canonicalId = String(uData.uid || uData.id || id).trim();
            if (canonicalId.includes("@") && email && emailToUid.has(email)) {
              canonicalId = emailToUid.get(email)!;
            }
            if (serverCache.users.has(canonicalId)) {
              const existing = serverCache.users.get(canonicalId);
              const exData = existing?.data || existing || {};
              const exBal = Number(exData.balance ?? exData.walletBalance ?? 0);
              const inBal = Number(uData.balance ?? uData.walletBalance ?? 0);
              const bestBal = (!isNaN(inBal) && inBal > 0) ? inBal : exBal;
              serverCache.users.set(canonicalId, {
                data: { ...exData, ...uData, id: canonicalId, uid: canonicalId, balance: bestBal },
                time: Math.max(cacheObj?.time || 0, existing?.time || 0) || Date.now()
              });
            } else {
              serverCache.users.set(canonicalId, { data: { ...uData, id: canonicalId, uid: canonicalId }, time: cacheObj?.time || Date.now() });
            }
          });
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.users.size} unique users from disk.`);
        }

        if (parsed.deposits && Array.isArray(parsed.deposits)) {
          serverCache.deposits.clear();
          parsed.deposits.forEach(([id, cacheObj]: [string, any]) => {
            const dData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            serverCache.deposits.set(id, { data: dData, time: cacheObj?.time || Date.now() });
          });
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.deposits.size} deposits from disk.`);
        }

        if (parsed.orders && Array.isArray(parsed.orders)) {
          serverCache.orders.clear();
          serverCache.latestOrders = [];
          parsed.orders.forEach(([id, cacheObj]: [string, any]) => {
            const oData = cacheObj?.data ? { id, ...cacheObj.data } : { id, ...(cacheObj || {}) };
            serverCache.orders.set(id, { data: oData, time: cacheObj?.time || Date.now() });
            serverCache.latestOrders.push(oData);
          });
          serverCache.latestOrders.sort((a, b) => getTimestampMs(b.createdAt || b.created_at) - getTimestampMs(a.createdAt || a.created_at));
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.orders.size} orders from disk (0 Firestore reads required).`);
        }

        if (parsed.received_gateway_payments && Array.isArray(parsed.received_gateway_payments)) {
          serverCache.received_gateway_payments.clear();
          parsed.received_gateway_payments.forEach(([k, v]: [string, any]) => {
            serverCache.received_gateway_payments.set(k, v);
          });
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.received_gateway_payments.size} gateway/sms payments from disk.`);
        }

        if (parsed.sms_forwarder_logs && Array.isArray(parsed.sms_forwarder_logs)) {
          serverCache.sms_forwarder_logs = parsed.sms_forwarder_logs;
          console.log(`[PERSISTENT-CACHE] Loaded ${serverCache.sms_forwarder_logs.length} SMS forwarder logs from disk.`);
        }
      }
    } catch (err: any) {
      console.error("[PERSISTENT-CACHE-ERR] Failed to load persistent cache:", err.message);
    }

    // Seed defaults if empty
    if (serverCache.courses.size === 0) {
      console.log(`[PERSISTENT-CACHE] No default courses seeded into memory.`);
    }

    if (serverCache.providers.size === 0) {
      console.log(`[PERSISTENT-CACHE] No default providers seeded to allow fetching from DB.`);
    }

    if (!serverCache.settings || !serverCache.settings.data) {
      console.log("[PERSISTENT-CACHE] No default settings seeded to allow fetching from DB.");
    }
  };

  // Save persistent cache to disk
  const savePersistentCache = () => {
    try {
      // CRITICAL SAFETY: If we are in quota-exceeded mode and memory cache is empty,
      // do NOT overwrite the persistent disk cache! This prevents "vanishing data" issues.
      if (firestoreQuotaExceeded && serverCache.courses.size === 0 && serverCache.providers.size === 0) {
        console.warn("[PERSISTENT-CACHE] Quota exceeded and memory cache is empty. Skipping disk save to prevent data loss.");
        return;
      }

      const dataToSave = {
        settings: serverCache.settings,
        providers: Array.from(serverCache.providers.entries()),
        courses: Array.from(serverCache.courses.entries()),
        users: Array.from(serverCache.users.entries()),
        deposits: Array.from(serverCache.deposits.entries()).slice(-100),
        orders: Array.from(serverCache.orders.entries()).slice(-500),
        received_gateway_payments: Array.from(serverCache.received_gateway_payments.entries()).slice(-100),
        sms_forwarder_logs: (serverCache.sms_forwarder_logs || []).slice(-100)
      };

      // Only save if we actually have some settings or courses (basic sanity check)
      // Refuse to overwrite a populated disk cache with an empty memory state unless explicitly intended.
      if (!dataToSave.settings && dataToSave.courses.length === 0 && dataToSave.providers.length === 0) {
        if (fs.existsSync(cacheFilePath) && fs.statSync(cacheFilePath).size > 5000) {
          console.warn("[PERSISTENT-CACHE] Refusing to overwrite populated disk cache with empty memory state.");
          return;
        }
      }

      fs.writeFileSync(cacheFilePath, JSON.stringify(dataToSave, null, 2), "utf-8");
      console.log("[PERSISTENT-CACHE] Saved settings, providers, courses, users, deposits & orders cache to disk.");
    } catch (err: any) {
      console.error("[PERSISTENT-CACHE-ERR] Failed to save persistent cache:", err.message);
    }
  };

  // Run the disk cache loader right away
  loadPersistentCache();
  // Initialize Telegram Bot & local bank alerts service (0 Firestore reads/writes)
  try {
    initTelegramBotService();
    const savedUpi = serverCache.settings?.data?.upiId;
    const savedMerchant = serverCache.settings?.data?.merchantName;
    if (savedUpi && savedUpi !== "paytmqr281005050101111956557626@paytm") {
      saveTelegramConfig({
        upiId: savedUpi,
        ...(savedMerchant ? { payeeName: savedMerchant } : {})
      });
    }
  } catch (tErr: any) {
    console.warn("[TELEGRAM-INIT-FAIL]", tErr.message);
  }

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

    // Persist to disk cache
    savePersistentCache();
  }

  // Load orders from Firestore on startup only if disk cache has them, else rely on on-demand user loading
  async function seedMemoryOrders() {
    try {
      if (serverCache.orders.size > 0) {
        console.log(`[MEMORY] ${serverCache.orders.size} orders loaded from persistent disk cache - 0 Firestore reads needed.`);
        return;
      }
      console.log("[MEMORY] Zero-read startup mode: skipping global orders query from Firestore to protect 50k daily quota.");
      return;
    } catch (e: any) {
      console.warn("[MEMORY] Notice during seedMemoryOrders:", e?.message);
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
        !realProjectId.startsWith("ais-")) return realProjectId;
    
    // 2. Use config's projectId if available
    if (configProjectId) return configProjectId;

    // 3. Last resort
    return "gen-lang-client-0629912823";
  };

  const getGoogleAuthHeaders = async (token?: string) => {
    const headers: any = {};
    if (token && typeof token === "string" && token.trim().length > 0) {
      const stripped = token.replace(/^Bearer\s+/i, "").trim();
      // Google Cloud Firestore REST API ONLY accepts Google OAuth 2.0 access tokens (which start with 'ya29.')
      // Firebase User ID tokens (JWTs starting with 'eyJ') are rejected by Google API Gateway with 401.
      // Firestore security rules (allow read, write: if true) work seamlessly with apiKey.
      if (stripped.startsWith("ya29.")) {
        headers["Authorization"] = `Bearer ${stripped}`;
      }
    }
    return headers;
  };

  const getDocREST = async (collect: string, id: string, token?: string) => {
    const targetProject = getTargetProject();
    try {
      const isConfigColl = collect === "providers" || collect === "settings" || collect === "courses" || collect === "services";
      const effectiveToken = isConfigColl ? undefined : token;
      const headers = await getGoogleAuthHeaders(effectiveToken);
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
      const headers = await getGoogleAuthHeaders(token);
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
      const headers = await getGoogleAuthHeaders(token);
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
      const headers = await getGoogleAuthHeaders(token);
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
      const headers = await getGoogleAuthHeaders(token);
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

  const adjustUserBalanceSafe = async (user_id: string, change: number, token?: string) => {
    console.log(`[BALANCE-SAFE] Adjusting balance for ${user_id} by ${change}`);
    
    // 1. Determine current balance accurately
    let currentBalance = 0;
    let existingUserData: any = null;

    // 1. ALWAYS fetch authoritative fresh user document from Firestore first (prevents stale balance calculations)
    try {
      const userRef = await getDocREST("users", user_id, token);
      if (userRef && userRef.exists) {
        existingUserData = userRef.data();
        currentBalance = Number(existingUserData.balance ?? existingUserData.walletBalance ?? existingUserData.wallet_balance ?? 0);
      }
    } catch (fetchErr: any) {
      console.warn(`[BALANCE-SAFE] Fresh fetch error for ${user_id}, using fallback:`, fetchErr.message);
    }

    // Fallback only if direct Firestore fetch failed
    if (!existingUserData && serverCache.users.has(user_id)) {
      const cached = serverCache.users.get(user_id);
      if (cached && (cached.data || cached.balance !== undefined)) {
        existingUserData = cached.data || cached;
        currentBalance = Number(existingUserData.balance ?? existingUserData.walletBalance ?? existingUserData.wallet_balance ?? 0);
      }
    }

    const newBalance = Math.max(0, Number((currentBalance + change).toFixed(2)));
    console.log(`[BALANCE-SAFE] User ${user_id}: ₹${currentBalance} -> ₹${newBalance} (change: ${change})`);

    const updatedData = {
      ...(existingUserData || { uid: user_id, role: "student", createdAt: new Date().toISOString() }),
      balance: newBalance,
      updatedAt: new Date().toISOString()
    };

    // 2. Immediately update in-memory cache and persistent disk cache
    serverCache.users.set(user_id, { data: updatedData, time: Date.now() });
    savePersistentCache();

    // 3. Persist immediately to Firestore via REST
    try {
      const restOk = await setDocREST("users", user_id, { balance: newBalance, updatedAt: new Date().toISOString() }, token);
      if (restOk) {
        console.log(`[BALANCE-SAFE] Successfully persisted balance ₹${newBalance} to Firestore for ${user_id}`);
      } else {
        console.warn(`[BALANCE-SAFE] setDocREST returned false for user ${user_id}`);
      }
    } catch (persistErr: any) {
      console.error(`[BALANCE-SAFE] Warning: REST balance persist error for ${user_id}:`, persistErr.message);
    }

    // Try Admin SDK atomic increment as secondary sync if available
    if (!useRestFallback && adminSdkSucceeded) {
      try {
        await fdb.collection("users").doc(user_id).set({
          balance: newBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {}
    }

    // Persist to Turso database (smm_users and smm_documents)
    try {
      await setTursoDoc("users", user_id, updatedData);
    } catch (e) {}

    return { success: true, newBalance };
  };

  const adjustUserBalanceREST = async (user_id: string, change: number, token?: string) => {
    return adjustUserBalanceSafe(user_id, change, token);
  };

  // Register Zero-UTR Automatic Payment Intent Callback
  registerPaymentIntentCallback(async (intent, utr, rawText) => {
    const cleanUtr = (utr || intent.orderRef || "").trim();
    const orderRef = (intent.orderRef || "").trim();
    const intentId = (intent.intentId || "").trim();

    // 0. Firestore Persistent Duplicate Guard (Acts as ironclad distributed lock):
    if (orderRef) {
      try {
        const claimDoc = await getDocSafe("claimed_payments", orderRef);
        const claimData = claimDoc?.data ? claimDoc.data() : claimDoc;
        if (claimData && claimData.credited) {
          console.log(`[DUPLICATE-PREVENTED] Permanent Firestore check: Order ${orderRef} was already claimed in Firestore. Skipping.`);
          return true;
        }
      } catch (err) {}
    }
    if (cleanUtr) {
      try {
        const claimDoc = await getDocSafe("claimed_payments", cleanUtr);
        const claimData = claimDoc?.data ? claimDoc.data() : claimDoc;
        if (claimData && claimData.credited) {
          console.log(`[DUPLICATE-PREVENTED] Permanent Firestore check: UTR ${cleanUtr} was already claimed in Firestore. Skipping.`);
          return true;
        }
      } catch (err) {}
    }

    // Strict Multi-Level Duplicate Guard (In-memory lock check):
    if ((intent as any).credited || (intent as any).walletCredited) {
      console.log(`[DUPLICATE-PREVENTED] Intent ${intentId} already credited in memory. Skipping.`);
      return true;
    }

    if (
      (cleanUtr && globalClaimedUtrs.has(cleanUtr)) ||
      (orderRef && globalClaimedUtrs.has(orderRef)) ||
      (intentId && globalClaimedUtrs.has(intentId)) ||
      (cleanUtr && globalUtrLocks.has(cleanUtr)) ||
      (orderRef && globalUtrLocks.has(orderRef))
    ) {
      console.log(`[DUPLICATE-PREVENTED] Payment ${orderRef} / ${cleanUtr} already claimed or processing globally. Skipping.`);
      return true;
    }

    // Acquire atomic concurrency lock IMMEDIATELY
    if (cleanUtr) globalUtrLocks.add(cleanUtr);
    if (orderRef) globalUtrLocks.add(orderRef);
    if (cleanUtr) globalClaimedUtrs.add(cleanUtr);
    if (orderRef) globalClaimedUtrs.add(orderRef);
    if (intentId) globalClaimedUtrs.add(intentId);

    console.log(`[ZERO-UTR-INTENT-CALLBACK] Processing wallet credit for intent ${intentId} (Order: ${orderRef}, ₹${intent.amount})`);
    try {
      (intent as any).credited = true;
      (intent as any).walletCredited = true;

      // Check if user document already has this deposit in their history
      let currentBal = 0;
      let existingDeposits: any[] = [];
      try {
        const uDoc = await getDocSafe("users", intent.userId);
        const uData = uDoc?.data ? uDoc.data() : uDoc;
        currentBal = Number(uData?.balance ?? uData?.walletBalance ?? 0);
        if (Array.isArray(uData?.latestDeposits)) {
          existingDeposits = uData.latestDeposits;
        }
      } catch (e) {}

      const alreadyExists = existingDeposits.some((d: any) =>
        (orderRef && d?.orderRef === orderRef) ||
        (cleanUtr && d?.utr === cleanUtr)
      );
      if (alreadyExists) {
        console.log(`[DUPLICATE-PREVENTED] Deposit already approved in user profile for ${orderRef} / ${cleanUtr}. Skipping balance add.`);
        return true;
      }

      // 1. Credit User Balance
      const adjusted = await adjustUserBalanceSafe(intent.userId, intent.amount);
      if (!adjusted) {
        console.error(`[ZERO-UTR-CREDIT-FAIL] Failed to credit wallet for user ${intent.userId}`);
        return false;
      }

      // Mark distributed cross-platform lock in Firestore claimed_payments collection
      if (orderRef) {
        setDocSafe("claimed_payments", orderRef, {
          orderRef,
          utr: cleanUtr,
          userId: intent.userId,
          amount: intent.amount,
          credited: true,
          claimedAt: new Date().toISOString()
        }).catch(() => {});
      }
      if (cleanUtr && cleanUtr !== orderRef) {
        setDocSafe("claimed_payments", cleanUtr, {
          orderRef,
          utr: cleanUtr,
          userId: intent.userId,
          amount: intent.amount,
          credited: true,
          claimedAt: new Date().toISOString()
        }).catch(() => {});
      }

      // 2. Read new balance
      let newBalance = 0;
      try {
        const uDoc = await getDocSafe("users", intent.userId);
        const uData = uDoc?.data ? uDoc.data() : uDoc;
        newBalance = uData?.balance || 0;
        if (Array.isArray(uData?.latestDeposits)) {
          existingDeposits = uData.latestDeposits;
        }
      } catch (e) {}
      (intent as any).newBalance = newBalance;

      // 3. Save approved deposit record
      const depositId = `dep_auto_${intent.orderRef}_${Date.now()}`;
      const depositData = {
        id: depositId,
        userId: intent.userId,
        userEmail: intent.userEmail || "customer",
        amount: intent.amount,
        baseAmount: intent.baseAmount,
        utr: cleanUtr,
        orderRef: intent.orderRef,
        status: "approved",
        type: "auto_zero_utr_upi",
        paymentMethod: "auto_zero_utr_upi",
        provider: intent.senderBank || "UPI Auto QR",
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      try {
        await addDocSafe("deposits", depositData);
        serverCache.deposits.set(depositId, { data: depositData, time: Date.now() });
        savePersistentCache();
      } catch (e) {}

      // 4. Maintain rotating latest 10 deposits in user document (0 extra reads on login/refresh!)
      try {
        const updatedLatestDeposits = [
          depositData,
          ...existingDeposits.filter((d: any) => d && d.utr !== cleanUtr && d.orderRef !== intent.orderRef)
        ].slice(0, 10);

        await updateDocSafe("users", intent.userId, {
          latestDeposits: updatedLatestDeposits,
          lastDepositedAt: new Date().toISOString()
        });
      } catch (e) {}

      console.log(`[ZERO-UTR-CREDITED-SUCCESS] Credited ₹${intent.amount} to user ${intent.userId} (New Balance: ₹${newBalance})`);
      return true;
    } catch (err: any) {
      console.error("[ZERO-UTR-CREDIT-EXCEPTION]", err.message);
      return false;
    }
  });

  // Reconcile any existing alerts with uncompleted intents right after callback registration
  setTimeout(() => {
    reconcilePendingIntentsWithAlerts()
      .then((count) => {
        if (count > 0) console.log(`[STARTUP-RECONCILE] Successfully auto-credited ${count} pending intents!`);
      })
      .catch((e) => console.warn("[STARTUP-RECONCILE-WARN]", e.message));
  }, 1000);

  // Startup permissions test to enable automatic Firestore REST fallback before handling requests
  const initAdminSdk = async () => {
    if (process.env.VERCEL) {
      console.warn("[STARTUP] Vercel detected. Forcing REST Fallback.");
      adminSdkSucceeded = false;
      useRestFallback = true;
      return;
    }

    // CACHE-FIRST: If settings and providers are already loaded from persistent disk cache,
    // do NOT perform a test read or sync against Firestore on startup! (0 Firestore reads)
    
    if (serverCache.settings && serverCache.settings.data) {
      console.log("[STARTUP] Cache-first: settings/payment already loaded from persistent disk.");
      // We don't need to force REST fallback here, we can still use the Admin SDK if available
      adminSdkSucceeded = true; 
      useRestFallback = false;
      if (serverCache.providers.size > 0) {
        console.log(`[STARTUP] Cache-first: ${serverCache.providers.size} providers already loaded from disk.`);
      } else {
        syncProvidersToSettingsInternal().catch(console.error);
      }
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
      if (serverCache.providers.size > 0) {
        console.log(`[SYNC-PROVIDERS-STARTUP] Cache-first: ${serverCache.providers.size} providers already in persistent cache. Skipping Firestore read.`);
        return;
      }
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
          serverCache.providers.set(p.id, { data: p, time: Date.now() });
        }
      });
      savePersistentCache();
      console.log(`[SYNC-PROVIDERS-STARTUP] Providers loaded in memory and saved to persistent cache.`);
    } catch (err: any) {
      console.error(`[SYNC-PROVIDERS-STARTUP-ERROR] Failed to sync on startup:`, err.message);
    }
  };

  // Skip startup write to save Firestore writes

  // Database Access Layer Helper Operations

  // Firebase-Firestore Helpers that replace Supabase ones
  const getDocSafe = async (collect: string, id: string, token?: string, forceFresh?: boolean) => {
    const now = Date.now();
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    if (!forceFresh) {
      if (collect === "settings" && id === "payment" && serverCache.settings?.data) {
        return { exists: true, data: () => serverCache.settings.data };
      }
      if (collect === "providers" && id && serverCache.providers.has(id)) {
        return { exists: true, data: () => serverCache.providers.get(id).data };
      }
      if (collect === "courses" && id && serverCache.courses.has(id)) {
        return { exists: true, data: () => serverCache.courses.get(id).data };
      }
    }

    // Dynamic cache for users (15s TTL if not forceFresh)
    if (collect === "users" && id && serverCache.users.has(id)) {
      const cached = serverCache.users.get(id);
      if (checkQuotaCooldown() || (!forceFresh && (now - cached.time < 15000))) {
        return { exists: true, data: () => cached.data };
      }
    }

    // If quota circuit breaker is active, serve directly from cache to save quota
    if (checkQuotaCooldown() || !forceFresh) {
      if (collect === "orders" && id && serverCache.orders.has(id)) {
        return { exists: true, data: () => serverCache.orders.get(id).data || serverCache.orders.get(id) };
      }
    }

    // Bypassing Firestore read completely for SMM providers, Global settings, and services if called internally (no token) and already cached
    if (!token && !forceFresh) {
      if (collect === "settings" && id === "payment" && serverCache.settings && (now - (serverCache.settings.time || 0) < CACHE_TTL)) {
        if (serverCache.settings.data?.providerApiKey !== "f55bb2dfdc035f9c3c9e737bb72922a51d64309f") {
          console.log(`[GET-SAFE-INTERNAL] Serving settings/payment from persistent cache (no token).`);
          return { exists: true, data: () => serverCache.settings.data };
        }
      }
      if (collect === "providers" && id && serverCache.providers.has(id)) {
        if (!serverCache.providers.has("z9lfdj7ByNCeGNO6WbGZ") || serverCache.providers.size > 10) {
          console.log(`[GET-SAFE-INTERNAL] Serving providers/${id} from persistent cache (no token).`);
          return { exists: true, data: () => serverCache.providers.get(id).data };
        }
      }
      if (collect === "courses" && id && serverCache.courses.has(id)) {
        if (!serverCache.courses.has("srv_ig_followers_nondrop") || serverCache.courses.size > 20) {
          console.log(`[GET-SAFE-INTERNAL] Serving courses/${id} from persistent cache (no token).`);
          return { exists: true, data: () => serverCache.courses.get(id).data };
        }
      }
    }

    // Cache lookup for common static/global configurations (always safe to cache regardless of user auth tokens)
    if (!forceFresh) {
      if (collect === "settings" && id === "payment" && serverCache.settings && now - serverCache.settings.time < CACHE_TTL) {
        if (serverCache.settings.data?.providerApiKey !== "f55bb2dfdc035f9c3c9e737bb72922a51d64309f") {
          return { exists: true, data: () => serverCache.settings.data };
        }
      }
      if (collect === "courses" && id && serverCache.courses && serverCache.courses.has(id)) {
        if (!serverCache.courses.has("srv_ig_followers_nondrop") || serverCache.courses.size > 20) {
          const cached = serverCache.courses.get(id);
          if (now - cached.time < CACHE_TTL) {
            return { exists: true, data: () => cached.data };
          }
        }
      }
      if (collect === "providers" && id && serverCache.providers && serverCache.providers.has(id)) {
        if (!serverCache.providers.has("z9lfdj7ByNCeGNO6WbGZ") || serverCache.providers.size > 10) {
          const cached = serverCache.providers.get(id);
          if (now - cached.time < CACHE_TTL) {
            return { exists: true, data: () => cached.data };
          }
        }
      }
    }

    if (!forceFresh) { // Cache user balance within dynamic TTL to avoid redundant reads on rapid orders
      if (collect === "users" && id && serverCache.users && serverCache.users.has(id)) {
        const cached = serverCache.users.get(id);
        if (now - cached.time < 15000) {
          return { exists: true, data: () => cached.data };
        }
      }
    }

    let result = { exists: false, data: () => null as any };

    // 1. Try Turso Database first
    try {
      const tursoData = await getTursoDoc(collect, id);
      if (tursoData) {
        return { exists: true, data: () => tursoData };
      }
    } catch (tursoErr) {}

    const isCoreColl = collect === "providers" || collect === "settings" || collect === "courses" || collect === "services";

    if (!result.exists && (!useRestFallback || (adminSdkSucceeded && isCoreColl))) {
      try {
        const snap = await fdb.collection(collect).doc(id).get();
        if (snap.exists) {
          const data = snap.data();
          result = { exists: true, data: () => data };
        }
      } catch (err: any) {
        console.warn(`[FIREBASE-GET] Failed for ${collect}/${id}: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.message?.includes("Quota") || err.code === 7 || err.code === 8 || err.code === 429) {
          if (!adminSdkSucceeded || err.message?.includes("Quota")) {
            console.warn("[FIREBASE] Permission denied or Quota exceeded. Engaging REST Fallback.");
            useRestFallback = true;
            handleFirestoreQuotaError(err);
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
      if (collect === "users" && id && serverCache.users && serverCache.users.has(id)) {
        console.log(`[GET-SAFE-FALLBACK] Live fetch failed for users/${id}. Falling back to cached copy.`);
        const cached = serverCache.users.get(id);
        const uData = cached.data || cached;
        return { exists: true, data: () => uData };
      }
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
      
      // Auto-sync back to Turso Database to populate missing items and prevent future Firestore reads
      try {
        setTursoDoc(collect, id, data).catch(() => {});
      } catch (e) {}

      try {
        setLocalDoc(collect, id, data);
      } catch (e) {}

      if (collect === "settings" && id === "payment") {
        serverCache.settings = { data, time: now };
        savePersistentCache();
      } else if (collect === "courses" && id) {
        serverCache.courses.set(id, { data, time: now });
        savePersistentCache();
      } else if (collect === "providers" && id) {
        serverCache.providers.set(id, { data, time: now });
        savePersistentCache();
      } else if (collect === "users" && id) {
        let uData = data;
        const currentBal = Number(uData?.balance ?? uData?.walletBalance ?? 0);
        // Automatic balance recovery from approved deposits if balance is zero or missing
        if (currentBal <= 0) {
          let totalApproved = 0;
          serverCache.deposits.forEach((dep: any) => {
            const d = dep?.data || dep;
            if ((d.userId === id || d.user_id === id) && d.status === "approved") {
              totalApproved += Number(d.amount || 0);
            }
          });
          let totalOrdersPrice = 0;
          serverCache.orders.forEach((ord: any) => {
            const o = ord?.data || ord;
            if ((o.userId === id || o.user_id === id) && o.status !== "Failed" && o.status !== "Cancelled") {
              totalOrdersPrice += Number(o.totalPrice || o.total_price || 0);
            }
          });
          const calculatedBal = Math.max(0, Number((totalApproved - totalOrdersPrice).toFixed(2)));
          if (calculatedBal > 0) {
            console.log(`[BALANCE-AUTO-RESTORE] Restoring ₹${calculatedBal} balance for user ${id} (Approved deposits: ₹${totalApproved}, Orders: ₹${totalOrdersPrice})`);
            uData = { ...uData, balance: calculatedBal };
            result = { exists: true, data: () => uData };
            if (!useRestFallback) {
              fdb.collection("users").doc(id).set({ balance: calculatedBal }, { merge: true }).catch(() => {});
            }
          }
        }
        serverCache.users.set(id, { data: uData, time: now });
        savePersistentCache();
      } else if (collect === "orders" && id && !token) {
        serverCache.orders.set(id, { data, time: now });
      }
    }

    return result;
  };

  const listDocsSafe = async (collect: string, token?: string, forceFresh?: boolean) => {
    const docMap = new Map<string, any>();
    const now = Date.now();
    const CACHE_TTL = 24 * 60 * 60 * 1000;

    // 1. Check in-memory collection cache first
    if (!forceFresh) {
      if (collect === "deposits" && serverCache.deposits.size > 0) {
        serverCache.deposits.forEach((val, id) => docMap.set(id, { id, data: () => (val.data || val) }));
        return { docs: Array.from(docMap.values()) };
      }
      if (collect === "courses" && serverCache.courses.size > 0) {
        serverCache.courses.forEach((val, id) => docMap.set(id, { id, data: () => (val.data || val) }));
        return { docs: Array.from(docMap.values()) };
      }
      if (collect === "providers" && serverCache.providers.size > 0) {
        serverCache.providers.forEach((val, id) => docMap.set(id, { id, data: () => (val.data || val) }));
        return { docs: Array.from(docMap.values()) };
      }
    }

    // 1.5. Query Turso Database (Fast & Zero Firestore Reads)
    try {
      const limitCount = collect === "courses" ? 500 : 100;
      const tursoDocs = await listTursoDocs(collect, limitCount);
      if (tursoDocs && Array.isArray(tursoDocs) && tursoDocs.length > 0) {
        tursoDocs.forEach(d => {
          if (d && d.id) docMap.set(d.id, { id: d.id, data: () => d });
        });
        return { docs: Array.from(docMap.values()) };
      }
    } catch (tErr: any) {
      console.warn(`[TURSO-LIST-SAFE-WARN] ${collect}:`, tErr.message);
    }

    // 2. Firestore Admin SDK (Authoritative)
    if (!useRestFallback) {
      try {
        const limitCount = collect === "courses" ? 500 : 100;
        const snap = await fdb.collection(collect).limit(limitCount).get();
        console.log(`[LIST-SAFE-FIREBASE] Found ${snap.size} docs for ${collect}.`);
        if (!snap.empty) {
          snap.docs.forEach(doc => {
            docMap.set(doc.id, { id: doc.id, data: () => doc.data() });
          });
          return { docs: Array.from(docMap.values()) };
        }
        // If snap.empty is true, we should still return empty map unless it's a core collection that MIGHT be in REST fallback
        if (snap.empty && (collect === "courses" || collect === "providers")) {
           console.log(`[LIST-SAFE-FIREBASE] ${collect} is empty in Admin SDK. Trying REST fallback just in case.`);
           // Proceed to REST fallback below
        } else {
           return { docs: [] };
        }
      } catch (err: any) {
        console.warn(`[LIST-SAFE-FIREBASE] Failed for ${collect}: ${err.message}`);
        if (err.message?.includes("permissions") || err.message?.includes("PERMISSION_DENIED") || err.message?.includes("Quota") || err.code === 7 || err.code === 8 || err.code === 429) {
          useRestFallback = true;
          handleFirestoreQuotaError(err);
        }
      }
    }

    try {
      const results = await runQueryREST({
        structuredQuery: {
          from: [{ collectionId: collect }],
          limit: 50
        }
      }, token);
      if (results && results.length > 0) {
        results.forEach((item: any) => {
          docMap.set(item.id, item);
        });
      }
    } catch (restErr: any) {
      console.warn(`[LIST-SAFE-REST] Failed for ${collect}: ${restErr.message}`);
    }

    const docList = Array.from(docMap.values());
    if (docList.length > 0) {
      // Direct auto-sync back to Turso Database to populate lists
      docList.forEach((item: any) => {
        const d = typeof item.data === "function" ? item.data() : (item.data || item);
        if (d && item.id) {
          setTursoDoc(collect, item.id, d).catch(() => {});
        }
      });
    }

    return { docs: docList };
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
    updateLocalDoc(col, id, data);
    invalidateCachesForCollection(col, id);

    // Direct write to Turso Database
    try {
      const existing = (await getTursoDoc(col, id)) || {};
      const merged = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
      setTursoDoc(col, id, merged).catch((err: any) => {
        console.warn(`[TURSO-UPDATE-WARN] Failed for ${col}/${id}:`, err.message);
      });
    } catch (tErr) {}

    if (col === "courses" || col === "services") {
      const cached = serverCache.courses.get(id);
      const existingData = cached ? (cached.data || cached) : {};
      const merged = { ...existingData, ...data, id, updatedAt: new Date().toISOString() };
      serverCache.courses.set(id, { data: merged, time: Date.now() });
      savePersistentCache();
    }
    if (col === "settings" && id === "payment") {
      const existing = serverCache.settings?.data || {};
      const merged = { ...existing, ...data };
      serverCache.settings = { data: merged, time: Date.now() };
      serverCachedSettings = merged;
      serverCachedSettingsTime = Date.now();
      savePersistentCache();

      if (merged.upiId || merged.merchantName) {
        try {
          saveTelegramConfig({
            ...(merged.upiId ? { upiId: String(merged.upiId).trim() } : {}),
            ...(merged.merchantName ? { payeeName: String(merged.merchantName).trim() } : {})
          });
        } catch (e) {}
      }
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
    if (col === "users") {
      const existing = serverCache.users.get(id);
      const existingData = existing ? (existing.data || existing) : {};
      serverCache.users.set(id, { data: { ...existingData, ...data }, time: Date.now() });
      savePersistentCache();
    }
    if (col === "deposits") {
      const existing = serverCache.deposits.get(id) || {};
      serverCache.deposits.set(id, { ...existing, ...data, updatedAt: new Date().toISOString() });
    }
    return true;
  };

  function toFirestoreFields(obj: any): any {
    const fields: any = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v === null || v === undefined) {
        fields[k] = { nullValue: null };
      } else if (typeof v === "boolean") {
        fields[k] = { booleanValue: v };
      } else if (typeof v === "number") {
        if (Number.isInteger(v)) {
          fields[k] = { integerValue: String(v) };
        } else {
          fields[k] = { doubleValue: v };
        }
      } else if (typeof v === "string") {
        fields[k] = { stringValue: v };
      } else if (Array.isArray(v)) {
        fields[k] = { arrayValue: { values: v.map((item: any) => typeof item === "object" ? { mapValue: { fields: toFirestoreFields(item) } } : { stringValue: String(item) }) } };
      } else if (typeof v === "object") {
        fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
      }
    }
    return fields;
  }

  const setDocRESTAsync = (col: string, id: string, data: any) => {
    try {
      const targetProject = getTargetProject();
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${col}/${id}?key=${apiKey}`;
      const fields = toFirestoreFields(data);
      axios.patch(url, { fields }, { timeout: 10000 }).catch(err => {
        console.warn(`[REST-SYNC-WARN] Failed background Firestore sync for ${col}/${id}:`, err.message);
      });
    } catch (e) {}
  };

  const deleteDocRESTAsync = (col: string, id: string) => {
    try {
      const targetProject = getTargetProject();
      const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/${col}/${id}?key=${apiKey}`;
      axios.delete(url, { timeout: 10000 }).catch(err => {
        console.warn(`[REST-DELETE-WARN] Failed background Firestore delete for ${col}/${id}:`, err.message);
      });
    } catch (e) {}
  };

  const setDocSafe = async (col: string, id: string, data: any, token?: string) => {
    setLocalDoc(col, id, data);
    
    // Background write to Turso Database
    setTursoDoc(col, id, data).catch((err: any) => {
      console.warn(`[TURSO-SET-WARN] Failed for ${col}/${id}:`, err.message);
    });

    invalidateCachesForCollection(col, id);
    if (col === "providers") {
      const merged = { id, ...data };
      serverCache.providers.set(id, { data: merged, time: Date.now() });
      savePersistentCache();
    }
    if (col === "courses" || col === "services") {
      const merged = { id, ...data };
      serverCache.courses.set(id, { data: merged, time: Date.now() });
      savePersistentCache();
    }
    if (col === "settings" && id === "payment") {
      const existing = serverCache.settings?.data || {};
      const merged = { ...existing, ...data };
      serverCache.settings = { data: merged, time: Date.now() };
      serverCachedSettings = merged;
      serverCachedSettingsTime = Date.now();
      savePersistentCache();

      if (merged.upiId || merged.merchantName) {
        try {
          saveTelegramConfig({
            ...(merged.upiId ? { upiId: String(merged.upiId).trim() } : {}),
            ...(merged.merchantName ? { payeeName: String(merged.merchantName).trim() } : {})
          });
        } catch (e) {}
      }
    }
    if (col === "orders") {
      console.log(`[MEMORY-SET] Syncing memory cache for order ${id}.`);
      addOrderToMemory(id, data);
    }
    if (col === "users") {
      let existingData: any = {};
      try {
        const local = getLocalDoc("users", id);
        if (local) existingData = local;
      } catch (e) {}
      if (!existingData.balance) {
        const existing = serverCache.users.get(id);
        if (existing) existingData = existing.data || existing;
      }

      const existingBal = Number(existingData.balance ?? existingData.walletBalance ?? 0);
      const incomingBal = Number(data.balance);
      
      // Balance Guard: If incoming balance is 0 or undefined, but user already has a positive balance, preserve it!
      if ((data.balance === undefined || isNaN(incomingBal) || (incomingBal === 0 && existingBal > 0)) && existingBal > 0) {
        data.balance = existingBal;
        console.log(`[BALANCE-GUARD] Preserved existing balance of ₹${existingBal} for user ${id} (prevented overwrite).`);
      }
      serverCache.users.set(id, { data: { ...existingData, ...data }, time: Date.now() });
      savePersistentCache();
    }
    if (col === "deposits") {
      serverCache.deposits.set(id, { ...data, updatedAt: new Date().toISOString() });
    }
    return true;
  };

  const addDocSafe = async (col: string, data: any, token?: string) => {
    const generatedId = addLocalDoc(col, data);
    const now = new Date().toISOString();
    const docData = { id: generatedId, ...data, createdAt: data.createdAt || now, updatedAt: now };

    // Background write to Turso Database
    setTursoDoc(col, generatedId, docData).catch((err: any) => {
      console.warn(`[TURSO-ADD-WARN] Failed for ${col}/${generatedId}:`, err.message);
    });

    if (col === "orders") {
      addOrderToMemory(generatedId, docData);
    }
    if (col === "deposits") {
      serverCache.deposits.set(generatedId, { data: docData, time: Date.now() });
    }
    if (col === "providers") {
      serverCache.providers.set(generatedId, { data: docData, time: Date.now() });
      savePersistentCache();
    }
    if (col === "courses" || col === "services") {
      serverCache.courses.set(generatedId, { data: docData, time: Date.now() });
      savePersistentCache();
    }

    return generatedId;
  };

  const deleteDocSafe = async (col: string, id: string) => {
    deleteLocalDoc(col, id);
    
    // Background delete from Turso Database
    deleteTursoDoc(col, id).catch((err: any) => {
      console.warn(`[TURSO-DEL-WARN] Failed for ${col}/${id}:`, err.message);
    });

    if (col === "providers") {
      serverCache.providers.delete(id);
      savePersistentCache();
    }
    if (col === "courses" || col === "services") {
      serverCache.courses.delete(id);
      savePersistentCache();
    }
    invalidateCachesForCollection(col, id);
    return true;
  };

  // Health check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.get("/api/admin/transmission-logs", (req, res) => res.json([]));
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
        let results: any[] = [];
        // 1. Check in-memory courses first (0 Firestore reads!)
        if (serverCache.courses.size > 0) {
          results = Array.from(serverCache.courses.values()).map((c: any) => c.data || c);
        } else if (serverCachedCourses && serverCachedCourses.length > 0) {
          results = serverCachedCourses;
        } else {
          results = []; // Do not use default seed
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
        const strId = String(orderId);

        // 1. Check in-memory orders first (0 Firestore reads!)
        const cachedOrder = serverCache.orders.get(strId) || 
          serverCache.latestOrders.find((o: any) => String(o.id) === strId || String(o.providerOrderId) === strId);
        if (cachedOrder) {
          const ord = cachedOrder.data || cachedOrder;
          if (ord.userId === userId || ord.user_id === userId) {
            let status = ord.status || "Pending";
            if (status === "Failed") status = "Canceled";
            return res.json({
              status: status,
              charge: ord.totalPrice || ord.charge || ord.price || 0,
              start_count: ord.start_count || ord.startCount || 0,
              remains: ord.remains || ord.quantity || 0,
              currency: "INR"
            });
          }
        }

        const snap = await getDocSafe("orders", strId);
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

  app.get("/api/admin/transmission-logs", async (req, res) => {
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
    
    // Reload local lookup cache maps from disk / persistent cache rather than leaving them empty
    try {
      const localProvs = listLocalDocs("providers", 100);
      if (localProvs && Array.isArray(localProvs)) {
        localProvs.forEach(p => { if (p && p.id) serverCache.providers.set(p.id, { data: p, time: Date.now() }); });
      }
      const localCourses = listLocalDocs("courses", 500);
      if (localCourses && Array.isArray(localCourses)) {
        localCourses.forEach(c => { if (c && c.id) serverCache.courses.set(c.id, { data: c, time: Date.now() }); });
      }
    } catch (e) {}

    console.log("[SERVER-CACHE] Server-side cache refreshed on Admin update request!");
    res.json({ success: true, message: "Server-side cache refreshed successfully" });
  });

  // Express API for Providers list with server-side in-memory caching
  app.get("/api/providers", async (req, res) => {
    try {
      const forceFresh = req.query.force === "true";
      if (!forceFresh && serverCache.providers.size > 0) {
        const providersList = Array.from(serverCache.providers.entries()).map(([id, p]) => ({ id, ...(p?.data ? p.data : p) }));
        return res.json(providersList);
      }

      const combinedMap = new Map<string, any>();
      
      // 1. Load from local disk (data/local_db.json)
      const local = listLocalDocs("providers", 100);
      if (local && Array.isArray(local)) {
        local.forEach(p => { if (p && p.id) combinedMap.set(p.id, p); });
      }

      // 2. Load from memory cache
      serverCache.providers.forEach((val, id) => {
        const d = val?.data || val;
        if (d && (d.id || id)) combinedMap.set(d.id || id, d);
      });

      // 3. Load from persistent cache
      try {
        if (fs.existsSync("persistent_cache.json")) {
          const raw = fs.readFileSync("persistent_cache.json", "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.providers)) {
            parsed.providers.forEach(([id, val]: [string, any]) => {
              const d = val?.data || val;
              if (d && (d.id || id)) combinedMap.set(d.id || id, d);
            });
          }
        }
      } catch (e) {}

      // 4. Merge from Firestore if available
      try {
        const snap = await listDocsSafe("providers", req.headers.authorization as string, forceFresh);
        if (snap && snap.docs && snap.docs.length > 0) {
          snap.docs.forEach(doc => {
            const d = typeof doc.data === "function" ? doc.data() : doc.data;
            if (d) combinedMap.set(doc.id, { id: doc.id, ...d });
          });
          console.log(`[SERVER-DB] Merged ${snap.docs.length} Firestore providers.`);
        }
      } catch (err: any) {
        console.warn("[SERVER-DB] Firestore fetch failed for providers:", err.message);
      }

      // Sync back to memory & disk so everything stays consistent
      combinedMap.forEach((data, id) => {
        serverCache.providers.set(id, { data, time: Date.now() });
        try { setLocalDoc("providers", id, data); } catch (e) {}
      });
      savePersistentCache();

      const providersList = Array.from(combinedMap.values());
      res.json(providersList);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching providers:", err.message);
      const fallbackList = Array.from(serverCache.providers.entries()).map(([id, p]) => ({ id, ...(p?.data ? p.data : p) }));
      res.json(fallbackList);
    }
  });

  // Express API for Courses list with server-side in-memory caching & robust local/Firestore merge
  app.get("/api/courses", async (req, res) => {
    try {
      const forceFresh = req.query.force === "true";
      const combinedMap = new Map<string, any>();

      // 1. Load from local disk (so newly added services in local_db are never lost)
      const localCourses = listLocalDocs("courses", 500);
      if (localCourses && Array.isArray(localCourses)) {
        localCourses.forEach(c => { if (c && c.id) combinedMap.set(c.id, c); });
      }

      // 2. Load from persistent cache
      try {
        if (fs.existsSync("persistent_cache.json")) {
          const raw = fs.readFileSync("persistent_cache.json", "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.courses)) {
            parsed.courses.forEach(([id, val]: [string, any]) => {
              const d = val?.data || val;
              if (d && (d.id || id)) combinedMap.set(d.id || id, d);
            });
          }
        }
      } catch (e) {}

      // 3. Load from serverCache (memory store)
      serverCache.courses.forEach((val, id) => {
        const d = val?.data || val;
        if (d && (d.id || id)) combinedMap.set(d.id || id, d);
      });

      // 4. Merge with Firestore items if available or force requested
      if (forceFresh || combinedMap.size === 0) {
        try {
          const snap = await listDocsSafe("courses", req.headers.authorization as string, forceFresh);
          if (snap && snap.docs && snap.docs.length > 0) {
            snap.docs.forEach(doc => {
              const d = typeof doc.data === "function" ? doc.data() : doc.data;
              if (d) combinedMap.set(doc.id, { id: doc.id, ...d });
            });
            console.log(`[SERVER-DB] Merged ${snap.docs.length} services from Firestore.`);
          }
        } catch (err: any) {
          console.warn("[SERVER-DB] Firestore fetch failed for courses:", err.message);
        }
      }

      // Save merged list to memory & disk
      combinedMap.forEach((data, id) => {
        serverCache.courses.set(id, { data, time: Date.now() });
        try { setLocalDoc("courses", id, data); } catch (e) {}
      });
      savePersistentCache();

      const coursesList = Array.from(combinedMap.values());
      const activeServices = coursesList.filter((s: any) => s.status !== "archived" && s.status !== "hidden");
      return res.json(activeServices.length > 0 ? activeServices : coursesList);
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching services from database:", err.message);
      const fallbackList = Array.from(serverCache.courses.entries()).map(([id, c]) => ({ id, ...(c?.data ? c.data : c) }));
      return res.json(fallbackList);
    }
  });


  // Express API for Settings with server-side in-memory caching
  app.get("/api/settings", async (req, res) => {
    try {
      // Use getDocSafe to dynamically load from memory, SQLite, or Supabase
      const snap = await getDocSafe("settings", "payment", undefined, false);
      if (snap.exists) {
        return res.json(snap.data());
      }
      return res.json({});
    } catch (err: any) {
      console.error("[SERVER-DB] Error fetching settings:", err.message);
      return res.json({});
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const data = req.body || {};
      const now = Date.now();
      const updated = { ...data, updatedAt: new Date().toISOString() };
      await setDocSafe("settings", "payment", updated);
      serverCachedSettings = updated;
      serverCachedSettingsTime = now;
      serverCache.settings = { data: updated, time: now };
      savePersistentCache();
      return res.json({ success: true, message: "Settings saved", settings: updated });
    } catch (err: any) {
      console.error("[SETTINGS-SAVE-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Turso Database Management Routes
  app.get("/api/turso/status", async (req, res) => {
    try {
      const status = await getTursoStatus();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ connected: false, error: e.message });
    }
  });

  app.post("/api/turso/test", async (req, res) => {
    try {
      const { url, authToken } = req.body || {};
      const result = await testTursoConnection(url, authToken);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/turso/config", async (req, res) => {
    try {
      const { url, authToken, autoSync } = req.body || {};
      const result = await saveTursoConfig(url, authToken, autoSync !== false);
      if (result.success && url && authToken) {
        // Automatically sync all data on config save
        const allData = getAllLocalCollections();
        syncAllLocalDataToTurso(allData).catch(err => {
          console.warn("[TURSO] Auto-sync on config save:", err);
        });
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/turso/sync", async (req, res) => {
    try {
      const allData = getAllLocalCollections();
      const result = await syncAllLocalDataToTurso(allData);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/admin/update-balance", async (req, res) => {
    try {
      const { userId, id, balance } = req.body || {};
      const targetId = userId || id;
      if (!targetId) return res.status(400).json({ success: false, error: "Missing userId" });
      const numBal = Number(balance || 0);
      await updateDocSafe("users", targetId, { balance: numBal, updatedAt: new Date().toISOString() });
      if (serverCache.users.has(targetId)) {
        const u = serverCache.users.get(targetId);
        if (u) {
          u.data = { ...(u.data || {}), balance: numBal };
          u.time = Date.now();
        }
      }
      return res.json({ success: true, balance: numBal });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/user-orders/:userId", async (req, res) => {
    const { userId } = req.params;
    const qEmail = String(req.query.email || req.query.userEmail || "").trim().toLowerCase();
    const limitCount = Math.min(parseInt(req.query.limit as string) || 20, 50);
    
    // Add super strict validation for invalid or placeholder user IDs
    if ((!userId || userId === "undefined" || userId === "null" || userId === "placeholder" || userId.trim() === "") && !qEmail) {
      return res.json([]);
    }

    // 1. Check in-memory serverCache orders first (0 Firestore Reads!)
    if (serverCache.orders.size > 0 || serverCache.latestOrders.length > 0) {
      const memoryOrders = [
        ...Array.from(serverCache.orders.values()).map((o: any) => o.data || o),
        ...serverCache.latestOrders
      ];
      
      const userMemoryOrders = memoryOrders.filter((item: any) => {
        const orderUserId = item.userId || item.user_id;
        const orderEmail = String(item.userEmail || item.user_email || "").trim().toLowerCase();
        const matchesId = userId && userId !== "undefined" && userId !== "null" && orderUserId === userId;
        const matchesEmail = qEmail && orderEmail && orderEmail === qEmail;
        if (!matchesId && !matchesEmail) return false;
        
        const pId = item.providerOrderId || item.provider_order_id;
        const isFailedAborted = item.status?.toLowerCase() === 'failed' && (!pId || pId === 'N/A');
        return !isFailedAborted;
      });

      if (userMemoryOrders.length > 0) {
        // Unique by order id and return latest
        const map = new Map<string, any>();
        userMemoryOrders.forEach((o: any) => {
          const key = o.id || o.providerOrderId || o.createdAt || o.created_at;
          if (key) map.set(key, o);
        });
        const sorted = Array.from(map.values()).sort((a: any, b: any) => {
          const tA = new Date(a.createdAt || a.created_at || 0).getTime();
          const tB = new Date(b.createdAt || b.created_at || 0).getTime();
          return tB - tA;
        });
        return res.json(sorted.slice(0, limitCount));
      }
    }
    
    // 2. Check User Profile document latestOrders (0 extra queries if cached, 1 read otherwise)
    if (userId && userId !== "undefined" && userId !== "null") {
      try {
        const uDoc = await getDocSafe("users", userId);
        const uData = uDoc?.data ? uDoc.data() : uDoc;
        if (uData && Array.isArray(uData.latestOrders) && uData.latestOrders.length > 0) {
          return res.json(uData.latestOrders.slice(0, limitCount));
        }
      } catch (uErr) {}
    }

    try {
      let docs: any[] = [];
      if (!useRestFallback) {
        try {
          if (userId && userId !== "undefined" && userId !== "null") {
            const snap = await fdb.collection("orders")
              .where("userId", "==", userId)
              .limit(limitCount)
              .get();
            docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          }
          
          if (docs.length === 0 && qEmail) {
            const emailSnap = await fdb.collection("orders")
              .where("userEmail", "==", qEmail)
              .limit(limitCount)
              .get();
            docs = emailSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          }
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
            },
            limit: limitCount
          }
        }, req.headers.authorization as string || systemAccessToken);
        
        if (queryRes) {
          docs = queryRes.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        if (docs.length === 0 && qEmail) {
          const emailQueryRes = await runQueryREST({
            structuredQuery: {
              from: [{ collectionId: "orders" }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "userEmail" },
                  op: "EQUAL",
                  value: { stringValue: qEmail }
                }
              },
              limit: limitCount
            }
          }, req.headers.authorization as string || systemAccessToken);
          if (emailQueryRes) {
            docs = emailQueryRes.map(doc => ({ id: doc.id, ...doc.data() }));
          }
        }
      }

      // Filter strictly to ensure only orders belonging to the specified user are returned.
      // This prevents any leakage or "fake" orders belonging to other users.
      // Also filter out aborted "Failed" orders that do not have a valid provider ID (e.g. they failed before transmission).
      const filteredDocs = docs.filter(item => {
        const orderUserId = item.userId || item.user_id;
        const orderEmail = String(item.userEmail || item.user_email || "").trim().toLowerCase();
        const matchesId = userId && userId !== "undefined" && userId !== "null" && orderUserId === userId;
        const matchesEmail = qEmail && orderEmail && orderEmail === qEmail;
        if (!matchesId && !matchesEmail) return false;
        
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
      const userOrders = processedDocs.slice(0, limitCount);
      res.json(userOrders);
    } catch (apiErr: any) {
      console.error("[API] Failed to get user orders on-demand:", userId, apiErr.message);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Securely place a new order on custom domain server
  app.post("/api/orders", async (req, res) => {
    try {
      const { userId, serviceId, quantity, ...extra } = req.body || {};
      if (!userId || !serviceId || !quantity) {
        return res.status(400).json({ error: "Missing required fields (userId, serviceId, quantity)" });
      }

      // 1. Get Service Details
      const serviceSnap = await getDocSafe("courses", serviceId, req.headers.authorization as string, true);
      if (!serviceSnap.exists) {
        return res.status(404).json({ error: "Service not found: " + serviceId });
      }
      const service = serviceSnap.data();

      // 2. Calculate Charge
      const pricePerThousand = Number(service.pricePerThousand || service.price || 0);
      const charge = Number(((pricePerThousand / 1000) * quantity).toFixed(4));

      // 3. Get User Balance
      const userSnap = await getDocSafe("users", userId, req.headers.authorization as string, true);
      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = userSnap.data();

      const balance = Number(user.balance || 0);
      if (balance < charge) {
        return res.status(400).json({ error: "Insufficient balance. Please add funds." });
      }

      // 4. Create Order
      const orderId = "ord_" + Date.now();
      const now = new Date().toISOString();
      const newOrder = {
        id: orderId,
        userId,
        userEmail: user.email || user.userEmail || "",
        serviceId,
        serviceName: service.name || service.title || "N/A",
        quantity,
        charge,
        status: "Pending",
        createdAt: now,
        updatedAt: now,
        ...extra
      };

      // 5. Update Balance and Save Order
      const newBalance = Number((balance - charge).toFixed(2));
      
      await Promise.all([
        setDocSafe("orders", orderId, newOrder, req.headers.authorization as string),
        setDocSafe("users", userId, { ...user, balance: newBalance, updatedAt: now }, req.headers.authorization as string)
      ]);

      // 6. Update Memory Cache
      addOrderToMemory(orderId, newOrder);

      res.status(200).json({ success: true, orderId, charge, newBalance });
    } catch (err: any) {
      console.error("[API-ORDER] Failed to place order:", err.message);
      res.status(500).json({ error: "Server error occurred while placing order: " + err.message });
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

  app.post("/api/admin/search-user", async (req, res) => {
    const query = String(req.body.query || req.body.email || "").trim();
    
    try {
      const userMap = new Map<string, any>();
      const emailToCanonicalUid = new Map<string, string>();

      const addOrMergeUser = (rawUser: any, fallbackId?: string) => {
        if (!rawUser) return;
        const d = typeof rawUser.data === "function" ? rawUser.data() : (rawUser.data || rawUser);
        let uid = String(d.uid || d.id || rawUser.id || fallbackId || "").trim();
        let email = String(d.email || d.userEmail || "").trim().toLowerCase();

        // Extract email from nested arrays if top-level was blank
        if (!email && Array.isArray(d.latestOrders)) {
          for (const o of d.latestOrders) {
            if (o?.userEmail) { email = String(o.userEmail).trim().toLowerCase(); break; }
          }
        }
        if (!email && Array.isArray(d.latestDeposits)) {
          for (const dep of d.latestDeposits) {
            if (dep?.userEmail) { email = String(dep.userEmail).trim().toLowerCase(); break; }
          }
        }

        // Determine canonical UID (prefer real non-email UID over email string)
        let canonicalId = uid;
        if (canonicalId && !canonicalId.includes("@") && email) {
          emailToCanonicalUid.set(email, canonicalId);
        } else if (canonicalId.includes("@") && email && emailToCanonicalUid.has(email)) {
          canonicalId = emailToCanonicalUid.get(email)!;
        } else if (email && emailToCanonicalUid.has(email)) {
          canonicalId = emailToCanonicalUid.get(email)!;
        }

        if (!canonicalId) canonicalId = email || fallbackId || `user_${Date.now()}`;

        const existing = userMap.get(canonicalId);
        if (existing) {
          const exBal = Number(existing.balance ?? existing.walletBalance ?? 0);
          const inBal = Number(d.balance ?? d.walletBalance ?? 0);
          const bestBal = (!isNaN(inBal) && inBal > 0) ? inBal : exBal;
          userMap.set(canonicalId, {
            ...existing,
            ...d,
            id: canonicalId,
            uid: canonicalId,
            email: email || existing.email,
            balance: bestBal
          });
        } else {
          userMap.set(canonicalId, {
            ...d,
            id: canonicalId,
            uid: canonicalId,
            email: email || (uid.includes("@") ? uid : "")
          });
        }
      };

      // 1. Gather users from in-memory cache
      if (serverCache.users && serverCache.users.size > 0) {
        serverCache.users.forEach((u: any, id: string) => {
          addOrMergeUser(u, id);
        });
      }

      // 1.2 Gather all users directly from Turso SQL Database
      try {
        const client = getTursoClient();
        if (client) {
          const res = await client.execute("SELECT id, email, role, balance, data FROM smm_users;");
          if (res && res.rows) {
            for (const r of res.rows) {
              const uId = String(r.id || "");
              const uEmail = String(r.email || "");
              let parsed: any = {};
              if (typeof r.data === "string") {
                try { parsed = JSON.parse(r.data); } catch (e) {}
              }
              const userData = {
                ...parsed,
                id: uId,
                uid: uId,
                email: uEmail || parsed.email || parsed.userEmail,
                userEmail: uEmail || parsed.email || parsed.userEmail,
                balance: Number(r.balance ?? parsed.balance ?? 0),
                role: r.role || parsed.role || "user"
              };
              addOrMergeUser(userData, uId);
              serverCache.users.set(uId, { data: userData, time: Date.now() });
            }
          }
        }
      } catch (tursoUserErr: any) {
        console.warn("[SEARCH-USERS-TURSO] Error:", tursoUserErr.message);
      }

      // 1.3 Ensure known users are ALWAYS present and properly attributed
      const KNOWN_USERS_REGISTRY: Record<string, { email: string; name?: string }> = {
        "c4w6bjFk9leTy9SR2ijM0YyJVfx1": { email: "mtasvir375@gmail.com", name: "Tasvir (Admin)" },
        "5LRJPrkW5vVimfCFKGbzTKhXtji2": { email: "mdsarfarajalam727712@gmail.com", name: "Sarfaraj Alam" },
        "UlsK3PLAGHdiSZAhx58Cb23FXLq2": { email: "mdtasvir888@gmail.com", name: "Tasvir" },
        "w1VAF0MJoYducsSTQtMRW907OBX2": { email: "mdsaudalam621@gmail.com", name: "Md Saud Alam" },
        "evVy5BL2BQXHZT2v7xcmTM1zRJe2": { email: "tachunique621@gmail.com", name: "tachunique621" }
      };
      for (const [kUid, kInfo] of Object.entries(KNOWN_USERS_REGISTRY)) {
        if (!userMap.has(kUid)) {
          addOrMergeUser({
            id: kUid,
            uid: kUid,
            email: kInfo.email,
            userEmail: kInfo.email,
            displayName: kInfo.name || kInfo.email.split("@")[0],
            role: kInfo.email === "mtasvir375@gmail.com" ? "admin" : "user",
            balance: 0
          }, kUid);
        } else {
          const ex = userMap.get(kUid);
          ex.email = kInfo.email;
          ex.userEmail = kInfo.email;
          if (!ex.displayName || ex.displayName === "User") ex.displayName = kInfo.name;
        }
      }

      // 3. Fallback Auth lookup for direct email search if not found
      const searchLower = query.toLowerCase();
      if (searchLower && searchLower.includes("@")) {
        const found = Array.from(userMap.values()).some((u: any) => 
          String(u.email || "").toLowerCase() === searchLower
        );
        if (!found && admin && admin.auth) {
          try {
            const userRec = await admin.auth().getUserByEmail(searchLower);
            if (userRec) {
              const userData = {
                id: userRec.uid,
                uid: userRec.uid,
                email: userRec.email,
                displayName: userRec.displayName || userRec.email?.split("@")[0] || "User",
                photoURL: userRec.photoURL || "",
                balance: 0,
                role: "student"
              };
              addOrMergeUser(userData, userRec.uid);
              serverCache.users.set(userRec.uid, { data: userData, time: Date.now() });
              if (fdb) {
                fdb.collection("users").doc(userRec.uid).set(userData, { merge: true }).catch(() => {});
              }
            }
          } catch (authErr: any) {
            // Ignore not found
          }
        }
      }

      // 3.5 Enrich all users with missing emails from latestOrders or latestDeposits
      userMap.forEach((uData) => {
        let email = String(uData.email || uData.userEmail || "").trim();
        if (!email && Array.isArray(uData.latestOrders)) {
          for (const o of uData.latestOrders) {
            if (o?.userEmail) { email = String(o.userEmail).trim(); break; }
          }
        }
        if (!email && Array.isArray(uData.latestDeposits)) {
          for (const dep of uData.latestDeposits) {
            if (dep?.userEmail) { email = String(dep.userEmail).trim(); break; }
          }
        }
        if (email) {
          uData.email = email;
          if (!uData.displayName || uData.displayName === "User") {
            uData.displayName = email.split("@")[0];
          }
        }
      });

      // 4. Filter users based on query
      let allFoundUsers = Array.from(userMap.values());
      if (searchLower) {
        allFoundUsers = allFoundUsers.filter((u: any) => {
          const uEmail = String(u.email || u.userEmail || "").toLowerCase();
          const uName = String(u.displayName || "").toLowerCase();
          const uId = String(u.id || u.uid || "").toLowerCase();
          return uEmail.includes(searchLower) || uName.includes(searchLower) || uId.includes(searchLower);
        });
      }

      // 5. Compute balances and sort (highest balance and active users first)
      const results = allFoundUsers.map((uData: any) => {
        const uid = uData.id || uData.uid;
        let bal = Number(uData.balance ?? uData.walletBalance ?? 0);

        // Check if balance can be verified/restored from approved deposits
        let totalApproved = 0;
        serverCache.deposits.forEach((dep: any) => {
          const d = dep?.data || dep;
          if ((d.userId === uid || d.user_id === uid) && d.status === "approved") {
            totalApproved += Number(d.amount || 0);
          }
        });
        let totalOrders = 0;
        serverCache.orders.forEach((ord: any) => {
          const o = ord?.data || ord;
          if ((o.userId === uid || o.user_id === uid) && o.status !== "Failed" && o.status !== "Cancelled") {
            totalOrders += Number(o.totalPrice || o.total_price || 0);
          }
        });

        if (bal === 0 && totalApproved > 0) {
          bal = Math.max(0, Number((totalApproved - totalOrders).toFixed(2)));
        }

        return {
          ...uData,
          id: uid,
          uid: uid,
          balance: bal
        };
      });

      results.sort((a: any, b: any) => {
        const balA = Number(a.balance || 0);
        const balB = Number(b.balance || 0);
        if (balB !== balA) return balB - balA;
        const timeA = new Date(a.updatedAt || a.lastOrderedAt || a.lastDepositedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.updatedAt || b.lastOrderedAt || b.lastDepositedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      // Strict uniqueness filter to guarantee NO duplicate user entries ever
      const seenUids = new Set<string>();
      const seenEmails = new Set<string>();
      const uniqueResults: any[] = [];
      for (const u of results) {
        const uid = String(u.id || u.uid || "").trim();
        const email = String(u.email || u.userEmail || "").trim().toLowerCase();
        if (uid && seenUids.has(uid)) continue;
        if (email && seenEmails.has(email)) continue;
        if (uid) seenUids.add(uid);
        if (email) seenEmails.add(email);
        uniqueResults.push(u);
      }

      console.log(`[SEARCH-USERS] Query "${query}" returned ${uniqueResults.length} unique users`);
      return res.json({
        success: true,
        users: uniqueResults.slice(0, 50),
        user: uniqueResults.length > 0 ? uniqueResults[0] : null
      });
    } catch (e: any) {
      console.error("[SEARCH-USERS] Global error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/all-deposits", async (req, res) => {
    try {
      const limitCount = Math.min(Number(req.query.limit) || 100, 100);
      const forceRefresh = req.query.force === "true";

      const depositMap = new Map<string, any>();

      // 1. Collect from memory cache
      if (serverCache.deposits.size > 0) {
        for (const [key, val] of serverCache.deposits.entries()) {
          const item = val?.data || val;
          if (item) {
            const id = item.id || key;
            depositMap.set(id, { ...item, id });
          }
        }
      }

      // 2. Fetch fresh from Turso database (smm_deposits)
      try {
        const client = getTursoClient();
        if (client) {
          const res = await client.execute({
            sql: `SELECT * FROM smm_deposits ORDER BY created_at DESC LIMIT ?;`,
            args: [limitCount]
          });
          for (const row of res.rows) {
            try {
              const parsed = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
              const dId = String(row.id || "");
              const data = { id: dId, userId: String(row.user_id || ""), amount: Number(row.amount || 0), status: String(row.status || ""), utr: String(row.transaction_id || ""), ...parsed };
              depositMap.set(dId, data);
              serverCache.deposits.set(dId, { data, time: Date.now() });
            } catch (e) {}
          }
          savePersistentCache();
        }
      } catch (e: any) {
        console.warn("[ADMIN-ALL-DEPOSITS-TURSO-ERR]", e.message);
      }

      // 3. If still empty, use REST fallback
      if (depositMap.size === 0) {
        try {
          const targetProject = getTargetProject();
          const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/deposits?key=${apiKey}&pageSize=${limitCount}`;
          const resRest = await axios.get(url, { timeout: 10000 });
          if (resRest.data && resRest.data.documents) {
            resRest.data.documents.forEach((doc: any) => {
              const id = doc.name.split("/").pop();
              const data = { id, ...unwrapRestFields(doc.fields || {}) };
              depositMap.set(id, data);
              serverCache.deposits.set(id, { data, time: Date.now() });
            });
            savePersistentCache();
          }
        } catch (rErr: any) {
          console.warn("[ADMIN-ALL-DEPOSITS-REST-ERR]", rErr.message);
        }
      }

      const allList = Array.from(depositMap.values());

      // Sort: Pending first, then newest createdAt first
      allList.sort((a: any, b: any) => {
        const aPending = (a.status || "").toLowerCase() === "pending" ? 1 : 0;
        const bPending = (b.status || "").toLowerCase() === "pending" ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;

        const aTime = new Date(a.createdAt || a.timestamp || 0).getTime();
        const bTime = new Date(b.createdAt || b.timestamp || 0).getTime();
        return bTime - aTime;
      });

      console.log(`[API-ALL-DEPOSITS] Returning ${allList.length} deposits (Pending: ${allList.filter(d => (d.status || '').toLowerCase() === 'pending').length})`);
      return res.json(allList.slice(0, limitCount));
    } catch (err: any) {
      console.error("[ALL-DEPOSITS-ERR]", err.message);
      const cached = Array.from(serverCache.deposits.entries()).map(([k, d]) => {
        const item = d?.data || d;
        return { id: item?.id || k, ...item };
      });
      return res.json(cached.slice(0, 50));
    }
  });

  // User Deposit History Endpoint
  app.get("/api/user/deposits", async (req, res) => {
    try {
      const targetUid = String(req.query.userId || (req as any).user?.uid || "").trim();
      const targetEmail = String(req.query.email || (req as any).user?.email || "").trim().toLowerCase();

      if (!targetUid && !targetEmail) {
        return res.status(400).json({ success: false, error: "User ID or email is required" });
      }

      const depositMap = new Map<string, any>();

      // Check User Profile document latestDeposits first (0 extra queries if cached)
      if (targetUid) {
        try {
          const uDoc = await getDocSafe("users", targetUid);
          const uData = uDoc?.data ? uDoc.data() : uDoc;
          if (uData && Array.isArray(uData.latestDeposits)) {
            for (const d of uData.latestDeposits) {
              if (d && d.id) depositMap.set(d.id, d);
            }
          }
        } catch (uErr) {}
      }

      // 1. From server memory cache
      for (const [key, val] of serverCache.deposits.entries()) {
        const item = val?.data || val;
        if (!item) continue;
        const uUid = String(item.userId || item.user_id || "").trim();
        const uEmail = String(item.userEmail || item.user_email || "").trim().toLowerCase();
        if ((targetUid && uUid === targetUid) || (targetEmail && uEmail && uEmail === targetEmail)) {
          depositMap.set(item.id || key, { ...item, id: item.id || key });
        }
      }

      // 2. From payment intents (completed)
      for (const intent of getAllPaymentIntents()) {
        if (!intent || intent.status !== "completed") continue;
        const uUid = String(intent.userId || "").trim();
        const uEmail = String(intent.userEmail || "").trim().toLowerCase();
        if ((targetUid && uUid === targetUid) || (targetEmail && uEmail && uEmail === targetEmail)) {
          const depId = `intent_${intent.intentId}`;
          if (!depositMap.has(depId)) {
            depositMap.set(depId, {
              id: depId,
              userId: intent.userId,
              userEmail: intent.userEmail,
              amount: intent.amount,
              status: "approved",
              utr: intent.utr || intent.orderRef,
              orderRef: intent.orderRef,
              method: "Instant UPI QR",
              gateway: intent.senderBank || "Instant QR",
              createdAt: new Date(intent.completedAt || intent.createdAt).toISOString()
            });
          }
        }
      }

      // 3. From Turso database (smm_deposits)
      try {
        const client = getTursoClient();
        if (client) {
          const res = await client.execute({
            sql: `SELECT * FROM smm_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50;`,
            args: [targetUid]
          });
          for (const row of res.rows) {
            try {
              const parsed = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
              const dId = String(row.id || "");
              const item = { id: dId, userId: String(row.user_id || ""), amount: Number(row.amount || 0), status: String(row.status || ""), utr: String(row.transaction_id || ""), ...parsed };
              depositMap.set(dId, item);
            } catch (e) {}
          }
        }
      } catch (e) {}

      const deposits = Array.from(depositMap.values()).sort((a, b) => {
        const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
        const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
        return timeB - timeA;
      });

      return res.status(200).json({ success: true, deposits: deposits.slice(0, 10) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // TELEGRAM BOT & LOCAL BANK ALERTS ENDPOINTS
  // (0 Firestore Reads - Local Disk Persistence)
  // ==========================================

  // 1. Get Telegram Bot Config & Status
  app.get(["/api/admin/telegram-config", "/api/telegram-config"], (req, res) => {
    try {
      const status = getTelegramStatus();
      return res.json({ success: true, ...status });
    } catch (err: any) {
      console.error("[GET-TELEGRAM-CONFIG-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Save Telegram Bot Config & Start/Stop Polling
  app.post(["/api/admin/telegram-config", "/api/telegram-config"], async (req, res) => {
    try {
      const { botToken, chatId, upiId, payeeName, action } = req.body || {};

      if (botToken !== undefined || chatId !== undefined || upiId !== undefined || payeeName !== undefined) {
        const cleanTok = botToken !== undefined ? String(botToken).replace(/\s+/g, "").trim() : "";
        const updateObj: any = {};
        if (cleanTok && cleanTok.length >= 35) {
          updateObj.botToken = cleanTok;
        }
        if (chatId !== undefined && chatId !== "") {
          updateObj.chatId = String(chatId).trim();
        }
        if (upiId !== undefined && String(upiId).trim().length > 0) {
          updateObj.upiId = String(upiId).trim();
        }
        if (payeeName !== undefined && String(payeeName).trim().length > 0) {
          updateObj.payeeName = String(payeeName).trim();
        }
        if (Object.keys(updateObj).length > 0) {
          saveTelegramConfig(updateObj);

          // Sync with Firestore settings/payment & settings/telegram_bot for permanent persistence across restarts
          try {
            const paymentDocUpdate: any = {};
            if (updateObj.upiId) paymentDocUpdate.upiId = updateObj.upiId;
            if (updateObj.payeeName) paymentDocUpdate.merchantName = updateObj.payeeName;
            if (updateObj.botToken) paymentDocUpdate.telegramBotToken = updateObj.botToken;
            if (updateObj.chatId) paymentDocUpdate.telegramChatId = updateObj.chatId;

            if (Object.keys(paymentDocUpdate).length > 0) {
              await setDocSafe("settings", "payment", paymentDocUpdate);
              if (serverCache.settings?.data) {
                serverCache.settings.data = { ...serverCache.settings.data, ...paymentDocUpdate };
              }
            }
            await setDocSafe("settings", "telegram_bot", updateObj);
            savePersistentCache();
          } catch (dbErr: any) {
            console.warn("[TELEGRAM-CONFIG-DB-WARN]", dbErr.message);
          }
        }
      }

      if (action === "start") {
        const startRes = await startTelegramPolling();
        if (!startRes.success) {
          return res.status(400).json({ success: false, error: startRes.message, status: getTelegramStatus() });
        }
        return res.json({ success: true, message: startRes.message, status: getTelegramStatus() });
      } else if (action === "stop") {
        const stopRes = stopTelegramPolling();
        return res.json({ success: true, message: stopRes.message, status: getTelegramStatus() });
      } else if (action === "set_webhook") {
        const host = req.get("host") || "localhost:3000";
        const proto = req.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
        const defaultWebhook = `https://${host}/api/telegram-webhook`;
        const webhookUrl = req.body?.webhookUrl || defaultWebhook;
        const setRes = await setTelegramWebhook(webhookUrl, req.body?.botToken);
        if (!setRes.success) {
          return res.status(400).json({ success: false, error: setRes.message, status: getTelegramStatus() });
        }
        return res.json({ success: true, message: setRes.message, status: getTelegramStatus() });
      } else if (action === "delete_webhook") {
        const clearRes = await clearTelegramWebhook(req.body?.botToken);
        if (!clearRes.success) {
          return res.status(400).json({ success: false, error: clearRes.message, status: getTelegramStatus() });
        }
        // Restart polling now that webhook is cleared
        await startTelegramPolling();
        return res.json({ success: true, message: clearRes.message, status: getTelegramStatus() });
      } else if (action === "get_webhook_info") {
        const infoRes = await getTelegramWebhookInfo(req.body?.botToken);
        return res.json(infoRes);
      }

      return res.json({
        success: true,
        message: "Telegram configuration saved.",
        status: getTelegramStatus()
      });
    } catch (err: any) {
      console.error("[POST-TELEGRAM-CONFIG-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2b. Explicit Clear Webhook Endpoint (Fixes 409 Conflict)
  app.post(["/api/admin/clear-webhook", "/api/telegram-clear-webhook"], async (req, res) => {
    try {
      const { token } = req.body || {};
      const clearRes = await clearTelegramWebhook(token);
      if (clearRes.success) {
        // Also restart polling if it was supposed to be running
        const startRes = await startTelegramPolling();
        return res.json({
          success: true,
          message: "Webhook deleted successfully and Telegram Bot polling reconnected!",
          status: getTelegramStatus()
        });
      }
      return res.status(400).json({ success: false, error: clearRes.message, status: getTelegramStatus() });
    } catch (err: any) {
      console.error("[CLEAR-WEBHOOK-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2c. Telegram Webhook Receiver (Push updates straight to database)
  app.post(["/api/telegram-webhook", "/api/admin/telegram-webhook"], async (req, res) => {
    try {
      const token = getTelegramConfig().botToken;
      const result = await processTelegramUpdate(req.body, token);

      // If an alert was captured, check if any user was waiting in pending_user_utrs
      if (result.success && result.alert) {
        const cleanUtr = result.alert.utr;
        const amount = result.alert.amount;

        // Sync with gateway payments cache
        serverCache.received_gateway_payments.set(cleanUtr, {
          amount,
          provider: result.alert.senderBank || "telegram_bot",
          sender: "Telegram Bot",
          time: Date.now(),
          rawSms: result.alert.rawText,
          status: "available"
        });

        // Check if user was waiting
        const pendingUser = serverCache.pending_user_utrs.get(cleanUtr);
        if (pendingUser && (amount >= pendingUser.amount || Math.abs(amount - pendingUser.amount) <= 1)) {
          console.log(`[TELEGRAM-AUTO-MATCH] Auto-crediting waiting user ${pendingUser.userId} for UTR ${cleanUtr}`);
          try {
            await verifyAndCreditPayment({
              userId: pendingUser.userId,
              userEmail: pendingUser.userEmail,
              amount: pendingUser.amount,
              utr: cleanUtr
            });
            serverCache.pending_user_utrs.delete(cleanUtr);
            try { await deleteDocSafe("pending_user_utrs", cleanUtr); } catch (e) {}
          } catch (e: any) {
            console.error("[TELEGRAM-AUTO-MATCH-ERR]", e.message);
          }
        }
      }

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[TELEGRAM-WEBHOOK-RECEIVE-ERR]", err.message);
      return res.json({ ok: true }); // Always return 200 OK to Telegram so it doesn't retry
    }
  });

  // 2b. Direct Android SMS Forwarder Webhook (Automated Phone-to-Website Ingest)
  // Supports all major Android SMS Forwarder apps (Lanrens, feliphegomez, MacroDroid, Tasker, etc.)
  app.all(["/api/sms-forwarder", "/api/sms-webhook", "/api/forwarder"], async (req, res) => {
    try {
      const b = req.body || {};
      const q = req.query || {};

      // Flexible extraction across various SMS Forwarder app schemas
      let rawText = "";
      if (typeof b === "string") {
        rawText = b;
      } else if (typeof b === "object") {
        rawText = b.text || b.message || b.body || b.content || b.sms || b.msg || b.data || b.sms_body || b.smsContent || "";
      }
      if (!rawText && typeof q === "object") {
        rawText = (q.text || q.message || q.body || q.content || q.sms || q.msg || q.sms_body || "") as string;
      }
      if (!rawText && (req as any).rawBody) {
        rawText = (req as any).rawBody;
      }

      const sender = (b.from || b.sender || b.number || b.phone || b.title || q.from || q.sender || "SMS Forwarder App") as string;

      console.log(`[SMS-FORWARDER-INCOMING] Received from: ${sender} | Text: ${rawText.slice(0, 80)}...`);

      if (!rawText || typeof rawText !== "string" || rawText.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Empty SMS text received. Please send SMS text in 'text', 'message', or 'body' field."
        });
      }

      const parsed = parseBankSmsFromService(rawText, sender);
      if (!parsed.isValid || !parsed.utr || parsed.amount <= 0) {
        console.warn(`[SMS-FORWARDER-PARSE-FAIL] Reason: ${parsed.reason || "Invalid UTR/Amount"} for: ${rawText.slice(0, 80)}`);
        recordIncomingMessage({
          sender: sender || "SMS Forwarder Webhook",
          chatId: "Direct Webhook",
          text: rawText,
          parsed: false,
          reason: parsed.reason || "No valid 12-digit UTR and amount found in SMS"
        });
        return res.json({
          success: true,
          captured: false,
          reason: parsed.reason || "No valid 12-digit UTR and amount found in SMS",
          receivedText: rawText.slice(0, 100)
        });
      }

      const cleanUtr = parsed.utr;
      const amount = parsed.amount;

      // Record in Live Ingestion Feed
      recordIncomingMessage({
        sender: sender || "SMS Forwarder Webhook",
        chatId: "Direct Webhook",
        text: rawText,
        parsed: true,
        utr: cleanUtr,
        amount,
        bank: parsed.bank,
        reason: `Direct Webhook: Captured ₹${amount} (UTR: ${cleanUtr})`
      });

      const result = await addBankAlert({
        utr: cleanUtr,
        amount: amount,
        senderBank: parsed.bank,
        rawText: rawText
      });

      // 1. Also register in received_gateway_payments for instant verification
      serverCache.received_gateway_payments.set(cleanUtr, {
        amount,
        provider: "sms_forwarder",
        sender,
        time: Date.now(),
        rawSms: rawText,
        status: "available"
      });

      // 2. Also record in sms_forwarder_logs
      const logEntry = {
        id: `sms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        sender,
        rawText,
        isCredit: true,
        amount,
        utr: cleanUtr,
        valid: true,
        status: "available"
      };
      serverCache.sms_forwarder_logs.unshift(logEntry);
      if (serverCache.sms_forwarder_logs.length > 200) serverCache.sms_forwarder_logs.pop();
      savePersistentCache();

      // 3. Save to Firestore sms_forwarder_pool
      try {
        await setDocSafe("sms_forwarder_pool", cleanUtr, {
          utr: cleanUtr,
          amount,
          sender,
          rawSms: rawText,
          timestamp: new Date().toISOString(),
          status: "available"
        });
      } catch (e) {}

      // 4. Auto-reconcile with active 12-digit QR code payment intents instantly
      try {
        await reconcilePendingIntentsWithAlerts();
      } catch (e: any) {
        console.warn("[SMS-FORWARDER-RECONCILE-WARN]", e.message);
      }

      if (result.success && result.alert) {
        // Auto-match if user has pending UTR claim
        const pendingUser = serverCache.pending_user_utrs.get(cleanUtr);
        if (pendingUser && (amount >= pendingUser.amount || Math.abs(amount - pendingUser.amount) <= 1)) {
          console.log(`[SMS-FORWARDER-AUTO-MATCH] Auto-crediting waiting user ${pendingUser.userId} for UTR ${cleanUtr}`);
          try {
            await verifyAndCreditPayment({
              userId: pendingUser.userId,
              userEmail: pendingUser.userEmail,
              amount: pendingUser.amount,
              utr: cleanUtr
            });
            serverCache.pending_user_utrs.delete(cleanUtr);
            try { await deleteDocSafe("pending_user_utrs", cleanUtr); } catch (e) {}
          } catch (e: any) {
            console.error("[SMS-FORWARDER-AUTO-MATCH-ERR]", e.message);
          }
        }
      }

      return res.json({
        success: true,
        captured: result.success,
        duplicate: result.duplicate || false,
        message: result.success
          ? `Captured ₹${parsed.amount} with UTR ${parsed.utr} (${parsed.bank})`
          : "Alert already recorded previously",
        alert: result.alert
      });
    } catch (err: any) {
      console.error("[SMS-FORWARDER-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get raw SMS Forwarder logs for Admin
  app.get(["/api/admin/sms-forwarder-logs", "/api/sms-forwarder-logs"], (req, res) => {
    try {
      return res.json({
        success: true,
        logs: serverCache.sms_forwarder_logs || []
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2c. Telegram sendMessage Interceptor Proxy
  // Allows SMS Forwarder apps to keep using Telegram format while our website captures the SMS and passes it to Telegram!
  app.post(["/bot:token/sendMessage", "/api/bot:token/sendMessage"], async (req, res) => {
    try {
      const token = req.params.token;
      const { text, chat_id } = req.body || {};

      console.log(`[TELEGRAM-PROXY-SENDMESSAGE] Intercepted sendMessage for chat ${chat_id}: ${String(text || "").slice(0, 80)}...`);

      if (text && typeof text === "string") {
        const parsed = parseBankSmsFromService(text);
        if (parsed.isValid && parsed.utr && parsed.amount > 0) {
          console.log(`[TELEGRAM-PROXY-CAPTURE] Detected UTR ${parsed.utr}, Amount ₹${parsed.amount}`);
          const addRes = addBankAlert({
            utr: parsed.utr,
            amount: parsed.amount,
            senderBank: parsed.bank,
            rawText: text
          });

          // Check pending claim
          const cleanUtr = parsed.utr;
          const amount = parsed.amount;
          const pendingUser = serverCache.pending_user_utrs.get(cleanUtr);
          if (pendingUser && (amount >= pendingUser.amount || Math.abs(amount - pendingUser.amount) <= 1)) {
            try {
              await verifyAndCreditPayment({
                userId: pendingUser.userId,
                userEmail: pendingUser.userEmail,
                amount: pendingUser.amount,
                utr: cleanUtr
              });
              serverCache.pending_user_utrs.delete(cleanUtr);
              try { await deleteDocSafe("pending_user_utrs", cleanUtr); } catch (e) {}
            } catch (e: any) {
              console.error("[PROXY-AUTO-MATCH-ERR]", e.message);
            }
          }
        }
      }

      // Forward directly to Telegram API so Telegram also receives the message!
      try {
        const tgRes = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, req.body, {
          headers: { "Content-Type": "application/json" },
          timeout: 10000
        });
        return res.json(tgRes.data);
      } catch (tgErr: any) {
        console.warn("[TELEGRAM-PROXY-UPSTREAM-WARN]", tgErr.response?.data || tgErr.message);
        return res.json({ ok: true, note: "Captured locally, upstream Telegram responded with error" });
      }
    } catch (err: any) {
      console.error("[TELEGRAM-PROXY-ERR]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ========================================================
  // ZERO-UTR AUTOMATIC PAYMENT GATEWAY & INTENT ENGINE
  // ========================================================

  // 1. Create Dynamic Payment Intent (Zero-Collision Amount & Unique Order Ref)
  app.post("/api/payments/create-intent", async (req, res) => {
    try {
      const { amount, userId, userEmail } = req.body || {};
      const numAmount = Number(amount);
      if (!numAmount || isNaN(numAmount) || numAmount < 1) {
        return res.status(400).json({ success: false, error: "Minimum deposit amount is ₹1." });
      }
      if (!userId) {
        return res.status(400).json({ success: false, error: "User ID is required." });
      }

      const cfg = getTelegramConfig();
      // Read active UPI ID: prioritize admin's saved UPI ID
      const upiId = (
        (cfg.upiId && cfg.upiId !== "paytmqr281005050101111956557626@paytm" ? cfg.upiId : "") ||
        (serverCache.settings?.data?.upiId && serverCache.settings.data.upiId !== "paytmqr281005050101111956557626@paytm" ? serverCache.settings.data.upiId : "") ||
        cfg.upiId ||
        serverCache.settings?.data?.upiId ||
        ""
      ).trim();
      const payeeName = (cfg.payeeName || serverCache.settings?.data?.merchantName || "Pyare SMM Panel").trim();

      const result = createPaymentIntent({
        baseAmount: numAmount,
        userId: String(userId),
        userEmail: userEmail ? String(userEmail) : "",
        upiId,
        payeeName
      });

      if (!result.success || !result.intent) {
        return res.status(400).json({ success: false, error: result.error || "Failed to create payment intent." });
      }

      return res.json({
        success: true,
        intentId: result.intent.intentId,
        orderRef: result.intent.orderRef,
        baseAmount: result.intent.baseAmount,
        amount: result.intent.amount,
        upiId: result.intent.upiId,
        payeeName: result.intent.payeeName,
        upiLink: result.intent.upiLink,
        expiresAt: result.intent.expiresAt
      });
    } catch (err: any) {
      console.error("[CREATE-INTENT-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Check Intent Status (Polled by Frontend)
  app.get("/api/payments/check-intent/:intentId", async (req, res) => {
    try {
      const { intentId } = req.params;
      let intent = getPaymentIntent(intentId);
      if (!intent) {
        // Fallback: try single doc read in case server restarted
        try {
          const doc = await getDocSafe("payment_intents", intentId);
          if (doc && (typeof (doc as any).exists === "function" ? (doc as any).exists() : Boolean((doc as any).exists))) {
            intent = doc.data() as any;
          }
        } catch {}
      }
      if (!intent) {
        return res.status(404).json({ success: false, error: "Payment intent not found or expired." });
      }

      // Proactively reconcile in-memory alerts if not yet completed (0 Firestore reads)
      if (intent.status !== "completed") {
        await reconcilePendingIntentsWithAlerts();
        intent = getPaymentIntent(intentId) || intent;
      }

      let userBalance: number | undefined;
      if (intent.status === "completed") {
        if ((intent as any).newBalance !== undefined) {
          userBalance = (intent as any).newBalance;
        } else {
          try {
            const uDoc = await getDocSafe("users", intent.userId);
            userBalance = uDoc?.data()?.balance;
          } catch (e) {}
        }
      }

      return res.json({
        success: true,
        status: intent.status,
        intentId: intent.intentId,
        orderRef: intent.orderRef,
        amount: intent.amount,
        baseAmount: intent.baseAmount,
        creditedAmount: intent.amount,
        utr: intent.utr,
        expiresAt: intent.expiresAt,
        completedAt: intent.completedAt,
        newBalance: userBalance
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2b. Admin Payment Intents Dashboard (List all 12-digit QR requests - 0 Firestore reads)
  app.get("/api/admin/payment-intents", (req, res) => {
    try {
      const allIntents = getAllPaymentIntents();
      const now = Date.now();

      // Sort newest first
      const sorted = [...allIntents].sort((a, b) => b.createdAt - a.createdAt);

      const stats = {
        total: sorted.length,
        pending: sorted.filter((i) => i.status === "pending" && i.expiresAt > now).length,
        completed: sorted.filter((i) => i.status === "completed").length,
        expired: sorted.filter((i) => i.status === "expired" || (i.status === "pending" && i.expiresAt <= now)).length,
        totalVolume: sorted
          .filter((i) => i.status === "completed")
          .reduce((sum, i) => sum + (i.amount || 0), 0)
      };

      return res.json({
        success: true,
        stats,
        intents: sorted.slice(0, 100) // return recent 100 intents
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2c. Admin Manual 1-Click Approve Intent
  app.post("/api/admin/payment-intents/approve", async (req, res) => {
    try {
      const { intentId, customUtr } = req.body || {};
      if (!intentId) {
        return res.status(400).json({ success: false, error: "Missing intentId" });
      }

      const intent = getPaymentIntent(intentId);
      if (!intent) {
        return res.status(404).json({ success: false, error: "Payment intent not found" });
      }

      if (intent.status === "completed") {
        return res.status(400).json({ success: false, error: "Intent already completed and credited." });
      }

      intent.status = "completed";
      intent.completedAt = Date.now();
      intent.utr = customUtr || intent.orderRef;
      intent.senderBank = "Admin Manual Approval";

      // 1. Credit User Balance
      const adjusted = await adjustUserBalanceSafe(intent.userId, intent.amount);
      if (!adjusted) {
        return res.status(500).json({ success: false, error: `Failed to credit ₹${intent.amount} to user balance.` });
      }

      // 2. Read new balance
      let newBalance = 0;
      try {
        const uDoc = await getDocSafe("users", intent.userId);
        newBalance = uDoc?.data()?.balance || 0;
      } catch (e) {}

      // 3. Save approved deposit record
      const cleanUtr = intent.utr;
      const depositId = `dep_manual_intent_${intent.orderRef}_${Date.now()}`;
      const depositData = {
        id: depositId,
        userId: intent.userId,
        userEmail: intent.userEmail || "customer",
        amount: intent.amount,
        baseAmount: intent.baseAmount,
        utr: cleanUtr,
        orderRef: intent.orderRef,
        status: "approved",
        type: "auto_zero_utr_upi",
        paymentMethod: "auto_zero_utr_upi",
        provider: "Admin Manual QR Approval",
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      try {
        await addDocSafe("deposits", depositData);
        serverCache.deposits.set(depositId, { data: depositData, time: Date.now() });
        savePersistentCache();
      } catch (e) {}

      console.log(`[ADMIN-INTENT-APPROVED] Credited ₹${intent.amount} to user ${intent.userId} (Ref: ${intent.orderRef})`);

      return res.json({
        success: true,
        message: `Successfully credited ₹${intent.amount} to user account!`,
        intent,
        newBalance
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Admin UPI Gateway Configuration (Get Config)
  app.get("/api/admin/upi-gateway-config", (req, res) => {
    try {
      const cfg = getTelegramConfig();
      const status = getTelegramStatus();
      const upiId = (
        (cfg.upiId && cfg.upiId !== "paytmqr281005050101111956557626@paytm" ? cfg.upiId : "") ||
        (serverCache.settings?.data?.upiId && serverCache.settings.data.upiId !== "paytmqr281005050101111956557626@paytm" ? serverCache.settings.data.upiId : "") ||
        cfg.upiId ||
        serverCache.settings?.data?.upiId ||
        ""
      ).trim();
      const payeeName = (cfg.payeeName || serverCache.settings?.data?.merchantName || "Pyare SMM Panel").trim();

      return res.json({
        success: true,
        upiId,
        payeeName,
        botToken: cfg.botToken ? `${cfg.botToken.slice(0, 6)}...${cfg.botToken.slice(-4)}` : "",
        hasToken: !!cfg.botToken,
        chatId: cfg.chatId ? `${String(cfg.chatId).slice(0, 3)}***` : "",
        enabled: cfg.enabled,
        instantQrEnabled: serverCache.settings?.data?.instantQrEnabled !== false,
        manualQrEnabled: serverCache.settings?.data?.manualQrEnabled !== false,
        running: status.running,
        botUsername: cfg.botUsername || status.botUsername || "",
        lastPolledAt: status.lastPolledAt,
        totalAlertsCount: status.totalAlertsCount,
        unusedAlertsCount: status.unusedAlertsCount
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Admin UPI Gateway Configuration (Save / Update / Start / Stop / Test Ping)
  app.post("/api/admin/upi-gateway-config", async (req, res) => {
    try {
      const { upiId, payeeName, botToken, chatId, instantQrEnabled, manualQrEnabled, action } = req.body || {};
      const updates: any = {};

      if (upiId !== undefined && String(upiId).trim().length > 0) {
        updates.upiId = String(upiId).trim();
      }
      if (payeeName !== undefined && String(payeeName).trim().length > 0) {
        updates.payeeName = String(payeeName).trim();
      }
      if (chatId !== undefined && String(chatId).trim().length > 0) {
        updates.chatId = String(chatId).trim();
      }
      if (botToken !== undefined && String(botToken).trim().length >= 35) {
        updates.botToken = String(botToken).replace(/\s+/g, "").trim();
      }
      if (instantQrEnabled !== undefined) {
        updates.instantQrEnabled = !!instantQrEnabled;
      }
      if (manualQrEnabled !== undefined) {
        updates.manualQrEnabled = !!manualQrEnabled;
      }

      if (Object.keys(updates).length > 0) {
        saveTelegramConfig(updates);

        // Sync with Firestore settings/payment & settings/telegram_bot for permanent persistence across restarts
        try {
          const paymentDocUpdate: any = {};
          if (updates.upiId) paymentDocUpdate.upiId = updates.upiId;
          if (updates.payeeName) paymentDocUpdate.merchantName = updates.payeeName;
          if (updates.botToken) paymentDocUpdate.telegramBotToken = updates.botToken;
          if (updates.chatId) paymentDocUpdate.telegramChatId = updates.chatId;
          if (updates.instantQrEnabled !== undefined) paymentDocUpdate.instantQrEnabled = updates.instantQrEnabled;
          if (updates.manualQrEnabled !== undefined) paymentDocUpdate.manualQrEnabled = updates.manualQrEnabled;

          if (Object.keys(paymentDocUpdate).length > 0) {
            await setDocSafe("settings", "payment", paymentDocUpdate);
            if (serverCache.settings?.data) {
              serverCache.settings.data = { ...serverCache.settings.data, ...paymentDocUpdate };
            }
          }
          await setDocSafe("settings", "telegram_bot", updates);
          savePersistentCache();
        } catch (dbErr: any) {
          console.warn("[UPI-GATEWAY-CONFIG-DB-WARN]", dbErr.message);
        }
      }

      if (action === "start") {
        const startRes = await startTelegramPolling();
        if (!startRes.success) {
          return res.status(400).json({ success: false, error: startRes.message, status: getTelegramStatus() });
        }
        return res.json({ success: true, message: "UPI Gateway & Telegram Bot started!", status: getTelegramStatus() });
      } else if (action === "stop") {
        const stopRes = stopTelegramPolling();
        return res.json({ success: true, message: "UPI Gateway & Telegram Bot stopped.", status: getTelegramStatus() });
      } else if (action === "test_ping") {
        const activeCfg = getTelegramConfig();
        if (!activeCfg.botToken || !activeCfg.chatId) {
          return res.status(400).json({
            success: false,
            error: "Bot Token and Group Chat ID are required before sending a test ping."
          });
        }
        await sendTelegramReply(
          activeCfg.botToken,
          activeCfg.chatId,
          `🔔 <b>UPI Gateway Connection Verified!</b>\n\n` +
          `✅ The Automatic Zero-UTR Telegram Bot is connected and active.\n` +
          `💳 <b>Configured UPI ID:</b> <code>${activeCfg.upiId || "Not set"}</code>\n` +
          `👤 <b>Payee Name:</b> ${activeCfg.payeeName || "SMM Panel"}\n` +
          `⏰ <b>Timestamp:</b> ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
        );
        return res.json({ success: true, message: `Test ping sent successfully to Chat ID: ${activeCfg.chatId}!` });
      }

      return res.json({
        success: true,
        message: "UPI Gateway configuration saved permanently.",
        status: getTelegramStatus()
      });
    } catch (err: any) {
      console.error("[UPI-GATEWAY-CONFIG-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Get Received Bank Alerts (Filterable & Searchable)
  app.get(["/api/admin/bank-alerts", "/api/bank-alerts"], (req, res) => {
    try {
      const alerts = getBankAlerts();
      const filter = String(req.query.filter || "all"); // all, unused, used
      const search = String(req.query.search || "").toLowerCase().trim();

      let filtered = alerts;
      if (filter === "unused") {
        filtered = filtered.filter((a) => !a.isUsed);
      } else if (filter === "used") {
        filtered = filtered.filter((a) => a.isUsed);
      }

      if (search) {
        filtered = filtered.filter((a) =>
          a.utr.includes(search) ||
          a.senderBank.toLowerCase().includes(search) ||
          a.amount.toString().includes(search) ||
          (a.usedByEmail && a.usedByEmail.toLowerCase().includes(search))
        );
      }

      return res.json({
        success: true,
        alerts: filtered.slice(0, 200),
        totalCount: alerts.length,
        unusedCount: alerts.filter((a) => !a.isUsed).length,
        usedCount: alerts.filter((a) => a.isUsed).length
      });
    } catch (err: any) {
      console.error("[GET-BANK-ALERTS-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Simulate Test Bank SMS (For instant zero-cost testing)
  app.post(["/api/admin/simulate-sms", "/api/simulate-sms"], async (req, res) => {
    try {
      const { amount, utr, bank, text } = req.body || {};
      const sim = await simulateBankSms({
        amount: amount ? Number(amount) : undefined,
        utr: utr ? String(utr).trim() : undefined,
        bank: bank ? String(bank).trim() : undefined,
        text: text ? String(text).trim() : undefined
      });
      return res.json({
        success: true,
        message: `Simulated bank alert created for ₹${sim.alert.amount} (UTR: ${sim.alert.utr})`,
        alert: sim.alert
      });
    } catch (err: any) {
      console.error("[SIMULATE-SMS-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4b. Parse & Ingest Real Bank SMS directly (Live Test & Ingest)
  app.post(["/api/admin/parse-and-add-sms", "/api/parse-and-add-sms"], async (req, res) => {
    try {
      const { text, sender } = req.body || {};
      if (!text || typeof text !== "string") {
        return res.status(400).json({ success: false, error: "Please provide SMS text to parse." });
      }

      const parsed = parseBankSmsFromService(text, sender);
      if (!parsed.isValid || !parsed.utr || parsed.amount <= 0) {
        return res.status(400).json({
          success: false,
          error: parsed.reason || "Could not detect 12-digit UTR or amount in this SMS.",
          parsed
        });
      }

      const result = await addBankAlert({
        utr: parsed.utr,
        amount: parsed.amount,
        senderBank: parsed.bank,
        rawText: text
      });

      // Also check if this matches any active zero-UTR payment intent
      tryMatchAndCompleteIntent({
        text,
        utr: parsed.utr,
        amount: parsed.amount,
        bank: parsed.bank,
        senderName: sender || "Admin Direct Ingest"
      }).catch(() => {});

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.duplicate ? "Duplicate UTR already recorded in database." : "Failed to save bank alert.",
          duplicate: result.duplicate,
          parsed
        });
      }

      return res.json({
        success: true,
        message: `Successfully captured ₹${parsed.amount} with UTR ${parsed.utr} (${parsed.bank})`,
        alert: result.alert,
        parsed
      });
    } catch (err: any) {
      console.error("[PARSE-AND-ADD-SMS-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Concurrency & Duplicate Protection Locks
  const globalUtrLocks = new Set<string>();
  const globalClaimedUtrs = new Set<string>();

  function isUtrAlreadyClaimed(cleanUtr: string): boolean {
    if (!cleanUtr) return false;
    if (globalClaimedUtrs.has(cleanUtr)) return true;
    if (serverCache.deposits.size > 0) {
      for (const d of serverCache.deposits.values()) {
        const item = d?.data || d;
        if (
          String(item?.utr || "").replace(/\D/g, "").trim() === cleanUtr &&
          (item?.status === "approved" || item?.status === "completed")
        ) {
          globalClaimedUtrs.add(cleanUtr);
          return true;
        }
      }
    }
    return false;
  }

  // 5. User-Facing UTR Verification & Instant Add Funds
  app.post(["/api/wallet/verify-utr", "/api/verify-utr"], async (req, res) => {
    const { userId, utr, amount, userEmail } = req.body || {};
    const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
    const numAmount = Number(amount || 0);

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required." });
    }
    if (cleanUtr.length !== 12) {
      return res.status(400).json({ success: false, error: "Please enter a valid 12-digit UTR / UPI reference number." });
    }

    // 0. Strict Anti-Duplicate Check
    if (isUtrAlreadyClaimed(cleanUtr)) {
      return res.status(400).json({ 
        success: false, 
        error: "This UTR number has already been verified and credited to balance. Duplicate submissions are not allowed." 
      });
    }

    if (!useRestFallback) {
      try {
        const snap = await fdb.collection("deposits").where("utr", "==", cleanUtr).limit(1).get();
        if (!snap.empty) {
          const docData: any = snap.docs[0].data();
          if (docData.status === "approved" || docData.status === "completed") {
            globalClaimedUtrs.add(cleanUtr);
            return res.status(400).json({ 
              success: false, 
              error: "This UTR number has already been verified and credited to balance. Duplicate submissions are not allowed." 
            });
          }
        }
      } catch (fErr) {}
    }

    // Check concurrency lock: Is this exact UTR being verified right this millisecond?
    if (globalUtrLocks.has(cleanUtr)) {
      return res.status(429).json({
        success: false,
        error: "This transaction is currently being processed. Please wait 5 seconds and refresh your balance."
      });
    }

    // Acquire lock
    globalUtrLocks.add(cleanUtr);

    try {
      // 1. Check local disk bank_alerts.json FIRST (0 Firestore Reads!)
      const claimRes = verifyAndClaimAlert(cleanUtr, numAmount > 0 ? numAmount : undefined, userId, userEmail);
      if (claimRes.success && claimRes.alert) {
        const creditedAmount = claimRes.alert.amount;

        // Credit wallet in memory & disk cache, perform 1 single write to user doc
        const adjusted = await adjustUserBalanceSafe(userId, creditedAmount, req.headers.authorization as string);
        if (!adjusted) {
          return res.status(500).json({ success: false, error: "Payment verified, but failed to credit wallet balance. Please contact admin." });
        }

        // Mark permanently as claimed in memory
        globalClaimedUtrs.add(cleanUtr);

        // Read updated balance from user record
        let newBalance = 0;
        try {
          const uDoc = await getDocSafe("users", userId);
          newBalance = uDoc?.data()?.balance || 0;
        } catch (e) {}

        // Save ONE approved deposit record
        const depositId = `dep_bot_${cleanUtr}_${Date.now()}`;
        const depositData = {
          id: depositId,
          userId,
          userEmail: userEmail || "not-provided",
          amount: creditedAmount,
          utr: cleanUtr,
          status: "approved",
          type: "telegram_upi_bot",
          provider: claimRes.alert.senderBank,
          verifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };

        try {
          await addDocSafe("deposits", depositData);
          serverCache.deposits.set(depositId, { data: depositData, time: Date.now() });
          savePersistentCache();
        } catch (e) {}

        // Synchronize: mark in sms_forwarder_pool if exists so it can never be claimed anywhere else
        try {
          await updateDocSafe("sms_forwarder_pool", cleanUtr, {
            status: "claimed",
            claimedBy: userId,
            claimedEmail: userEmail || "",
            claimedAt: new Date().toISOString()
          });
        } catch (e) {}

        // Clear any pending user UTR
        serverCache.pending_user_utrs.delete(cleanUtr);
        try { await deleteDocSafe("pending_user_utrs", cleanUtr); } catch (e) {}

        // Mark SMS log as claimed
        const existingLog = (serverCache.sms_forwarder_logs || []).find((l: any) => l.utr === cleanUtr);
        if (existingLog) {
          existingLog.status = "claimed";
          existingLog.claimedBy = userId;
          existingLog.claimedEmail = userEmail || "";
          existingLog.claimedAt = new Date().toISOString();
        }

        console.log(`[BOT-WALLET-VERIFIED] Credited ₹${creditedAmount} to user ${userId} for UTR ${cleanUtr}`);

        return res.json({
          success: true,
          amount: creditedAmount,
          newBalance,
          message: `🎉 Payment verified! ₹${creditedAmount} has been credited to your wallet.`
        });
      }

      // If claim failed with 400 (already used or explicit amount mismatch), return that exact reason
      if (claimRes.status === 400) {
        return res.status(400).json({ success: false, error: claimRes.error });
      }

      // 2. Fallback check: Payment Gateways or Webhook memory cache
      const verifyResult = await verifyAndCreditPayment({
        userId,
        userEmail,
        amount: numAmount,
        utr: cleanUtr,
        authHeader: req.headers.authorization as string
      });

      if (verifyResult.success) {
        globalClaimedUtrs.add(cleanUtr);
      }

      return res.status(verifyResult.status || (verifyResult.success ? 200 : 400)).json(verifyResult);
    } catch (err: any) {
      console.error("[VERIFY-UTR-ERR]", err.message);
      return res.status(500).json({ success: false, error: err.message || "Failed to verify UTR" });
    } finally {
      // Always release lock
      globalUtrLocks.delete(cleanUtr);
    }
  });

  app.post("/api/admin/process-deposit", async (req, res) => {
    const { depositId, action, adminEmail, deposit: clientDeposit } = req.body;
    if (!depositId || !action) {
      return res.status(400).json({ error: "Missing depositId or action" });
    }

    try {
      console.log(`[DEPOSIT-ACTION] Processing deposit ${depositId} with action ${action} by ${adminEmail}`);
      
      let depData = clientDeposit;
      if (!depData || !depData.userId || !depData.amount) {
        // Fallback: 1 single read if client didn't supply deposit details
        const depSnap = await getDocSafe("deposits", depositId, req.headers.authorization as string, true);
        if (!depSnap.exists) {
          return res.status(404).json({ error: "Deposit not found" });
        }
        depData = depSnap.data();
      }

      const currentStatus = (depData.status || "").toLowerCase();
      if (currentStatus === "approved" && action === "approved") {
        return res.json({ success: true, message: "Deposit is already approved", deposit: depData });
      }
      if (currentStatus === "cancelled" && action === "cancelled") {
        return res.json({ success: true, message: "Deposit is already cancelled", deposit: depData });
      }

      const userId = depData.userId || depData.user_id;
      const amount = Number(depData.amount || 0);

      if (action === "approved") {
        if (!userId) {
          return res.status(400).json({ error: "Deposit is missing userId" });
        }
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({ error: "Invalid deposit amount" });
        }

        // Adjust user balance safely (0 reads, 1 write)
        const balanceAdjusted = await adjustUserBalanceSafe(userId, amount, req.headers.authorization as string);
        if (!balanceAdjusted) {
          return res.status(500).json({ error: "Failed to update user wallet balance" });
        }

        // Update deposit status (0 reads, 1 write)
        const updateData = {
          status: "approved",
          verifiedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          processedBy: adminEmail || "admin"
        };
        await updateDocSafe("deposits", depositId, updateData, req.headers.authorization as string);

        // Update memory cache
        if (serverCache.deposits.has(depositId)) {
          const cached = serverCache.deposits.get(depositId) || {};
          serverCache.deposits.set(depositId, { ...cached, ...updateData });
        }

        return res.json({ 
          success: true, 
          status: "approved",
          depositId,
          amount,
          userId,
          message: `Deposit ₹${amount} approved successfully!`
        });
      } else {
        // Cancel deposit (0 reads, 1 write)
        const updateData = {
          status: "cancelled",
          updatedAt: new Date().toISOString(),
          processedBy: adminEmail || "admin"
        };
        await updateDocSafe("deposits", depositId, updateData, req.headers.authorization as string);

        if (serverCache.deposits.has(depositId)) {
          const cached = serverCache.deposits.get(depositId) || {};
          serverCache.deposits.set(depositId, { ...cached, ...updateData });
        }

        return res.json({ 
          success: true, 
          status: "cancelled",
          depositId,
          message: "Deposit rejected/cancelled."
        });
      }
    } catch (err: any) {
      console.error(`[DEPOSIT-ACTION-ERR] Failed:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/restore-all-balances", async (req, res) => {
    try {
      console.log(`[RESTORE-BALANCES] Starting balance reconciliation...`);
      const userApprovedMap = new Map<string, number>();
      const userOrdersMap = new Map<string, number>();

      // 1. Calculate from in-memory and persistent deposits
      serverCache.deposits.forEach((dep: any) => {
        const d = dep?.data || dep;
        const uId = d.userId || d.user_id;
        if (uId && d.status === "approved") {
          const amt = Number(d.amount || 0);
          userApprovedMap.set(uId, (userApprovedMap.get(uId) || 0) + amt);
        }
      });

      // Also query Turso approved deposits
      try {
        const client = getTursoClient();
        if (client) {
          const res = await client.execute(`SELECT * FROM smm_deposits WHERE status = 'approved' OR status = 'completed';`);
          for (const row of res.rows) {
            const uId = String(row.user_id || "");
            const amt = Number(row.amount || 0);
            if (uId && amt > 0) {
              if (!userApprovedMap.has(uId)) {
                userApprovedMap.set(uId, amt);
              } else {
                userApprovedMap.set(uId, Math.max(userApprovedMap.get(uId)! , amt));
              }
            }
          }
        }
      } catch (e: any) {
        console.warn("[RESTORE-BALANCES] Error fetching deposits from Turso:", e.message);
      }

      // 2. Calculate orders
      serverCache.orders.forEach((ord: any) => {
        const o = ord?.data || ord;
        const uId = o.userId || o.user_id;
        if (uId && o.status !== "Failed" && o.status !== "Cancelled") {
          const price = Number(o.totalPrice || o.total_price || 0);
          userOrdersMap.set(uId, (userOrdersMap.get(uId) || 0) + price);
        }
      });

      const restoredList: any[] = [];
      for (const [uId, totalDep] of userApprovedMap.entries()) {
        const totalOrd = userOrdersMap.get(uId) || 0;
        const calculatedBalance = Math.max(0, Number((totalDep - totalOrd).toFixed(2)));
        
        const cachedUser = serverCache.users.get(uId);
        const existingData = cachedUser ? (cachedUser.data || cachedUser) : {};
        const currentBal = Number(existingData.balance ?? existingData.walletBalance ?? 0);

        if (calculatedBalance > currentBal) {
          console.log(`[RESTORE-BALANCES] Restoring User ${uId}: Old Bal ₹${currentBal} -> New Bal ₹${calculatedBalance}`);
          const updatedUser = { ...existingData, uid: uId, balance: calculatedBalance, updatedAt: new Date().toISOString() };
          serverCache.users.set(uId, { data: updatedUser, time: Date.now() });
          
          if (!useRestFallback && adminSdkSucceeded) {
            fdb.collection("users").doc(uId).set({ balance: calculatedBalance }, { merge: true }).catch(() => {});
          }
          
          restoredList.push({ userId: uId, oldBalance: currentBal, restoredBalance: calculatedBalance });
        }
      }

      savePersistentCache();
      return res.json({ success: true, count: restoredList.length, restored: restoredList });
    } catch (err: any) {
      console.error("[RESTORE-BALANCES-ERR] Failed:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/db/get", async (req, res) => {
    const { collection, id } = req.body;
    if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
    // Use server cache by default to protect Firestore read quota unless explicit fresh request is sent
    const forceFresh = req.body.fresh === true;
    const snap = await getDocSafe(collection, id, req.headers.authorization as string, forceFresh);
    if (snap.exists) {
      res.json({ success: true, data: snap.data() });
    } else {
      res.json({ success: false, error: "Document not found" });
    }
  });

  app.post("/api/db/list", async (req, res) => {
    const { collection: collect, limit: pageSize = 100, fresh = false } = req.body;
    if (!collect) return res.status(400).json({ error: "Missing collection" });
    
    // 1. Check serverCache first (0 Reads) - Most efficient for repeated calls
    if (!fresh) {
      if (collect === "courses" && serverCache.courses.size > 0) {
        const list = Array.from(serverCache.courses.values()).map((c: any) => c.data || c);
        return res.json({ success: true, data: list.slice(0, pageSize) });
      }
      if (collect === "providers" && serverCache.providers.size > 0) {
        const list = Array.from(serverCache.providers.values()).map((p: any) => p.data || p);
        return res.json({ success: true, data: list.slice(0, pageSize) });
      }
      if (collect === "deposits" && serverCache.deposits.size > 0) {
        const list = Array.from(serverCache.deposits.values())
          .map((d: any) => d.data || d)
          .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        return res.json({ success: true, data: list.slice(0, pageSize) });
      }
      if (collect === "orders" && serverCache.latestOrders.length > 0) {
        return res.json({ success: true, data: serverCache.latestOrders.slice(0, pageSize) });
      }
    }

    // 2. Prioritize Firestore & Merge for courses and providers
    if (collect === "courses" || collect === "providers") {
      const combinedMap = new Map<string, any>();
      const localDocs = listLocalDocs(collect, 500);
      if (localDocs && Array.isArray(localDocs)) {
        localDocs.forEach(item => { if (item && item.id) combinedMap.set(item.id, item); });
      }

      const cacheStore = collect === "courses" ? serverCache.courses : serverCache.providers;
      cacheStore.forEach((val, id) => {
        const d = val?.data || val;
        if (d && (d.id || id)) combinedMap.set(d.id || id, d);
      });

      try {
        const snap = await listDocsSafe(collect, req.headers.authorization as string, fresh);
        if (snap && snap.docs && snap.docs.length > 0) {
          snap.docs.forEach(doc => {
            const d = typeof doc.data === "function" ? doc.data() : doc.data;
            if (d) combinedMap.set(doc.id, { id: doc.id, ...d });
          });
        }
      } catch (e) {}

      combinedMap.forEach((data, id) => {
        cacheStore.set(id, { data, time: Date.now() });
        try { setLocalDoc(collect, id, data); } catch (err) {}
      });
      savePersistentCache();

      const mergedList = Array.from(combinedMap.values());
      return res.json({ success: true, data: mergedList.slice(0, pageSize) });
    }

    if (collect === "settings" || collect === "users" || fresh) {
      try {
        const snap = await listDocsSafe(collect, req.headers.authorization as string, fresh);
        if (snap && snap.docs && snap.docs.length > 0) {
          const docs = snap.docs.map(doc => {
            const d = typeof doc.data === "function" ? doc.data() : doc.data;
            return { id: doc.id, ...d };
          });
          return res.json({ success: true, data: docs.slice(0, pageSize) });
        }
      } catch (e) {}
    }


    // 3. Fallback to local DB
    const localList = listLocalDocs(collect, pageSize);
    if (localList.length > 0) {
      return res.json({ success: true, data: localList });
    }
    
    return res.json({ success: true, data: [] });
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

  app.post("/api/db/delete", async (req, res) => {
    const { collection, id } = req.body;
    if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
    
    try {
      const success = await deleteDocSafe(collection, id);
      res.json({ success });
    } catch (err: any) {
      console.error(`[DB-DELETE-ERR] Failed to delete ${collection}/${id}:`, err.message);
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

  const userLastDepositTime = new Map<string, number>();

  // Helper: Verify payment and instantly credit user wallet (No pending requests, 0 Firestore writes on failed attempts)
  async function verifyAndCreditPayment(params: {
    userId: string;
    userEmail?: string;
    amount: number;
    utr: string;
    clientTxnId?: string;
    authHeader?: string;
  }) {
    const { userId, userEmail, amount, utr, clientTxnId, authHeader } = params;
    const cleanUtr = String(utr || "").replace(/\D/g, "").trim();

    if (!userId || !amount || isNaN(amount) || amount <= 0) {
      return { success: false, status: 400, error: "Invalid user ID or deposit amount." };
    }

    if (cleanUtr.length < 10 || cleanUtr.length > 18) {
      return { success: false, status: 400, error: "Invalid UTR number. Please enter a valid 12-digit transaction ID." };
    }

    // 0. Strict Anti-Duplicate Check
    if (isUtrAlreadyClaimed(cleanUtr)) {
      return { success: false, status: 400, error: "This UTR number has already been verified and credited to balance. Duplicate submissions are not allowed." };
    }

    // Check concurrency lock: Is this exact UTR being verified right now?
    if (globalUtrLocks.has(cleanUtr)) {
      return { success: false, status: 429, error: "This transaction is currently being processed. Please wait a moment." };
    }

    globalUtrLocks.add(cleanUtr);

    try {
      // 1. Check in-memory deposits cache first (0 Firestore reads)
    let isAlreadyVerified = false;
    if (serverCache.deposits.size > 0) {
      const cachedDeps = Array.from(serverCache.deposits.values()).map((d: any) => d.data || d);
      isAlreadyVerified = cachedDeps.some((d: any) => 
        String(d.utr || "").replace(/\D/g, "").trim() === cleanUtr && 
        (d.status === "approved" || d.status === "completed")
      );
    }

    // Secondary check against Turso database if not found in cache
    if (!isAlreadyVerified) {
      try {
        const client = getTursoClient();
        if (client) {
          const res = await client.execute({
            sql: `SELECT * FROM smm_deposits WHERE transaction_id = ? LIMIT 1;`,
            args: [cleanUtr]
          });
          if (res.rows.length > 0) {
            const row = res.rows[0];
            if (row.status === "approved" || row.status === "completed") {
              isAlreadyVerified = true;
            }
          }
        }
      } catch (e) {}
    }

    if (isAlreadyVerified) {
      return { success: false, status: 400, error: "This UTR number has already been verified and credited to balance. Duplicate submissions are not allowed." };
    }

    // 2. Check Gateway Webhook Memory Cache (Real-time confirmed payments from Paytm/PhonePe/UPIGateway)
    let isVerified = false;
    let verifiedProvider = "gateway_auto";

    // Check Local Bank Alerts from Telegram Bot / SMS (0 Firestore Reads!)
    const alertClaim = verifyAndClaimAlert(cleanUtr, amount, userId, userEmail);
    if (alertClaim.success && alertClaim.alert) {
      isVerified = true;
      verifiedProvider = alertClaim.alert.senderBank || "telegram_bot";
      console.log(`[AUTO-VERIFY] Matched disk bank alert for UTR ${cleanUtr}: ₹${alertClaim.alert.amount} (${verifiedProvider})`);
    } else if (alertClaim.status === 400) {
      return { success: false, status: 400, error: alertClaim.error };
    }

    const matchedWebhookPayment = serverCache.received_gateway_payments.get(cleanUtr);

    if (matchedWebhookPayment) {
      const receivedAmt = Number(matchedWebhookPayment.amount || 0);
      if (receivedAmt >= amount || Math.abs(receivedAmt - amount) <= 1) {
        isVerified = true;
        verifiedProvider = matchedWebhookPayment.provider || "webhook_auto";
        console.log(`[AUTO-VERIFY] Matched incoming ${verifiedProvider} webhook payment for UTR ${cleanUtr}: ₹${receivedAmt}`);
      } else {
        return { 
          success: false, 
          status: 400, 
          error: `Amount mismatch: Received payment for this UTR was ₹${receivedAmt}, but requested deposit is ₹${amount}.` 
        };
      }
    }

    // 3. If not in webhook memory, verify against configured Gateway API (Paytm Business, PhonePe, UPIGateway, SMMQR, VPAAPI, etc.)
    const settingsSnap = await getDocSafe("settings", "payment");
    const settings = settingsSnap.data() || {};

    if (!isVerified) {
      const provider = settings.qrAutoProvider || "paytm_business";
      const apiKey = settings.qrAutoApiKey || settings.customGateway1Key;
      const secret = settings.qrAutoToken || settings.customGateway1Secret;
      const customUrl = settings.qrAutoUrl || settings.customGateway1Url;

      if (provider === "paytm_business" || settings.paytmEnabled) {
        const mid = settings.paytmMid || apiKey;
        if (mid) {
          try {
            const isProd = settings.paytmEnv === "production";
            const statusUrl = isProd
              ? `https://securegw.paytm.in/v3/order/status`
              : `https://securegw-stage.paytm.in/v3/order/status`;
            
            const statusRes = await axios.post(statusUrl, {
              body: {
                mid: mid,
                orderId: clientTxnId || `ORDER_${cleanUtr}`
              }
            }, { timeout: 12000 });

            if (statusRes.data?.body?.resultInfo?.resultStatus === "TXN_SUCCESS") {
              const paytmAmt = Number(statusRes.data?.body?.txnAmount || 0);
              if (!paytmAmt || paytmAmt >= amount || Math.abs(paytmAmt - amount) <= 1) {
                isVerified = true;
                verifiedProvider = "paytm_business";
              }
            }
          } catch (pErr: any) {
            console.warn("[PAYTM-STATUS-API]", pErr.message);
          }
        }
      }

      if (!isVerified && (provider === "phonepe_business" || settings.phonepeEnabled)) {
        const merchantId = settings.phonepeMerchantId || apiKey;
        if (merchantId) {
          try {
            const isProd = settings.phonepeEnv === "production";
            const phonepeUrl = isProd
              ? `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${clientTxnId || cleanUtr}`
              : `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status/${merchantId}/${clientTxnId || cleanUtr}`;
            
            const ppRes = await axios.get(phonepeUrl, {
              headers: {
                "X-MERCHANT-ID": merchantId,
                "Content-Type": "application/json"
              },
              timeout: 12000
            });
            if (ppRes.data?.code === "PAYMENT_SUCCESS") {
              isVerified = true;
              verifiedProvider = "phonepe_business";
            }
          } catch (ppErr: any) {
            console.warn("[PHONEPE-STATUS-API]", ppErr.message);
          }
        }
      }

      if (!isVerified && provider === "upigateway") {
        const verifyUrl = customUrl || "https://api.upigateway.com/api/v1/verify_payment";
        try {
          const apiRes = await axios.post(verifyUrl, {
            key: apiKey,
            utr: cleanUtr,
            client_txn_id: clientTxnId
          }, { timeout: 15000 });
          if (apiRes.data?.status === true || apiRes.data?.msg?.toLowerCase().includes("success")) {
            isVerified = true;
            verifiedProvider = "upigateway";
          }
        } catch (uErr: any) {
          console.warn("[UPIGATEWAY-VERIFY]", uErr.message);
        }
      }

      if (!isVerified && provider === "smmqr") {
        const verifyUrl = customUrl || "https://smmqr.com/api/v1/verify-payment";
        try {
          const apiRes = await axios.get(verifyUrl, {
            params: {
              api_key: apiKey,
              token: secret,
              utr: cleanUtr,
              amount: amount
            },
            timeout: 15000
          });
          if (apiRes.data?.status === "success" || apiRes.data?.success === true) {
            isVerified = true;
            verifiedProvider = "smmqr";
          }
        } catch (sErr: any) {
          console.warn("[SMMQR-VERIFY]", sErr.message);
        }
      }

      if (!isVerified && provider === "vpaapi") {
        const verifyUrl = customUrl || "https://vpaapi.com/api/verify";
        try {
          const apiRes = await axios.post(verifyUrl, {
            api_key: apiKey,
            utr: cleanUtr,
            amount: amount
          }, { timeout: 15000 });
          if (apiRes.data?.status === "success" || apiRes.data?.success === true) {
            isVerified = true;
            verifiedProvider = "vpaapi";
          }
        } catch (vErr: any) {
          console.warn("[VPAAPI-VERIFY]", vErr.message);
        }
      }

      if (!isVerified && customUrl && provider === "custom") {
        try {
          const apiRes = await axios.post(customUrl, {
            key: apiKey,
            token: secret,
            utr: cleanUtr,
            amount: amount
          }, { timeout: 15000 });
          if (apiRes.data?.status === "success" || apiRes.data?.success === true) {
            isVerified = true;
            verifiedProvider = "custom";
          }
        } catch (cErr: any) {
          console.warn("[CUSTOM-VERIFY]", cErr.message);
        }
      }

      // Check global auto-approve setting if enabled by Admin
      if (!isVerified && settings.autoApproveDeposits === true) {
        isVerified = true;
        verifiedProvider = "admin_auto_approve";
      }
    }

    // 3.5 Check Firestore sms_forwarder_pool (persistent pool shared with Vercel)
    if (!isVerified) {
      try {
        const poolSnap = await getDocSafe("sms_forwarder_pool", cleanUtr);
        if (poolSnap.exists) {
          const poolData = poolSnap.data() || {};
          if (poolData.status !== "claimed") {
            const poolAmt = Number(poolData.amount || 0);
            if (!amount || poolAmt >= amount || Math.abs(poolAmt - amount) <= 1) {
              isVerified = true;
              verifiedProvider = "sms_forwarder";
              console.log(`[AUTO-VERIFY] Matched Firestore sms_forwarder_pool for UTR ${cleanUtr}: ₹${poolAmt}`);
              try {
                await updateDocSafe("sms_forwarder_pool", cleanUtr, {
                  status: "claimed",
                  claimedBy: userId,
                  claimedEmail: userEmail || "",
                  claimedAt: new Date().toISOString()
                });
              } catch (uErr) {}
            }
          }
        }
      } catch (poolErr: any) {
        console.warn("[SMS-POOL-CHECK-FAIL]", poolErr.message);
      }
    }

    // 4. If NOT verified:
    if (!isVerified) {
      // Register in pending UTR queue in memory
      serverCache.pending_user_utrs.set(cleanUtr, {
        userId,
        userEmail: userEmail || "",
        amount: Number(amount),
        timestamp: Date.now()
      });

      // Save as pending deposit record so Admin sees it in Deposits tab & can approve manually
      const pendingDepId = `dep_pending_${cleanUtr}`;
      const pendingDepData = {
        id: pendingDepId,
        userId,
        userEmail: userEmail || "not-provided",
        amount: Number(amount),
        utr: cleanUtr,
        status: "pending",
        type: "manual_upi",
        provider: "upi_manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDocSafe("deposits", pendingDepId, pendingDepData);
      serverCache.deposits.set(pendingDepId, { data: pendingDepData, time: Date.now() });
      savePersistentCache();

      // Also register in pending_user_utrs
      try {
        await setDocSafe("pending_user_utrs", cleanUtr, {
          utr: cleanUtr,
          userId,
          userEmail: userEmail || "",
          amount: Number(amount),
          timestamp: new Date().toISOString()
        });
      } catch (pendErr: any) {
        console.warn("[PENDING-UTR-FIRESTORE-FAIL]", pendErr.message);
      }

      return { 
        success: false, 
        status: 400, 
        error: `Payment verification pending: No confirmed transaction received yet for UTR ${cleanUtr}. If you just completed the payment, please wait 15–30 seconds for the Bank/UPI SMS to arrive, then click Confirm again.` 
      };
    }

    // 5. Payment is confirmed: Credit user's wallet
    const adjusted = await adjustUserBalanceSafe(userId, amount, authHeader);
    if (!adjusted) {
      return { success: false, status: 500, error: "Payment verified, but failed to credit wallet. Please contact support." };
    }

    // Mark SMS log as claimed if it came from SMS Forwarder
    const existingLog = (serverCache.sms_forwarder_logs || []).find((l: any) => l.utr === cleanUtr);
    if (existingLog) {
      existingLog.status = "claimed";
      existingLog.claimedBy = userId;
      existingLog.claimedEmail = userEmail || "";
      existingLog.claimedAt = new Date().toISOString();
    }
    serverCache.pending_user_utrs.delete(cleanUtr);
    try {
      await deleteDocSafe("pending_user_utrs", cleanUtr);
    } catch (e) {}

    // Fetch new balance
    const userDoc = await getDocSafe("users", userId);
    const newBalance = userDoc.data()?.balance || 0;

    // Save ONE approved deposit record
    const depositId = `dep_auto_${cleanUtr}_${Date.now()}`;
    const depositData = {
      id: depositId,
      userId,
      userEmail: userEmail || "not-provided",
      amount: Number(amount),
      utr: cleanUtr,
      status: "approved",
      type: "auto_gateway_verify",
      provider: verifiedProvider,
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    await addDocSafe("deposits", depositData);
    try {
      await setTursoDoc("deposits", depositId, depositData);
    } catch (e) {}
    serverCache.deposits.set(depositId, { data: depositData, time: Date.now() });
    savePersistentCache();

    // Log transaction
    await addDocSafe("transactions", {
      userId,
      amount: Number(amount),
      type: "deposit",
      method: verifiedProvider,
      status: "success",
      utr: cleanUtr,
      timestamp: new Date().toISOString(),
      description: `Auto Verified Deposit (UTR: ${cleanUtr})`
    });

    // Remove from webhook cache once used
    serverCache.received_gateway_payments.delete(cleanUtr);

    console.log(`[AUTO-DEPOSIT-SUCCESS] Verified and credited ₹${amount} for user ${userId} (UTR: ${cleanUtr})`);

    globalClaimedUtrs.add(cleanUtr);

    return {
      success: true,
      status: 200,
      amount: Number(amount),
      newBalance,
      message: `Payment verified successfully! ₹${amount} added to your wallet.`
    };
  } finally {
    globalUtrLocks.delete(cleanUtr);
  }
}

  // Confirm Payment & Auto Verify endpoint
  app.post("/api/deposits/submit-manual", async (req, res) => {
    const { amount, utr, userId, userEmail } = req.body;
    const user_id = userId;
    const depositAmount = Number(amount);
    
    if (!user_id || !depositAmount || isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount or user ID." });
    }

    // Rate-limiting check
    const now = Date.now();
    const lastSub = userLastDepositTime.get(user_id) || 0;
    if (now - lastSub < 3000) {
      return res.status(429).json({ error: "Please wait a moment before trying again." });
    }
    userLastDepositTime.set(user_id, now);

    const result = await verifyAndCreditPayment({
      userId: user_id,
      userEmail,
      amount: depositAmount,
      utr,
      authHeader: req.headers.authorization as string
    });

    return res.status(result.status).json(result);
  });

  // Pre-register QR Auto Order if provider requires it
  app.post("/api/deposits/create-qr-auto-order", async (req, res) => {
    const { userId, amount, userEmail } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: "Missing fields" });

    try {
      const settingsSnap = await getDocSafe("settings", "payment");
      const settings = settingsSnap.data() || {};
      
      const { qrAutoProvider, qrAutoApiKey } = settings;
      
      if (qrAutoProvider === "upigateway") {
        const createUrl = "https://api.upigateway.com/api/v1/create_order";
        const client_txn_id = `DEP_${Date.now()}_${userId}`.slice(0, 30);
        
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

          if (apiRes.data?.status === true || apiRes.data?.msg?.toLowerCase().includes("success")) {
            return res.json({ 
              success: true, 
              order_id: apiRes.data.data.order_id,
              client_txn_id: client_txn_id,
              payment_url: apiRes.data.data.payment_url 
            });
          } else {
            return res.status(400).json({ error: apiRes.data?.msg || "Failed to create order on UPIGateway." });
          }
        } catch (apiErr: any) {
          return res.status(500).json({ error: "Could not connect to gateway." });
        }
      }

      res.json({ success: true, message: "Ready for direct UPI payment." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Verify QR Auto Payment (Paytm / PhonePe / UPIGateway / UPI)
  app.post("/api/deposits/verify-qr-auto", async (req, res) => {
    const { userId, amount, utr, client_txn_id, userEmail } = req.body;
    if (!userId || !amount || !utr) return res.status(400).json({ error: "Missing fields" });

    // Rate-limiting check
    const now = Date.now();
    const lastSub = userLastDepositTime.get(userId) || 0;
    if (now - lastSub < 3000) {
      return res.status(429).json({ error: "Please wait a moment before trying again." });
    }
    userLastDepositTime.set(userId, now);

    const result = await verifyAndCreditPayment({
      userId,
      userEmail,
      amount: Number(amount),
      utr,
      clientTxnId: client_txn_id,
      authHeader: req.headers.authorization as string
    });

    return res.status(result.status).json(result);
  });
  
  // Paytm Business Webhook Handler
  app.post("/api/webhooks/paytm", async (req, res) => {
    try {
      const data = req.body || {};
      console.log("[WEBHOOK-PAYTM] Received notification:", JSON.stringify(data));

      const status = data.STATUS || data.status;
      const amount = parseFloat(data.TXNAMOUNT || data.txnAmount || data.amount || 0);
      const utr = String(data.BANKTXNID || data.bankTxnId || data.TXNID || data.txnId || data.utr || "").replace(/\D/g, "");
      const orderId = String(data.ORDERID || data.orderId || "");

      if (status === "TXN_SUCCESS" && utr) {
        // Store in memory cache for immediate matching when user enters UTR
        serverCache.received_gateway_payments.set(utr, {
          amount,
          provider: "paytm_business",
          time: Date.now(),
          orderId
        });
        console.log(`[WEBHOOK-PAYTM] Cached payment for UTR ${utr}: ₹${amount}`);

        // If orderId has user encoded (e.g. DEP_userId_timestamp or TXN_userId_timestamp), credit directly!
        let userId = "";
        if (orderId.startsWith("DEP_") || orderId.startsWith("TXN_")) {
          const parts = orderId.split("_");
          if (parts.length >= 3) userId = parts[1];
        }

        if (userId && amount > 0) {
          await verifyAndCreditPayment({
            userId,
            amount,
            utr,
            clientTxnId: orderId
          });
        }
      }

      res.status(200).send("OK");
    } catch (err: any) {
      console.error("[WEBHOOK-PAYTM-ERR]", err.message);
      res.status(200).send("OK");
    }
  });

  // PhonePe Business Webhook Handler
  app.post("/api/webhooks/phonepe", async (req, res) => {
    try {
      console.log("[WEBHOOK-PHONEPE] Received notification");
      let data = req.body || {};

      // PhonePe sends a base64 encoded 'response' string in standard merchant callback
      if (data.response && typeof data.response === "string") {
        try {
          const decoded = Buffer.from(data.response, "base64").toString("utf-8");
          data = JSON.parse(decoded);
        } catch (decErr) {}
      }

      const code = data.code || data.status;
      const paymentData = data.data || {};
      const utr = String(
        paymentData.paymentInstrument?.utr || 
        paymentData.paymentInstrument?.bankTransactionId || 
        paymentData.utr || 
        data.utr || 
        ""
      ).replace(/\D/g, "");

      // PhonePe amounts are in paise (divide by 100) or plain rupees
      let amount = Number(paymentData.amount || data.amount || 0);
      if (amount > 1000) amount = amount / 100;

      const txnId = String(paymentData.merchantTransactionId || data.merchantTransactionId || "");

      if ((code === "PAYMENT_SUCCESS" || code === "SUCCESS") && utr) {
        serverCache.received_gateway_payments.set(utr, {
          amount,
          provider: "phonepe_business",
          time: Date.now(),
          orderId: txnId
        });
        console.log(`[WEBHOOK-PHONEPE] Cached payment for UTR ${utr}: ₹${amount}`);

        let userId = "";
        if (txnId.startsWith("DEP_") || txnId.startsWith("TXN_")) {
          const parts = txnId.split("_");
          if (parts.length >= 3) userId = parts[1];
        }

        if (userId && amount > 0) {
          await verifyAndCreditPayment({
            userId,
            amount,
            utr,
            clientTxnId: txnId
          });
        }
      }

      res.status(200).send("OK");
    } catch (err: any) {
      console.error("[WEBHOOK-PHONEPE-ERR]", err.message);
      res.status(200).send("OK");
    }
  });

  // UPIGateway.com Webhook Handler
  app.post("/api/webhooks/upigateway", async (req, res) => {
    const data = req.body || {};
    console.log("[WEBHOOK-UPIGATEWAY]", JSON.stringify(data));

    try {
      const status = data.status;
      const utr = String(data.utr || "").replace(/\D/g, "");
      const amount = Number(data.amount || 0);
      const clientTxnId = data.client_txn_id || "";

      if ((status === "success" || status === "COMPLETED") && utr) {
        serverCache.received_gateway_payments.set(utr, {
          amount,
          provider: "upigateway",
          time: Date.now(),
          orderId: clientTxnId
        });

        let userId = "";
        if (clientTxnId.startsWith("DEP_") || clientTxnId.startsWith("TXN_")) {
          const parts = clientTxnId.split("_");
          if (parts.length >= 3) userId = parts[1];
        }

        if (userId && amount > 0) {
          await verifyAndCreditPayment({
            userId,
            amount,
            utr,
            clientTxnId
          });
        }
      }
      
      res.status(200).send("OK");
    } catch (err: any) {
      console.error("[WEBHOOK-UPIGATEWAY-ERR]", err.message);
      res.status(200).send("OK");
    }
  });

  // ==========================================
  // BANK SMS PARSING ENGINE FOR AUTOMATIC UPI
  // ==========================================
  function parseBankSms(smsText: string, sender: string = "") {
    if (!smsText || typeof smsText !== "string") return null;
    const res = parseBankSmsFromService(smsText, sender);
    return {
      isCredit: res.isValid,
      amount: res.amount,
      utr: res.utr,
      bank: res.bank,
      valid: res.isValid && res.amount > 0 && res.utr.length === 12,
      isValid: res.isValid && res.amount > 0 && res.utr.length === 12,
      reason: res.reason
    };
  }

  // Universal SMS Forwarder Webhook
  // Accepts GET or POST from any Android SMS forwarder app (e.g. SMS Forwarder, MacroDroid, Tasker, AutoForward)
  app.all("/api/sms-webhook", async (req, res) => {
    try {
      let body = req.body || {};
      if (Buffer.isBuffer(body)) {
        body = body.toString("utf-8");
      }
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (e) {
          body = { message: body };
        }
      }
      const query = req.query || {};

      // Flexible extraction across different SMS forwarding app schemas
      let smsText = String(
        body.text || body.message || body.body || body.sms || body.content || body.msg || body.raw || body.textMessage ||
        body.msg_body || body.sms_body || body.data || body.notification ||
        query.text || query.message || query.body || query.sms || query.msg || ""
      ).trim();

      // If still empty, inspect all string values in body
      if (!smsText && typeof body === "object") {
        for (const val of Object.values(body)) {
          if (typeof val === "string" && val.trim().length > 10) {
            smsText = val.trim();
            break;
          }
        }
      }

      const sender = String(
        body.from || body.sender || body.address || body.phone || body.number || body.originatingAddress ||
        query.from || query.sender || "SMS_APP"
      ).trim();

      const receivedSecret = String(
        body.secret || body.key || body.token || body.api_key || body.apiKey ||
        query.secret || query.key || query.token ||
        req.headers["x-sms-secret"] || req.headers["x-secret-key"] || ""
      ).trim();

      // Check configured payment settings
      const settingsSnap = await getDocSafe("settings", "payment");
      const settings = settingsSnap.data() || {};
      const expectedSecret = String(settings.smsForwarderSecret || "").trim();
      const isSmsEnabled = settings.smsForwarderEnabled !== false;

      if (!isSmsEnabled) {
        return res.status(403).json({ success: false, error: "SMS Forwarder is currently disabled in Admin settings." });
      }

      if (expectedSecret && receivedSecret !== expectedSecret) {
        console.warn(`[SMS-FORWARDER-AUTH-FAIL] Secret mismatch from ${sender}`);
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid SMS secret key" });
      }

      if (!smsText) {
        return res.status(200).json({ 
          success: true, 
          message: "SMS Forwarder webhook endpoint is live and ready. Forward SMS text using POST json or text with 'message' or 'text' key." 
        });
      }

      console.log(`[SMS-FORWARDER-INCOMING] From: ${sender} | Text: "${smsText.substring(0, 120)}..."`);

      const parsed = parseBankSms(smsText);

      const logEntry: any = {
        id: `sms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        sender,
        rawText: smsText,
        isCredit: !!parsed?.isCredit,
        amount: parsed?.amount || 0,
        utr: parsed?.utr || "",
        valid: !!parsed?.valid,
        status: "ignored"
      };

      if (!parsed || !parsed.isCredit) {
        logEntry.status = "ignored_not_credit";
        logEntry.reason = parsed?.reason || "Not a payment credit SMS";
        serverCache.sms_forwarder_logs.unshift(logEntry);
        if (serverCache.sms_forwarder_logs.length > 200) serverCache.sms_forwarder_logs.pop();
        savePersistentCache();
        try { await addDocSafe("sms_forwarder_logs", logEntry); } catch (e) {}
        return res.status(200).json({ success: true, message: "Ignored non-credit SMS", reason: logEntry.reason });
      }

      if (!parsed.valid || !parsed.utr || parsed.amount <= 0) {
        logEntry.status = "invalid_format";
        logEntry.reason = `Could not find 12-digit UTR (${parsed.utr || "none"}) or valid amount (₹${parsed.amount})`;
        serverCache.sms_forwarder_logs.unshift(logEntry);
        if (serverCache.sms_forwarder_logs.length > 200) serverCache.sms_forwarder_logs.pop();
        savePersistentCache();
        try { await addDocSafe("sms_forwarder_logs", logEntry); } catch (e) {}
        return res.status(200).json({ success: true, message: "Received SMS but UTR or amount not detected", details: parsed });
      }

      const cleanUtr = parsed.utr;
      const amount = parsed.amount;

      // 1. Cache the payment for user verification
      serverCache.received_gateway_payments.set(cleanUtr, {
        amount,
        provider: "sms_forwarder",
        sender,
        time: Date.now(),
        rawSms: smsText,
        status: "available"
      });
      logEntry.status = "available";

      console.log(`[SMS-FORWARDER-CACHED] Available payment for UTR ${cleanUtr}: ₹${amount}`);

      // 2. Check if a user entered this UTR earlier and was waiting in memory OR Firestore pending_user_utrs!
      let pendingUser = serverCache.pending_user_utrs.get(cleanUtr);
      if (!pendingUser) {
        try {
          const pendSnap = await getDocSafe("pending_user_utrs", cleanUtr);
          if (pendSnap.exists) {
            pendingUser = pendSnap.data();
          }
        } catch (e) {}
      }

      let autoCredited = false;
      if (pendingUser && (amount >= pendingUser.amount || Math.abs(amount - pendingUser.amount) <= 1)) {
        console.log(`[SMS-FORWARDER-AUTO-MATCH] Auto-crediting waiting user ${pendingUser.userId} for UTR ${cleanUtr} (₹${amount})`);
        try {
          const credRes = await verifyAndCreditPayment({
            userId: pendingUser.userId,
            userEmail: pendingUser.userEmail,
            amount: pendingUser.amount,
            utr: cleanUtr
          });
          if (credRes.success) {
            autoCredited = true;
            logEntry.status = "claimed_auto";
            logEntry.claimedBy = pendingUser.userId;
            logEntry.claimedEmail = pendingUser.userEmail;
            serverCache.pending_user_utrs.delete(cleanUtr);
            try { await deleteDocSafe("pending_user_utrs", cleanUtr); } catch (e) {}
          }
        } catch (autoErr: any) {
          console.error(`[SMS-FORWARDER-AUTO-ERR]`, autoErr.message);
        }
      }

      // 3. Persist to Firestore sms_forwarder_pool so both Vercel & local server have access
      try {
        await setDocSafe("sms_forwarder_pool", cleanUtr, {
          utr: cleanUtr,
          amount,
          sender,
          rawSms: smsText,
          timestamp: new Date().toISOString(),
          status: autoCredited ? "claimed" : "available",
          claimedBy: autoCredited ? (pendingUser?.userId || "") : "",
          claimedEmail: autoCredited ? (pendingUser?.userEmail || "") : ""
        });
        await addDocSafe("sms_forwarder_logs", logEntry);
      } catch (poolErr: any) {
        console.warn("[FIRESTORE-POOL-SAVE-FAIL]", poolErr.message);
      }

      serverCache.sms_forwarder_logs.unshift(logEntry);
      if (serverCache.sms_forwarder_logs.length > 200) serverCache.sms_forwarder_logs.pop();
      savePersistentCache();

      return res.status(200).json({
        success: true,
        message: autoCredited 
          ? `₹${amount} (UTR: ${cleanUtr}) received and auto-credited to waiting user!` 
          : `₹${amount} (UTR: ${cleanUtr}) received and ready for instant user claim.`,
        utr: cleanUtr,
        amount,
        autoCredited
      });
    } catch (err: any) {
      console.error("[SMS-FORWARDER-ERR]", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Manual UTR and SMS Resolver (For Admin Instant Credit)
  app.post("/api/sms-forwarder/manual-resolve", async (req, res) => {
    try {
      const { utr, amount: reqAmount, userEmail, userId: reqUserId, adminEmail } = req.body || {};
      const cleanUtr = String(utr || "").replace(/\D/g, "");
      if (cleanUtr.length !== 12) {
        return res.status(400).json({ error: "Please provide a valid 12-digit UTR" });
      }

      let targetUserId = reqUserId || "";
      let targetEmail = userEmail || "";
      let amountToCredit = Number(reqAmount || 0);

      // Check pending in memory or Firestore
      let pending = serverCache.pending_user_utrs.get(cleanUtr);
      if (!pending) {
        try {
          const pendSnap = await getDocSafe("pending_user_utrs", cleanUtr);
          if (pendSnap.exists) pending = pendSnap.data();
        } catch (e) {}
      }

      if (pending) {
        if (!targetUserId) targetUserId = pending.userId;
        if (!targetEmail) targetEmail = pending.userEmail;
        if (!amountToCredit) amountToCredit = Number(pending.amount || 0);
      }

      // Check users collection if targetUserId not found
      if (!targetUserId && targetEmail) {
        const userDocs = Array.from(serverCache.users.values());
        const found = userDocs.find((u: any) => (u.email || "").toLowerCase() === targetEmail.toLowerCase());
        if (found) targetUserId = found.uid || found.id;
      }

      if (!targetUserId) {
        return res.status(400).json({
          error: `Could not determine user for UTR ${cleanUtr}. Please provide user email or user ID.`
        });
      }

      if (amountToCredit <= 0) {
        return res.status(400).json({ error: "Please specify an amount greater than ₹0" });
      }

      const credRes = await verifyAndCreditPayment({
        userId: targetUserId,
        userEmail: targetEmail,
        amount: amountToCredit,
        utr: cleanUtr,
        authHeader: req.headers.authorization as string
      });

      // Update pool and delete pending
      try {
        await setDocSafe("sms_forwarder_pool", cleanUtr, {
          utr: cleanUtr,
          amount: amountToCredit,
          status: "claimed",
          claimedBy: targetUserId,
          claimedEmail: targetEmail,
          sender: "ADMIN_RESOLVE",
          timestamp: new Date().toISOString()
        });
        await deleteDocSafe("pending_user_utrs", cleanUtr);
      } catch (e) {}

      return res.json({
        success: true,
        message: `Successfully credited ₹${amountToCredit} to user (${targetEmail || targetUserId}) for UTR ${cleanUtr}!`,
        details: credRes
      });
    } catch (err: any) {
      console.error("[MANUAL-RESOLVE-ERR]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // SMS Parser Test & Simulation Endpoint (For Admin testing)
  app.post("/api/sms-forwarder/test-parse", async (req, res) => {
    try {
      const { smsText, simulate } = req.body || {};
      if (!smsText) return res.status(400).json({ error: "Missing smsText" });

      const parsed = parseBankSms(smsText);
      let simulated = false;

      if (simulate && parsed && parsed.valid) {
        serverCache.received_gateway_payments.set(parsed.utr, {
          amount: parsed.amount,
          provider: "sms_forwarder_simulated",
          sender: "ADMIN_SIMULATOR",
          time: Date.now(),
          rawSms: smsText,
          status: "available"
        });

        // Check if any user was waiting for this UTR
        const pendingUser = serverCache.pending_user_utrs.get(parsed.utr);
        let autoCredited = false;
        if (pendingUser && (parsed.amount >= pendingUser.amount || Math.abs(parsed.amount - pendingUser.amount) <= 1)) {
          await verifyAndCreditPayment({
            userId: pendingUser.userId,
            userEmail: pendingUser.userEmail,
            amount: pendingUser.amount,
            utr: parsed.utr
          });
          autoCredited = true;
          serverCache.pending_user_utrs.delete(parsed.utr);
        }

        serverCache.sms_forwarder_logs.unshift({
          id: `sim_${Date.now()}`,
          timestamp: new Date().toISOString(),
          sender: "ADMIN_SIMULATOR",
          rawText: smsText,
          isCredit: true,
          amount: parsed.amount,
          utr: parsed.utr,
          valid: true,
          status: autoCredited ? "claimed_auto" : "available",
          claimedBy: autoCredited ? pendingUser?.userId : undefined
        });

        savePersistentCache();
        simulated = true;
      }

      res.json({
        success: true,
        parsed,
        simulated
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get SMS forwarder logs & real-time available payments
  app.get("/api/sms-forwarder/logs", async (req, res) => {
    try {
      const availableList = Array.from(serverCache.received_gateway_payments.entries())
        .map(([utr, item]) => ({ utr, ...item }))
        .filter(item => item.provider?.startsWith("sms_forwarder"));

      let mergedLogs = [...(serverCache.sms_forwarder_logs || [])];

      try {
        const queryRes = await runQueryREST({
          structuredQuery: {
            from: [{ collectionId: "sms_forwarder_logs" }],
            limit: 50
          }
        });
        if (queryRes && Array.isArray(queryRes)) {
          const logMap = new Map();
          mergedLogs.forEach((l: any) => logMap.set(l.id || l.timestamp, l));
          queryRes.forEach((doc: any) => {
            const data = doc.data();
            const key = doc.id || data.timestamp;
            if (!logMap.has(key)) {
              logMap.set(key, { id: doc.id, ...data });
            }
          });
          mergedLogs = Array.from(logMap.values());
          mergedLogs.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        }
      } catch (dbErr) {}

      res.json({
        success: true,
        logs: mergedLogs.slice(0, 50),
        available: availableList.slice(0, 50),
        pendingUsers: Array.from(serverCache.pending_user_utrs.entries()).map(([utr, u]) => ({ utr, ...u }))
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear SMS forwarder logs
  app.post("/api/sms-forwarder/clear-logs", async (req, res) => {
    try {
      serverCache.sms_forwarder_logs = [];
      savePersistentCache();
      res.json({ success: true, message: "SMS Forwarder logs cleared successfully." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // IN-MEMORY SET TO PREVENT MULTIPLE TRANSMISSIONS OF THE SAME ORDER ID
  const processingOrders = new Set<string>();

  // CONCURRENCY LOCK PER USER TO PREVENT DOUBLE-SPEND ATTACKS ACROSS MULTIPLE DEVICES (E.G. WEBSITE + MOBILE APP)
  const activeUserOrders = new Set<string>();
  async function withUserOrderLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (!userId) return await fn();
    if (activeUserOrders.has(userId)) {
      let waited = 0;
      while (activeUserOrders.has(userId) && waited < 4000) {
        await new Promise(r => setTimeout(r, 200));
        waited += 200;
      }
    }
    activeUserOrders.add(userId);
    try {
      return await fn();
    } finally {
      activeUserOrders.delete(userId);
    }
  }

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
      // 0. Resolve orderData or fallback to Supabase/Firestore fetch to avoid redundant DB reads
      let userId = currentOrderData?.userId || currentOrderData?.user_id;
      let serviceId = currentOrderData?.serviceId || currentOrderData?.service_id;

      const refundIfDeducted = async (uid: string, oId: string, amt: number) => {
        try {
          if (currentOrderData?.balanceAlreadyDeducted && uid && amt > 0) {
            console.log(`[REFUND-PROCESS] Refunding ₹${amt} to user ${uid} for rejected order ${oId}`);
            
            // Refund directly in Firebase Firestore
            let currentBal = 0;
            if (serverCache.users.has(uid)) {
              const cached = serverCache.users.get(uid);
              currentBal = Number((cached?.data || cached)?.balance || 0);
            } else if (currentOrderData?.newBalance !== undefined) {
              currentBal = Number(currentOrderData.newBalance);
            }
            const refundedBal = Number((currentBal + amt).toFixed(2));

            let refundOk = false;
            if (!useRestFallback && adminSdkSucceeded) {
              try {
                await fdb.collection("users").doc(uid).set({
                  balance: refundedBal,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                refundOk = true;
              } catch (e: any) {
                console.warn(`[REFUND-FAIL] Admin SDK refund error:`, e.message);
              }
            }

            if (!refundOk) {
              try {
                await setDocREST("users", uid, { balance: refundedBal, updatedAt: new Date().toISOString() }, token);
                refundOk = true;
              } catch (e: any) {
                console.warn(`[REFUND-FAIL] REST refund error:`, e.message);
              }
            }

            // Sync in-memory, localDb, and Turso Cloud Database
            const refundUserData = {
              uid,
              balance: refundedBal,
              updatedAt: new Date().toISOString()
            };
            setLocalDoc("users", uid, refundUserData);
            tursoSetDoc("users", uid, refundUserData).catch(() => {});

            if (serverCache.users.has(uid)) {
              const cached = serverCache.users.get(uid);
              serverCache.users.set(uid, {
                data: { ...(cached?.data || cached || { uid }), balance: refundedBal, updatedAt: new Date().toISOString() },
                time: Date.now()
              });
            }
            savePersistentCache();

            currentOrderData.balanceAlreadyDeducted = false;
            currentOrderData.newBalance = refundedBal;
            console.log(`[REFUND-SUCCESS] Successfully refunded ₹${amt} to user ${uid}. Restored balance: ₹${refundedBal}`);
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
          return { success: true, providerOrderId: currentOrderData.providerOrderId, newBalance: currentOrderData?.newBalance };
        }
      }

      const orderAmount = Number(currentOrderData.totalPrice || currentOrderData.total_price || 0);
      const targetLink = currentOrderData.targetLink || currentOrderData.target_link || "";
      const quantity = currentOrderData.quantity;

      if (!serviceId) {
        throw new Error("Missing required field: service_id");
      }

      // 1. Direct live check of user balance from Turso Cloud Database & Local Storage
      console.log(`[TRANSMIT] Checking live balance for order ${orderId} (User ID: ${userId}, Amount: ₹${orderAmount})`);
      
      let userDocData: any = null;
      let liveBalance = 0;
      let userFound = false;

      // 1. Check Turso Cloud Database FIRST (Authoritative Cloud Source)
      try {
        const tursoUser = await tursoGetDoc("users", userId);
        if (tursoUser && (tursoUser.balance !== undefined || tursoUser.walletBalance !== undefined)) {
          userDocData = tursoUser;
          userFound = true;
          liveBalance = Number(tursoUser.balance ?? tursoUser.walletBalance ?? 0);
          console.log(`[TURSO-BALANCE-CHECK] Found user ${userId} in Turso with balance ₹${liveBalance}`);
        }
      } catch (tursoErr: any) {
        console.warn(`[TURSO-BALANCE-CHECK] Turso check warning: ${tursoErr.message}`);
      }

      // 1.1 Check Turso by email if not found by ID
      if (!userFound && currentOrderData?.userEmail) {
        try {
          const client = getTursoClient();
          if (client) {
            const res = await client.execute({
              sql: "SELECT * FROM smm_users WHERE LOWER(email) = LOWER(?) LIMIT 1;",
              args: [String(currentOrderData.userEmail).trim()]
            });
            if (res.rows.length > 0) {
              const row: any = res.rows[0];
              const parsed = row.data ? JSON.parse(row.data) : row;
              userDocData = parsed;
              userFound = true;
              liveBalance = Number(parsed.balance ?? parsed.walletBalance ?? 0);
              console.log(`[TURSO-BALANCE-EMAIL] Found user by email in Turso with balance ₹${liveBalance}`);
            }
          }
        } catch (e) {}
      }

      // 2. Fallback: Local database lookup (100% resilient)
      if (!userFound) {
        try {
          const lUser = getLocalDoc("users", userId) || (currentOrderData.userEmail ? getLocalDoc("users", currentOrderData.userEmail) : null);
          if (lUser) {
            userDocData = lUser;
            userFound = true;
            liveBalance = Number(lUser.balance ?? lUser.walletBalance ?? 0);
          }
        } catch (e) {}
      }

      // 3. Fallback: Firebase Admin SDK
      if (!userFound && !useRestFallback && adminSdkSucceeded) {
        try {
          const directUserSnap = await fdb.collection("users").doc(userId).get();
          if (directUserSnap.exists) {
            userDocData = directUserSnap.data();
            userFound = true;
            liveBalance = Number(userDocData.balance ?? userDocData.walletBalance ?? userDocData.wallet_balance ?? 0);
          }
        } catch (e: any) {
          console.warn(`[DIRECT-BALANCE] Admin SDK direct get error: ${e.message}`);
        }
      }

      // 4. Fallback: Direct Firestore REST get
      if (!userFound) {
        try {
          const restSnap = await getDocREST("users", userId);
          if (restSnap && restSnap.exists) {
            userDocData = restSnap.data();
            userFound = true;
            liveBalance = Number(userDocData.balance ?? userDocData.walletBalance ?? userDocData.wallet_balance ?? 0);
          }
        } catch (e: any) {
          console.warn(`[DIRECT-BALANCE] REST direct get error: ${e.message}`);
        }
      }

      // Fallback: Memory cache
      if (!userFound && serverCache.users.has(userId)) {
        const cached = serverCache.users.get(userId);
        if (cached && (cached.data || cached.balance !== undefined)) {
          userDocData = cached.data || cached;
          userFound = true;
          liveBalance = Number(userDocData.balance ?? userDocData.walletBalance ?? 0);
        }
      }

      // Fallback: By email match in memory or initial users
      if (!userFound && currentOrderData?.userEmail) {
        const emailLower = String(currentOrderData.userEmail).toLowerCase().trim();
        for (const [id, uObj] of serverCache.users.entries()) {
          const u = uObj?.data || uObj;
          if (u && (u.email?.toLowerCase() === emailLower || u.userEmail?.toLowerCase() === emailLower)) {
            userDocData = u;
            userFound = true;
            liveBalance = Number(u.balance ?? u.walletBalance ?? 0);
            break;
          }
        }
      }

      if (!userFound) {
        // Default uninitialized user balance must be 0 (never grant automatic funds)
        const fallbackBal = 0;
        userDocData = { uid: userId, email: currentOrderData?.userEmail || "", balance: fallbackBal };
        userFound = true;
        liveBalance = fallbackBal;
        try {
          setLocalDoc("users", userId, userDocData);
          serverCache.users.set(userId, { data: userDocData, time: Date.now() });
        } catch (e) {}
      }

      const isAlreadyDeducted = currentOrderData?.balanceAlreadyDeducted || false;

      // ATOMIC BALANCE VERIFICATION & DIRECT DEDUCTION IN FIREBASE BEFORE PROVIDER TRANSMISSION
      if (!isAlreadyDeducted && orderAmount > 0) {
        if (liveBalance < orderAmount) {
          console.log(`[ORDER-REJECT-BALANCE] User ${userId} has insufficient live balance in Firebase: ₹${liveBalance} < required ₹${orderAmount}`);
          const lowBalErr: any = new Error(`Insufficient balance! Your wallet balance is ₹${liveBalance.toFixed(2)}, but this order requires ₹${orderAmount.toFixed(2)}. Please recharge your wallet.`);
          lowBalErr.currentBalance = liveBalance;
          lowBalErr.statusCode = 400;
          throw lowBalErr;
        }

        // Deduct upfront directly in Firebase Firestore so no subsequent order from website or app can reuse the same funds!
        const newBalance = Math.max(0, Number((liveBalance - orderAmount).toFixed(2)));
        console.log(`[FIREBASE-DIRECT-DEDUCT] Deducting ₹${orderAmount} from User ${userId} in Firebase. Live balance: ₹${liveBalance} -> ₹${newBalance}`);

        let directDeductSuccess = false;
        if (!useRestFallback && adminSdkSucceeded) {
          try {
            await fdb.collection("users").doc(userId).set({
              balance: newBalance,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            directDeductSuccess = true;
          } catch (e: any) {
            console.warn(`[FIREBASE-DIRECT-DEDUCT] Admin SDK write failed: ${e.message}`);
          }
        }

        if (!directDeductSuccess) {
          try {
            const ok = await setDocREST("users", userId, { balance: newBalance, updatedAt: new Date().toISOString() });
            if (ok) directDeductSuccess = true;
          } catch (e: any) {
            console.warn(`[FIREBASE-DIRECT-DEDUCT] REST write failed: ${e.message}`);
          }
        }

        // Immediately update Turso Cloud Database, localDb, and RAM cache
        const updatedUserData = {
          ...(userDocData || { uid: userId }),
          balance: newBalance,
          updatedAt: new Date().toISOString()
        };
        setLocalDoc("users", userId, updatedUserData);
        tursoSetDoc("users", userId, updatedUserData).catch((err: any) => {
          console.warn(`[TURSO-BALANCE-DEDUCT-WARN] Failed to write new balance to Turso:`, err.message);
        });
        serverCache.users.set(userId, { data: updatedUserData, time: Date.now() });
        savePersistentCache();

        currentOrderData.balanceAlreadyDeducted = true;
        currentOrderData.deductedAmount = orderAmount;
        currentOrderData.newBalance = newBalance;
        currentOrderData.previousBalance = liveBalance;
      }

      // Fetch Settings and Course (cached to avoid redundant reads)
      let [sS, cS] = await Promise.all([
        getDocSafe("settings", "payment", token),
        getDocSafe("courses", serviceId, token)
      ]);

      if (!cS || !cS.exists) {
        const serviceAlt = await getDocSafe("services", serviceId, token);
        if (serviceAlt && serviceAlt.exists) cS = serviceAlt;
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

        if (!pData) {
          try {
            const client = getTursoClient();
            if (client) {
              const pRes = await client.execute({
                sql: `SELECT * FROM smm_providers WHERE id = ? LIMIT 1;`,
                args: [c.providerId]
              });
              if (pRes.rows.length > 0) {
                const r: any = pRes.rows[0];
                pData = {
                  id: r.id,
                  name: r.name,
                  apiUrl: r.api_url || r.apiUrl,
                  apiKey: r.api_key || r.apiKey
                };
              }
            }
          } catch (tErr) {}
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

      // Fallback provider key resolution only if pKey was not already resolved from database provider
      if (!pKey) {
        const checkStr = `${c.providerId || ""} ${providerName || ""} ${pUrl || ""} ${c.title || ""}`.toLowerCase();
        if (checkStr.includes("wholesale") || c.providerId === "talVdnSEg8QGpNVpaUTi" || c.providerId === "BjKqhBjQkzJ6y1GIYf5R") {
          pUrl = "https://wholesalesmmstore.com/api/v2";
          pKey = "e88f2599c82bf15a44b759e61f63673ceae954b8";
          providerName = "Wholesale Smm Store";
        } else if (checkStr.includes("main smm") || checkStr.includes("themainsmm") || c.providerId === "3eaZMZbSKVvMUbRI4kei" || c.providerId === "z4luhVVgYKgHULKPXj8j" || c.providerId === "k7IIPgA8QcpGmZGul3Pw") {
          pUrl = "https://themainsmmprovider.com/api/v2";
          pKey = "a10c05a0cacf6ed5c83b55e374e690495b727586";
          providerName = "The main smm provider ♥️♥️";
        } else if (checkStr.includes("smm bin") || checkStr.includes("smmbin") || c.providerId === "z9lfdj7ByNCeGNO6WbGZ" || c.providerId === "GbtZDOMSvSrBPgeRy6aU" || c.providerId === "doc_1791067476261_cjt5c") {
          pUrl = "https://www.smmbin.com/api/v2";
          pKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
          providerName = "Smm bin (Primary)";
        } else if (checkStr.includes("mainsmmpanel") || checkStr.includes("main smm panel") || c.providerId === "1RmzJhc5ZeyOCU23uZMy") {
          pUrl = "https://mainsmmpanel.in/api/v2";
          pKey = "5a2749e1fdafdf50cd81f2137f9b5806";
          providerName = "MainSMMpanel ♥️";
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

      // 4. Target Link (Preserve user's exact input without altering or converting)
      let finalLink = String(targetLink || "").trim();

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
              timeout: 15000
            });

            if (subRes.data && (subRes.data.order || subRes.data.id)) {
              const subOrderId = String(subRes.data.order || subRes.data.id);
              comboResults.push({ name: itemName, providerOrderId: subOrderId, serviceId: itemServiceId });
              console.log(`[TRANSMIT-COMBO] Sub-Order "${itemName}" Succeeded -> Provider Order ID #${subOrderId}`);
            } else {
              const errText = subRes.data?.error || subRes.data?.message || JSON.stringify(subRes.data);
              comboErrors.push(`${itemName}: ${errText}`);
              console.warn(`[TRANSMIT-COMBO] Sub-Order "${itemName}" warning: ${errText}`);
            }
          } catch (subErr: any) {
            const errText = subErr.response?.data?.error || subErr.response?.data?.message || subErr.message;
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

          return { success: true, providerOrderId: combinedProviderOrderId, newBalance: currentOrderData?.newBalance };
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

      // Configure providers to attempt. Primary provider first.
      const candidateProviders: Array<{ url: string; key: string; name: string }> = [];

      // 1. Primary provider
      if (pUrl && pKey) {
        candidateProviders.push({ url: pUrl, key: pKey, name: providerName });
        // If smmbin, also try canonical domain
        if (pUrl.includes("smmbin.com")) {
          const altUrl = pUrl.includes("www.") ? pUrl.replace("www.", "") : pUrl.replace("://", "://www.");
          candidateProviders.push({ url: altUrl, key: pKey, name: "Smm bin (Alt)" });
        }
      }

      // 2. Default active SMM Bin if primary was missing or different
      if (!pUrl.includes("smmbin.com")) {
        candidateProviders.push({
          url: "https://www.smmbin.com/api/v2",
          key: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
          name: "Smm bin (Primary)"
        });
      }

      // Deduplicate by URL
      const uniqueProviders = Array.from(new Map(candidateProviders.map(p => [p.url, p])).values());

      let finalResData: any = null;
      let finalProviderName = providerName;
      let successfulProviderUrl = "";
      let primaryProviderError = "";

      for (let pIdx = 0; pIdx < uniqueProviders.length; pIdx++) {
        const prov = uniqueProviders[pIdx];
        console.log(`[TRANSMIT] Trying provider "${prov.name}" (${prov.url}) for order ${orderId} (Service: ${resolvedProviderServiceId})`);
        const params = new URLSearchParams();
        params.append("key", prov.key);
        params.append("action", "add");
        params.append("service", resolvedProviderServiceId);
        params.append("link", finalLink);
        params.append("quantity", String(quantity).trim());

        let attempts = 0;
        let provSuccess = false;
        let provData: any = null;

        while (attempts < 2 && !provSuccess) {
          try {
            attempts++;
            let targetUrl = prov.url;
            if (!targetUrl.includes("/api/") && !targetUrl.endsWith("/api/v2")) {
              const cleanedBase = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
              if (attempts === 2) targetUrl = `${cleanedBase}/api/v2`;
            }

            const response = await axios.post(targetUrl, params.toString(), {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
              },
              timeout: 20000
            });

            let resD = response.data;
            if (typeof resD === "string") {
              try {
                resD = JSON.parse(resD);
              } catch (e) {
                if (resD.match(/^\d+$/)) resD = { order: resD };
              }
            }
            if (Array.isArray(resD) && resD.length > 0) resD = resD[0];

            const oId = resD?.order || resD?.order_id || resD?.orderid || resD?.orderId || resD?.id || resD?.data?.order;
            const isOk = resD?.status === "success" || resD?.success === true || oId;

            if (isOk) {
              provData = resD;
              provSuccess = true;
              finalProviderName = prov.name;
              successfulProviderUrl = prov.url;
              console.log(`[TRANSMIT-SUCCESS] Provider "${prov.name}" accepted order! Provider Order ID: ${oId}`);
              break;
            } else {
              const errTxt = resD?.error || resD?.message || JSON.stringify(resD);
              console.warn(`[TRANSMIT-REJECT] Provider "${prov.name}" returned error: ${errTxt}`);
              if (!primaryProviderError) {
                primaryProviderError = errTxt;
              }
              // If the provider gave a definitive validation error for this link or balance:
              const lower = String(errTxt || "").toLowerCase();
              if (lower.includes("already in work") || lower.includes("already in progress") || lower.includes("not enough balance") || lower.includes("link") || lower.includes("quantity") || lower.includes("min") || lower.includes("max")) {
                // The issue is with this link or provider balance; do not spam other providers
                break;
              }
            }
          } catch (axiosErr: any) {
            console.warn(`[TRANSMIT-FAIL] Provider "${prov.name}" attempt ${attempts} network error: ${axiosErr.message}`);
            if (!primaryProviderError) {
              primaryProviderError = axiosErr.response?.data?.error || axiosErr.response?.data?.message || axiosErr.message;
            }
          }
        }

        if (provSuccess && provData) {
          finalResData = provData;
          break;
        }

        // If the error was a link-in-work or insufficient balance error on primary, stop failover
        const lowerFirst = String(primaryProviderError || "").toLowerCase();
        if (lowerFirst.includes("already in work") || lowerFirst.includes("already in progress") || lowerFirst.includes("not enough balance")) {
          break;
        }
      }

      if (!finalResData) {
        let cleanReason = primaryProviderError || "Provider did not accept the order.";
        const lowerReason = cleanReason.toLowerCase();
        if (lowerReason.includes("current link already in work") || lowerReason.includes("already in work") || lowerReason.includes("already in progress")) {
          cleanReason = "Current link already in work! Please wait for the previous order on this link to finish, or use a different post link.";
        } else if (lowerReason.includes("not enough balance") || lowerReason.includes("low balance")) {
          cleanReason = "Provider panel has low balance. Please notify admin to recharge.";
        } else if (lowerReason.includes("incorrect api key") || lowerReason.includes("user disabled")) {
          cleanReason = "Provider API key configuration error. Please update provider settings in Admin.";
        }
        console.error(`[TRANSMIT] Order ${orderId} rejected: ${cleanReason}`);
        
        if (!skipStoreCompleted) {
          await updateDocSafe("orders", orderId, {
            status: "Failed",
            needsProviderTransmission: false,
            providerTransmissionStatus: "failed",
            error: cleanReason,
            updatedAt: new Date().toISOString()
          });
        }
        await refundIfDeducted(userId, orderId, orderAmount);
        return { success: false, error: cleanReason, statusCode: 400 };
      }

      let resData = finalResData;
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

        const price = Number(currentOrderData.totalPrice || currentOrderData.total_price || 0);
        const oUserId = currentOrderData.userId || currentOrderData.user_id;
        const alreadyDeducted = currentOrderData?.balanceAlreadyDeducted || false;

        // Synchronously deduct balance in Firestore and memory cache (if not already deducted upfront)
        let updatedUserBal: number | undefined = currentOrderData.newBalance;
        if (oUserId && price > 0 && !alreadyDeducted) {
          console.log(`[DEDUCTION-START] Synchronously deducting ₹${price} from User ${oUserId} for order ${orderId}`);
          try {
            const deductRes: any = await adjustUserBalanceSafe(oUserId, -price, token);
            updatedUserBal = deductRes?.newBalance !== undefined ? deductRes.newBalance : (typeof deductRes === "number" ? deductRes : undefined);
            console.log(`[DEDUCTION-SUCCESS] Deducted ₹${price} from User ${oUserId} in database. New balance: ₹${updatedUserBal}`);
            await logToDb("BALANCE_DEDUCTION", { userId: oUserId, amount: price, orderId, success: true, newBalance: updatedUserBal });
          } catch (deductErr: any) {
            console.error(`[DEDUCTION-FAIL] Error during balance deduction for ${oUserId}:`, deductErr.message);
          }
        }

        // Save completed order document
        if (!skipStoreCompleted && orderId) {
          try {
            await setDocSafe("orders", orderId, {
              id: orderId,
              userId: oUserId || "",
              userEmail: currentOrderData.userEmail || currentOrderData.user_email || "",
              serviceId: currentOrderData.serviceId || currentOrderData.service_id || "",
              courseId: currentOrderData.courseId || currentOrderData.serviceId || "",
              title: currentOrderData.title || currentOrderData.courseTitle || "",
              category: currentOrderData.category || "Other",
              quantity: Number(currentOrderData.quantity || 0),
              targetLink: String(currentOrderData.targetLink || currentOrderData.target_link || "").trim(),
              totalPrice: price,
              isCombo: !!currentOrderData.isCombo,
              comboItems: currentOrderData.comboItems || [],
              status: "Completed",
              providerOrderId: oId,
              needsProviderTransmission: false,
              providerTransmissionStatus: "completed",
              balanceAlreadyDeducted: true,
              updatedAt: new Date().toISOString(),
              createdAt: currentOrderData.createdAt || new Date().toISOString(),
              providerRawResponse: JSON.stringify(resData).substring(0, 800)
            }, token);
          } catch (saveErr: any) {
            console.warn(`[TRANSMIT] Order save warning: ${saveErr.message}`);
          }
        }

        // Maintain rotating latest 10 orders in user document (0 extra reads for Dashboard!)
        if (oUserId) {
          try {
            const uDoc = await getDocSafe("users", oUserId);
            const uData = uDoc?.data ? uDoc.data() : uDoc;
            const existingOrders = Array.isArray(uData?.latestOrders) ? uData.latestOrders : [];
            const newOrderSummary = {
              id: orderId,
              userId: oUserId,
              userEmail: currentOrderData.userEmail || currentOrderData.user_email || "",
              serviceId: currentOrderData.serviceId || currentOrderData.service_id || "",
              courseId: currentOrderData.courseId || currentOrderData.serviceId || "",
              title: currentOrderData.title || currentOrderData.courseTitle || "",
              category: currentOrderData.category || "Other",
              quantity: Number(currentOrderData.quantity || 0),
              targetLink: String(currentOrderData.targetLink || currentOrderData.target_link || "").trim(),
              totalPrice: price,
              status: "Completed",
              providerOrderId: oId,
              createdAt: currentOrderData.createdAt || new Date().toISOString()
            };
            const updatedLatestOrders = [
              newOrderSummary,
              ...existingOrders.filter((o: any) => o && o.id !== orderId && o.providerOrderId !== oId)
            ].slice(0, 10);

            await updateDocSafe("users", oUserId, {
              latestOrders: updatedLatestOrders,
              lastOrderedAt: new Date().toISOString()
            });
          } catch (ordSyncErr) {}
        }

        if (updatedUserBal === undefined && oUserId) {
          if (serverCache.users.has(oUserId)) {
            const cachedData = serverCache.users.get(oUserId)?.data || serverCache.users.get(oUserId);
            if (typeof cachedData?.balance === "number") {
              updatedUserBal = cachedData.balance;
            }
          }
        }

        return { success: true, providerOrderId: oId, newBalance: updatedUserBal };
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
        
        if (lowerErr.includes("current link already in work") || lowerErr.includes("link already in work") || lowerErr.includes("link is already in work") || lowerErr.includes("link is already in progress")) {
          finalErrorStr = "Current link already in work";
        } else if (lowerErr.includes("server error has occurred") || lowerErr.includes("server error") || lowerErr.includes("a server error")) {
          finalErrorStr = `Provider Panel Error: SMM Provider panel ne server error diya (500). Kripya Admin -> Providers mein Provider API URL, Key aur Service ID (${resolvedProviderServiceId}) check karein.`;
        } else if (lowerErr.includes("not enough balance") || lowerErr.includes("insufficient balance") || lowerErr.includes("out of funds") || lowerErr.includes("low balance")) {
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
        return { 
          success: false, 
          error: finalErrorStr,
          currentBalance: currentOrderData?.newBalance,
          newBalance: currentOrderData?.newBalance,
          statusCode: 400
        };
      }
    } catch (e: any) {
      console.error(`[TRANSMIT] Severe Exception: ${e.message}`);
      if (e.statusCode === 400 && e.currentBalance !== undefined) {
        // Insufficient balance directly from Firebase, do not write a failed order doc (saves quota)
        return { success: false, error: e.message, currentBalance: e.currentBalance, statusCode: 400 };
      }

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
      return { 
        success: false, 
        error: e.message || "Unknown internal processing error",
        statusCode: e.statusCode || 400,
        currentBalance: e.currentBalance 
      };
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
      const b = req.body || {};
      const orderData = b.orderData || {};
      const payload = b.payload || {};
      const customFields = payload.customFields || b.customFields || {};

      const final_user_id = String(
        b.userId || b.user_id || 
        orderData.userId || orderData.user_id || 
        customFields.userId || 
        (req as any).user?.uid || ""
      ).trim();

      const final_user_email = String(
        b.userEmail || b.user_email || 
        orderData.userEmail || orderData.user_email || 
        customFields.userEmail || ""
      ).trim();

      const final_service_id = String(
        b.serviceId || b.service_id || b.courseId || 
        orderData.serviceId || orderData.courseId || 
        payload.service || b.service || ""
      ).trim();

      const final_title = String(
        b.title || b.courseTitle || 
        orderData.title || orderData.courseTitle || ""
      ).trim();

      const final_category = String(b.category || orderData.category || "Other").trim();

      const final_target_link = String(
        b.targetLink || b.target_link || b.link || 
        orderData.targetLink || orderData.target_link || 
        payload.link || ""
      ).trim();

      const rawTotalPrice = 
        b.totalPrice !== undefined ? b.totalPrice : 
        b.total_price !== undefined ? b.total_price : 
        orderData.totalPrice !== undefined ? orderData.totalPrice : 
        orderData.total_price !== undefined ? orderData.total_price : 
        customFields.totalPrice !== undefined ? customFields.totalPrice : 0;
      const final_total_price = Math.max(0, Number(rawTotalPrice) || 0);

      const rawQuantity = b.quantity || orderData.quantity || payload.quantity || 1;
      const final_quantity = Math.max(1, Number(rawQuantity) || 1);

      const isCombo = !!(b.isCombo ?? orderData.isCombo ?? false);
      const comboItems = Array.isArray(b.comboItems) ? b.comboItems : (Array.isArray(orderData.comboItems) ? orderData.comboItems : []);

      const providerServiceId = String(
        b.providerServiceId || b.provider_service_id || 
        orderData.providerServiceId || orderData.provider_service_id || 
        payload.service || b.service || ""
      ).trim();

      const providerId = String(
        b.providerId || b.provider_id || 
        orderData.providerId || orderData.provider_id || ""
      ).trim();

      let orderId = b.orderId || b.id || orderData.orderId || orderData.id;
      const skipStoreCompleted = b.skipStoreCompleted || orderData.skipStoreCompleted || false;

      if (!orderId) {
        orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      }

      console.log(`[HTTP Proxy] Order transmission call received for order: ${orderId} (User: ${final_user_id}, Price: ₹${final_total_price}, Amount: ${final_quantity})`);

      const payloadData = {
        userId: final_user_id,
        user_id: final_user_id,
        userEmail: final_user_email,
        user_email: final_user_email,
        serviceId: final_service_id,
        courseId: final_service_id,
        title: final_title,
        category: final_category,
        quantity: final_quantity,
        targetLink: final_target_link,
        target_link: final_target_link,
        link: final_target_link,
        totalPrice: final_total_price,
        total_price: final_total_price,
        isCombo: isCombo,
        comboItems: comboItems,
        status: "Pending",
        providerServiceId: providerServiceId,
        providerId: providerId
      };

      const userToken = (req.headers.authorization as string) || "";

      // 1. Dispatch synchronous transmission to SMM provider panel with per-user mutex lock
      // to ensure concurrent orders from multiple devices (e.g. website + mobile app) do not double-spend
      const result = await withUserOrderLock(final_user_id, async () => {
        return await transmitOrderToProviderDirect(orderId, payloadData, skipStoreCompleted, userToken);
      });

      // 2. Return response to user
      if (result.success) {
        return res.json({ 
          success: true, 
          isAsync: false, 
          providerOrderId: result.providerOrderId, 
          orderId,
          newBalance: result.newBalance
        });
      } else {
        const statusCode = result.statusCode || 400;
        return res.status(statusCode).json({ 
          success: false, 
          error: result.alreadyProcessing ? "Processing in-progress..." : result.error, 
          orderId,
          currentBalance: result.currentBalance,
          newBalance: result.newBalance
        });
      }

    } catch (e: any) {
      console.error(`[HTTP Proxy] Severe endpoint exception: ${e.message}`);
      const status = e.statusCode && e.statusCode < 500 ? e.statusCode : 400;
      return res.status(status).json({ 
        success: false, 
        error: e.message || "Failed to process order. Please check service and link.", 
        currentBalance: e.currentBalance,
        orderId: req.body?.orderId || "ord_" + Date.now() 
      });
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
          // 1. Check local db
          try {
            const lDoc = getLocalDoc("providers", providerId);
            if (lDoc) {
              if (!pUrl) pUrl = (lDoc.apiUrl || lDoc.api_url || lDoc.providerApiUrl || lDoc.url || "").trim();
              if (!pKey) pKey = (lDoc.apiKey || lDoc.api_key || lDoc.providerApiKey || lDoc.key || "").trim();
            }
          } catch (e) {}

          // 2. Check serverCache
          if (!pKey && serverCache.providers.has(providerId)) {
            const d = serverCache.providers.get(providerId)?.data;
            if (d) {
              if (!pUrl) pUrl = (d.apiUrl || d.api_url || d.providerApiUrl || d.url || "").trim();
              if (!pKey) pKey = (d.apiKey || d.api_key || d.providerApiKey || d.key || "").trim();
            }
          }

          // 3. Check persistent_cache.json
          if (!pKey && fs.existsSync("persistent_cache.json")) {
            try {
              const raw = fs.readFileSync("persistent_cache.json", "utf-8");
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.providers)) {
                for (const [id, val] of parsed.providers) {
                  if (id === providerId && val?.data) {
                    if (!pUrl) pUrl = (val.data.apiUrl || val.data.api_url || "").trim();
                    if (!pKey) pKey = (val.data.apiKey || val.data.api_key || "").trim();
                    break;
                  }
                }
              }
            } catch (e) {}
          }

          // 4. Safe lookup from Firestore
          if (!pKey) {
            try {
              const pS = await getDocSafe("providers", providerId, req.headers.authorization as string, true);
              if (pS.exists) {
                const data = pS.data() || {};
                if (!pUrl) pUrl = (data.apiUrl || data.api_url || data.providerApiUrl || data.url || "").trim();
                if (!pKey) pKey = (data.apiKey || data.api_key || data.providerApiKey || data.key || "").trim();
              }
            } catch (e) {}
          }
        }
        
        if (!pUrl || !pKey) {
          const sS = await getDocSafe("settings", "payment", req.headers.authorization as string, true);
          const data = sS.data() || {};
          if (!pUrl) pUrl = (data.providerApiUrl || data.apiUrl || data.api_url || data.provider_api_url || "").trim();
          if (!pKey) pKey = (data.providerApiKey || data.apiKey || data.api_key || data.provider_api_key || "").trim();
        }

        // Fallback: Check all cached providers
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

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", async () => {
      console.log(`[READY] Server running on http://localhost:${PORT}`);
      try {
        await getLocalSqliteDb();
        console.log("[SQLITE] Local SQLite database successfully initialized and ready!");
        migrateAllFromFirebase().then((res) => {
          console.log("[MIGRATION-COMPLETE]", JSON.stringify(res.migrated));
        }).catch((err) => {
          console.warn("[MIGRATION-WARN]", err.message);
        });
      } catch (e: any) {
        console.error("[SQLITE-INIT-ERR]", e.message);
      }
      // Auto-start Telegram bot polling on startup if enabled
      try {
        initTelegramBotService();
        startTelegramPolling().then((res) => {
          console.log("[TELEGRAM-BOOT-AUTOSTART]", res.message);
        }).catch((e) => {
          console.warn("[TELEGRAM-BOOT-WARN]", e.message);
        });
      } catch (err: any) {
        console.warn("[TELEGRAM-INIT-WARN]", err.message);
      }
    });
  }
}

startServer().catch(console.error);
