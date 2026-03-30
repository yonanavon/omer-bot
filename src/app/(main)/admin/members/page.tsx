"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users,
  RefreshCw,
  Download,
  Search,
  UserPlus,
  Clock,
} from "lucide-react";

interface Member {
  id: number;
  phoneNumber: string;
  jid: string;
  communityId: string;
  joinedAt: string;
  active: boolean;
}

interface Community {
  jid: string;
  name: string;
  announceGroupJid: string | null;
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [newMemberFlash, setNewMemberFlash] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const params = selectedCommunity
        ? `?communityId=${selectedCommunity}`
        : "";
      const res = await fetch(`/api/whatsapp/members${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch (err) {
      console.error("Error fetching members:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedCommunity]);

  const fetchCommunities = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/communities");
      const data = await res.json();
      if (Array.isArray(data)) setCommunities(data);
    } catch (err) {
      console.error("Error fetching communities:", err);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
    fetchCommunities();
  }, [fetchMembers, fetchCommunities]);

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(fetchMembers, 5000);
    return () => clearInterval(interval);
  }, [fetchMembers]);

  const filteredMembers = members.filter((m) =>
    m.phoneNumber.includes(search)
  );

  const handleExportCSV = () => {
    const csv = [
      "Phone Number,JID,Community,Joined At,Active",
      ...filteredMembers.map(
        (m) =>
          `${m.phoneNumber},${m.jid},${m.communityId},${m.joinedAt},${m.active}`
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `community-members-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPhone = (phone: string) => {
    if (phone.startsWith("972")) {
      return `+${phone.slice(0, 3)}-${phone.slice(3, 5)}-${phone.slice(5)}`;
    }
    return `+${phone}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">חברי קהילה</h2>
          <p className="text-[var(--muted-foreground)] mt-1">
            רשימת כל המספרים שהצטרפו לקהילות
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setLoading(true);
              fetchMembers();
            }}
            className="p-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
            title="רענן"
          >
            <RefreshCw size={18} />
          </button>
          <button
            onClick={handleExportCSV}
            disabled={filteredMembers.length === 0}
            className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Download size={16} />
            ייצוא CSV
          </button>
        </div>
      </div>

      {/* New member notification */}
      {newMemberFlash && (
        <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-green-500/20 bg-green-500/10 p-4 flex items-center gap-3">
          <UserPlus className="text-[var(--success)]" size={20} />
          <span className="text-[var(--success)] font-medium">
            חבר חדש הצטרף: {formatPhone(newMemberFlash)}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Users className="text-[var(--primary)]" size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold">{members.length}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                סה&quot;כ חברים
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <UserPlus className="text-[var(--success)]" size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {
                  members.filter(
                    (m) =>
                      new Date(m.joinedAt).toDateString() ===
                      new Date().toDateString()
                  ).length
                }
              </p>
              <p className="text-sm text-[var(--muted-foreground)]">
                הצטרפו היום
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Clock className="text-purple-400" size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold">{communities.length}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                קהילות מנוטרות
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
            size={18}
          />
          <input
            type="text"
            placeholder="חפש לפי מספר טלפון..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>
        {communities.length > 1 && (
          <select
            value={selectedCommunity}
            onChange={(e) => setSelectedCommunity(e.target.value)}
            className="px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="">כל הקהילות</option>
            {communities.map((c) => (
              <option key={c.jid} value={c.jid}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Members Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[var(--muted-foreground)]">
            טוען...
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-12 text-center text-[var(--muted-foreground)]">
            <Users className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-lg font-medium">אין חברים עדיין</p>
            <p className="text-sm mt-1">
              חברים חדשים יופיעו כאן ברגע שיצטרפו לקהילה
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                <th className="text-right px-6 py-4 text-sm font-medium">#</th>
                <th className="text-right px-6 py-4 text-sm font-medium">
                  מספר טלפון
                </th>
                <th className="text-right px-6 py-4 text-sm font-medium">
                  תאריך הצטרפות
                </th>
                <th className="text-right px-6 py-4 text-sm font-medium">
                  סטטוס
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member, index) => (
                <tr
                  key={member.id}
                  className={`border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)] transition-colors ${
                    newMemberFlash === member.phoneNumber
                      ? "bg-green-500/10"
                      : ""
                  }`}
                >
                  <td className="px-6 py-4 text-[var(--muted-foreground)]">
                    {index + 1}
                  </td>
                  <td className="px-6 py-4 font-mono text-lg" dir="ltr">
                    {formatPhone(member.phoneNumber)}
                  </td>
                  <td className="px-6 py-4 text-[var(--muted-foreground)]">
                    {formatDate(member.joinedAt)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        member.active
                          ? "bg-green-500/10 text-[var(--success)]"
                          : "bg-red-500/10 text-[var(--danger)]"
                      }`}
                    >
                      {member.active ? "פעיל" : "עזב"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
