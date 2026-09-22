import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
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
  Smartphone
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

interface TelegramConfigStatus {
  running: boolean;
  enabled: boolean;
  hasToken: boolean;
  maskedToken: string;
  chatId: string;
  botUsername?: string;
  webhookUrl?: string;
  startedAt?: string;
  lastPolledAt?: string;
  lastError?: string;
  totalAlertsCount: number;
  unusedAlertsCount: number;
}

export const TelegramBotTab: React.FC = () => {
  const [config, setConfig] = useState<TelegramConfigStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingAction, setSavingAction] = useState<"start" | "stop" | "save" | null>(null);

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

  const extractErrorMessage = (err: any): string => {
    const data = err.response?.data;
    if (!data) return err.message || "Network error. Please check your connection.";
    if (typeof data === "string") return data;
    if (typeof data.error === "string") return data.error;
    if (data.error && typeof data.error.message === "string") return data.error.message;
    if (typeof data.message === "string") return data.message;
    if (data.error && typeof data.error === "object") {
      try {
        return JSON.stringify(data.error);
      } catch (e) {}
    }
    return err.message || "An unexpected error occurred.";
  };

  const fetchConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await axios.get("/api/admin/telegram-config");
      if (res.data && res.data.success) {
        setConfig(res.data);
        if (res.data.chatId && !chatId) setChatId(res.data.chatId);
      }
    } catch (err: any) {
      console.warn("Failed to fetch telegram config:", extractErrorMessage(err));
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchAlerts = async () => {
    setLoadingAlerts(true);
    try {
      const res = await axios.get(`/api/admin/bank-alerts?filter=${filter}&search=${encodeURIComponent(searchQuery)}`);
      if (res.data && res.data.success) {
        setAlerts(res.data.alerts || []);
      }
    } catch (err: any) {
      console.warn("Failed to fetch bank alerts:", extractErrorMessage(err));
    } finally {
      setLoadingAlerts(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchAlerts();
  }, [filter]);

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
    try {
      const payload: any = { action };
      if (cleanToken) payload.botToken = cleanToken;
      if (cleanChatId) payload.chatId = cleanChatId;

      const res = await axios.post("/api/admin/telegram-config", payload);
      if (res.data && res.data.success) {
        toast.success(res.data.message || "Settings updated successfully");
        if (res.data.status) setConfig(res.data.status);
        setBotToken(""); // Clear raw token from input for security
        fetchConfig();
      } else {
        const errorText = typeof res.data.error === "string" ? res.data.error : "Action failed";
        toast.error(errorText);
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      toast.error(`Telegram Bot Error: ${msg}`);
    } finally {
      setSavingAction(null);
    }
  };

  const handleSimulateSms = async () => {
    const num = Number(simAmount);
    if (!num || num <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsSimulating(true);
    try {
      const res = await axios.post("/api/admin/simulate-sms", {
        amount: num,
        bank: simBank
      });

      if (res.data && res.data.success && res.data.alert) {
        toast.success(`🎉 Test SMS simulated! UTR: ${res.data.alert.utr} (₹${res.data.alert.amount})`);
        setLastSimulatedAlert(res.data.alert);
        fetchAlerts();
        fetchConfig();
      } else {
        toast.error("Failed to simulate SMS");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Simulation failed");
    } finally {
      setIsSimulating(false);
    }
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
                    Telegram Bot Connection
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500">
                    Configure your Telegram Bot credentials to receive and poll SMS in real-time.
                  </CardDescription>
                </div>
                {config?.hasToken && (
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[11px] font-medium">
                    Token Saved
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5 sm:p-6 space-y-4">
              {config?.lastError && (
                <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold">Telegram Error Notice:</p>
                    <p>{config.lastError}</p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Telegram Bot Token</span>
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

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Chat ID / Channel ID (Optional)</span>
                  <span className="text-[10px] text-gray-400 font-normal">For confirmation receipts</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 123456789 or -100123456789"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="rounded-2xl h-12 text-xs border-gray-200 focus:border-blue-500 font-mono"
                />
                <p className="text-[11px] text-gray-400">
                  When a payment SMS is recorded, the bot sends an instant receipt to this chat.
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
                    {savingAction === "start" ? "Connecting Bot..." : "Start Telegram Bot"}
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
                    {savingAction === "stop" ? "Stopping..." : "Stop Bot Polling"}
                  </Button>
                )}

                <Button
                  onClick={() => handleConfigAction("save")}
                  disabled={savingAction !== null}
                  variant="outline"
                  className="h-12 rounded-2xl text-xs font-bold border-gray-200 hover:bg-gray-50 px-5"
                >
                  Save Credentials
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
        </div>
      </div>

      {/* Received Bank Alerts Table */}
      <Card className="rounded-3xl border-gray-100 shadow-sm bg-white overflow-hidden">
        <CardHeader className="p-5 sm:p-6 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                Live Received Bank Alerts & UTR Registry
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                All parsed payments from Telegram. Unused UTRs are instantly claimable by users.
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
                  <th className="py-3 px-4">Claimed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-gray-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Smartphone className="w-8 h-8 opacity-40 text-gray-400" />
                        <p className="text-xs">No bank alerts found for current filter.</p>
                        <p className="text-[11px] text-gray-400">
                          Click "Generate Simulated Bank SMS" above to test or forward SMS to your bot.
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
