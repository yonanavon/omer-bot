"use client";

import { useEffect, useState, useCallback } from "react";
import { Wifi, WifiOff, Loader2, QrCode } from "lucide-react";

type Status = "disconnected" | "connecting" | "qr" | "connected";

const statusConfig: Record<
  Status,
  { label: string; color: string; bgColor: string }
> = {
  disconnected: {
    label: "מנותק",
    color: "text-[var(--danger)]",
    bgColor: "bg-red-500/10",
  },
  connecting: {
    label: "מתחבר...",
    color: "text-[var(--warning)]",
    bgColor: "bg-yellow-500/10",
  },
  qr: {
    label: "ממתין לסריקת QR",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  connected: {
    label: "מחובר",
    color: "text-[var(--success)]",
    bgColor: "bg-green-500/10",
  },
};

export default function WhatsAppPage() {
  const [status, setStatus] = useState<Status>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok || !active) return;
        const data = await res.json();
        setStatus(data.status);
        if (data.status === "qr" && data.qr) {
          setQr(data.qr);
        } else {
          setQr(null);
        }
      } catch {
        // ignore fetch errors
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/whatsapp/connect", { method: "POST" });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/whatsapp/disconnect", { method: "POST" });
    } finally {
      setLoading(false);
    }
  }, []);

  const config = statusConfig[status];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold">חיבור וואטסאפ</h2>
        <p className="text-[var(--muted-foreground)] mt-1">
          חבר את חשבון הוואטסאפ כדי לעקוב אחר הצטרפויות לקהילה
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              {status === "connected" ? (
                <Wifi className={config.color} size={24} />
              ) : status === "connecting" || status === "qr" ? (
                <QrCode className={config.color} size={24} />
              ) : (
                <WifiOff className={config.color} size={24} />
              )}
            </div>
            <div>
              <p className="text-sm text-[var(--muted-foreground)]">סטטוס</p>
              <p className={`font-semibold ${config.color}`}>{config.label}</p>
            </div>
          </div>

          {status === "disconnected" ? (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              התחבר
            </button>
          ) : status === "connected" ? (
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-6 py-2.5 bg-[var(--danger)] text-white rounded-lg font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              התנתק
            </button>
          ) : null}
        </div>
      </div>

      {/* QR Code */}
      {status === "qr" && qr && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 flex flex-col items-center gap-4">
          <h3 className="text-lg font-semibold">סרוק את קוד ה-QR</h3>
          <p className="text-[var(--muted-foreground)] text-sm text-center">
            פתח את וואטסאפ בטלפון &gt; הגדרות &gt; מכשירים מקושרים &gt; קשר
            מכשיר
          </p>
          <div className="bg-white p-4 rounded-xl">
            <img src={qr} alt="QR Code" className="w-64 h-64" />
          </div>
        </div>
      )}

      {/* Connected Info */}
      {status === "connected" && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6">
          <p className="text-[var(--success)] font-medium">
            הבוט מחובר ומאזין להצטרפויות חדשות לקהילות!
          </p>
          <p className="text-[var(--muted-foreground)] text-sm mt-2">
            עבור לעמוד &quot;חברי קהילה&quot; כדי לראות את הרשימה
          </p>
        </div>
      )}
    </div>
  );
}
