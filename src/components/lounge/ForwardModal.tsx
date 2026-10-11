import React from "react";
import { X, Share2, Crown, Users } from "lucide-react";
import type { LoungeConversation, LoungeMessage } from "./types";

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: LoungeMessage | null;
  conversations: LoungeConversation[];
  onForwardToChat: (targetChatId: string) => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  message,
  conversations,
  onForwardToChat
}) => {
  if (!isOpen || !message) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-sans">
              Forward Message
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message Snippet Preview */}
        <div className="p-3 bg-slate-950/40 border-b border-slate-900">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
            Message Preview
          </span>
          <p className="text-xs text-amber-300 italic truncate">
            {message.text || (message.voiceNote ? "🎤 Voice Note" : "Shared Draughts Item")}
          </p>
        </div>

        {/* Target list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 scrollbar-thin">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Choose Destination
          </span>
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => {
                onForwardToChat(conv.id);
                onClose();
              }}
              className="p-2.5 bg-slate-950/60 hover:bg-slate-900 border border-slate-900 hover:border-amber-500/40 rounded-xl flex items-center justify-between transition cursor-pointer text-left group"
            >
              <div className="flex items-center gap-2.5">
                {conv.type === "public" ? (
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Crown className="w-4 h-4" />
                  </div>
                ) : conv.type === "group" ? (
                  <div className="w-8 h-8 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center">
                    {conv.avatarUrl || "👥"}
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-xs">
                    {conv.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition truncate">
                  {conv.name}
                </span>
              </div>
              <span className="text-[10px] font-black text-amber-400 uppercase bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                Send
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
