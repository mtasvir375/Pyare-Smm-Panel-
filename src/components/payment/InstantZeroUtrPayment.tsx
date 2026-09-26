import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Zap,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InstantZeroUtrPaymentProps {
  amount: number;
  userId: string;
  userEmail?: string;
  onSuccess: (creditedAmount: number, newBalance?: number) => void;
  onCancelOrSwitchManual?: () => void;
}

interface PaymentIntentResponse {
  intentId: string;
  orderRef: string;
  baseAmount: number;
  amount: number;
  upiId: string;
  payeeName: string;
  upiLink: string;
  expiresAt: number;
}

export const InstantZeroUtrPayment: React.FC<InstantZeroUtrPaymentProps> = ({
  amount,
  userId,
  userEmail,
  onSuccess,
  onCancelOrSwitchManual
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(1800);
  const [isSuccess, setIsSuccess] = useState(false);
  const [completedData, setCompletedData] = useState<{ amount: number; utr?: string; newBalance?: number } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Create Payment Intent on mount
  useEffect(() => {
    let isMounted = true;

    const initIntent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.post("/api/payments/create-intent", {
          amount,
          userId,
          userEmail
        }, { timeout: 8000 });

        if (res.data?.success && isMounted) {
          setIntent(res.data);
          const rem = Math.max(0, Math.floor((res.data.expiresAt - Date.now()) / 1000));
          setSecondsRemaining(rem > 0 ? rem : 1800);
        } else if (isMounted) {
          setError(res.data?.error || "Failed to initialize automatic UPI gateway.");
        }
      } catch (err: any) {
        if (isMounted) {
          const msg = err.response?.data?.error || err.message || "Failed to initialize automatic UPI payment.";
          setError(msg);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initIntent();

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [amount, userId, userEmail]);

  // 2. Countdown Timer
  useEffect(() => {
    if (!intent || isSuccess) return;

    countdownIntervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [intent, isSuccess]);

  const verifyStatus = async (showToast = false) => {
    if (!intent || isSuccess) return;
    if (showToast) setCheckingNow(true);
    try {
      const res = await axios.get(`/api/payments/check-intent/${intent.intentId}`, { timeout: 6000 });
      if (res.data?.success && res.data.status === "completed") {
        setIsSuccess(true);
        setCompletedData({
          amount: res.data.creditedAmount || intent.amount,
          utr: res.data.utr,
          newBalance: res.data.newBalance
        });

        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

        toast.success(`🎉 Payment Verified! ₹${res.data.creditedAmount || intent.amount} credited to your wallet!`);
        onSuccess(res.data.creditedAmount || intent.amount, res.data.newBalance);
      } else if (showToast) {
        toast.info("Still awaiting bank SMS confirmation. Please allow a few seconds for the bank network to update.");
      }
    } catch (err) {
      if (showToast) {
        toast.error("Could not reach verification server. Please try again.");
      }
    } finally {
      if (showToast) setCheckingNow(false);
    }
  };

  // 3. 2-Second Polling Loop to check verification status without asking UTR
  useEffect(() => {
    if (!intent || isSuccess) return;

    pollIntervalRef.current = setInterval(() => verifyStatus(false), 2000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [intent, isSuccess, onSuccess]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const copyRef = (ref: string) => {
    navigator.clipboard.writeText(ref);
    setCopiedRef(true);
    toast.success("Order Ref copied!");
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const copyUpiLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    toast.success("UPI payment link copied!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-3 min-h-[300px]">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-emerald-100 border-t-emerald-600 animate-spin" />
          <Zap className="w-6 h-6 text-emerald-600 absolute inset-0 m-auto fill-emerald-600 animate-pulse" />
        </div>
        <p className="text-sm font-bold text-gray-800">Generating Zero-Collision QR...</p>
        <p className="text-xs text-gray-400">Assigning unique decimal & order ref</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-gray-900">Automatic QR Unavailable</h4>
          <p className="text-xs text-rose-600">{error}</p>
        </div>
        {onCancelOrSwitchManual && (
          <Button
            onClick={onCancelOrSwitchManual}
            className="w-full rounded-2xl bg-primary text-white font-bold text-xs h-11"
          >
            Use Manual UPI QR (Enter 12-digit UTR)
          </Button>
        )}
      </div>
    );
  }

  if (isSuccess && completedData) {
    return (
      <div className="p-6 text-center space-y-5 animate-in zoom-in-95 duration-300">
        <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-emerald-600/20">
          <CheckCircle2 className="w-12 h-12" />
        </div>
        <div className="space-y-1.5">
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs px-3 py-1 font-bold">
            ✅ VERIFIED AUTOMATICALLY
          </Badge>
          <h3 className="text-2xl font-black text-gray-900">
            ₹{completedData.amount.toFixed(2)} Credited!
          </h3>
          <p className="text-xs text-gray-500">
            Payment confirmed via Telegram SMS alert without UTR entry!
          </p>
          {completedData.newBalance !== undefined && (
            <p className="text-xs font-bold text-emerald-600 pt-1">
              New Wallet Balance: ₹{completedData.newBalance.toFixed(2)}
            </p>
          )}
        </div>
        <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 text-left text-xs space-y-1 font-mono text-gray-600">
          <div className="flex justify-between">
            <span className="text-gray-400">Order Ref:</span>
            <span className="font-bold">{intent?.orderRef}</span>
          </div>
          {completedData.utr && (
            <div className="flex justify-between">
              <span className="text-gray-400">Bank UTR:</span>
              <span className="font-bold">{completedData.utr}</span>
            </div>
          )}
        </div>
        <Button
          onClick={() => onSuccess(completedData.amount, completedData.newBalance)}
          className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20"
        >
          Done
        </Button>
      </div>
    );
  }

  if (secondsRemaining <= 0) {
    return (
      <div className="p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
          <Clock className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-gray-900">Payment Timer Completed</h4>
          <p className="text-xs text-gray-500">
            Did you already complete the UPI payment? Click below to immediately verify and credit your wallet.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => verifyStatus(true)}
            disabled={checkingNow}
            className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-11 shadow-md shadow-emerald-600/20"
          >
            {checkingNow ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2 text-yellow-300 fill-yellow-300" />
            )}
            I Have Already Paid - Verify My Payment Now
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="w-full rounded-2xl border-gray-200 text-gray-700 font-bold text-xs h-11"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Generate Fresh QR
          </Button>
          {onCancelOrSwitchManual && (
            <Button
              variant="ghost"
              onClick={onCancelOrSwitchManual}
              className="w-full rounded-2xl text-gray-500 font-semibold text-xs h-9"
            >
              Switch to Manual Deposit (Enter UTR)
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Timer & Zero-UTR Badge Header */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-bold text-emerald-800">Auto-Detect Active</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono font-bold text-emerald-900 bg-white px-3 py-1 rounded-xl shadow-xs border border-emerald-200">
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <span>{formatTimer(secondsRemaining)}</span>
        </div>
      </div>

      {/* Main QR Display */}
      <div className="flex flex-col items-center p-4 bg-gray-50/70 rounded-3xl border border-gray-200 relative overflow-hidden">
        {/* Payable Amount Highlight */}
        <div className="text-center mb-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Pay Exact Amount</p>
          <div className="text-3xl font-black text-gray-900 tracking-tight flex items-baseline justify-center gap-0.5">
            <span className="text-xl text-emerald-600 font-bold">₹</span>
            <span>{intent?.amount.toFixed(2)}</span>
          </div>
          {intent && intent.amount !== intent.baseAmount && (
            <p className="text-[10px] text-amber-700 font-medium bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md mt-1">
              ⚠️ Pay exact ₹{intent.amount.toFixed(2)} (decimal ensures instant zero-collision credit)
            </p>
          )}
        </div>

        {/* Dynamic QR Code */}
        <div className="bg-white p-3.5 rounded-2xl shadow-md border border-gray-100 relative group">
          {intent?.upiLink && (
            <QRCodeSVG
              value={intent.upiLink}
              size={175}
              level="M"
              includeMargin={false}
              className="rounded-lg"
            />
          )}
        </div>

        {/* Order Ref & Payee Info */}
        <div className="mt-3 text-center space-y-1.5 w-full">
          <div className="flex items-center justify-center gap-2">
            <span className="text-[11px] font-semibold text-gray-600">Order Ref (12-Digit):</span>
            <button
              onClick={() => intent?.orderRef && copyRef(intent.orderRef)}
              className="inline-flex items-center gap-1.5 font-mono text-xs font-bold bg-blue-50 text-blue-800 px-2.5 py-1 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors shadow-xs"
              title="Click to copy 12-digit Order Ref"
            >
              <span>{intent?.orderRef}</span>
              {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-blue-500" />}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 font-mono">
            {intent?.upiId} • {intent?.payeeName}
          </p>
        </div>
      </div>

      {/* Pay via UPI App direct button on Mobile */}
      {intent?.upiLink && (
        <a
          href={intent.upiLink}
          className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all"
        >
          <ExternalLink className="w-4 h-4" />
          Pay via UPI App (GPay / PhonePe / Paytm)
        </a>
      )}

      {/* Status Bar */}
      <div className="p-3 bg-blue-50/70 rounded-2xl border border-blue-200 flex items-center justify-between text-xs text-blue-900">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          <span className="font-semibold">Auto-checking every 2s...</span>
        </div>
        <button
          type="button"
          onClick={() => verifyStatus(true)}
          disabled={checkingNow}
          className="text-xs font-bold text-emerald-700 bg-white hover:bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 shadow-xs transition-colors"
        >
          {checkingNow ? "Checking..." : "Paid? Verify Now"}
        </button>
      </div>

      <div className="p-3 bg-emerald-50/50 rounded-2xl border border-emerald-100 text-[11px] text-emerald-900 space-y-1">
        <p className="font-bold flex items-center gap-1 text-emerald-700">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Zero-UTR Automatic Guarantee:</span>
        </p>
        <p className="text-gray-600 leading-relaxed">
          You <strong>DO NOT</strong> need to enter any 12-digit UTR! Once paid, our 24/7 Telegram Engine captures the bank alert and credits your balance automatically in seconds.
        </p>
      </div>

      {/* Option to switch to manual deposit */}
      {onCancelOrSwitchManual && (
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={onCancelOrSwitchManual}
            className="text-xs text-gray-500 hover:text-gray-800 underline font-medium"
          >
            Want to enter 12-digit UTR manually instead? Click here
          </button>
        </div>
      )}
    </div>
  );
};
