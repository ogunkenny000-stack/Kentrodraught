import React, { useState } from "react";
import { 
  X, 
  Users, 
  ShieldCheck, 
  UserMinus, 
  UserPlus, 
  LogOut, 
  AlertTriangle,
  Crown
} from "lucide-react";
import type { LoungeGroup } from "./types";

interface GroupInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: LoungeGroup;
  currentUsername: string;
  onAddMember: (groupId: string, member: string) => void;
  onRemoveMember: (groupId: string, member: string) => void;
  onMakeAdmin: (groupId: string, member: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onReportGroup: (groupName: string) => void;
}

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  isOpen,
  onClose,
  group,
  currentUsername,
  onAddMember,
  onRemoveMember,
  onMakeAdmin,
  onLeaveGroup,
  onReportGroup
}) => {
  const [newMemberInput, setNewMemberInput] = useState("");
  const isAdmin = group.admins.map((a) => a.toLowerCase()).includes(currentUsername.toLowerCase());

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newMemberInput.trim().toLowerCase();
    if (!clean || group.members.map((m) => m.toLowerCase()).includes(clean)) return;
    onAddMember(group.id, clean);
    setNewMemberInput("");
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header Banner */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950 border border-indigo-800/40 flex items-center justify-center text-2xl shadow-md">
              {group.icon || "👥"}
            </div>
            <div>
              <h3 className="text-sm font-black text-white font-sans">
                {group.name}
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                {group.members.length} Tactical Members
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

        {/* Group Description */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/20">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
            Topic & Guidelines
          </span>
          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            {group.description || "Active KentroDraught tactical discussion group."}
          </p>
        </div>

        {/* Members Management */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Group Members ({group.members.length})
            </span>
          </div>

          {/* Add member input */}
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text"
              value={newMemberInput}
              onChange={(e) => setNewMemberInput(e.target.value)}
              placeholder="Add username to circle..."
              className="flex-1 bg-slate-900 border border-slate-800 focus:border-amber-500/50 rounded-xl px-3 py-1.5 text-xs text-white outline-none"
            />
            <button
              type="submit"
              disabled={!newMemberInput.trim()}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {/* Member items */}
          <div className="flex flex-col gap-1.5">
            {group.members.map((member) => {
              const isMemberAdmin = group.admins.map((a) => a.toLowerCase()).includes(member.toLowerCase());
              const isSelf = member.toLowerCase() === currentUsername.toLowerCase();

              return (
                <div
                  key={member}
                  className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-900"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-xs">
                      {member.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-200">
                        {member} {isSelf && "(You)"}
                      </span>
                      {isMemberAdmin && (
                        <span className="px-1.5 py-0.2 rounded text-[7px] font-black uppercase tracking-wider bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center gap-0.5">
                          <Crown className="w-2.5 h-2.5" />
                          <span>Admin</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Admin controls */}
                  <div className="flex items-center gap-1">
                    {isAdmin && !isMemberAdmin && (
                      <button
                        onClick={() => onMakeAdmin(group.id, member)}
                        className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-amber-400 rounded-lg text-[10px] font-bold transition cursor-pointer"
                        title="Make Group Admin"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {isAdmin && !isSelf && (
                      <button
                        onClick={() => onRemoveMember(group.id, member)}
                        className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-rose-400 rounded-lg text-[10px] font-bold transition cursor-pointer"
                        title="Remove Member"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-900 bg-slate-950/80 flex items-center justify-between">
          <button
            onClick={() => {
              onLeaveGroup(group.id);
              onClose();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave Group</span>
          </button>

          <button
            onClick={() => {
              onReportGroup(group.name);
              onClose();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-amber-400 transition cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Report Group</span>
          </button>
        </div>
      </div>
    </div>
  );
};
