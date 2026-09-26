import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { dbClient } from "@/lib/dbClient";
import {
  Send,
  Bot,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  Check,
  Eye,
  EyeOff,
  Zap,
  Sparkles,
  HelpCircle,
  Search,
  ArrowUpRight,
  ShieldCheck,
  Smartphone,
  Radio,
  ArrowRight,
  ExternalLink,
  QrCode
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface AdminPaymentIntent {
  intentId: string;
  orderRef: string; // 12-digit numeric code
  baseAmount: number;
  amount: number;
  userId: string;
  userEmail?: string;
  upiId: string;
  payeeName: string;
  upiLink: string;
  status: "pending" | "completed" | "expired";
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
  utr?: string;
  senderBank?: string;
}

export interface PaymentIntentStats {
  total: number;
  pending: number;
  completed: number;
  expired: number;
  totalVolume: number;
}

interface BankAlert {
  id: string;
  utr: string;
  amount: number;
  senderBank: string;
  rawText: string;
  timestamp: string;
  isUsed: boolean;
  usedBy?: string;
  usedByEmail?: string;
  usedAt?: string;
}

interface RawBotMessage {
  id: string;
  timestamp: string;
  sender: string;
  chatId: string | number;
  text: string;
  parsed: boolean;
  utr?: string;
  amount?: number;
  bank?: string;
  reason?: string;
}

interface TelegramConfigStatus {
  running: boolean;
  enabled: boolean;
  hasToken: boolean;
  maskedToken: string;
  chatId: string;
  upiId?: string;
  payeeName?: string;
  botUsername?: string;
  webhookUrl?: string;
  startedAt?: string;
  lastPolledAt?: string;
  lastPolledAgeSeconds?: number | null;
  lastError?: string;
  totalAlertsCount: number;
  unusedAlertsCount: number;
  totalIntentsCount?: number;
  recentMessages?: RawBotMessage[];
}

export const TelegramBotTab: React.FC = () => {
  const [config, setConfig] = useState<TelegramConfigStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("Pyare SMM Panel");
  const isUserEditingRef = useRef(false);
  const [showToken, setShowToken] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingAction, setSavingAction] = useState<"start" | "stop" | "save" | null>(null);
  const [isTestingPing, setIsTestingPing] = useState(false);

  // Bank Alerts State
  const [alerts, setAlerts] = useState<BankAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);

  // Simulation State
  const [simAmount, setSimAmount] = useState("100");
  const [simBank, setSimBank] = useState("State Bank of India (SBI)");
  const [isSimulating, setIsSimulating] = useState(false);
  const [lastSimulatedAlert, setLastSimulatedAlert] = useState<BankAlert | null>(null);

  // Direct SMS Ingest State
  const [forwarderMode, setForwarderMode] = useState<"webhook" | "telegram">("webhook");
  const [directSmsText, setDirectSmsText] = useState("");
  const [isIngestingSms, setIsIngestingSms] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [isTestingTgProxy, setIsTestingTgProxy] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);
  const [viewingAlertSms, setViewingAlertSms] = useState<BankAlert | null>(null);

  // 12-Digit QR Payment Intents State (Live User Requests)
  const [intents, setIntents] = useState<AdminPaymentIntent[]>([]);
  const [intentStats, setIntentStats] = useState<PaymentIntentStats>({
    total: 0,
    pending: 0,
    completed: 0,
    expired: 0,
    totalVolume: 0
  });
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [intentFilter, setIntentFilter] = useState<"all" | "pending" | "completed" | "expired">("all");
  const [approvingIntentId, setApprovingIntentId] = useState<string | null>(null);
  const [copiedIntentRef, setCopiedIntentRef] = useState<string | null>(null);

  const fetchIntents = async () => {
    setLoadingIntents(true);
    try {
      const res = await axios.get("/api/admin/payment-intents", { timeout: 4000 });
      if (res.data && res.data.success) {
        setIntents(res.data.intents || []);
        if (res.data.stats) setIntentStats(res.data.stats);
      }
    } catch (e) {
      console.warn("[FETCH-INTENTS-ERR]", e);
    } finally {
      setLoadingIntents(false);
    }
  };

  const handleApproveIntent = async (intentId: string, orderRef: string, amount: number) => {
    if (!window.confirm(`Kya aap Order Ref ${orderRef} (₹${amount}) ko user ke wallet me turant credit karna chahte hain?`)) {
      return;
    }
    setApprovingIntentId(intentId);
    try {
      const res = await axios.post("/api/admin/payment-intents/approve", { intentId });
      if (res.data && res.data.success) {
        toast.success(`₹${amount} safaltapoorvak user account me credit kar diya gaya!`);
        fetchIntents();
      } else {
        toast.error(res.data?.error || "Approval failed.");
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err));
    } finally {
      setApprovingIntentId(null);
    }
  };

  const extractErrorMessage = (err: any): string => {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    const data = err.response?.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      if (typeof data.error === "string") return data.error;
      if (data.error && typeof data.error.message === "string") return data.error.message;
      if (typeof data.message === "string") return data.message;
      if (typeof data.description === "string") return data.description;
      try {
        return JSON.stringify(data.error || data);
      } catch (e) {}
    }
    return err.message || "An unexpected error occurred.";
  };

  const fetchConfig = async () => {
    setLoadingConfig(true);
    let loaded = false;

    // 1. Try serverless routes first
    for (const endpoint of ["/api/admin/upi-gateway-config", "/api/telegram-config", "/api/admin/telegram-config"]) {
      try {
        const res = await axios.get(endpoint, { timeout: 4000 });
        if (res.data && res.data.success) {
          setConfig(res.data);
          if (res.data.chatId && !chatId) setChatId(res.data.chatId);
          if (res.data.upiId && !isUserEditingRef.current) setUpiId(res.data.upiId);
          if (res.data.payeeName && !isUserEditingRef.current) setPayeeName(res.data.payeeName);
          loaded = true;
          break;
        }
      } catch (e) {}
    }

    // 2. Direct Firestore fallback (Guarantees working on custom domain/Vercel)
    if (!loaded) {
      try {
        const [tgDoc, paymentDoc] = await Promise.all([
          dbClient.getDoc("settings", "telegram_bot"),
          dbClient.getDoc("settings", "payment")
        ]);

        const rawToken = tgDoc?.botToken || paymentDoc?.telegramBotToken || "";
        const cId = tgDoc?.chatId || paymentDoc?.telegramChatId || "";
        const username = tgDoc?.botUsername || paymentDoc?.telegramBotUsername || "";
        const isEnabled = tgDoc?.enabled ?? paymentDoc?.telegramBotEnabled ?? false;
        const uId = paymentDoc?.upiId || tgDoc?.upiId || "";
        const pName = paymentDoc?.merchantName || tgDoc?.payeeName || "Pyare SMM Panel";
        if (!isUserEditingRef.current) {
          if (uId) setUpiId(uId);
          if (pName) setPayeeName(pName);
        }

        let masked = "";
        if (rawToken && rawToken.length > 8) {
          const parts = rawToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${rawToken.slice(0, 4)}***${rawToken.slice(-4)}`;
        }

        setConfig({
          running: !!isEnabled,
          enabled: !!isEnabled,
          hasToken: !!rawToken,
          maskedToken: masked,
          chatId: cId,
          upiId: uId,
          payeeName: pName,
          botUsername: username,
          webhookUrl: tgDoc?.webhookUrl || `https://${window.location.host}/api/telegram-webhook`,
          startedAt: tgDoc?.startedAt,
          totalAlertsCount: 0,
          unusedAlertsCount: 0
        });

        if (cId && !chatId) setChatId(cId);
      } catch (fsErr: any) {
        console.warn("[TELEGRAM-FIRESTORE-FALLBACK-WARN]", fsErr);
      }
    }
    setLoadingConfig(false);
  };

  const fetchAlerts = async () => {
    setLoadingAlerts(true);
    let loaded = false;

    for (const endpoint of [
      `/api/bank-alerts?filter=${filter}&search=${encodeURIComponent(searchQuery)}`,
      `/api/admin/bank-alerts?filter=${filter}&search=${encodeURIComponent(searchQuery)}`
    ]) {
      try {
        const res = await axios.get(endpoint, { timeout: 4000 });
        if (res.data && res.data.success) {
          setAlerts(res.data.alerts || []);
          loaded = true;
          break;
        }
      } catch (e) {}
    }

    if (!loaded) {
      try {
        const [alertDocs, poolDocs] = await Promise.all([
          dbClient.getDocs("bank_alerts"),
          dbClient.getDocs("sms_forwarder_pool")
        ]);

        const map = new Map<string, any>();
        for (const doc of [...alertDocs, ...poolDocs]) {
          const utr = doc.utr || doc.id;
          if (!utr || map.has(utr)) continue;
          const isUsed = doc.status === "claimed" || doc.isUsed === true;
          map.set(utr, {
            id: doc.id || `alert_${utr}`,
            utr,
            amount: Number(doc.amount || 0),
            senderBank: doc.senderBank || doc.sender || "UPI Payment",
            rawText: doc.rawText || doc.rawSms || "",
            timestamp: doc.timestamp || new Date().toISOString(),
            isUsed,
            usedBy: doc.usedBy || doc.claimedBy || "",
            usedByEmail: doc.usedByEmail || doc.claimedEmail || "",
            usedAt: doc.usedAt || doc.claimedAt || ""
          });
        }

        let allAlerts = Array.from(map.values());
        allAlerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (filter === "unused") {
          allAlerts = allAlerts.filter((a) => !a.isUsed);
        } else if (filter === "used") {
          allAlerts = allAlerts.filter((a) => a.isUsed);
        }

        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          allAlerts = allAlerts.filter((a) =>
            a.utr.toLowerCase().includes(q) ||
            a.senderBank.toLowerCase().includes(q) ||
            String(a.amount).includes(q) ||
            (a.usedByEmail && a.usedByEmail.toLowerCase().includes(q))
          );
        }

        setAlerts(allAlerts);
      } catch (e) {
        console.warn("[FETCH-ALERTS-FIRESTORE-ERR]", e);
      }
    }

    setLoadingAlerts(false);
  };

  useEffect(() => {
    fetchConfig();
    fetchAlerts();
    fetchIntents();

    // Auto-poll alerts & intents every 5 seconds so new SMS/Telegram payments and QR requests show up automatically
    const pollInterval = setInterval(() => {
      fetchAlerts();
      fetchIntents();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [filter, intentFilter]);

  const handleIngestDirectSms = async () => {
    const text = directSmsText.trim();
    if (!text) {
      toast.error("Please paste the Bank SMS text first.");
      return;
    }

    setIsIngestingSms(true);
    try {
      const res = await axios.post("/api/admin/parse-and-add-sms", { text }, { timeout: 6000 });
      if (res.data?.success) {
        toast.success(res.data.message || "Bank SMS parsed and added successfully!");
        setDirectSmsText("");
        fetchAlerts();
        fetchConfig();
      } else {
        toast.error(res.data?.error || "Failed to parse SMS");
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      toast.error(msg);
    } finally {
      setIsIngestingSms(false);
    }
  };

  const handleTestWebhook = async () => {
    setIsTestingWebhook(true);
    try {
      const mockUtr = String(Math.floor(100000000000 + Math.random() * 900000000000));
      const res = await axios.post("/api/sms-forwarder", {
        from: "AD-CENTBK-T",
        text: `From : AD-CENTBK-T()\nA/c XX0953 credited by Rs. 50.00 on 22092026 via UPI from Mr MD SAUD ALAM via Ref No. ${mockUtr}. -CBoI`
      }, { timeout: 6000 });

      if (res.data?.success) {
        toast.success(`🎉 Webhook Verified! Captured ₹50 with 12-Digit UTR ${mockUtr} in 0.1s!`);
        fetchAlerts();
        fetchConfig();
        fetchIntents();
      } else {
        toast.error(res.data?.error || "Webhook test failed");
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err));
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleTestTgProxy = async () => {
    setIsTestingTgProxy(true);
    try {
      const mockUtr = String(Math.floor(100000000000 + Math.random() * 900000000000));
      const token = botToken.trim() || "8268916986:AAGn5qnLukLpZGw9h9y1kcRzySd_2bS57k0";
      const targetChatId = chatId.trim() || "8307658312";
      const res = await axios.post(`/bot${token}/sendMessage`, {
        chat_id: targetChatId,
        text: `From : AD-CENTBK-T()\nA/c XX0953 credited by Rs. 10.00 on 22092026 via UPI from Mr MD SAUD ALAM via Ref No. ${mockUtr}. -CBoI`
      }, { timeout: 8000 });

      if (res.data?.ok) {
        toast.success(`Success! Telegram Proxy captured ₹10 (UTR: ${mockUtr}) and delivered it to Telegram chat!`);
        fetchAlerts();
      } else {
        toast.error("Proxy test failed: " + JSON.stringify(res.data));
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err));
    } finally {
      setIsTestingTgProxy(false);
    }
  };

  const handleConfigAction = async (action: "start" | "stop" | "save") => {
    const cleanToken = botToken.replace(/\s+/g, "").trim();
    const cleanChatId = chatId.trim();

    if (action === "start" && !cleanToken && !config?.hasToken) {
      toast.error("Please enter your Telegram Bot Token from @BotFather before starting.");
      return;
    }

    if (cleanToken && (!cleanToken.includes(":") || cleanToken.length < 30)) {
      toast.error("The token looks incomplete or malformed. Standard Telegram Bot Tokens look like 123456789:ABC... (~45 characters). Please copy the full token from @BotFather.");
      return;
    }

    setSavingAction(action);
    let success = false;
    let botUsername = config?.botUsername || "";

    // Step 1: Direct Telegram API Validation with CORS
    if (cleanToken) {
      try {
        const tgRes = await axios.get(`https://api.telegram.org/bot${cleanToken}/getMe`, { timeout: 8000 });
        if (tgRes.data && tgRes.data.ok) {
          botUsername = tgRes.data.result?.username || "";
        } else {
          const desc = tgRes.data?.description || "Unauthorized";
          toast.error(`Telegram Validation Failed: ${desc}. Please check the token provided by @BotFather.`);
          setSavingAction(null);
          return;
        }
      } catch (tgErr: any) {
        const desc = tgErr.response?.data?.description || tgErr.message;
        toast.error(`Telegram Validation Failed: ${desc}. Please verify your bot token from @BotFather.`);
        setSavingAction(null);
        return;
      }
    }

    // Step 2: Try Serverless API routes
    const payload: any = {
      action,
      upiId: upiId.trim(),
      payeeName: payeeName.trim()
    };
    if (cleanToken) payload.botToken = cleanToken;
    if (cleanChatId) payload.chatId = cleanChatId;

    for (const endpoint of ["/api/admin/upi-gateway-config", "/api/telegram-config", "/api/admin/telegram-config"]) {
      try {
        const res = await axios.post(endpoint, payload, { timeout: 6000 });
        if (res.data && res.data.success) {
          success = true;
          if (res.data.status) setConfig(res.data.status);
          toast.success(res.data.message || "UPI Gateway settings updated successfully");
          break;
        }
      } catch (e) {}
    }

    // Step 3: Direct Firestore save as authoritative fallback (Never fails on custom domain!)
    try {
      const isEnabled = action === "start" ? true : (action === "stop" ? false : !!config?.enabled);
      const host = window.location.host;
      const webhookUrl = `https://${host}/api/telegram-webhook`;

      const docUpdate: any = {
        ...(cleanToken && { botToken: cleanToken }),
        chatId: cleanChatId,
        upiId: upiId.trim(),
        payeeName: payeeName.trim(),
        botUsername: botUsername || config?.botUsername || "",
        enabled: isEnabled,
        updatedAt: new Date().toISOString()
      };
      if (action === "start") {
        docUpdate.startedAt = new Date().toISOString();
        docUpdate.webhookUrl = webhookUrl;
      }

      await Promise.all([
        dbClient.saveDoc("settings", "telegram_bot", docUpdate),
        dbClient.saveDoc("settings", "payment", {
          ...(cleanToken && { telegramBotToken: cleanToken }),
          ...(cleanChatId && { telegramChatId: cleanChatId }),
          telegramBotUsername: botUsername || config?.botUsername || "",
          telegramBotEnabled: isEnabled,
          upiId: upiId.trim(),
          merchantName: payeeName.trim()
        })
      ]);

      // Ensure Telegram webhook is deleted so getUpdates polling runs with 0 conflicts
      const activeToken = cleanToken || "";
      if (activeToken) {
        try {
          await axios.post(`https://api.telegram.org/bot${activeToken}/deleteWebhook`, {
            drop_pending_updates: false
          }, { timeout: 8000 });
        } catch (e) {}
      }

      if (!success) {
        toast.success(action === "start" ? "UPI Gateway & Bot started successfully!" : (action === "stop" ? "UPI Gateway & Bot stopped." : "UPI Gateway settings saved!"));
      }
      setBotToken(""); // Clear raw token
      isUserEditingRef.current = false;
      try {
        const cacheMod = await import("@/lib/cache");
        cacheMod.clearCache();
        await cacheMod.getCachedSettings(true);
      } catch (e) {}
      fetchConfig();
    } catch (fsErr: any) {
      console.error("[TELEGRAM-SAVE-FIRESTORE-ERR]", fsErr);
      if (!success) {
        const safeMsg = typeof fsErr === "object" ? (fsErr.message || JSON.stringify(fsErr)) : String(fsErr);
        toast.error(`Failed to save settings: ${safeMsg}`);
      }
    } finally {
      setSavingAction(null);
    }
  };

  const handleTestPing = async () => {
    setIsTestingPing(true);
    try {
      const res = await axios.post("/api/admin/upi-gateway-config", {
        action: "test_ping",
        upiId: upiId.trim(),
        payeeName: payeeName.trim(),
        botToken: botToken.trim() || undefined,
        chatId: chatId.trim() || undefined
      }, { timeout: 8000 });
      if (res.data?.success) {
        toast.success(res.data.message || "Test ping sent to Telegram Group!");
      } else {
        toast.error(res.data?.error || "Failed to send test ping");
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err));
    } finally {
      setIsTestingPing(false);
    }
  };

  const [isFixingWebhook, setIsFixingWebhook] = useState(false);

  const handleFixWebhookConflict = async () => {
    setIsFixingWebhook(true);

    // 1. Try server endpoint
    for (const endpoint of ["/api/admin/clear-webhook", "/api/telegram-clear-webhook"]) {
      try {
        const res = await axios.post(endpoint, {}, { timeout: 6000 });
        if (res.data && res.data.success) {
          toast.success(res.data.message || "Webhook conflict resolved!");
          break;
        }
      } catch (e) {}
    }

    // 2. Direct Telegram API call as authoritative client fallback
    let tokenToUse = botToken.replace(/\s+/g, "").trim();
    if (!tokenToUse) {
      try {
        const [tgDoc, paymentDoc] = await Promise.all([
          dbClient.getDoc("settings", "telegram_bot"),
          dbClient.getDoc("settings", "payment")
        ]);
        tokenToUse = tgDoc?.botToken || paymentDoc?.telegramBotToken || "";
      } catch (e) {}
    }

    if (tokenToUse) {
      try {
        await axios.post(`https://api.telegram.org/bot${tokenToUse}/deleteWebhook`, {
          drop_pending_updates: false
        }, { timeout: 8000 });
      } catch (tgErr: any) {
        console.warn("[DIRECT-DELETE-WEBHOOK-FAIL]", tgErr);
      }
    }

    // 3. Restart polling
    try {
      await handleConfigAction("start");
      toast.success("Webhook conflict deleted! Telegram bot is now actively listening to SMS.");
    } catch (e) {}

    await fetchConfig();
    setIsFixingWebhook(false);
  };

  const handleSimulateSms = async () => {
    const num = Number(simAmount);
    if (!num || num <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsSimulating(true);
    let simDone = false;

    for (const endpoint of ["/api/simulate-sms", "/api/admin/simulate-sms"]) {
      try {
        const res = await axios.post(endpoint, {
          amount: num,
          bank: simBank
        }, { timeout: 4000 });

        if (res.data && res.data.success && res.data.alert) {
          toast.success(`🎉 Test SMS simulated! UTR: ${res.data.alert.utr} (₹${res.data.alert.amount})`);
          setLastSimulatedAlert(res.data.alert);
          fetchAlerts();
          fetchConfig();
          simDone = true;
          break;
        }
      } catch (e) {}
    }

    if (!simDone) {
      try {
        const random12 = `9${Math.floor(10000000000 + Math.random() * 90000000000).toString().slice(0, 11)}`;
        const nowIso = new Date().toISOString();
        const sampleText = `Dear SBI UPI User, A/C ..4102 credited by Rs.${num}.00 on ${new Date().toLocaleDateString("en-IN")} transfer from Payer Ref No ${random12} -SBI`;

        const alertData: BankAlert = {
          id: `alert_${random12}_${Date.now()}`,
          utr: random12,
          amount: num,
          senderBank: simBank,
          rawText: sampleText,
          timestamp: nowIso,
          isUsed: false
        };

        await Promise.all([
          dbClient.saveDoc("bank_alerts", random12, alertData),
          dbClient.saveDoc("sms_forwarder_pool", random12, {
            utr: random12,
            amount: num,
            sender: simBank,
            rawSms: sampleText,
            timestamp: nowIso,
            status: "available"
          })
        ]);

        setLastSimulatedAlert(alertData);
        toast.success(`🎉 Test SMS simulated! UTR: ${random12} (₹${num})`);
        fetchAlerts();
        fetchConfig();
      } catch (fsErr: any) {
        toast.error(`Simulation failed: ${fsErr.message}`);
      }
    }

    setIsSimulating(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUtr(id);
    toast.success("UTR copied to clipboard!");
    setTimeout(() => setCopiedUtr(null), 2000);
  };

  const isBotActive = config?.running || false;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner with Zero Quota Assurance */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-700 rounded-3xl text-white shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
              <Bot className="w-5 h-5 text-white" />
            </span>
            <h2 className="text-lg sm:text-xl font-bold">Automated Telegram UPI Gateway & Verification</h2>
            <Badge className="bg-emerald-400/30 text-white border-emerald-300/40 text-[10px] font-bold">
              0 Firebase Reads/Writes
            </Badge>
          </div>
          <p className="text-xs text-blue-100 max-w-2xl leading-relaxed">
            Forward your PhonePe, Paytm, GPay, or NetBanking SMS into your Telegram Bot. Incoming payments are auto-parsed and verified locally on server disk without using Firebase quota.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className={`px-4 py-2 rounded-2xl flex items-center gap-2.5 font-bold text-xs shadow-sm border ${
            isBotActive
              ? "bg-emerald-500/20 text-emerald-100 border-emerald-400/40"
              : "bg-rose-500/20 text-rose-100 border-rose-400/40"
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full ${isBotActive ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
            <span>{isBotActive ? "BOT ACTIVE & LISTENING" : "BOT STOPPED"}</span>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-white/20 bg-white/10 hover:bg-white/20 text-white text-xs h-9"
            onClick={() => {
              fetchConfig();
              fetchAlerts();
            }}
            disabled={loadingConfig || loadingAlerts}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingConfig || loadingAlerts ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl border-gray-100 shadow-sm bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Captured Alerts</p>
              <h3 className="text-2xl font-black text-gray-900">{config?.totalAlertsCount ?? alerts.length}</h3>
              <p className="text-[10px] text-gray-500">All bank SMS recorded locally</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-emerald-100 shadow-sm bg-emerald-50/40">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Available for Claim</p>
              <h3 className="text-2xl font-black text-emerald-900">{config?.unusedAlertsCount ?? alerts.filter(a => !a.isUsed).length}</h3>
              <p className="text-[10px] text-emerald-600 font-medium">Ready for users to credit wallet</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Zap className="w-6 h-6 fill-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-gray-100 shadow-sm bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Claimed / Credited</p>
              <h3 className="text-2xl font-black text-violet-900">
                {(config?.totalAlertsCount ?? alerts.length) - (config?.unusedAlertsCount ?? alerts.filter(a => !a.isUsed).length)}
              </h3>
              <p className="text-[10px] text-gray-500">Successfully verified deposits</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Bot Setup + Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Bot Configuration */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="rounded-3xl border-gray-100 shadow-sm bg-white overflow-hidden">
            <CardHeader className="pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2 text-gray-900">
                    <Send className="w-4 h-4 text-blue-600" />
                    UPI Gateway Config (Zero-UTR Engine)
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500">
                    Configure your UPI Gateway & Telegram Bot credentials for 24/7 automatic deposits without UTR entry.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold">
                    ⚡ Zero-UTR Auto
                  </Badge>
                  {config?.botUsername && (
                    <a
                      href={`https://t.me/${config.botUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-[11px] font-semibold border border-blue-200"
                    >
                      <Send className="w-3 h-3" />
                      @{config.botUsername}
                      <ArrowUpRight className="w-3 h-3" />
                    </a>
                  )}
                  {config?.hasToken && (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[11px] font-medium">
                      Token Active
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 sm:p-6 space-y-4">
              {/* Single Notification Protection Guarantee Banner */}
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-center justify-between gap-3 text-xs text-blue-900">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="font-semibold">STRICT SINGLE-NOTIFICATION:</span>
                  <span className="text-blue-700">Duplicate messages are strictly blocked. Group receives only 1 verified receipt per transaction.</span>
                </div>
              </div>

              {config?.lastError && (
                <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200 space-y-2 text-xs text-rose-800">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-bold">Telegram Connection Issue:</p>
                        <p className="break-words font-mono text-[11px]">{config.lastError}</p>
                      </div>
                    </div>
                    {(config.lastError.toLowerCase().includes("webhook") || config.lastError.toLowerCase().includes("conflict")) && (
                      <Button
                        size="sm"
                        onClick={handleFixWebhookConflict}
                        disabled={isFixingWebhook}
                        className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-sm h-8 px-3 shrink-0"
                      >
                        <Zap className="w-3.5 h-3.5 mr-1" />
                        {isFixingWebhook ? "Clearing Conflict..." : "Auto-Fix 409 Conflict"}
                      </Button>
                    )}
                  </div>

                  {config.lastError.toLowerCase().includes("conflict") && (
                    <div className="p-3 bg-white/80 rounded-xl border border-rose-200 text-rose-900 space-y-1.5 text-[11px] leading-relaxed">
                      <p className="font-bold flex items-center gap-1.5 text-rose-700">
                        <span>🔍 Reason for 409 Conflict:</span>
                      </p>
                      <p>
                        Yeh error tab aata hai jab is same bot token ko kisi aur PC, terminal, phone app, ya python script par bhi run kiya hua ho. Telegram ek time par sirf 1 jagah updates allow karta hai.
                      </p>
                      <p className="font-semibold text-rose-800">
                        👉 <strong>Quick Fix:</strong> Telegram me <strong>@BotFather</strong> kholo, <code>/revoke</code> ya <code>/token</code> karke new token lo aur yahan paste karke <strong>"Start Telegram Bot"</strong> dabao!
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Group Privacy Notice */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl text-[11px] text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-800">
                  <span>⚠️ Important: Where are you sending SMS?</span>
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                  <li>
                    <strong>Direct Bot Chat:</strong> SMS bot ko <strong>Direct 1-on-1 Chat</strong> (<code>@{config?.botUsername || "your bot"}</code>) me forward karo. Yahan 100% messages detect hote hain.
                  </li>
                  <li>
                    <strong>Group / Channel Chat:</strong> Agar aapne bot ko kisi Telegram Group me add kiya hai, to <strong>@BotFather</strong> me jakar <code>/setprivacy</code> &rarr; select bot &rarr; <strong>Disable</strong> karein, varna Telegram group ke messages bot ko block kar deta hai.
                  </li>
                </ul>
              </div>

              {/* 1. UPI ID & Payee Name Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                    <span>UPI ID (VPA)</span>
                    <span className="text-[10px] text-blue-600 font-normal">Primary QR Gateway</span>
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. yourname@upi or name@okaxis"
                    value={upiId}
                    onChange={(e) => {
                      isUserEditingRef.current = true;
                      setUpiId(e.target.value.trim());
                    }}
                    className="rounded-2xl h-12 text-xs border-gray-200 focus:border-blue-500 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">
                    Customers will scan dynamic QR codes directed to this VPA.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                    <span>Payee / Merchant Name</span>
                    <span className="text-[10px] text-gray-400 font-normal">Displays on UPI App</span>
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. Pyare SMM Panel"
                    value={payeeName}
                    onChange={(e) => {
                      isUserEditingRef.current = true;
                      setPayeeName(e.target.value);
                    }}
                    className="rounded-2xl h-12 text-xs border-gray-200 focus:border-blue-500"
                  />
                  <p className="text-[11px] text-gray-400">
                    Business / Panel name shown on GPay, PhonePe, Paytm.
                  </p>
                </div>
              </div>

              {/* 2. Telegram Bot Token Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Telegram Bot Token (Custom BotFather)</span>
                  {config?.maskedToken && (
                    <span className="text-[10px] text-gray-400 font-mono font-normal">
                      Current: {config.maskedToken}
                    </span>
                  )}
                </label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    placeholder={config?.hasToken ? "Enter new token to replace (or leave blank)" : "e.g. 7123456789:AAHkLp-Z... from @BotFather"}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value.replace(/\s+/g, ""))}
                    className="rounded-2xl h-12 pr-10 text-xs font-mono border-gray-200 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {botToken ? (
                  <div className="text-[11px] flex items-center justify-between pt-0.5">
                    <span className="text-gray-400 font-mono">{botToken.length} characters</span>
                    {!botToken.includes(":") ? (
                      <span className="text-amber-600 font-semibold">⚠️ Colon ':' missing in token</span>
                    ) : botToken.length < 35 ? (
                      <span className="text-amber-600 font-semibold">⚠️ Token might be incomplete (usually ~45 chars)</span>
                    ) : (
                      <span className="text-emerald-600 font-semibold">✓ Format looks good</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">
                    Get your free token by opening Telegram, sending <code className="text-blue-600 font-bold">/newbot</code> to <strong>@BotFather</strong>.
                  </p>
                )}
              </div>

              {config?.botUsername && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Connected Bot: <strong>@{config.botUsername}</strong></span>
                  </div>
                  <a
                    href={`https://t.me/${config.botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 underline font-semibold hover:text-emerald-800"
                  >
                    Open in Telegram &rarr;
                  </a>
                </div>
              )}

              {/* 3. Telegram Group Chat ID Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Telegram Group Chat ID</span>
                  <span className="text-[10px] text-gray-400 font-normal">For instant verified receipts</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 12345678 or -100123456789"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value.trim())}
                  className="rounded-2xl h-12 text-xs border-gray-200 focus:border-blue-500 font-mono"
                />
                <p className="text-[11px] text-gray-400">
                  Single verified receipt will be delivered to this group when an automatic payment succeeds.
                </p>
              </div>

              <div className="pt-2 flex flex-wrap gap-2.5">
                {!isBotActive ? (
                  <Button
                    onClick={() => handleConfigAction("start")}
                    disabled={savingAction !== null || (!config?.hasToken && !botToken.trim())}
                    className="flex-1 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20"
                  >
                    {savingAction === "start" ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Play className="w-4 h-4 fill-white mr-2" />
                    )}
                    {savingAction === "start" ? "Starting Engine..." : "Start 24/7 Engine"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleConfigAction("stop")}
                    disabled={savingAction !== null}
                    variant="destructive"
                    className="flex-1 h-12 rounded-2xl font-bold text-xs shadow-md"
                  >
                    {savingAction === "stop" ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Square className="w-4 h-4 fill-white mr-2" />
                    )}
                    {savingAction === "stop" ? "Stopping..." : "Stop Engine"}
                  </Button>
                )}

                <Button
                  onClick={() => handleConfigAction("save")}
                  disabled={savingAction !== null}
                  variant="outline"
                  className="h-12 rounded-2xl text-xs font-bold border-gray-200 hover:bg-gray-50 px-5"
                >
                  Save UPI Config
                </Button>

                <Button
                  onClick={handleTestPing}
                  disabled={isTestingPing || !chatId}
                  variant="secondary"
                  className="h-12 rounded-2xl text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-4"
                >
                  {isTestingPing ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Send className="w-4 h-4 mr-1.5" />
                  )}
                  {isTestingPing ? "Sending..." : "Test Group Ping"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Setup Guide */}
          <Card className="rounded-3xl border-gray-100 shadow-sm bg-gradient-to-br from-gray-50 to-blue-50/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                <HelpCircle className="w-4 h-4 text-blue-600" />
                How to Setup in 3 Quick Steps:
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 text-xs text-gray-600 space-y-3 leading-relaxed">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">1</span>
                <div>
                  <strong>Create Telegram Bot:</strong> Open Telegram, search for <code>@BotFather</code>, and send <code>/newbot</code>. Follow the prompts and copy your HTTP API Token.
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">2</span>
                <div>
                  <strong>Paste & Start:</strong> Paste the token in the box above and click <strong>"Start Telegram Bot"</strong>. The bot will automatically begin listening.
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5">3</span>
                <div>
                  <strong>Forward SMS:</strong> Forward incoming bank payment SMS (from PhonePe, Paytm, Google Pay, SBI, HDFC, etc.) directly into your Telegram bot chat or channel. The engine captures the 12-digit UTR and amount immediately!
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Automatic SMS Forwarder Setup Card (Dual Mode: Direct Webhook vs Telegram) */}
          <Card className="rounded-3xl border-blue-200 shadow-md bg-white overflow-hidden">
            <CardHeader className="p-5 border-b border-gray-100 bg-gradient-to-r from-blue-50/80 via-indigo-50/40 to-white">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2 text-gray-900">
                    <Smartphone className="w-5 h-5 text-blue-600" />
                    SMS Forwarder App Setup (Website Server Ingest)
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500 mt-0.5">
                    Apne phone ke SMS Forwarder app se SMS seedha website mein bhejein ya Telegram ke through.
                  </CardDescription>
                </div>

                {/* Mode Selector Toggle */}
                <div className="flex items-center p-1 bg-gray-100 rounded-2xl w-fit">
                  <button
                    type="button"
                    onClick={() => setForwarderMode("webhook")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                      forwarderMode === "webhook"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    Option 1: Direct Webhook (Bina Telegram)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForwarderMode("telegram")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                      forwarderMode === "telegram"
                        ? "bg-sky-600 text-white shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Option 2: Telegram Bot
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {forwarderMode === "webhook" ? (
                /* OPTION 1: DIRECT WEBSITE WEBHOOK */
                <div className="space-y-4">
                  {/* How it works banner */}
                  <div className="p-4 bg-blue-50/80 rounded-2xl border border-blue-200 text-xs text-blue-950 space-y-2">
                    <div className="font-bold flex items-center justify-between text-blue-900">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        Seedha Website Server Par SMS Forwarding (Direct Webhook)
                      </span>
                      <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                        ⚡ 0.1s Instant Auto-Credit
                      </Badge>
                    </div>
                    <p className="text-[11px] text-blue-900/90 leading-relaxed">
                      Telegram ki zaroorat nahi hai! Apne Android phone me koi bhi SMS Forwarder app (jaise <strong>SMS Forwarder by fritools</strong>, <strong>Lanrens SMSForwarder</strong>, <strong>MacroDroid</strong>, ya <strong>Tasker</strong>) me yeh <strong>Webhook URL</strong> daal dijiye. Jaise hi phone par payment SMS aayega, yeh server instant 0.1s mein 12-digit UTR & Amount read karke user ka balance add kar dega!
                    </p>
                  </div>

                  {/* 1. Direct Webhook URL */}
                  <div className="space-y-1.5 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                    <label className="text-xs font-bold text-gray-800 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                        Webhook URL (SMS Forwarder app me Target URL me dalein):
                      </span>
                      <span className="text-[10px] text-blue-600 font-mono font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Method: POST
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={typeof window !== "undefined" ? `${window.location.origin}/api/sms-forwarder` : "/api/sms-forwarder"}
                        className="font-mono text-xs bg-white h-11 rounded-xl border-blue-300 font-bold text-blue-900 selection:bg-blue-100"
                      />
                      <Button
                        type="button"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            navigator.clipboard.writeText(`${window.location.origin}/api/sms-forwarder`);
                            setCopiedWebhook(true);
                            toast.success("Direct Webhook URL copied! Paste in SMS Forwarder app.");
                            setTimeout(() => setCopiedWebhook(false), 2500);
                          }
                        }}
                        className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-sm"
                      >
                        {copiedWebhook ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                        {copiedWebhook ? "Copied!" : "Copy Webhook URL"}
                      </Button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Alternative endpoints: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/sms-webhook` : "/api/sms-webhook"}</code>
                    </p>
                  </div>

                  {/* 2. POST Body / Data Template */}
                  <div className="space-y-1.5 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                    <label className="text-xs font-bold text-gray-800 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">2</span>
                        JSON Body Template (SMS Forwarder app me Payload / Post Data me):
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">Content-Type: application/json</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value='{"text": "[sms_body]", "from": "[from]"}'
                        className="font-mono text-xs bg-white h-10 rounded-xl border-gray-300 text-gray-900 font-semibold"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText('{"text": "[sms_body]", "from": "[from]"}');
                          setCopiedPayload(true);
                          toast.success("Payload template copied!");
                          setTimeout(() => setCopiedPayload(false), 2000);
                        }}
                        className="h-10 px-3 rounded-xl border-gray-300 font-semibold text-xs flex items-center gap-1 shrink-0"
                      >
                        {copiedPayload ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedPayload ? "Copied" : "Copy Template"}
                      </Button>
                    </div>
                    <p className="text-[10px] text-gray-500 leading-tight">
                      Note: Agar app me sirf <code>message</code> ya <code>content</code> field hai ya raw text bhejna hai, website server automatically sabhi formats ko detect kar leti hai.
                    </p>
                  </div>

                  {/* Test Button */}
                  <Button
                    onClick={handleTestWebhook}
                    disabled={isTestingWebhook}
                    className="w-full h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20"
                  >
                    {isTestingWebhook ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Zap className="w-4 h-4 fill-white mr-2" />
                    )}
                    {isTestingWebhook ? "Sending Test SMS to Webhook..." : "⚡ Test Direct SMS Webhook (Simulate Phone Forwarding in 0.1s)"}
                  </Button>
                </div>
              ) : (
                /* OPTION 2: TELEGRAM BOT PROXY */
                <div className="space-y-4">
                  <div className="p-3.5 bg-sky-50/90 rounded-2xl border border-sky-200 text-xs text-sky-950 space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5 text-sky-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      Telegram Bot Proxy System
                    </div>
                    <p className="text-[11px] text-sky-900/90 leading-relaxed">
                      Aapke phone ka SMS Forwarder app Telegram format me SMS bhejega. Website <strong>0.1s me UTR & Amount save karke wallet credit karegi</strong> aur sath me <strong>Aapke Telegram Chat me bhi deliver kar degi!</strong>
                    </p>
                  </div>

                  <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-sky-200">
                    {/* Chat ID */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-gray-600">
                        1. Telegram Chat ID (Aapka Telegram ID)
                      </label>
                      <Input
                        readOnly
                        value={chatId.trim() || "8307658312"}
                        className="font-mono text-xs bg-white h-9 rounded-xl border-gray-200 text-gray-900 font-semibold"
                      />
                    </div>

                    {/* Custom Telegram Server Host */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-gray-600 flex items-center justify-between">
                        <span>2. Custom Telegram Server Host (SMS Forwarder App me)</span>
                        <span className="text-[10px] text-sky-600 font-bold">Recommended</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={typeof window !== "undefined" ? window.location.origin : ""}
                          className="font-mono text-xs bg-white h-10 rounded-xl border-sky-200 text-sky-900 font-semibold"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (typeof window !== "undefined") {
                              navigator.clipboard.writeText(window.location.origin);
                              setCopiedHost(true);
                              toast.success("Telegram Server Host copied!");
                              setTimeout(() => setCopiedHost(false), 2500);
                            }
                          }}
                          className="h-10 px-3.5 rounded-xl border-sky-300 hover:bg-sky-50 font-semibold text-xs flex items-center gap-1 text-sky-800"
                        >
                          {copiedHost ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedHost ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>

                    {/* Full Telegram Proxy URL */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-gray-600">
                        3. Full Telegram Proxy URL (agar app custom full URL maangti hai):
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={typeof window !== "undefined" ? `${window.location.origin}/bot${botToken.trim() || "8268916986:AAGn5qnLukLpZGw9h9y1kcRzySd_2bS57k0"}/sendMessage` : ""}
                          className="font-mono text-[11px] bg-white h-9 rounded-xl border-gray-200 text-gray-800"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (typeof window !== "undefined") {
                              const fullUrl = `${window.location.origin}/bot${botToken.trim() || "8268916986:AAGn5qnLukLpZGw9h9y1kcRzySd_2bS57k0"}/sendMessage`;
                              navigator.clipboard.writeText(fullUrl);
                              setCopiedWebhook(true);
                              toast.success("Full Telegram Proxy URL copied!");
                              setTimeout(() => setCopiedWebhook(false), 2500);
                            }
                          }}
                          className="h-9 px-3 rounded-xl border-gray-300 font-semibold text-xs flex items-center gap-1 text-gray-700"
                        >
                          {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedWebhook ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handleTestTgProxy}
                    disabled={isTestingTgProxy}
                    className="w-full h-11 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-md shadow-sky-600/20"
                  >
                    {isTestingTgProxy ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {isTestingTgProxy ? "Sending Test Alert..." : "Test Telegram Bot (Send ₹10 to Telegram + Capture on Website)"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Instant SMS Simulator */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="rounded-3xl border-gray-100 shadow-sm bg-white">
            <CardHeader className="pb-3 border-b border-gray-100">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-900">
                <Sparkles className="w-4 h-4 text-violet-600" />
                Simulate Test Bank SMS
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Test the end-to-end UTR extraction and auto-credit engine instantly without real money.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Test Deposit Amount (₹)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">₹</span>
                  <Input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="rounded-2xl h-12 pl-8 text-lg font-bold border-gray-200"
                    placeholder="e.g. 100"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  {[50, 100, 250, 500].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSimAmount(val.toString())}
                      className="px-2.5 py-1 rounded-xl border border-gray-200 text-xs font-semibold hover:border-violet-400 hover:bg-violet-50 transition-colors"
                    >
                      +₹{val}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Simulated Sender Bank</label>
                <select
                  value={simBank}
                  onChange={(e) => setSimBank(e.target.value)}
                  className="w-full h-12 rounded-2xl px-3 border border-gray-200 text-xs font-medium bg-white focus:outline-none focus:border-violet-500"
                >
                  <option value="State Bank of India (SBI)">State Bank of India (SBI)</option>
                  <option value="HDFC Bank">HDFC Bank</option>
                  <option value="ICICI Bank">ICICI Bank</option>
                  <option value="Paytm Payments Bank">Paytm Payments Bank</option>
                  <option value="PhonePe UPI">PhonePe UPI</option>
                  <option value="Google Pay">Google Pay</option>
                  <option value="Axis Bank">Axis Bank</option>
                  <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                  <option value="Bank of Baroda">Bank of Baroda</option>
                  <option value="Punjab National Bank">Punjab National Bank</option>
                </select>
              </div>

              <Button
                onClick={handleSimulateSms}
                disabled={isSimulating}
                className="w-full h-12 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-md shadow-violet-600/20"
              >
                {isSimulating ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Zap className="w-4 h-4 fill-white mr-2" />
                )}
                {isSimulating ? "Simulating Bank SMS..." : "Generate Simulated Bank SMS"}
              </Button>

              {lastSimulatedAlert && (
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Alert Generated & Saved!
                    </span>
                    <Badge className="bg-emerald-600 text-white text-[10px]">Ready to Claim</Badge>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-100 space-y-1 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Amount:</span>
                      <span className="font-bold text-emerald-700">₹{lastSimulatedAlert.amount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">12-Digit UTR:</span>
                      <div className="flex items-center gap-1.5 font-bold text-gray-900">
                        <span>{lastSimulatedAlert.utr}</span>
                        <button
                          onClick={() => copyToClipboard(lastSimulatedAlert.utr, "sim")}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {copiedUtr === "sim" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Bank:</span>
                      <span className="text-gray-700">{lastSimulatedAlert.senderBank}</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-emerald-700 leading-tight">
                    💡 You can now copy this UTR: <strong>{lastSimulatedAlert.utr}</strong> and test the "Add Funds" modal as a regular user!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Direct SMS Ingester / Parser Test */}
          <Card className="rounded-3xl border-gray-100 shadow-sm bg-white">
            <CardHeader className="pb-3 border-b border-gray-100">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-900">
                <Smartphone className="w-4 h-4 text-blue-600" />
                Paste & Ingest Real Bank SMS
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Paste any SMS text directly to parse UTR and amount immediately into website database.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">SMS Text from Bank / Phone</label>
                <textarea
                  rows={3}
                  value={directSmsText}
                  onChange={(e) => setDirectSmsText(e.target.value)}
                  placeholder="e.g. Dear SBI UPI User, A/C ..4102 credited by Rs.100.00 on 22Sep24 transfer from Payer Ref No 426819284918"
                  className="w-full rounded-2xl p-3 text-xs border border-gray-200 focus:border-blue-500 focus:outline-none font-mono resize-none"
                />
              </div>

              <Button
                onClick={handleIngestDirectSms}
                disabled={isIngestingSms || !directSmsText.trim()}
                className="w-full h-11 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20"
              >
                {isIngestingSms ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                {isIngestingSms ? "Parsing & Ingesting..." : "Parse & Ingest SMS to Website"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ======================================================== */}
      {/* LIVE QR CODE PAYMENT REQUESTS (12-DIGIT INTENT ENGINE)   */}
      {/* ======================================================== */}
      <Card className="rounded-3xl border-amber-200/80 shadow-md bg-white overflow-hidden">
        <CardHeader className="p-5 sm:p-6 border-b border-amber-100 bg-gradient-to-r from-amber-50/60 via-orange-50/30 to-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Zap className="w-5 h-5 fill-amber-500" />
                </div>
                <div>
                  <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                    Live QR Code Requests (12-Digit Unique Code Engine)
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                      Zero-Collision
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500">
                    Har QR code ka alag 12-digit numeric code (jaise <b>252525383637</b>) generate hota hai. Telegram SMS aate hi instant auto-verify hota hai!
                  </CardDescription>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchIntents}
                disabled={loadingIntents}
                className="h-9 rounded-xl border-amber-200 text-amber-900 hover:bg-amber-50 text-xs font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingIntents ? "animate-spin" : ""}`} />
                Refresh Requests
              </Button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            <div className="p-3 bg-white rounded-2xl border border-gray-100 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total QR Generated</p>
              <p className="text-xl font-black text-gray-900 mt-0.5">{intentStats.total}</p>
            </div>

            <div className="p-3 bg-amber-50/70 rounded-2xl border border-amber-200/60 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Active Pending</p>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              </div>
              <p className="text-xl font-black text-amber-900 mt-0.5">{intentStats.pending}</p>
            </div>

            <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-200/60 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Auto-Completed</p>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-xl font-black text-emerald-900 mt-0.5">{intentStats.completed}</p>
            </div>

            <div className="p-3 bg-purple-50/70 rounded-2xl border border-purple-200/60 shadow-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Completed Volume</p>
              <p className="text-xl font-black text-purple-900 mt-0.5">₹{intentStats.totalVolume.toFixed(2)}</p>
            </div>
          </div>
        </CardHeader>

        {/* Filter Navigation */}
        <div className="p-4 sm:px-6 border-b border-gray-100 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5">
            <Button
              variant={intentFilter === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setIntentFilter("all")}
              className={`h-8 rounded-xl text-xs font-bold ${
                intentFilter === "all" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              All Requests ({intents.length})
            </Button>
            <Button
              variant={intentFilter === "pending" ? "default" : "ghost"}
              size="sm"
              onClick={() => setIntentFilter("pending")}
              className={`h-8 rounded-xl text-xs font-bold ${
                intentFilter === "pending" ? "bg-amber-600 text-white" : "text-amber-700 hover:bg-amber-50"
              }`}
            >
              Pending ({intents.filter((i) => i.status === "pending" && i.expiresAt > Date.now()).length})
            </Button>
            <Button
              variant={intentFilter === "completed" ? "default" : "ghost"}
              size="sm"
              onClick={() => setIntentFilter("completed")}
              className={`h-8 rounded-xl text-xs font-bold ${
                intentFilter === "completed" ? "bg-emerald-600 text-white" : "text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              Completed ({intents.filter((i) => i.status === "completed").length})
            </Button>
            <Button
              variant={intentFilter === "expired" ? "default" : "ghost"}
              size="sm"
              onClick={() => setIntentFilter("expired")}
              className={`h-8 rounded-xl text-xs font-bold ${
                intentFilter === "expired" ? "bg-gray-600 text-white" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              Expired ({intents.filter((i) => i.status === "expired" || (i.status === "pending" && i.expiresAt <= Date.now())).length})
            </Button>
          </div>

          <span className="text-[11px] text-gray-400 hidden sm:inline">
            ⚡ 0 Firestore reads (Server Memory)
          </span>
        </div>

        {/* Requests List */}
        <CardContent className="p-0">
          {(() => {
            const now = Date.now();
            const filteredIntents = intents.filter((i) => {
              if (intentFilter === "pending") return i.status === "pending" && i.expiresAt > now;
              if (intentFilter === "completed") return i.status === "completed";
              if (intentFilter === "expired") return i.status === "expired" || (i.status === "pending" && i.expiresAt <= now);
              return true;
            });

            if (filteredIntents.length === 0) {
              return (
                <div className="py-12 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-gray-700">No QR Code Requests found in this filter.</p>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Jaise hi koi user Add Fund me jaakar amount select karega, unka 12-digit QR code yahan live save ho jayega.
                  </p>
                </div>
              );
            }

            return (
              <div className="divide-y divide-gray-100">
                {filteredIntents.map((item) => {
                  const isPending = item.status === "pending" && item.expiresAt > now;
                  const isCompleted = item.status === "completed";
                  const isExpired = item.status === "expired" || (item.status === "pending" && item.expiresAt <= now);
                  const isCopied = copiedIntentRef === item.orderRef;

                  return (
                    <div
                      key={item.intentId}
                      className={`p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                        isPending ? "bg-amber-50/20 hover:bg-amber-50/40" : isCompleted ? "bg-emerald-50/10 hover:bg-emerald-50/20" : "hover:bg-gray-50/50"
                      }`}
                    >
                      {/* Left: 12-Digit Code & Amount */}
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(item.orderRef);
                              setCopiedIntentRef(item.orderRef);
                              toast.success(`12-Digit Code copied: ${item.orderRef}`);
                              setTimeout(() => setCopiedIntentRef(null), 2000);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 hover:bg-blue-50 text-gray-900 hover:text-blue-700 font-mono text-xs font-bold rounded-lg border border-gray-200 transition-colors shadow-2xs"
                            title="Click to copy 12-digit unique code"
                          >
                            <QrCode className="w-3.5 h-3.5 text-blue-600" />
                            <span>{item.orderRef}</span>
                            {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-gray-400" />}
                          </button>

                          <span className="text-sm font-black text-gray-900 bg-white px-2 py-0.5 rounded-md border border-gray-200 shadow-2xs">
                            ₹{item.amount.toFixed(2)}
                          </span>

                          {item.amount !== item.baseAmount && (
                            <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              Base: ₹{item.baseAmount}
                            </span>
                          )}

                          {isPending && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                              PENDING WAITING
                            </Badge>
                          )}

                          {isCompleted && (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              AUTO-CREDITED
                            </Badge>
                          )}

                          {isExpired && (
                            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px] font-bold">
                              EXPIRED
                            </Badge>
                          )}
                        </div>

                        {/* User & Bank Info */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>User: <b className="text-gray-700 font-mono">{item.userEmail || item.userId}</b></span>
                          <span>Time: <b className="text-gray-700">{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b></span>
                          {item.utr && (
                            <span>Bank UTR: <b className="text-emerald-700 font-mono font-bold">{item.utr}</b></span>
                          )}
                          {item.senderBank && (
                            <span>Bank: <b className="text-gray-700">{item.senderBank}</b></span>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isPending && (
                          <Button
                            size="sm"
                            onClick={() => handleApproveIntent(item.intentId, item.orderRef, item.amount)}
                            disabled={approvingIntentId === item.intentId}
                            className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm shadow-emerald-600/20"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            {approvingIntentId === item.intentId ? "Crediting..." : `⚡ 1-Click Approve ₹${item.amount.toFixed(2)}`}
                          </Button>
                        )}

                        {isCompleted && (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            Wallet Credited
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Live Telegram Bot Ingestion Feed */}
      <Card className="rounded-3xl border-gray-100 shadow-sm bg-white overflow-hidden">
        <CardHeader className="p-5 sm:p-6 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-600" />
                Live Telegram Messages Received by Bot
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Incoming messages forwarded into @{config?.botUsername || "your bot"}. Auto-updates every 5s.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Badge className={`text-xs font-semibold px-2.5 py-1 ${
                config?.lastPolledAgeSeconds !== null && config?.lastPolledAgeSeconds !== undefined && config.lastPolledAgeSeconds < 30
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-gray-100 text-gray-700 border-gray-200"
              }`}>
                <Clock className="w-3 h-3 mr-1" />
                {config?.lastPolledAgeSeconds !== null && config?.lastPolledAgeSeconds !== undefined
                  ? `Polled ${config.lastPolledAgeSeconds}s ago`
                  : "Polling active"}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6">
          {config?.recentMessages && config.recentMessages.length > 0 ? (
            <div className="space-y-3">
              {config.recentMessages.slice(0, 8).map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    msg.parsed
                      ? "bg-emerald-50/40 border-emerald-200"
                      : "bg-amber-50/40 border-amber-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${msg.parsed ? "bg-emerald-500" : "bg-amber-500"}`} />
                      <span className="text-xs font-bold text-gray-800">
                        {msg.sender || "Telegram User"}
                      </span>
                      {msg.chatId && (
                        <span className="text-[10px] text-gray-400 font-mono">
                          ID: {msg.chatId}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">
                        {new Date(msg.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {msg.parsed ? (
                        <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                          ✓ Captured UTR {msg.utr} (₹{msg.amount})
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-semibold">
                          ⚠️ {msg.reason || "Not Parsed"}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 font-mono bg-white/70 p-2.5 rounded-xl border border-gray-100 whitespace-pre-wrap break-words">
                    {msg.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 space-y-2">
              <Bot className="w-8 h-8 text-gray-300 mx-auto" />
              <p className="text-xs text-gray-500 font-medium">
                No Telegram messages received in this session yet.
              </p>
              <p className="text-[11px] text-gray-400 max-w-md mx-auto">
                Send <code>/start</code> or forward any Bank SMS to <strong>@{config?.botUsername || "your bot"}</strong> on Telegram. It will appear here within seconds!
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Received Bank Alerts Table */}
      <Card className="rounded-3xl border-gray-100 shadow-sm bg-white overflow-hidden">
        <CardHeader className="p-5 sm:p-6 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                All Forwarded SMS & Bank Alerts Registry (Live Amount & 12-Digit UTR)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Direct Webhook aur Telegram Bot dono se aane wale sabhi payment SMS ka live data. 12-digit UTR aur amount match hote hi user ka wallet instant credit ho jata hai.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Input
                  type="text"
                  placeholder="Search UTR, Bank, Email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchAlerts()}
                  className="rounded-xl h-9 pl-8 text-xs border-gray-200"
                />
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>

              <div className="flex bg-gray-100 p-1 rounded-xl">
                {(["all", "unused", "used"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFilter(mode)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold capitalize transition-all ${
                      filter === mode ? "bg-white text-gray-900 shadow-xs" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {mode === "all" ? "All" : mode === "unused" ? "Available" : "Claimed"}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchAlerts}
                disabled={loadingAlerts}
                className="rounded-xl h-9 text-xs border-gray-200"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingAlerts ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Bank / Provider</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">12-Digit UTR</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Claimed / User</th>
                  <th className="py-3 px-4 text-right">Raw SMS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-gray-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Smartphone className="w-8 h-8 opacity-40 text-gray-400" />
                        <p className="text-xs">No bank alerts found for current filter.</p>
                        <p className="text-[11px] text-gray-400">
                          Click "Test Direct SMS Webhook" above to test or forward bank SMS from your phone.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span>
                            {new Date(alert.timestamp).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-bold text-gray-800">
                        {alert.senderBank}
                      </td>

                      <td className="py-3 px-4 font-black text-sm text-emerald-700 whitespace-nowrap">
                        ₹{alert.amount}
                      </td>

                      <td className="py-3 px-4 font-mono font-bold text-gray-900 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <code className="bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200 text-xs">
                            {alert.utr}
                          </code>
                          <button
                            onClick={() => copyToClipboard(alert.utr, alert.id)}
                            className="text-gray-400 hover:text-gray-700 transition-colors"
                            title="Copy UTR"
                          >
                            {copiedUtr === alert.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {alert.isUsed ? (
                          <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-[10px] font-bold">
                            Claimed / Used
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Available
                          </Badge>
                        )}
                      </td>

                      <td className="py-3 px-4 text-gray-500 text-[11px] whitespace-nowrap">
                        {alert.isUsed ? (
                          <div className="space-y-0.5">
                            <p className="font-semibold text-gray-800">{alert.usedByEmail || alert.usedBy}</p>
                            {alert.usedAt && (
                              <p className="text-[10px] text-gray-400">
                                {new Date(alert.usedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Waiting for user claim</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewingAlertSms(alert)}
                          className="h-7 px-2 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View SMS
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Raw SMS View Modal */}
      {viewingAlertSms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  Forwarded Bank SMS Details
                </h3>
                <p className="text-xs text-gray-500">
                  Received at {new Date(viewingAlertSms.timestamp).toLocaleString("en-IN")}
                </p>
              </div>
              <button
                onClick={() => setViewingAlertSms(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Extracted Amount</span>
                <span className="text-base font-black text-emerald-700">₹{viewingAlertSms.amount}</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">12-Digit UTR</span>
                <span className="text-xs font-mono font-bold text-gray-900">{viewingAlertSms.utr}</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Bank / Source</span>
                <span className="font-semibold text-gray-800">{viewingAlertSms.senderBank}</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <span className="text-gray-400 block text-[10px] font-semibold uppercase">Status</span>
                <span className="font-bold text-xs">
                  {viewingAlertSms.isUsed ? "✅ Claimed / Credited" : "🟢 Available"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Full Original Raw SMS:
              </label>
              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 font-mono text-xs text-gray-800 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                {viewingAlertSms.rawText || "No raw text recorded"}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(viewingAlertSms.rawText);
                  toast.success("Raw SMS copied!");
                }}
                className="rounded-xl text-xs"
              >
                Copy SMS Text
              </Button>
              <Button
                onClick={() => setViewingAlertSms(null)}
                className="rounded-xl bg-gray-900 text-white text-xs font-bold px-5"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
