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

dotenv.config();

// Supabase Admin Client (using service role key to bypass RLS for backend tasks)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
  
  // Storage for basic app config that doesn't change often
  const serverCache = {
    settings: null as any,
    courses: new Map<string, any>(),
    providers: new Map<string, any>(),
  };

  // Supabase Helpers that replace Firestore ones
  const getDocSafe = async (collect: string, id: string) => {
    const now = Date.now();
    // Quick cache for settings
      if (collect === "settings" && id === "payment" && serverCache.settings && now - serverCache.settings.time < 300000) {
      return { exists: true, data: () => serverCache.settings.data };
    }

    try {
      const { data, error } = await supabaseAdmin.from(collect).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      
      if (data) {
        if (collect === "settings" && id === "payment") serverCache.settings = { data, time: now };
        return { exists: true, data: () => data };
      }
    } catch (err: any) {
      console.warn(`[SUPABASE-GET] Failed for ${collect}/${id}: ${err.message}`);
    }
    return { exists: false, data: () => null };
  };

  const updateDocSafe = async (col: string, id: string, data: any) => {
    try {
      const { error } = await supabaseAdmin.from(col).update(data).eq("id", id);
      if (error) {
        console.warn(`[SUPABASE-UPDATE] Error updating ${col}/${id}:`, error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(`[SUPABASE-UPDATE] Exception: ${err.message}`);
      return false;
    }
  };

  const setDocSafe = async (col: string, id: string, data: any) => {
    try {
      const { error } = await supabaseAdmin.from(col).upsert({ id, ...data });
      if (error) {
        console.warn(`[SUPABASE-SET] Error upserting ${col}/${id}:`, error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(`[SUPABASE-SET] Exception: ${err.message}`);
      return false;
    }
  };

  const addDocSafe = async (col: string, data: any) => {
    try {
      const { data: result, error } = await supabaseAdmin.from(col).insert(data).select("id").single();
      if (error) {
        console.warn(`[SUPABASE-ADD] Error adding to ${col}:`, error.message);
        return null;
      }
      return result.id;
    } catch (err: any) {
      console.warn(`[SUPABASE-ADD] Exception: ${err.message}`);
      return null;
    }
  };

  // Activate auto-ensure on startup
  const ensureBackendUrlIsSet = async () => {
    const ACTIVE_BACKEND_URL = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    try {
      console.log(`[INIT] Auto-ensuring backend URL in database: ${ACTIVE_BACKEND_URL}`);
      const { data, error } = await supabaseAdmin.from("settings").select("*").eq("id", "payment").maybeSingle();
      if (error) throw error;
      if (data) {
        if (data.backendApiUrl !== ACTIVE_BACKEND_URL) {
          await supabaseAdmin.from("settings").update({ backendApiUrl: ACTIVE_BACKEND_URL }).eq("id", "payment");
          console.log(`[INIT] ✅ Supabase backendApiUrl updated.`);
        }
      } else {
        await supabaseAdmin.from("settings").insert({ id: "payment", backendApiUrl: ACTIVE_BACKEND_URL });
      }
    } catch (err: any) {
      console.warn(`[INIT] ⚠️ Auto-updating backendApiUrl failed: ${err.message}`);
    }
  };
  ensureBackendUrlIsSet();
  const adjustUserBalanceSafe = async (user_id: string, change: number) => {
    console.log(`[BALANCE-SAFE] Adjusting balance for ${user_id} by ${change}`);
    try {
      const { data: user, error: getErr } = await supabaseAdmin.from("users").select("balance").eq("id", user_id).single();
      if (getErr || !user) throw new Error("User not found");

      const newBalance = Number((Number(user.balance || 0) + change).toFixed(2));
      const { error: updErr } = await supabaseAdmin.from("users").update({ balance: newBalance }).eq("id", user_id);
      
      if (updErr) throw updErr;
      console.log(`[BALANCE-SAFE] Balance adjusted successfully to ${newBalance}`);
      return true;
    } catch (err: any) {
      console.error(`[BALANCE-SAFE] Error: ${err.message}`);
      return false;
    }
  };
  
  // Health check
  app.get("/api/health", (req, res) => res.json({ 
    status: "ok", 
    supabaseUrl: supabaseUrl,
    hasServiceKey: !!supabaseServiceKey
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
      console.log("[SERVER-DB] Fetching published services from Supabase to refresh cache...");
      const { data: services, error } = await supabaseAdmin
        .from("services")
        .select("*")
        .eq("status", "published");
      
      if (error) throw error;

      // Sort services by category priority
      const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
      services.sort((a: any, b: any) => {
        const orderA = categoryOrder.indexOf(a.category) === -1 ? 99 : categoryOrder.indexOf(a.category);
        const orderB = categoryOrder.indexOf(b.category) === -1 ? 99 : categoryOrder.indexOf(b.category);
        if (orderA !== orderB) return orderA - orderB;
        
        const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
        const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
        return timeB - timeA;
      });

      serverCachedCourses = services;
      serverCachedCoursesTime = now;
      res.json(services);
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
      const { data: ordersList, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);
      
      if (error) throw error;
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

  // Manual Deposit
  app.post("/api/deposits/submit-manual", async (req, res) => {
    const { amount, utr, screenshotUrl, userId, userEmail } = req.body;
    const user_id = userId;
    const user_email = userEmail;
    console.log(`[DEPOSIT] Attempting submission: UTR=${utr}, User=${user_id}`);
    
    const cleanUtr = String(utr).replace(/\D/g, "");
    if (cleanUtr.length !== 12) return res.status(400).json({ error: "Invalid UTR format. Must be 12 digits." });
    
    try {
      const { data: existingDep } = await supabaseAdmin.from("transactions").select("id").eq("utr", cleanUtr).maybeSingle();
      if (existingDep) {
        return res.status(400).json({ error: "This UTR number has already been used." });
      }

      // Check if Admin has enabled Auto-Approve Deposits
      const sS = await getDocSafe("settings", "payment");
      const paymentSettings = sS.exists ? sS.data() : {};
      const autoApprove = paymentSettings.auto_approve_deposits === true;

      if (autoApprove) {
        // Create an already-approved deposit entry
        const depId = await addDocSafe("transactions", {
          user_id, 
          user_email: user_email || "not-provided", 
          amount: Number(amount), 
          utr: cleanUtr, 
          screenshot_url: screenshotUrl || "", 
          status: "approved", 
          type: "deposit",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        if (depId) {
          // Immediately adjust user balance
          const balanceAdjusted = await adjustUserBalanceSafe(user_id, Number(amount));
          if (balanceAdjusted) {
            console.log(`[DEPOSIT] Instant auto-approved & balance adjusted for User=${user_id} by ₹${amount}`);
            res.json({ success: true, isAutoApproved: true });
          } else {
            console.error(`[DEPOSIT] Instant auto-approval wrote deposit ${depId} but failed to adjust balance for User=${user_id}!`);
            res.json({ success: true, isAutoApproved: true, warning: "Balance update delayed" });
          }
        } else {
          throw new Error("Failed to write manual deposit to database.");
        }
      } else {
        // Fallback to standard pending deposit
        const depId = await addDocSafe("transactions", {
          user_id, 
          user_email: user_email || "not-provided", 
          amount: Number(amount), 
          utr: cleanUtr, 
          screenshot_url: screenshotUrl || "", 
          status: "pending", 
          type: "deposit",
          created_at: new Date().toISOString()
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

      // 3. Find matching pending manual deposit in Supabase
      let depData: any = null;
      let depositId: string = "";
      let matchedUtr: string = "";

      // Loop through all candidate UTRs to find a match in Supabase
      for (const candidateUtr of candidateUtrs) {
        try {
          const { data, error } = await supabaseAdmin
            .from("deposits")
            .select("*")
            .eq("utr", candidateUtr)
            .eq("status", "pending")
            .maybeSingle();

          if (error) throw error;
          
          if (data) {
            depData = data;
            depositId = data.id;
            matchedUtr = candidateUtr;
            break; // Found matching pending deposit!
          }
        } catch (err: any) {
          console.warn(`[SMS-WEBHOOK] Supabase Query failed for UTR ${candidateUtr}: ${err.message}`);
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
  async function transmitOrderToProviderDirect(orderId: string, orderData: any) {
    // Look up lock first
    if (processingOrders.has(orderId)) {
      console.log(`[LOCK] Order ${orderId} is currently being processed by another worker path. Skipping.`);
      return { success: true, alreadyProcessing: true };
    }

    processingOrders.add(orderId);
    console.log(`[TRANSMIT] Locking & processing orderId: ${orderId}`);

    try {
      // 0. Resolve orderData or fallback to Supabase fetch to avoid redundant DB reads
      let currentOrderData = orderData;
      if (!currentOrderData || !currentOrderData.user_id || !currentOrderData.service_id) {
        console.log(`[TRANSMIT] Fetching order document ${orderId} from Supabase (slow path fallback)`);
        const snapObj = await getDocSafe("orders", orderId);
        if (!snapObj.exists) throw new Error("Order not found");
        currentOrderData = snapObj.data() || {};
        
        if (currentOrderData.provider_order_id) {
          console.log(`[TRANSMIT] Order ${orderId} already has provider_order_id registered: ${currentOrderData.provider_order_id}`);
          return { success: true, provider_order_id: currentOrderData.provider_order_id };
        }
        if (currentOrderData.provider_transmission_status === "completed") {
          console.log(`[TRANSMIT] Order ${orderId} transmission was already completed.`);
          return { success: true, provider_order_id: currentOrderData.provider_order_id || "SENT" };
        }
      }

      const orderAmount = Number(currentOrderData.total_price || 0);
      const serviceId = currentOrderData.service_id;
      const userId = currentOrderData.user_id;
      const targetLink = currentOrderData.target_link || "";
      const quantity = currentOrderData.quantity;

      if (!serviceId) {
        throw new Error("Missing required field: service_id");
      }

      // 1. Fetch User, Service details, and general Payment Settings IN PARALLEL (FAST PATH)
      console.log(`[TRANSMIT] Retrieving User, Service, and Settings in parallel for order ${orderId}`);
      const [userSnap, cS, sS] = await Promise.all([
        getDocSafe("users", userId),
        getDocSafe("services", serviceId),
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
      let pUrl = (s.api_url || "").trim();
      let pKey = (s.api_key || "").trim();

      if (c.provider_id && c.provider_id !== "global") {
        console.log(`[TRANSMIT] Course ${courseId} is using a custom provider: ${c.provider_id}`);
        const pS = await getDocSafe("providers", c.provider_id);
        if (pS && pS.exists) {
          const pData = pS.data() || {};
          pUrl = (pData.api_url || "").trim();
          pKey = (pData.api_key || "").trim();
        } else {
          console.warn(`[TRANSMIT] Custom provider ${c.provider_id} not found. Falling back to global settings.`);
        }
      }

      if (!pUrl || !pKey) {
        throw new Error("Provider API URL or API Key is missing inside settings. Transmission canceled.");
      }

      if (!pUrl.startsWith("http")) {
        pUrl = "https://" + pUrl;
      }

      if (!c.provider_service_id || String(c.provider_service_id) === "0") {
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
        await logToDb("PROXY_PROVIDER_SUCCESS", { provider_order_id: oId, isStatusSuccess, resData, orderId });

        // DEDUCT BALANCE NOW - Order was successful with provider
        try {
          const orderSnap = await getDocSafe("orders", orderId);
          if (orderSnap.exists) {
            const currentData = orderSnap.data();
            // We deduct if it hasn't been deducted yet (Pending/Processing status)
            // or if it was previously failed and we are retrying.
            const needsDeduction = ["Pending", "Processing", "Failed", "Refunded", "Awaiting-Validation"].includes(currentData.status);
            
            if (needsDeduction) {
              const price = currentData.total_price || 0;
              const deductionSuccess = await adjustUserBalanceSafe(currentData.user_id, -price);
              if (deductionSuccess) {
                console.log(`[DEDUCTION] Deducted ₹${price} from User ${currentData.user_id} after successful provider response.`);
              } else {
                console.error(`[DEDUCTION-FAIL] Could not deduct balance for user ${currentData.user_id} despite provider success!`);
              }
            }
          }

          await updateDocSafe("orders", orderId, {
            status: "Completed",
            provider_order_id: oId,
            needsProviderTransmission: false,
            provider_transmission_status: "completed",
            error: null,
            updated_at: new Date().toISOString(),
            provider_raw_response: JSON.stringify(resData).substring(0, 800)
          });
        } catch (updateErr: any) {
          console.warn(`[TRANSMIT] Could not update database snapshot but was definitely ordered: ${updateErr.message}`);
          await updateDocSafe("orders", orderId, {
            status: "Completed",
            provider_order_id: oId,
            needsProviderTransmission: false,
            provider_transmission_status: "completed",
            updated_at: new Date().toISOString()
          });
        }
        return { success: true, provider_order_id: oId };
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
          provider_transmission_status: "failed",
          error: `Provider Rejected Order (${finalErrorStr.substring(0, 400)})`,
          updated_at: new Date().toISOString()
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
            },
            limit: 3
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
    }, 1800000); // Check every 30 minutes. Primary listener uses direct HTTP api POST, so backup can be extremely lightweight and save reads!
  }

  // Background Live Snapshot Listener (Optimized for Spark Free tier - Deactivated real-time SDK listener to prevent permission-denied retry loop reads spam)
  function startBackgroundOrderListener(dbInstance: any) {
    console.log("[BACKGROUND-PROCESSOR] Initializing lightweight order manager background scheduler...");
    
    // Background REST polling loop disabled completely to prevent periodic query/read quota consumption.
    // All orders are dispatched synchronously and status updates triggered manually or on-demand.

    console.log("[BACKGROUND-PROCESSOR] In-memory orders scheduler active. SDK onSnapshot stream remains disabled to prevent credential block retries.");
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
      const final_service_id = bodyServiceId || courseId;
      const final_title = bodyTitle || courseTitle || "";
      const final_target_link = bodyTargetLink || targetLink || "";
      const final_total_price = bodyTotalPrice !== undefined ? bodyTotalPrice : totalPrice;

      let orderId = passedOrderId;

      // Check if this is a DIRECT Synchronous order creation request (contains userId & totalPrice)
      if (final_user_id && final_total_price !== undefined) {
        if (!orderId) {
          orderId = "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        }
        console.log(`[HTTP Direct Order] Creating order document ${orderId} in database`);

        // 1. Create order document first so transit methods can read/update it
        const orderData = {
          user_id: final_user_id,
          user_email: final_user_email,
          service_id: final_service_id,
          title: final_title,
          category: category || "Other",
          quantity: Number(quantity),
          target_link: final_target_link.trim(),
          total_price: Number(final_total_price),
          status: "Pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
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
        user_id: final_user_id,
        user_email: final_user_email,
        service_id: final_service_id,
        title: final_title,
        category: category || "Other",
        quantity: Number(quantity),
        target_link: final_target_link?.trim() || "",
        total_price: Number(final_total_price),
        status: "Pending"
      };

      if (req.body.isAsync) {
        console.log(`[HTTP Proxy] Dispatching asynchronous background order transit for order: ${orderId}`);
        // Run background transmittal immediately and return milliseconds response to client
        transmitOrderToProviderDirect(orderId, payloadData).catch(err => {
          console.error(`[ASYNC-TRANSMIT-ERROR] Background transmission exception for ${orderId}:`, err.message);
        });
        return res.json({ success: true, isAsync: true, provider_order_id: "PENDING", orderId });
      }

      const result = await transmitOrderToProviderDirect(orderId, payloadData);
      if (result.success) {
        return res.json({ success: true, provider_order_id: result.provider_order_id, orderId });
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
          pUrl = pS.data()?.api_url;
          pKey = pS.data()?.api_key;
        } else {
          return res.status(404).json({ error: "Provider not found" });
        }
      } else {
        const sS = await getDocSafe("settings", "payment");
        pUrl = sS.data()?.api_url;
        pKey = sS.data()?.api_key;
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

      if (!order.provider_order_id) {
        return res.json({ success: true, status: currentStatus, message: "No provider ID yet" });
      }

      // Fetch provider info
      let pUrl = "";
      let pKey = "";
      const sS = await getDocSafe("settings", "payment");
      const sData = sS.data() || {};
      pUrl = sData.api_url || "";
      pKey = sData.api_key || "";

      if (order.service_id) {
        const cS = await getDocSafe("services", order.service_id);
        if (cS.exists) {
          const cData = cS.data();
          if (cData.provider_id && cData.provider_id !== "global") {
            const pS = await getDocSafe("providers", cData.provider_id);
            if (pS.exists) {
              const pData = pS.data();
              pUrl = pData.api_url || "";
              pKey = pData.api_key || "";
            }
          }
        }
      }

      if (!pUrl || !pKey) return res.status(400).json({ error: "Provider config missing" });

      const params = new URLSearchParams();
      params.append("key", pKey);
      params.append("action", "status");
      params.append("order", String(order.provider_order_id));

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
