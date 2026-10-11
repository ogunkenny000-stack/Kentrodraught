import React, { useState } from "react";
import { X, Users, Check, Sparkles } from "lucide-react";

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateGroup: (name: string, description: string, icon: string, initialMembers: string[]) => void;
  onlineUsers: string[];
  currentUsername: string;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onCreateGroup,
  onlineUsers,
  currentUsername
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("🇳🇬");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState("");

  const ICONS = ["🇳🇬", "👑", "⚔️", "🔥", "🎯", "🏆", "🧠", "🦁", "⚡", "🛡️"];

  if (!isOpen) return null;

  const toggleMember = (user: string) => {
    setSelectedMembers((prev) =>
      prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]
    );
  };

  const handleAddCustomMember = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = memberInput.trim().toLowerCase();
    if (!clean || clean === currentUsername.toLowerCase() || selectedMembers.includes(clean)) return;
    setSelectedMembers((prev) => [...prev, clean]);
    setMemberInput("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreateGroup(name.trim(), description.trim(), selectedIcon, selectedMembers);
    setName("");
    setDescription("");
    setSelectedMembers([]);
    onClose();
  };

  // Available online users excluding self
  const availableUsers = onlineUsers.filter(
    (u) => u.toLowerCase() !== currentUsername.toLowerCase()
  );

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-sans">
                Create Tactical Circle
              </h3>
              <p className="text-[10px] text-slate-400">
                Form a Grandmaster group for matches & discussions
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {/* Group Icon & Name */}
          <div className="flex items-center gap-3">
            {/* Icon Picker dropdown or selected badge */}
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-2xl shrink-0 shadow-inner">
              {selectedIcon}
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                Group Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lagos Draughts Masters"
                required
                maxLength={40}
                className="bg-slate-900 border border-slate-800 focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
            </div>
          </div>

          {/* Group Icons row */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Group Emblem
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setSelectedIcon(ic)}
                  className={`w-8 h-8 rounded-lg border text-base flex items-center justify-center transition cursor-pointer ${
                    selectedIcon === ic
                      ? "bg-amber-500/20 border-amber-500"
                      : "bg-slate-900 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Topic / Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Tactical analysis and rapid match scheduling"
              maxLength={120}
              className="bg-slate-900 border border-slate-800 focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs text-white outline-none"
            />
          </div>

          {/* Member Selection */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Add Members ({selectedMembers.length})
            </label>

            {/* Custom username adder */}
            <div className="flex gap-2">
              <input
                type="text"
                value={memberInput}
                onChange={(e) => setMemberInput(e.target.value)}
                placeholder="Enter player username..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomMember}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-400 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Add
              </button>
            </div>

            {/* Online Quick Pick */}
            {availableUsers.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Online Players</span>
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {availableUsers.map((u) => {
                    const isSelected = selectedMembers.includes(u);
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => toggleMember(u)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition cursor-pointer ${
                          isSelected
                            ? "bg-amber-500 text-slate-950 border-amber-400 font-black"
                            : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        <span>{u}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!name.trim()}
            className="mt-2 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-amber-500/10"
          >
            Create Tactical Group
          </button>
        </form>
      </div>
    </div>
  );
};
