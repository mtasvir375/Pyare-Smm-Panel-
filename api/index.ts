import axios from "axios";
import { getRestDoc, setRestDoc, deleteRestDoc, listRestDocs, unwrapFirestoreFields } from "./_firestoreRest";
import proxyProviderHandler from "./_proxyProvider";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Parse path from req.url
  const rawUrl = req.url || "/api";
  const urlObj = new URL(rawUrl, "http://localhost");
  let pathname = urlObj.pathname.replace(/\/+$/, "") || "/api";
  // If rewrite was /api?__path=... or query params
  if (req.query?.path && Array.isArray(req.query.path)) {
    pathname = `/api/${req.query.path.join("/")}`;
  }

  try {
    // 1. Health check: /api
    if (pathname === "/api" || pathname === "") {
      return res.status(200).json({ status: "ok", message: "API Gateway Online" });
    }

    // 2. Settings: /api/settings
    if (pathname === "/api/settings") {
      if (req.method === "GET") {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/settings/payment?key=${FIREBASE_API_KEY}`;
          const response = await axios.get(url, { timeout: 6000 });
          const data = unwrapFirestoreFields(response.data.fields);
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          return res.status(200).json(data);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      } else if (req.method === "POST") {
        const body = req.body || {};
        await setRestDoc("settings", "payment", body);
        return res.status(200).json({ success: true, message: "Settings saved" });
      }
    }

    // 3. Courses: /api/courses
    if (pathname === "/api/courses") {
      if (req.method === "GET") {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/courses?pageSize=300&key=${FIREBASE_API_KEY}`;
          const response = await axios.get(url, { timeout: 7000 });
          const documents = response.data.documents || [];
          const courses = documents.map((doc: any) => {
            const parts = doc.name.split("/");
            const id = parts[parts.length - 1];
            const data = unwrapFirestoreFields(doc.fields);
            return { id, ...data };
          });
          const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
          courses.sort((a: any, b: any) => {
            const idxA = categoryOrder.indexOf(a.category || "Other");
            const idxB = categoryOrder.indexOf(b.category || "Other");
            if (idxA !== idxB) return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
            return (a.serviceId || 0) - (b.serviceId || 0);
          });
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          return res.status(200).json(courses);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      }
    }

    // 4. Providers: /api/providers
    if (pathname === "/api/providers") {
      if (req.method === "GET") {
        try {
          const providers = await listRestDocs("providers", 100);
          return res.status(200).json(providers);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      }
    }

    // 5. Proxy Provider: /api/proxy-provider
    if (pathname === "/api/proxy-provider" || pathname === "/api/proxy") {
      return await proxyProviderHandler(req, res);
    }

    // 6. Telegram Config: /api/telegram-config or /api/admin/telegram-config
    if (pathname === "/api/telegram-config" || pathname === "/api/admin/telegram-config") {
      if (req.method === "GET") {
        let cfg: any = null;
        try {
          cfg = await getRestDoc("settings", "telegram_bot");
        } catch {}

        if (!cfg) {
          return res.status(200).json({
            success: true,
            running: false,
            enabled: false,
            hasToken: false,
            maskedToken: "",
            chatId: "",
            botUsername: "",
            totalAlertsCount: 0
          });
        }

        const botToken = String(cfg.botToken || "").trim();
        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: !!cfg.enabled,
          enabled: !!cfg.enabled,
          hasToken: !!botToken,
          maskedToken: masked,
          chatId: cfg.chatId || "",
          botUsername: cfg.botUsername || "",
          startedAt: cfg.startedAt
        });
      } else if (req.method === "POST") {
        const body = req.body || {};
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
        const { amount, userId, userEmail } = req.body || {};
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

        await setRestDoc("payment_intents", intentId, intentData);

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

      const intent = await getRestDoc("payment_intents", String(intentId));
      if (!intent) {
        return res.status(404).json({ success: false, error: "Payment intent not found or expired." });
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
    }

    // 9. Verify UTR: /api/verify-utr or /api/deposits/verify-qr-auto or /api/wallet/verify-utr
    if (
      pathname === "/api/verify-utr" ||
      pathname === "/api/deposits/verify-qr-auto" ||
      pathname === "/api/wallet/verify-utr"
    ) {
      if (req.method === "POST") {
        const { userId, utr, amount: reqAmount, userEmail } = req.body || {};
        if (!userId) {
          return res.status(400).json({ success: false, error: "User authentication required." });
        }
        const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
        if (cleanUtr.length !== 12) {
          return res.status(400).json({ success: false, error: "Please enter a valid 12-digit UPI / UTR Reference Number." });
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
        try {
          const userDoc = await getRestDoc("users", userId);
          const currentBal = Number(userDoc?.balance || 0);
          newBalance = currentBal + creditAmount;
          await setRestDoc("users", userId, { balance: newBalance });
        } catch (e) {}

        const nowIso = new Date().toISOString();
        await setRestDoc("bank_alerts", cleanUtr, {
          ...alertDoc,
          isUsed: true,
          status: "claimed",
          usedBy: userId,
          usedByEmail: userEmail || "",
          claimedBy: userId,
          claimedAt: nowIso
        });

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
        const alerts = await listRestDocs("bank_alerts", 50);
        return res.status(200).json(alerts);
      }
    }

    // Default fallback: 404
    return res.status(404).json({ success: false, error: `Route ${pathname} not found on Vercel Gateway` });
  } catch (err: any) {
    console.error("[API-GATEWAY-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
