import React, { useEffect, useMemo, useState } from "react";
import { supabase, handleSupabaseError, OperationType } from "../supabase";
import { X, Users, UserPlus, Swords, MessageSquare, Trash2 } from "lucide-react";
import { AdminTappableName } from "../lib/adminProfileContext";

interface FriendsPageProps {
  username: string;
  userElo: number;
  myGamesList: any[]; // completed_games rows this account has played -- same list Home/Profile/Analysis already use
  onOpenLounge: () => void; // Friends and Messages are the same underlying feature (Grandmaster's Lounge) -- this just switches the main view there
  onClose: () => void;
}

export function FriendsPage({ username, userElo, myGamesList, onOpenLounge, onClose }: FriendsPageProps) {
  const [contactsList, setContactsList] = useState<any[]>([]);
  const [addUsername, setAddUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [friendError, setFriendError] = useState("");

  // Identical merge-by-id pattern to GlobalChatLounge.tsx's friends
  // subscription -- both read/write the exact same table and row shape, so
  // this page and the Lounge always agree on who your friends are.
  useEffect(() => {
    let cancelled = false;
    const merged = new Map<string, any>();
    const publish = () => { if (!cancelled) setContactsList(Array.from(merged.values())); };
    const applyRow = (row: any) => { merged.set(row.id, row); publish(); };
    const removeRow = (row: any) => { merged.delete(row.id); publish(); };

    // Realtime only streams CHANGES going forward, unlike Firestore's
    // onSnapshot (which also fired immediately with the current matching
    // docs) -- so the initial state is seeded with one direct fetch first.
    supabase
      .from("friends")
      .select("*")
      .or(`user1.eq.${username},user2.eq.${username}`)
      .then(({ data, error }) => {
        if (error) { handleSupabaseError(error, OperationType.GET, "friends"); return; }
        for (const row of data ?? []) merged.set(row.id, row);
        publish();
      });

    // Two channels because a Realtime postgres_changes filter only supports
    // a single column=eq.value condition -- matches the original two-query
    // merge pattern this replaces.
    const channel1 = supabase
      .channel(`friends-user1-${username}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `user1=eq.${username}` }, (payload) => {
        if (payload.eventType === "DELETE") removeRow(payload.old);
        else applyRow(payload.new);
      })
      .subscribe();

    const channel2 = supabase
      .channel(`friends-user2-${username}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `user2=eq.${username}` }, (payload) => {
        if (payload.eventType === "DELETE") removeRow(payload.old);
        else applyRow(payload.new);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel1);
      supabase.removeChannel(channel2);
    };
  }, [username]);

  const friends = contactsList.filter((c) => c.status === "accepted");
  const requests = contactsList.filter(c => c.status === "pending");
  const acceptFriend = async (id: string) => {
    const { data, error } = await supabase.from("friends").update({ status: "accepted" }).eq("id", id).select("id");
    if (error || !data?.length) setFriendError("Could not accept this request. Please refresh and try again.");
    else setContactsList(rows => rows.map(row => row.id === id ? { ...row, status: "accepted" } : row));
  };

  // "Person you play frequently with" -- derived straight from real match
  // history, not a separate tracked stat. Counts opponents across every
  // game this account has played, most-frequent first, excluding anyone
  // already a friend so the suggestion list stays useful.
  const frequentOpponents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of myGamesList) {
      const opponent = g.whitePlayer === username ? g.blackPlayer : g.whitePlayer;
      if (!opponent || opponent === username) continue;
      counts.set(opponent, (counts.get(opponent) || 0) + 1);
    }
    const friendNames = new Set(friends.map((f) => (f.user1 === username ? f.user2 : f.user1).toLowerCase()));
    return Array.from(counts.entries())
      .filter(([name]) => !friendNames.has(name.toLowerCase()))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [myGamesList, friends, username]);

  const addFriend = async (target: string, targetElo: number = 1500) => {
    const clean = target.trim();
    if (!clean || clean.toLowerCase() === username.toLowerCase()) return;
    setAdding(true);
    setFriendError("");
    try {
      const friendId = [username.toLowerCase(), clean.toLowerCase()].sort().join("_");
      const { error } = await supabase.from("friends").upsert({
        id: friendId,
        user1: username,
        user2: clean,
        user1Elo: userElo || 1500,
        user2Elo: targetElo,
        status: "pending",
        sender: username,
      });
      if (error) throw error;
      setAddUsername("");
    } catch (err) {
      console.error("Failed to add friend:", err);
      setFriendError("Could not add that friend. Check the username and try again.");
    } finally {
      setAdding(false);
    }
  };

  const removeFriend = async (friendId: string) => {
    try {
      const { error } = await supabase.from("friends").delete().eq("id", friendId);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to remove friend:", err);
      setFriendError("Could not remove that friend. Please try again.");
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Friends" className="k-friends-overlay fixed inset-0 bg-slate-950/95 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 relative my-4">
        <button onClick={onClose} aria-label="Close friends" className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-md shadow-amber-500/20">
            <Users className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <h2 className="text-lg font-extrabold text-white font-sans">Friends</h2>
        </div>

        {/* Add by username */}
        <div className="flex gap-2 mb-5">
          <input
            aria-label="Friend username"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFriend(addUsername)}
            placeholder="Add by username"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 font-sans focus:outline-none focus:border-amber-500/60 transition"
          />
          <button
            type="button"
            aria-label="Add friend"
            onClick={() => addFriend(addUsername)}
            disabled={adding || !addUsername.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 rounded-xl px-3 transition"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>

        {friendError && <p role="alert" className="mb-4 text-xs text-rose-300">{friendError}</p>}

        {requests.length > 0 && <div className="mb-5 space-y-2">
          <h3 className="text-xs text-slate-400">Friend requests</h3>
          {requests.map(request => {
            const incoming = request.sender?.toLowerCase() !== username.toLowerCase();
            const other = request.user1.toLowerCase() === username.toLowerCase() ? request.user2 : request.user1;
            return <div key={request.id} className="flex items-center justify-between gap-2 text-xs text-white">
              <span>{other} {incoming ? "sent you a request" : "· request pending"}</span>
              {incoming && <button onClick={() => acceptFriend(request.id)} className="text-amber-400">Accept</button>}
              <button onClick={() => removeFriend(request.id)} className="text-slate-400">{incoming ? "Decline" : "Cancel"}</button>
            </div>;
          })}
        </div>}

        {/* Frequent opponents -- real, derived from match history */}
        {frequentOpponents.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[10px] text-slate-500 uppercase font-bold tracking-wide font-sans mb-2 flex items-center gap-1.5">
              <Swords className="w-3 h-3" /> People You Play Often
            </h3>
            <div className="flex flex-col gap-1.5">
              {frequentOpponents.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                  <div className="flex flex-col">
                    <AdminTappableName username={name} className="text-xs font-bold text-white font-sans" />
                    <span className="text-[10px] text-slate-500 font-sans">{count} game{count !== 1 ? "s" : ""} together</span>
                  </div>
                  <button
                    onClick={() => addFriend(name)}
                    className="text-[10px] font-bold text-amber-400 hover:text-amber-300 font-sans flex items-center gap-1"
                  >
                    <UserPlus className="w-3 h-3" /> Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends list */}
        <div>
          <h3 className="text-[10px] text-slate-500 uppercase font-bold tracking-wide font-sans mb-2">
            Your Friends ({friends.length})
          </h3>
          {friends.length === 0 ? (
            <p className="text-[11px] text-slate-500 font-sans italic">
              No friends yet -- add someone above, or from the list of people you play often.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {friends.map((f) => {
                const otherName = f.user1 === username ? f.user2 : f.user1;
                return (
                  <div key={f.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                    <AdminTappableName username={otherName} className="text-xs font-bold text-white font-sans" />
                    <div className="flex items-center gap-2">
                      <button onClick={onOpenLounge} aria-label={`Message ${otherName}`} className="text-slate-500 hover:text-amber-400 transition" title="Message in the Grandmaster's Lounge">
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeFriend(f.id)} aria-label={`Remove ${otherName} from friends`} className="text-slate-600 hover:text-rose-400 transition" title="Remove friend">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
