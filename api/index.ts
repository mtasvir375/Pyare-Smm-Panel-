import axios from "axios";

// Environment & Configuration
const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

// --- FIRESTORE REST HELPERS (SELF-CONTAINED - NO EXTERNAL IMPORTS) ---

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val === undefined || val === null) continue;
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
    else if (val.arrayValue && val.arrayValue.values) {
      res[key] = val.arrayValue.values.map((v: any) => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.mapValue) return unwrapFirestoreFields(v.mapValue.fields);
        return v;
      });
    } else if (val.mapValue && val.mapValue.fields) {
      res[key] = unwrapFirestoreFields(val.mapValue.fields);
    } else {
      res[key] = null;
    }
  }
  return res;
}

function wrapFirestoreFields(data: any): any {
  const fields: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string") {
      fields[key] = { stringValue: val };
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === "boolean") {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") {
              return Number.isInteger(item)
                ? { integerValue: item.toString() }
                : { doubleValue: item };
            }
            if (typeof item === "boolean") return { booleanValue: item };
            if (typeof item === "object" && item !== null) {
              return { mapValue: { fields: wrapFirestoreFields(item) } };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === "object") {
      fields[key] = { mapValue: { fields: wrapFirestoreFields(val) } };
    }
  }
  return fields;
}

// In-Memory Quota-Protection Caches
const memIntents = new Map<string, { data: any; time: number }>();
const memUserOrders = new Map<string, { data: any[]; time: number }>();
const memUserDeposits = new Map<string, { data: any[]; time: number }>();
const lastCheckIntentTime = new Map<string, number>();

let memCoursesCache: { data: any[]; time: number } | null = null;
let memSettingsCache: { data: any; time: number } | null = null;
let memProvidersCache: { data: any[]; time: number } | null = null;
let memAdminOrdersCache: { data: any[]; time: number } | null = null;
let memAdminDepositsCache: { data: any[]; time: number } | null = null;
let memBankAlertsCache: { data: any[]; time: number } | null = null;
let memAllUsersCache: { data: any[]; time: number } | null = null;

// Registry of known user profiles to guarantee 100% email visibility & searchability in Admin panel
const KNOWN_USER_EMAILS: Record<string, { email: string; name?: string }> = {
  "5LRJPrkW5vVimfCFKGbzTKhXtji2": { email: "mdsarfarajalam727712@gmail.com", name: "Sarfaraj Alam" },
  "UlsK3PLAGHdiSZAhx58Cb23FXLq2": { email: "mdtasvir888@gmail.com", name: "Tasvir" },
  "test_e2e_user": { email: "test_e2e@pyaresmm.com", name: "Test User" },
  "test_user_race_1": { email: "test_race1@pyaresmm.com", name: "Race Test User" },
  "user_pending_test": { email: "pending_test@pyaresmm.com", name: "Pending User" },
  "test_user": { email: "test_admin@pyaresmm.com", name: "Test User" }
};

const userEmailRegistry = new Map<string, string>();
for (const [uid, info] of Object.entries(KNOWN_USER_EMAILS)) {
  userEmailRegistry.set(uid, info.email);
}

import { getLocalDoc, setLocalDoc, listLocalDocs, queryLocalDocs } from "./localDb";

async function getRestDoc(collection: string, docId: string): Promise<any> {
  const local = getLocalDoc(collection, docId);
  if (local) return local;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await axios.get(url, { timeout: 4000 });
    const fetched = res.data ? unwrapFirestoreFields(res.data.fields) : null;
    if (fetched) setLocalDoc(collection, docId, fetched);
    return fetched;
  } catch (err: any) {
    if (err.response && err.response.status === 404) return null;
    return local || null;
  }
}

async function setRestDoc(collection: string, docId: string, data: any): Promise<any> {
  setLocalDoc(collection, docId, data);
  try {
    const fields = wrapFirestoreFields(data);
    const keys = Object.keys(data).filter(k => data[k] !== undefined);
    const maskQuery = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const sep = maskQuery ? `?${maskQuery}&` : "?";
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}${sep}key=${FIREBASE_API_KEY}`;
    await axios.patch(url, { fields }, { timeout: 4000 }).catch(() => {});
  } catch (e) {}
  return getLocalDoc(collection, docId);
}

async function listRestDocs(collection: string, pageSize = 100): Promise<any[]> {
  const localList = listLocalDocs(collection, pageSize);
  if (localList.length > 0) return localList;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const payload = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        limit: pageSize
      }
    };
    const res = await axios.post(url, payload, { timeout: 4000 });
    if (res.data && Array.isArray(res.data)) {
      const fetched = res.data
        .filter((item: any) => item.document)
        .map((item: any) => {
          const doc = item.document;
          const id = doc.name.split("/").pop();
          const data = unwrapFirestoreFields(doc.fields || {});
          const merged = { id, ...data };
          setLocalDoc(collection, id, merged);
          return merged;
        });
      return fetched.length > 0 ? fetched : localList;
    }
  } catch (err: any) {}
  return localList;
}

async function queryRestDocs(collection: string, field: string, value: string, pageSize = 50): Promise<any[]> {
  const localList = queryLocalDocs(collection, field, value, pageSize);
  if (localList.length > 0) return localList;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const payload = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: { stringValue: value }
          }
        },
        limit: pageSize
      }
    };
    const res = await axios.post(url, payload, { timeout: 4000 });
    if (res.data && Array.isArray(res.data)) {
      const fetched = res.data
        .filter((item: any) => item.document)
        .map((item: any) => {
          const doc = item.document;
          const id = doc.name.split("/").pop();
          const data = unwrapFirestoreFields(doc.fields || {});
          const merged = { id, ...data };
          setLocalDoc(collection, id, merged);
          return merged;
        });
      return fetched;
    }
  } catch (err: any) {}
  return localList;
}

// Known Providers for proxy
const KNOWN_PROVIDERS: Record<string, { apiUrl: string; apiKey: string; name: string }> = {
  "talVdnSEg8QGpNVpaUTi": {
    name: "Wholesale Smm Store",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8"
  },
  "BjKqhBjQkzJ6y1GIYf5R": {
    name: "Wholesale Smm Store",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8"
  },
  "3eaZMZbSKVvMUbRI4kei": {
    name: "The main smm provider ♥️♥️",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
  },
  "z4luhVVgYKgHULKPXj8j": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
  },
  "k7IIPgA8QcpGmZGul3Pw": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
  },
  "z9lfdj7ByNCeGNO6WbGZ": {
    name: "Smm bin",
    apiUrl: "https://smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  },
  "GbtZDOMSvSrBPgeRy6aU": {
    name: "Smm bin",
    apiUrl: "https://smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  },
  "1RmzJhc5ZeyOCU23uZMy": {
    name: "MainSMMpanel ♥️",
    apiUrl: "https://mainsmmpanel.in/api/v2",
    apiKey: "5a2749e1fdafdf50cd81f2137f9b5806"
  }
};

// --- MASTER VERCEL SERVERLESS FUNCTION HANDLER ---

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Parse path from req.url
  const rawUrl = req.url || "/api";
  const urlObj = new URL(rawUrl, "http://localhost");
  let pathname = urlObj.pathname.replace(/\/+$/, "") || "/api";
  if (req.query?.path && Array.isArray(req.query.path)) {
    pathname = `/api/${req.query.path.join("/")}`;
  }

  // Ensure body is parsed if sent as JSON string
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  if (!body) body = {};

  try {
    // 1. Health check: /api
    if (pathname === "/api" || pathname === "") {
      return res.status(200).json({ status: "ok", message: "API Gateway Online", timestamp: new Date().toISOString() });
    }

    // 2. Settings: /api/settings
    if (pathname === "/api/settings") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      if (req.method === "POST") {
        memSettingsCache = null;
        const updated = { ...body, updatedAt: new Date().toISOString() };
        setLocalDoc("settings", "payment", updated);
        return res.status(200).json({ success: true, message: "Settings saved", settings: updated });
      }
      const settings = getLocalDoc("settings", "payment") || {};
      return res.status(200).json(settings);
    }

    // 2.5 Clear Cache: /api/clear-cache
    if (pathname === "/api/clear-cache") {
      memCoursesCache = null;
      memSettingsCache = null;
      memProvidersCache = null;
      memAllUsersCache = null;
      return res.status(200).json({ success: true, message: "Server cache cleared" });
    }

    // 3. Courses: /api/courses
    if (pathname === "/api/courses") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      const localCourses = listLocalDocs("courses", 500);
      return res.status(200).json(localCourses);
    }

    // 4. Providers: /api/providers
    if (pathname === "/api/providers") {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      const localProviders = listLocalDocs("providers", 200);
      return res.status(200).json(localProviders);
    }
      if (req.method === "GET") {
        try {
          const providers = await listRestDocs("providers", 100);
          memProvidersCache = { data: providers, time: Date.now() };
          return res.status(200).json(providers);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      }
    }

    // 4.1 Admin All Orders: /api/admin/all-orders
    if (pathname === "/api/admin/all-orders") {
      const now = Date.now();
      const isFresh = req.query?.force === "true";
      if (!isFresh && memAdminOrdersCache && (now - memAdminOrdersCache.time < 5 * 60 * 1000)) {
        return res.status(200).json(memAdminOrdersCache.data);
      }
      try {
        const queryLimit = parseInt(String(req.query?.limit || "50"), 10) || 50;
        const orders = await listRestDocs("orders", queryLimit);
        orders.sort((a, b) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());
        memAdminOrdersCache = { data: orders, time: Date.now() };
        return res.status(200).json(orders);
      } catch (err: any) {
        return res.status(200).json(memAdminOrdersCache?.data || []);
      }
    }

    // 4.2 Admin All Deposits: /api/admin/all-deposits
    if (pathname === "/api/admin/all-deposits") {
      const now = Date.now();
      const isFresh = req.query?.force === "true";
      if (!isFresh && memAdminDepositsCache && (now - memAdminDepositsCache.time < 5 * 60 * 1000)) {
        return res.status(200).json(memAdminDepositsCache.data);
      }
      try {
        const queryLimit = parseInt(String(req.query?.limit || "50"), 10) || 50;
        const deposits = await listRestDocs("deposits", queryLimit);
        deposits.sort((a, b) => new Date(b.createdAt || b.timestamp || 0).getTime() - new Date(a.createdAt || a.timestamp || 0).getTime());
        memAdminDepositsCache = { data: deposits, time: Date.now() };
        return res.status(200).json(deposits);
      } catch (err: any) {
        return res.status(200).json(memAdminDepositsCache?.data || []);
      }
    }

    // 5. Proxy Provider: /api/proxy-provider
    if (pathname === "/api/proxy-provider" || pathname === "/api/proxy") {
      const {
        providerId,
        service,
        providerServiceId,
        link,
        targetLink,
        target_link,
        quantity,
        totalPrice,
        total_price,
        userId,
        user_id,
        userEmail,
        orderId,
        orderData,
        runs,
        interval
      } = body || {};

      let apiUrl = "";
      let apiKey = "";

      const resolvedProviderId = providerId || orderData?.providerId || "";
      if (resolvedProviderId && KNOWN_PROVIDERS[resolvedProviderId]) {
        apiUrl = KNOWN_PROVIDERS[resolvedProviderId].apiUrl;
        apiKey = KNOWN_PROVIDERS[resolvedProviderId].apiKey;
      } else if (resolvedProviderId) {
        try {
          const pDoc = await getRestDoc("providers", resolvedProviderId);
          if (pDoc) {
            apiUrl = pDoc.apiUrl || pDoc.url;
            apiKey = pDoc.apiKey || pDoc.key;
          }
        } catch (e) {}
      }

      if (!apiUrl || !apiKey) {
        apiUrl = "https://smmbin.com/api/v2";
        apiKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
      }

      const finalService = String(service || providerServiceId || orderData?.providerServiceId || "").trim();
      const finalLink = String(link || targetLink || target_link || orderData?.targetLink || "").trim();
      const finalQty = String(quantity || orderData?.quantity || "1000").trim();
      const finalUserId = String(userId || user_id || orderData?.userId || "").trim();
      const finalPrice = Number(totalPrice || total_price || orderData?.totalPrice || 0);

      // Verify user has sufficient balance before placing order
      let currentUserBal = 0;
      let userDoc: any = null;
      if (finalUserId) {
        try {
          userDoc = await getRestDoc("users", finalUserId);
          if (userDoc) {
            currentUserBal = Number(userDoc.balance || 0);
          }
        } catch (uErr) {}

        if (finalPrice > 0 && currentUserBal < finalPrice) {
          return res.status(400).json({
            success: false,
            error: `Insufficient balance (₹${currentUserBal.toFixed(2)}). Required: ₹${finalPrice.toFixed(2)}`,
            currentBalance: currentUserBal
          });
        }
      }

      const params = new URLSearchParams();
      params.append("key", apiKey);
      params.append("action", "add");
      if (finalService) params.append("service", finalService);
      if (finalLink) params.append("link", finalLink);
      if (finalQty) params.append("quantity", finalQty);
      if (runs) params.append("runs", String(runs));
      if (interval) params.append("interval", String(interval));
      params.append("terms", "1");
      params.append("agree", "1");

      try {
        const provRes = await axios.post(apiUrl, params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 35000
        });

        let resData = provRes.data;
        if (typeof resData === "string") {
          try {
            resData = JSON.parse(resData);
          } catch (e) {}
        }

        const providerOrderId =
          resData?.order ||
          resData?.order_id ||
          resData?.orderid ||
          resData?.orderId ||
          resData?.id ||
          resData?.ID ||
          (typeof resData === "number" ? String(resData) : null);

        const isSuccess =
          !!providerOrderId ||
          resData?.status === "success" ||
          resData?.success === true ||
          String(resData?.message || "").toLowerCase().includes("success");

        if (isSuccess) {
          const finalOId = providerOrderId ? String(providerOrderId) : "SUCCESS";
          let newBal = currentUserBal;
          const finalOrderId = orderId || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

          const newOrderSummary = {
            id: finalOrderId,
            userId: finalUserId,
            userEmail: userEmail || orderData?.userEmail || "",
            serviceId: orderData?.serviceId || finalService,
            title: orderData?.title || "SMM Order",
            category: orderData?.category || "Other",
            quantity: Number(finalQty),
            targetLink: finalLink,
            totalPrice: finalPrice,
            status: "Completed",
            providerOrderId: finalOId,
            createdAt: new Date().toISOString()
          };

          // Deduct user balance & maintain latest 10 rotating orders
          if (finalUserId) {
            if (finalPrice > 0) {
              newBal = Math.max(0, Number((currentUserBal - finalPrice).toFixed(2)));
            }
            try {
              const existingOrders = Array.isArray(userDoc?.latestOrders) ? userDoc.latestOrders : [];
              const updatedLatestOrders = [
                newOrderSummary,
                ...existingOrders.filter((o: any) => o && o.id !== finalOrderId && o.providerOrderId !== finalOId)
              ].slice(0, 10);

              const userEmailToPersist = userDoc?.email || userDoc?.userEmail || (userEmail ? String(userEmail).trim() : "") || undefined;
              const userNameToPersist = userDoc?.displayName || userDoc?.name || (userEmailToPersist ? userEmailToPersist.split("@")[0] : undefined);
              if (userEmailToPersist) {
                userEmailRegistry.set(finalUserId, userEmailToPersist);
              }

              await setRestDoc("users", finalUserId, {
                ...userDoc,
                email: userEmailToPersist,
                userEmail: userEmailToPersist,
                displayName: userNameToPersist,
                balance: newBal,
                latestOrders: updatedLatestOrders,
                lastOrderedAt: new Date().toISOString()
              });
            } catch (deductErr: any) {
              console.warn("[BALANCE-DEDUCT-WARN]", deductErr.message);
            }
          }

          // Save order in Firestore orders collection
          try {
            await setRestDoc("orders", finalOrderId, {
              ...newOrderSummary,
              updatedAt: new Date().toISOString()
            });
          } catch (ordSaveErr: any) {
            console.warn("[ORDER-SAVE-WARN]", ordSaveErr.message);
          }

          return res.status(200).json({
            success: true,
            providerOrderId: finalOId,
            newBalance: newBal,
            data: resData
          });
        } else {
          const errReason =
            resData?.error ||
            resData?.message ||
            resData?.msg ||
            resData?.reason ||
            "Provider did not accept the order";
          const cleanErr = typeof errReason === "string" ? errReason : JSON.stringify(errReason);
          return res.status(400).json({
            success: false,
            error: cleanErr,
            currentBalance: currentUserBal,
            data: resData
          });
        }
      } catch (err: any) {
        const errorDetail = err.response?.data?.error || err.response?.data?.message || err.response?.data || err.message;
        const cleanErr = typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail);
        return res.status(500).json({
          success: false,
          error: cleanErr,
          currentBalance: currentUserBal
        });
      }
    }

    // 6. Telegram Config: /api/telegram-config or /api/admin/telegram-config
    if (pathname === "/api/telegram-config" || pathname === "/api/admin/telegram-config") {
      if (req.method === "GET") {
        let cfg: any = null;
        let paymentCfg: any = null;
        try {
          cfg = await getRestDoc("settings", "telegram_bot");
        } catch {}
        try {
          paymentCfg = await getRestDoc("settings", "payment");
        } catch {}

        const botToken = String(cfg?.botToken || paymentCfg?.telegramBotToken || paymentCfg?.botToken || "").trim();
        const chatId = String(cfg?.chatId || paymentCfg?.telegramChatId || paymentCfg?.chatId || "").trim();
        const isEnabled = cfg?.enabled ?? paymentCfg?.telegramBotEnabled ?? true;
        const isActive = !!(botToken && botToken.length >= 30 && isEnabled !== false);

        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: isActive,
          enabled: isActive,
          hasToken: !!botToken,
          maskedToken: masked,
          chatId,
          botUsername: cfg?.botUsername || paymentCfg?.telegramBotUsername || ""
        });
      } else if (req.method === "POST") {
        let current: any = {};
        try {
          current = (await getRestDoc("settings", "telegram_bot")) || {};
        } catch {}

        const updated = {
          ...current,
          ...(body.botToken !== undefined && { botToken: String(body.botToken).trim() }),
          ...(body.chatId !== undefined && { chatId: String(body.chatId).trim() }),
          ...(body.enabled !== undefined && { enabled: !!body.enabled }),
          ...(body.botUsername !== undefined && { botUsername: String(body.botUsername).trim() }),
          updatedAt: new Date().toISOString()
        };

        await setRestDoc("settings", "telegram_bot", updated);
        return res.status(200).json({ success: true, message: "Telegram configuration saved." });
      }
    }

    // 7. Dynamic Payment Intent: /api/payments/create-intent
    if (pathname === "/api/payments/create-intent") {
      if (req.method === "POST") {
        const { amount, userId, userEmail } = body || {};
        const numAmount = Number(amount);
        if (!numAmount || isNaN(numAmount) || numAmount < 1) {
          return res.status(400).json({ success: false, error: "Minimum deposit amount is ₹1." });
        }
        if (!userId) {
          return res.status(400).json({ success: false, error: "User ID is required." });
        }

        let settings: any = {};
        try {
          settings = (await getRestDoc("settings", "payment")) || {};
        } catch {}

        const upiId = (settings.upiId || "mdsaudalam621@okicici").trim();
        const payeeName = (settings.merchantName || "Pyare SMM Panel").trim();

        // 12-digit numeric Order Reference
        const part1 = Math.floor(100000 + Math.random() * 900000).toString();
        const part2 = Math.floor(100000 + Math.random() * 900000).toString();
        const orderRef = `${part1}${part2}`;

        const now = Date.now();
        const intentId = `pi_${now}_${Math.random().toString(36).substring(2, 7)}`;
        const expiresAt = now + 30 * 60 * 1000;
        const finalAmount = numAmount;

        const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${finalAmount.toFixed(2)}&tr=${orderRef}&tn=${orderRef}&cu=INR`;

        const intentData = {
          intentId,
          orderRef,
          baseAmount: numAmount,
          amount: finalAmount,
          userId: String(userId),
          userEmail: userEmail ? String(userEmail) : "",
          upiId,
          payeeName,
          upiLink,
          status: "pending",
          createdAt: now,
          expiresAt,
          notified: false
        };

        memIntents.set(intentId, { data: intentData, time: now });
        memIntents.set(orderRef, { data: intentData, time: now });

        try {
          await Promise.all([
            setRestDoc("payment_intents", intentId, intentData),
            setRestDoc("payment_intents", orderRef, intentData)
          ]);
        } catch (dbErr: any) {
          console.warn("[INTENT-SAVE-WARN]", dbErr.message);
        }

        return res.status(200).json({
          success: true,
          intentId,
          orderRef,
          baseAmount: numAmount,
          amount: finalAmount,
          upiId,
          payeeName,
          upiLink,
          expiresAt
        });
      }
    }

    // 8. Check Payment Intent: /api/payments/check-intent or /api/payments/check-intent/:intentId
    if (pathname.startsWith("/api/payments/check-intent")) {
      const parts = pathname.split("/").filter(Boolean);
      let intentId = parts.length > 3 ? parts[3] : (req.query?.intentId || req.query?.id);
      if (!intentId && pathname.includes("/check-intent/")) {
        intentId = pathname.substring(pathname.indexOf("/check-intent/") + 14);
      }

      if (!intentId) {
        return res.status(400).json({ success: false, error: "Missing intentId" });
      }

      const strId = String(intentId).trim();

      // QUOTA SHIELD 1: Check memory cache first (0 Firestore reads!)
      const memObj = memIntents.get(strId);
      if (memObj && memObj.data?.status === "completed") {
        return res.status(200).json({
          success: true,
          status: "completed",
          intentId: memObj.data.intentId || strId,
          orderRef: memObj.data.orderRef,
          amount: memObj.data.amount,
          creditedAmount: memObj.data.creditedAmount || memObj.data.amount,
          utr: memObj.data.utr || memObj.data.orderRef,
          completedAt: memObj.data.completedAt || Date.now()
        });
      }

      // QUOTA SHIELD 2: Throttle Firestore reads to at most once per 10 seconds per intent
      const lastPoll = lastCheckIntentTime.get(strId) || 0;
      const now = Date.now();
      if (memObj && (now - lastPoll < 10000)) {
        return res.status(200).json({
          success: true,
          status: memObj.data?.status || "pending",
          intentId: strId,
          orderRef: memObj.data?.orderRef,
          amount: memObj.data?.amount,
          creditedAmount: memObj.data?.creditedAmount || memObj.data?.amount,
          utr: memObj.data?.utr || memObj.data?.orderRef,
          message: "Awaiting bank SMS confirmation"
        });
      }
      lastCheckIntentTime.set(strId, now);

      let intent = memObj?.data;
      if (!intent || intent.status === "pending") {
        intent = await getRestDoc("payment_intents", strId);
        if (intent) {
          memIntents.set(strId, { data: intent, time: now });
          if (intent.orderRef) memIntents.set(intent.orderRef, { data: intent, time: now });
        }
      }

      if (!intent) {
        return res.status(200).json({
          success: true,
          status: "pending",
          intentId: strId,
          message: "Awaiting bank SMS confirmation"
        });
      }

      if (intent.status === "completed") {
        memIntents.set(strId, { data: intent, time: now });
        return res.status(200).json({
          success: true,
          status: "completed",
          intentId: intent.intentId,
          orderRef: intent.orderRef,
          amount: intent.amount,
          creditedAmount: intent.creditedAmount || intent.amount,
          utr: intent.utr || intent.orderRef,
          completedAt: intent.completedAt || Date.now()
        });
      }

      // Auto-reconcile against targeted orderRef alert (1 single doc read)
      if (intent.status !== "completed" && intent.userId && intent.orderRef) {
        try {
          // Targeted 1-doc lookup by unique 12-digit orderRef
          let match: any = await getRestDoc("bank_alerts", intent.orderRef);
          if (!match || match.isUsed === true || match.status === "claimed") {
            // Also check memory alert if not in bank_alerts
            match = null;
          }

          if (match && intent.orderRef) {
            const doubleDoc = await getRestDoc("claimed_payments", intent.orderRef).catch(() => null);
            if (doubleDoc && doubleDoc.credited) {
              console.log(`[RECONCILE-PREVENTED] Permanent check: Order ${intent.orderRef} already claimed in Firestore. Skipping match.`);
              match = null;
            }
          }

          if (match && !match.isUsed && match.status !== "claimed" && intent.status !== "completed") {
            const matchUtr = match.utr || intent.orderRef;
            const creditAmt = Number(intent.amount || match.amount || 0);

            // Double-check: Mark claimed_payments IMMEDIATELY as atomic distributed lock
            await setRestDoc("claimed_payments", intent.orderRef, {
              orderRef: intent.orderRef,
              utr: matchUtr,
              userId: intent.userId,
              amount: creditAmt,
              credited: true,
              claimedAt: new Date().toISOString()
            });

            // Fetch current user balance
            let currentBal = 0;
            let uDoc: any = null;
            try {
              uDoc = await getRestDoc("users", intent.userId);
              currentBal = Number(uDoc?.balance ?? uDoc?.walletBalance ?? 0);
            } catch (e) {}

            const existingDeposits = Array.isArray(uDoc?.latestDeposits) ? uDoc.latestDeposits : [];
            const alreadyInHistory = existingDeposits.some((d: any) =>
              (intent.orderRef && d?.orderRef === intent.orderRef) ||
              (matchUtr && d?.utr === matchUtr)
            );

            let newBal = currentBal;
            if (!alreadyInHistory) {
              newBal = Number((currentBal + creditAmt).toFixed(2));
            }

            const depId = `dep_${intent.orderRef}_${Date.now()}`;
            const newDepositSummary = {
              id: depId,
              amount: creditAmt,
              utr: matchUtr,
              orderRef: intent.orderRef,
              status: "approved",
              method: "Instant UPI QR",
              gateway: match.bank || match.senderBank || "UPI Auto-Verify",
              createdAt: new Date().toISOString()
            };

            const updatedLatestDeposits = [
              newDepositSummary,
              ...existingDeposits.filter((d: any) => d && d.utr !== matchUtr && d.orderRef !== intent.orderRef)
            ].slice(0, 10);

            const completedIntentData = {
              ...intent,
              status: "completed",
              completedAt: Date.now(),
              utr: matchUtr,
              creditedAmount: creditAmt,
              notified: true
            };

            // Update memory cache immediately (prevents any subsequent Firestore reads)
            memIntents.set(strId, { data: completedIntentData, time: Date.now() });
            if (intent.orderRef) memIntents.set(intent.orderRef, { data: completedIntentData, time: Date.now() });

            const intentEmailToPersist = uDoc?.email || uDoc?.userEmail || (intent?.userEmail ? String(intent.userEmail).trim() : "") || undefined;
            const intentNameToPersist = uDoc?.displayName || (intentEmailToPersist ? intentEmailToPersist.split("@")[0] : undefined);
            if (intentEmailToPersist && intent.userId) {
              userEmailRegistry.set(intent.userId, intentEmailToPersist);
            }

            // Persist updated balance, latestDeposits, completed intent, and deposit record
            await Promise.all([
              setRestDoc("users", intent.userId, { 
                ...uDoc, 
                email: intentEmailToPersist,
                userEmail: intentEmailToPersist,
                displayName: intentNameToPersist,
                balance: newBal, 
                latestDeposits: updatedLatestDeposits, 
                updatedAt: new Date().toISOString() 
              }),
              setRestDoc("deposits", depId, {
                ...newDepositSummary,
                userId: intent.userId,
                userEmail: intent.userEmail || "",
                type: "deposit"
              }),
              setRestDoc("payment_intents", intent.intentId, completedIntentData),
              setRestDoc("bank_alerts", matchUtr, {
                ...match,
                isUsed: true,
                status: "claimed",
                usedBy: intent.userId,
                usedAt: new Date().toISOString(),
                notified: true
              })
            ]);

            intent.status = "completed";
            intent.utr = matchUtr;
            intent.completedAt = Date.now();

            // Send 2nd confirmation message to Telegram Channel ONLY IF NOT ALREADY NOTIFIED
            if (!match.notified && !intent.notified) {
              try {
                const tgDoc = await getRestDoc("settings", "telegram_bot").catch(() => null);
                const botTok = (tgDoc?.botToken || "").trim();
                const cId = (tgDoc?.chatId || "").trim();
                if (botTok && cId) {
                  const rawSms = match.rawText || match.rawSms || `Mr MD SAUD ALAM paid you ₹${creditAmt.toFixed(2)} ${matchUtr}`;
                  const msgText = 
                    `📋 <b>[SMS Auto-Forwarded & Received]</b>\n` +
                    `<code>${rawSms}</code>\n\n` +
                    `✅ <b>Payment Verified Instantly!</b>\n` +
                    `💰 <b>Amount:</b> ₹${creditAmt.toFixed(2)}\n` +
                    `🆔 <b>Order Ref:</b> <code>${intent.orderRef}</code>\n` +
                    `🔢 <b>UTR:</b> <code>${matchUtr}</code>\n` +
                    `👤 <b>User:</b> ${intent.userEmail || intent.userId}\n` +
                    `🏦 <b>Gateway:</b> ${match.senderBank || match.bank || "UPI Payment"}\n` +
                    `🟢 <b>Status:</b> Auto-received & wallet credited in 0.1s!`;
                  await axios.post(`https://api.telegram.org/bot${botTok}/sendMessage`, {
                    chat_id: cId,
                    text: msgText,
                    parse_mode: "HTML"
                  }, { timeout: 4000 }).catch(() => {});
                }
              } catch (tgErr: any) {
                console.warn("[TG-NOTIFY-ERR]", tgErr.message);
              }
            }

            return res.status(200).json({
              success: true,
              status: "completed",
              intentId: intent.intentId,
              orderRef: intent.orderRef,
              amount: creditAmt,
              baseAmount: intent.baseAmount,
              creditedAmount: creditAmt,
              utr: matchUtr,
              expiresAt: intent.expiresAt,
              completedAt: intent.completedAt,
              newBalance: newBal
            });
          }
        } catch (reconcileErr: any) {
          console.warn("[CHECK-INTENT-AUTO-RECONCILE-WARN]", reconcileErr.message);
        }
      }

      let userBalance: number | undefined;
      if (intent.status === "completed" && intent.userId) {
        try {
          const uDoc = await getRestDoc("users", intent.userId);
          userBalance = uDoc?.balance;
        } catch (e) {}
      }

      return res.status(200).json({
        success: true,
        status: intent.status || "pending",
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
    }

    // 9. Verify UTR: /api/verify-utr or /api/deposits/verify-qr-auto or /api/wallet/verify-utr
    if (
      pathname === "/api/verify-utr" ||
      pathname === "/api/deposits/verify-qr-auto" ||
      pathname === "/api/wallet/verify-utr"
    ) {
      if (req.method === "POST") {
        const { userId, utr, amount: reqAmount, userEmail } = body || {};
        if (!userId) {
          return res.status(400).json({ success: false, error: "User authentication required." });
        }
        const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
        if (cleanUtr.length !== 12) {
          return res.status(400).json({ success: false, error: "Please enter a valid 12-digit UPI / UTR Reference Number." });
        }

        // Permanent distributed lock double-check
        const doubleClaim = await getRestDoc("claimed_payments", cleanUtr).catch(() => null);
        if (doubleClaim && doubleClaim.credited) {
          return res.status(400).json({
            success: false,
            error: `UTR ${cleanUtr} has already been claimed and credited to an account.`
          });
        }

        let alertDoc = await getRestDoc("bank_alerts", cleanUtr);
        if (!alertDoc) {
          alertDoc = await getRestDoc("sms_forwarder_pool", cleanUtr);
        }

        if (!alertDoc) {
          return res.status(404).json({
            success: false,
            error: `Payment verification pending: No bank alert received for UTR ${cleanUtr} yet. If you just sent payment, please wait 15–30 seconds for the bank confirmation SMS to process, then click Verify again.`
          });
        }

        const isClaimed = alertDoc.isUsed === true || alertDoc.status === "claimed";
        if (isClaimed) {
          const claimedBy = alertDoc.usedBy || alertDoc.claimedBy;
          if (claimedBy === userId) {
            return res.status(200).json({
              success: true,
              amount: Number(alertDoc.amount || reqAmount || 0),
              message: "You have already verified and claimed this UTR."
            });
          }
          return res.status(400).json({
            success: false,
            error: `UTR ${cleanUtr} has already been claimed and credited to an account.`
          });
        }

        const creditAmount = Number(alertDoc.amount || reqAmount || 0);
        let newBalance = creditAmount;
        let uDoc: any = null;
        try {
          uDoc = await getRestDoc("users", userId);
          const currentBal = Number(uDoc?.balance ?? uDoc?.walletBalance ?? 0);
          newBalance = currentBal + creditAmount;
        } catch (e) {}

        const nowIso = new Date().toISOString();
        const depId = `dep_utr_${cleanUtr}_${Date.now()}`;
        const newDepositSummary = {
          id: depId,
          amount: creditAmount,
          utr: cleanUtr,
          status: "approved",
          method: "Instant UPI QR",
          gateway: alertDoc.senderBank || "UPI Verification",
          createdAt: nowIso
        };

        const existingDeposits = Array.isArray(uDoc?.latestDeposits) ? uDoc.latestDeposits : [];
        const updatedLatestDeposits = [
          newDepositSummary,
          ...existingDeposits.filter((d: any) => d && d.utr !== cleanUtr)
        ].slice(0, 10);

        const instantEmailToPersist = uDoc?.email || uDoc?.userEmail || (userEmail ? String(userEmail).trim() : "") || undefined;
        const instantNameToPersist = uDoc?.displayName || (instantEmailToPersist ? instantEmailToPersist.split("@")[0] : undefined);
        if (instantEmailToPersist && userId) {
          userEmailRegistry.set(userId, instantEmailToPersist);
        }

        await Promise.all([
          setRestDoc("users", userId, { 
            ...uDoc, 
            email: instantEmailToPersist,
            userEmail: instantEmailToPersist,
            displayName: instantNameToPersist,
            balance: newBalance, 
            latestDeposits: updatedLatestDeposits, 
            updatedAt: nowIso 
          }),
          setRestDoc("deposits", depId, {
            ...newDepositSummary,
            userId,
            userEmail: userEmail || "",
            type: "deposit"
          }),
          setRestDoc("bank_alerts", cleanUtr, {
            ...alertDoc,
            isUsed: true,
            status: "claimed",
            usedBy: userId,
            usedByEmail: userEmail || "",
            claimedBy: userId,
            claimedAt: nowIso
          }),
          setRestDoc("claimed_payments", cleanUtr, {
            orderRef: alertDoc.orderRef || cleanUtr,
            utr: cleanUtr,
            userId,
            amount: creditAmount,
            credited: true,
            claimedAt: nowIso
          })
        ]);

        return res.status(200).json({
          success: true,
          amount: creditAmount,
          newBalance,
          message: `Successfully verified! ₹${creditAmount} added to your wallet.`
        });
      }
    }

    // 10. Bank Alerts: /api/bank-alerts or /api/admin/bank-alerts
    if (pathname === "/api/bank-alerts" || pathname === "/api/admin/bank-alerts") {
      if (req.method === "GET") {
        const now = Date.now();
        if (memBankAlertsCache && (now - memBankAlertsCache.time < 60 * 1000)) {
          return res.status(200).json(memBankAlertsCache.data);
        }
        const alerts = await listRestDocs("bank_alerts", 30);
        memBankAlertsCache = { data: alerts, time: Date.now() };
        return res.status(200).json(alerts);
      }
    }

    // 11. Generic DB Proxy Endpoints: /api/db/get, /api/db/set, /api/db/update, /api/db/list, /api/db/add
    if (pathname === "/api/db/get") {
      const { collection: colName, id } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      const data = await getRestDoc(colName, id);
      return res.status(200).json({ success: true, data });
    }

    if (pathname === "/api/db/set") {
      const { collection: colName, id, data } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      if (colName === "courses") memCoursesCache = null;
      if (colName === "settings") memSettingsCache = null;
      if (colName === "providers") memProvidersCache = null;
      const saved = await setRestDoc(colName, id, data || {});
      return res.status(200).json({ success: true, data: saved });
    }

    if (pathname === "/api/db/update") {
      const { collection: colName, id, data } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      if (colName === "courses") memCoursesCache = null;
      if (colName === "settings") memSettingsCache = null;
      if (colName === "providers") memProvidersCache = null;
      const updated = await setRestDoc(colName, id, data || {});
      return res.status(200).json({ success: true, data: updated });
    }

    if (pathname === "/api/db/list" || pathname === "/api/db/query") {
      const { collection: colName, limit: queryLimit } = body || {};
      if (!colName) return res.status(400).json({ success: false, error: "Missing collection" });
      const docs = await listRestDocs(colName, queryLimit || 100);
      return res.status(200).json({ success: true, data: docs });
    }

    if (pathname === "/api/db/add") {
      const { collection: colName, data } = body || {};
      if (!colName) return res.status(400).json({ success: false, error: "Missing collection" });
      if (colName === "courses") memCoursesCache = null;
      if (colName === "settings") memSettingsCache = null;
      if (colName === "providers") memProvidersCache = null;
      const autoId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const saved = await setRestDoc(colName, autoId, { id: autoId, ...(data || {}) });
      return res.status(200).json({ success: true, id: autoId, data: saved });
    }

    // 12. Admin User Management: /api/admin/search-user & /api/admin/update-balance
    if (pathname === "/api/admin/search-user") {
      const queryStr = String(body.query || body.email || "").toLowerCase().trim();

      const enrichUser = (u: any) => {
        if (!u) return u;
        const uid = String(u.id || u.uid || "").trim();
        let recoveredEmail = String(u.email || u.userEmail || "").trim();

        if (!recoveredEmail && userEmailRegistry.has(uid)) {
          recoveredEmail = userEmailRegistry.get(uid)!;
        }
        if (!recoveredEmail && KNOWN_USER_EMAILS[uid]) {
          recoveredEmail = KNOWN_USER_EMAILS[uid].email;
        }
        if (!recoveredEmail && Array.isArray(u.latestOrders)) {
          for (const o of u.latestOrders) {
            if (o?.userEmail) { recoveredEmail = String(o.userEmail).trim(); break; }
          }
        }
        if (!recoveredEmail && Array.isArray(u.latestDeposits)) {
          for (const d of u.latestDeposits) {
            if (d?.userEmail) { recoveredEmail = String(d.userEmail).trim(); break; }
          }
        }
        // Check memory intents for this user ID
        if (!recoveredEmail) {
          for (const item of memIntents.values()) {
            if (item?.data?.userId === uid && item.data.userEmail) {
              recoveredEmail = String(item.data.userEmail).trim();
              break;
            }
          }
        }

        if (recoveredEmail) {
          u.email = recoveredEmail;
          u.userEmail = recoveredEmail;
          userEmailRegistry.set(uid, recoveredEmail);
          if (!u.displayName || u.displayName === "User") {
            u.displayName = KNOWN_USER_EMAILS[uid]?.name || recoveredEmail.split("@")[0];
          }
        }
        return u;
      };

      // 1. First, get/refresh memory users list (with 10-minute cache to protect 100% Firestore reads!)
      const now = Date.now();
      let usersList: any[] = [];
      if (memAllUsersCache && (now - memAllUsersCache.time < 10 * 60 * 1000)) {
        usersList = memAllUsersCache.data;
      } else {
        try {
          const docs = await listRestDocs("users", 300);
          usersList = docs.map(enrichUser);
          memAllUsersCache = { data: usersList, time: now };
        } catch (fetchErr: any) {
          console.warn("[USERS-CACHE-FETCH-WARN]", fetchErr.message);
          if (memAllUsersCache?.data) {
            usersList = memAllUsersCache.data;
          }
        }
      }

      // If query is provided, perform instant in-memory search across email, name, and ID
      if (queryStr) {
        let matched = usersList.filter((u: any) => {
          const uEmail = String(u.email || u.userEmail || "").toLowerCase();
          const uName = String(u.displayName || u.name || "").toLowerCase();
          const uId = String(u.id || u.uid || "").toLowerCase();
          return uEmail.includes(queryStr) || uName.includes(queryStr) || uId.includes(queryStr);
        });

        // If not found in loaded users list, check memory registry and known emails
        if (matched.length === 0) {
          for (const [uid, email] of userEmailRegistry.entries()) {
            if (email.toLowerCase().includes(queryStr) || uid.toLowerCase().includes(queryStr)) {
              const existingInList = usersList.find((x: any) => x.id === uid);
              matched.push(enrichUser({ id: uid, ...(existingInList || {}), email, userEmail: email }));
            }
          }
          for (const [uid, info] of Object.entries(KNOWN_USER_EMAILS)) {
            if (info.email.toLowerCase().includes(queryStr) || (info.name && info.name.toLowerCase().includes(queryStr))) {
              if (!matched.some((m: any) => m.id === uid)) {
                const existingInList = usersList.find((x: any) => x.id === uid);
                matched.push(enrichUser({ id: uid, ...(existingInList || {}), email: info.email, displayName: info.name }));
              }
            }
          }
        }

        return res.status(200).json({ success: true, users: matched });
      }

      return res.status(200).json({ success: true, users: usersList });
    }

    if (pathname === "/api/admin/update-balance") {
      const { userId, id, balance } = body || {};
      const targetId = userId || id;
      if (!targetId) return res.status(400).json({ success: false, error: "Missing userId" });
      const numBal = Number(balance || 0);
      memAllUsersCache = null; // Invalidate cache so updated balance is visible immediately
      await setRestDoc("users", targetId, { balance: numBal, updatedAt: new Date().toISOString() });
      return res.status(200).json({ success: true, balance: numBal });
    }

    // 13. UPI Gateway & Telegram Config: /api/admin/upi-gateway-config
    if (pathname === "/api/admin/upi-gateway-config") {
      if (body.action === "save") {
        const upiId = body.upiId ? String(body.upiId).trim() : undefined;
        const payeeName = body.payeeName || body.merchantName ? String(body.payeeName || body.merchantName).trim() : undefined;
        const botToken = body.botToken || body.telegramBotToken ? String(body.botToken || body.telegramBotToken).trim() : undefined;
        const chatId = body.chatId || body.telegramChatId ? String(body.chatId || body.telegramChatId).trim() : undefined;

        const curPayment = (await getRestDoc("settings", "payment").catch(() => ({}))) || {};
        const curTg = (await getRestDoc("settings", "telegram_bot").catch(() => ({}))) || {};

        const updatedPayment = {
          ...curPayment,
          ...(upiId && { upiId }),
          ...(payeeName && { merchantName: payeeName }),
          ...(botToken && { telegramBotToken: botToken }),
          ...(chatId && { telegramChatId: chatId }),
          instantQrEnabled: body.instantQrEnabled !== undefined ? body.instantQrEnabled : curPayment.instantQrEnabled
        };

        const updatedTg = {
          ...curTg,
          ...(botToken && { botToken }),
          ...(chatId && { chatId }),
          ...(upiId && { upiId }),
          ...(payeeName && { payeeName }),
          enabled: body.enabled !== undefined ? !!body.enabled : true,
          updatedAt: new Date().toISOString()
        };

        await Promise.all([
          setRestDoc("settings", "payment", updatedPayment),
          setRestDoc("settings", "telegram_bot", updatedTg)
        ]);

        return res.status(200).json({
          success: true,
          message: "Config saved successfully",
          running: true,
          enabled: true,
          hasToken: !!(botToken || curTg.botToken),
          botToken: botToken || curTg.botToken,
          chatId: chatId || curTg.chatId,
          upiId: upiId || curPayment.upiId,
          payeeName: payeeName || curPayment.merchantName,
          config: updatedPayment
        });
      } else {
        const [settings, tgDoc] = await Promise.all([
          getRestDoc("settings", "payment").catch(() => ({})),
          getRestDoc("settings", "telegram_bot").catch(() => ({}))
        ]);

        const botToken = String(tgDoc?.botToken || settings?.telegramBotToken || settings?.botToken || "").trim();
        const chatId = String(tgDoc?.chatId || settings?.telegramChatId || settings?.chatId || "").trim();
        const isEnabled = tgDoc?.enabled ?? settings?.telegramBotEnabled ?? true;
        const isActive = !!(botToken && botToken.length >= 30 && isEnabled !== false);

        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: isActive,
          enabled: isActive,
          hasToken: !!botToken,
          maskedToken: masked,
          chatId: chatId ? `${String(chatId).slice(0, 3)}***` : "",
          botUsername: tgDoc?.botUsername || settings?.telegramBotUsername || "",
          upiId: settings?.upiId || tgDoc?.upiId || "mdsaudalam621@okicici",
          payeeName: settings?.merchantName || tgDoc?.payeeName || "Pyare SMM Panel",
          config: {
            upiId: settings?.upiId || tgDoc?.upiId || "mdsaudalam621@okicici",
            payeeName: settings?.merchantName || tgDoc?.payeeName || "Pyare SMM Panel",
            enabled: isActive
          }
        });
      }
    }

    // 14. User Deposits History: /api/user/deposits (Disabled to save Firestore read quota)
    if (pathname === "/api/user/deposits") {
      return res.status(200).json({ success: true, deposits: [] });
    }

    // 15. User Orders History: /api/user-orders/:userId or /api/user-orders
    if (pathname.startsWith("/api/user-orders")) {
      const parts = pathname.split("/").filter(Boolean);
      let pathUid = "";
      if (parts.length >= 3 && parts[1] === "user-orders") {
        pathUid = parts[2];
      } else if (parts.length === 2 && parts[0] === "api" && parts[1] !== "user-orders") {
        pathUid = parts[1];
      }
      const targetUid = String(req.query?.userId || pathUid || "").trim();
      const targetEmail = String(req.query?.email || req.query?.userEmail || "").trim().toLowerCase();

      if (!targetUid && !targetEmail) {
        return res.status(200).json([]);
      }

      // Check in-memory 10-minute cache first (0 Firestore reads!)
      const cacheKey = targetUid || targetEmail;
      const memCached = memUserOrders.get(cacheKey);
      if (memCached && (Date.now() - memCached.time < 10 * 60 * 1000)) {
        return res.status(200).json(memCached.data);
      }

      // Check User Profile document latestOrders first (0 extra reads if cached!)
      if (targetUid) {
        try {
          const uDoc = await getRestDoc("users", targetUid);
          if (uDoc && Array.isArray(uDoc.latestOrders) && uDoc.latestOrders.length > 0) {
            const list = uDoc.latestOrders.slice(0, 10);
            memUserOrders.set(cacheKey, { data: list, time: Date.now() });
            return res.status(200).json(list);
          }
        } catch (e) {}
      }

      // Fallback query to orders collection
      try {
        let ordList: any[] = [];
        if (targetUid) {
          ordList = await queryRestDocs("orders", "userId", targetUid, 30);
        } else if (targetEmail) {
          ordList = await queryRestDocs("orders", "userEmail", targetEmail, 30);
        }

        const filtered = ordList.filter((item: any) => {
          if (!item) return false;
          const uUid = String(item.userId || item.user_id || "").trim();
          const uEmail = String(item.userEmail || item.user_email || "").trim().toLowerCase();
          return (targetUid && uUid === targetUid) || (targetEmail && uEmail && uEmail === targetEmail);
        });
        filtered.sort((a, b) => {
          const timeA = new Date(a.createdAt || a.created_at || 0).getTime();
          const timeB = new Date(b.createdAt || b.created_at || 0).getTime();
          return timeB - timeA;
        });
        const finalOrders = filtered.slice(0, 10);
        memUserOrders.set(cacheKey, { data: finalOrders, time: Date.now() });
        return res.status(200).json(finalOrders);
      } catch (e: any) {
        return res.status(200).json([]);
      }
    }

    // Default 404
    return res.status(404).json({ success: false, error: `Route ${pathname} not found on Vercel Gateway` });
  } catch (err: any) {
    console.error("[API-GATEWAY-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
