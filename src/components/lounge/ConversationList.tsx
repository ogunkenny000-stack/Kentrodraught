import React from "react";
import { 
  Search, 
  Crown, 
  Users, 
  MessageSquare, 
  Mic, 
  Gamepad2, 
  Image as ImageIcon, 
  Smile, 
  Check, 
  CheckCheck,
  Pin,
  VolumeX,
  Plus
} from "lucide-react";
import type { LoungeConversation } from "./types";
import { formatMessageTime, getRankBadge } from "./constants";

interface ConversationListProps {
  conversations: LoungeConversation[];
  activeChatId: string;
  onSelectConversation: (chatId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilterTab: "all" | "direct" | "groups" | "hall";
  onFilterTabChange: (tab: "all" | "direct" | "groups" | "hall") => void;
  onOpenNewChat: () => void;
  onOpenCreateGroup: () => void;
  currentUsername: string;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeChatId,
  onSelectConversation,
  searchQuery,
  onSearchChange,
  activeFilterTab,
  onFilterTabChange,
  onOpenNewChat,
  onOpenCreateGroup,
  currentUsername
}) => {
  return (
    <div className="w-full md:w-80 lg:w-96 h-full bg-[#080a14] border-r border-slate-900/80 flex flex-col shrink-0 select-none overflow-hidden">
      {/* Search Bar & Quick Add */}
      <div className="p-3 border-b border-slate-900/80 bg-slate-950/40 flex flex-col gap-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search chats, groups or players..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-slate-900/90 border border-slate-800/80 focus:border-amber-500/50 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none transition font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-850">
          {(["all", "direct", "groups", "hall"] as const).map((tab) => {
            const label =
              tab === "all"
                ? "All"
                : tab === "direct"
                ? "Direct"
                : tab === "groups"
                ? "Groups"
                : "Hall";

            const isActive = activeFilterTab === tab;
            return (
              <button
                key={tab}
                onClick={() => onFilterTabChange(tab)}
                className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer text-center ${
                  isActive
                    ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversations Scrollable List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-900/40">
        {conversations.length === 0 ? (
          <div className="p-6 text-center text-slate-500 flex flex-col items-center gap-3 my-auto">
            <div className="w-12 h-12 rounded-full bg-slate-900/60 border border-slate-800 flex items-center justify-center text-slate-400">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-300">No conversations found</span>
              <span className="text-[10px] text-slate-500">
                {searchQuery ? `No matches for "${searchQuery}"` : "Start a new chat with a KentroDraught player!"}
              </span>
            </div>
            <button
              onClick={onOpenNewChat}
              className="mt-2 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Start Direct Chat
            </button>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeChatId;
            const lastMsg = conv.lastMessage;
            const isMeLastSender = lastMsg?.sender.toLowerCase() === currentUsername.toLowerCase();
            const rank = conv.type === "direct" && conv.elo ? getRankBadge(conv.elo) : null;

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                aria-label={"Open " + conv.name}
                aria-pressed={isActive}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectConversation(conv.id); } }}
                onClick={() => onSelectConversation(conv.id)}
                className={`flex items-center gap-3 p-3.5 transition cursor-pointer relative group ${
                  isActive
                    ? "bg-amber-500/10 border-l-2 border-amber-500"
                    : "hover:bg-slate-900/50"
                }`}
              >
                {/* Avatar / Icon with Online indicator */}
                <div className="relative shrink-0">
                  {conv.type === "public" ? (
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-900/40 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-md">
                      <Crown className="w-6 h-6 text-amber-400" />
                    </div>
                  ) : conv.type === "group" ? (
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-950 to-slate-900 border border-indigo-800/40 flex items-center justify-center text-lg shadow-md">
                      {conv.avatarUrl || "👥"}
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700/50 flex items-center justify-center text-slate-200 font-bold text-sm shadow-md">
                      {conv.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Online dot for direct chats */}
                  {conv.type === "direct" && (
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-950 ${
                        conv.isOnline ? "bg-emerald-500" : "bg-slate-600"
                      }`}
                      title={conv.isOnline ? "Online now" : "Offline"}
                    />
                  )}

                  {/* Pin badge */}
                  {conv.isPinned && (
                    <div className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-sm">
                      <Pin className="w-2 h-2 fill-current" />
                    </div>
                  )}
                </div>

                {/* Conversation Details */}
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-xs font-bold truncate ${isActive ? "text-amber-400" : "text-slate-100"}`}>
                        {conv.name}
                      </span>
                      {rank && (
                        <span className={`hidden sm:inline-block px-1 py-0.2 rounded text-[7px] font-black border uppercase tracking-wider truncate max-w-[80px] ${rank.style}`}>
                          {rank.title}
                        </span>
                      )}
                    </div>
                    {lastMsg && (
                      <span className="text-[10px] text-slate-500 font-mono shrink-0">
                        {formatMessageTime(lastMsg.timestamp)}
                      </span>
                    )}
                  </div>

                  {/* Last message preview */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[11px] text-slate-400 truncate min-w-0">
                      {/* Delivery Status checkmarks if I sent last message */}
                      {isMeLastSender && (
                        <span className="shrink-0">
                          {lastMsg?.status === "seen" ? (
                            <CheckCheck className="w-3.5 h-3.5 text-amber-400 stroke-[2.5]" role="img" aria-label="Read/Seen" />
                          ) : lastMsg?.status === "delivered" ? (
                            <CheckCheck className="w-3.5 h-3.5 text-slate-400" role="img" aria-label="Delivered" />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-slate-500" role="img" aria-label="Sent" />
                          )}
                        </span>
                      )}

                      {/* Content Type Icon */}
                      {lastMsg?.voiceNote ? (
                        <span className="flex items-center gap-1 text-emerald-400 font-medium">
                          <Mic className="w-3 h-3" />
                          <span>Voice Note ({lastMsg.duration || 1}s)</span>
                        </span>
                      ) : lastMsg?.gameShare ? (
                        <span className="flex items-center gap-1 text-amber-400 font-medium">
                          <Gamepad2 className="w-3 h-3" />
                          <span>Draughts Match #{lastMsg.gameShare.gameCode}</span>
                        </span>
                      ) : lastMsg?.mediaUrl ? (
                        <span className="flex items-center gap-1 text-sky-400 font-medium">
                          <ImageIcon className="w-3 h-3" />
                          <span>Photo</span>
                        </span>
                      ) : lastMsg?.sticker ? (
                        <span className="flex items-center gap-1 text-pink-400 font-medium">
                          <Smile className="w-3 h-3" />
                          <span>{lastMsg.stickerLabel || "Sticker"}</span>
                        </span>
                      ) : (
                        <span className="truncate">
                          {lastMsg?.text || (conv.type === "public" ? "Grand Hall open discussion" : "Start conversation")}
                        </span>
                      )}
                    </div>

                    {/* Unread badge */}
                    {conv.unreadCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 font-mono font-black text-[9px] flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                        {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer quick action */}
      <div className="p-3 border-t border-slate-900 bg-slate-950/60 flex items-center justify-between text-xs font-bold text-slate-400">
        <button
          onClick={onOpenNewChat}
          className="flex items-center gap-1.5 hover:text-amber-400 transition cursor-pointer"
        >
          <Plus className="w-4 h-4 text-amber-400" />
          <span>New Chat</span>
        </button>
        <button
          onClick={onOpenCreateGroup}
          className="flex items-center gap-1.5 hover:text-amber-400 transition cursor-pointer"
        >
          <Users className="w-4 h-4 text-indigo-400" />
          <span>New Group</span>
        </button>
      </div>
    </div>
  );
};
