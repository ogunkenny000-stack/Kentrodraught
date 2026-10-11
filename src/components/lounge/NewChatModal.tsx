import React, { useState } from "react";
import { X, Search, MessageSquare, UserPlus, Check } from "lucide-react";
import { supabase } from "../../supabase";

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartDirectChat: (targetUser: string, targetElo?: number) => void;
  onlineUsers: string[];
  currentUsername: string;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({
  isOpen,
  onClose,
  onStartDirectChat,
  onlineUsers,
  currentUsername
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const clean = searchQuery.trim().toLowerCase();
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .ilike("usernameLower", `${clean}%`)
        .limit(20);

      if (!error && data) {
        setResults(data.filter((u) => u.username.toLowerCase() !== currentUsername.toLowerCase()));
      }
    } catch (err) {
      console.warn("Search error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelect = (user: string, elo = 1500) => {
    onStartDirectChat(user, elo);
    onClose();
  };

  const availableOnline = onlineUsers.filter(
    (u) => u.toLowerCase() !== currentUsername.toLowerCase()
  );

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-sans">
                Start Conversation
              </h3>
              <p className="text-[10px] text-slate-400">
                Message any registered KentroDraught player directly
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input form */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/30">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by username (e.g. ade, babatunde)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-slate-900/90 border border-slate-800 focus:border-amber-500/50 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer"
            >
              Search
            </button>
          </form>
        </div>

        {/* Search Results or Online suggestions */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin">
          {isSearching ? (
            <div className="text-center py-8 text-xs text-slate-500">
              Searching player registry...
            </div>
          ) : results.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                Matches ({results.length})
              </span>
              {results.map((res) => (
                <div
                  key={res.id || res.username}
                  onClick={() => handleSelect(res.username, res.elo || 1500)}
                  className="p-2.5 bg-slate-950/60 hover:bg-slate-900 border border-slate-900 hover:border-amber-500/30 rounded-xl flex items-center justify-between transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-xs">
                      {res.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white">{res.username}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ELO {res.elo || 1500}
                      </span>
                    </div>
                  </div>
                  <button className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg text-[10px] font-bold uppercase">
                    Message
                  </button>
                </div>
              ))}
            </div>
          ) : searchQuery.trim() ? (
            <div className="text-center py-8 text-slate-500 flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-slate-400">No user found matching "{searchQuery}"</span>
              <button
                onClick={() => handleSelect(searchQuery.trim(), 1500)}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl text-xs font-bold cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Start chat with "{searchQuery.trim()}" anyway</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {availableOnline.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Online Players Now ({availableOnline.length})</span>
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {availableOnline.map((user) => (
                      <div
                        key={user}
                        onClick={() => handleSelect(user, 1500)}
                        className="p-2.5 bg-slate-950/60 hover:bg-slate-900 border border-slate-900 hover:border-emerald-500/30 rounded-xl flex items-center justify-between transition cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-xs">
                            {user.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-bold text-white">{user}</span>
                        </div>
                        <button className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-[10px] font-bold uppercase">
                          Chat Now
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
