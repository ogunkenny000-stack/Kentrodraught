import React, { useState, useEffect } from "react";
import { 
  X, 
  Crown, 
  Trophy, 
  Swords, 
  ShieldAlert, 
  Ban, 
  Check, 
  MessageSquare, 
  Edit3, 
  CheckCircle2, 
  AlertTriangle,
  Flame,
  Award
} from "lucide-react";
import { supabase } from "../../supabase";
import type { PlayerStats } from "../../types";
import type { LoungeUserProfile } from "./types";
import { getRankBadge } from "./constants";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUsername: string;
  currentUsername: string;
  profileStats?: PlayerStats;
  customProfile?: LoungeUserProfile;
  isBlocked: boolean;
  onBlockUser: (username: string) => void;
  onUnblockUser: (username: string) => void;
  onStartDirectChat: (username: string) => void;
  onReportUser: (username: string) => void;
  onUpdateProfile?: (updates: Partial<LoungeUserProfile>) => void;
  isOnline?: boolean;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  targetUsername,
  currentUsername,
  profileStats,
  customProfile,
  isBlocked,
  onBlockUser,
  onUnblockUser,
  onStartDirectChat,
  onReportUser,
  onUpdateProfile,
  isOnline = false
}) => {
  const isMe = targetUsername.toLowerCase() === currentUsername.toLowerCase();
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [statusQuoteInput, setStatusQuoteInput] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("👑");

  const AVATAR_PRESETS = ["👑", "🦁", "🦅", "⚔️", "🛡️", "🔥", "🎯", "🧠", "🇳🇬", "⚡"];

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      return;
    }

    if (isMe && profileStats) {
      setBioInput(customProfile?.bio || "KentroDraught Tactician & Grandmaster aspirant.");
      setStatusQuoteInput(customProfile?.statusQuote || "Kings rule the board.");
      setSelectedAvatar(customProfile?.avatarUrl || "👑");
    }

    const fetchProfile = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .ilike("usernameLower", targetUsername.toLowerCase())
          .maybeSingle();

        if (!error && data) {
          setProfileData(data);
          if (data.bio) setBioInput(data.bio);
          if (data.statusQuote) setStatusQuoteInput(data.statusQuote);
          if (data.avatarUrl) setSelectedAvatar(data.avatarUrl);
        }
      } catch (err) {
        console.warn("Could not fetch user profile:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [isOpen, targetUsername, isMe, profileStats, customProfile]);

  if (!isOpen) return null;

  const elo = isMe
    ? profileStats?.elo || 1500
    : profileData?.elo || customProfile?.elo || 1500;
  const wins = isMe
    ? profileStats?.wins || 0
    : profileData?.wins || customProfile?.wins || 0;
  const losses = isMe
    ? profileStats?.losses || 0
    : profileData?.losses || customProfile?.losses || 0;
  const draws = isMe
    ? profileStats?.draws || 0
    : profileData?.draws || customProfile?.draws || 0;
  const gamesPlayed = wins + losses + draws;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  const rank = getRankBadge(elo);

  const handleSaveProfile = () => {
    if (onUpdateProfile) {
      onUpdateProfile({
        bio: bioInput.trim(),
        statusQuote: statusQuoteInput.trim(),
        avatarUrl: selectedAvatar
      });
    }
    setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-[#090b16] border border-amber-500/20 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header Banner */}
        <div className="h-28 bg-gradient-to-r from-amber-950/40 via-amber-800/20 to-slate-900 border-b border-amber-500/20 relative p-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
              KentroDraught Passport
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-950/60 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Card Body */}
        <div className="p-5 flex flex-col gap-4 -mt-12">
          {/* Avatar & Username Row */}
          <div className="flex items-end justify-between gap-3">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-slate-900 border-2 border-amber-500/40 flex items-center justify-center text-4xl shadow-xl">
                {customProfile?.avatarUrl || selectedAvatar || targetUsername.charAt(0).toUpperCase()}
              </div>
              <div
                className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[#090b16] ${
                  isOnline ? "bg-emerald-500" : "bg-slate-600"
                }`}
                title={isOnline ? "Online now" : "Offline"}
              />
            </div>

            <div className="flex items-center gap-2 mb-1">
              {isMe ? (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-xs font-bold text-amber-400 transition cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{isEditing ? "Cancel" : "Edit Profile"}</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    onStartDirectChat(targetUsername);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer shadow-md shadow-amber-500/10"
                >
                  <MessageSquare className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Direct Chat</span>
                </button>
              )}
            </div>
          </div>

          {/* User Details */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-white font-sans">
                {targetUsername}
              </h2>
              <span className={`px-2 py-0.5 rounded text-[8px] font-black border uppercase tracking-wider ${rank.style}`}>
                {rank.title}
              </span>
            </div>

            {/* Status Quote */}
            {isEditing ? (
              <div className="flex flex-col gap-2 mt-1">
                <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                  Status Quote
                </label>
                <input
                  type="text"
                  value={statusQuoteInput}
                  onChange={(e) => setStatusQuoteInput(e.target.value)}
                  placeholder="e.g. Tactician at work"
                  maxLength={60}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500/50"
                />

                <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mt-1">
                  Player Bio
                </label>
                <textarea
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  placeholder="Tell other draughts players about yourself..."
                  maxLength={150}
                  rows={2}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500/50 resize-none"
                />

                <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mt-1">
                  Choose Avatar Emblem
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_PRESETS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => setSelectedAvatar(av)}
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center text-lg transition cursor-pointer ${
                        selectedAvatar === av
                          ? "bg-amber-500/20 border-amber-500 text-white"
                          : "bg-slate-900 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      {av}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="mt-2 py-2 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Save Profile
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-amber-400/90 italic font-medium">
                  "{customProfile?.statusQuote || profileData?.statusQuote || "Kings rule the board."}"
                </p>
                <p className="text-xs text-slate-400 leading-relaxed font-sans mt-1">
                  {customProfile?.bio || profileData?.bio || "Active draughts master competing across the Grandmaster Lounge."}
                </p>
              </>
            )}
          </div>

          {/* Stats Bento Grid */}
          <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-3 rounded-2xl border border-slate-900">
            <div className="flex flex-col items-center gap-0.5 p-2 bg-slate-900/40 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ELO Rating</span>
              <span className="text-base font-black text-amber-400 font-mono">{elo}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 p-2 bg-slate-900/40 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Win Rate</span>
              <span className="text-base font-black text-emerald-400 font-mono">{winRate}%</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 p-2 bg-slate-900/40 rounded-xl">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Matches</span>
              <span className="text-base font-black text-slate-200 font-mono">{gamesPlayed}</span>
            </div>
          </div>

          {/* Record Breakdown */}
          <div className="flex items-center justify-between text-xs font-mono font-bold px-2 py-1 text-slate-400">
            <span className="text-emerald-400">Wins: {wins}</span>
            <span className="text-slate-400">Draws: {draws}</span>
            <span className="text-rose-400">Losses: {losses}</span>
          </div>

          {/* Actions: Block / Unblock / Report */}
          {!isMe && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-900">
              {isBlocked ? (
                <button
                  onClick={() => onUnblockUser(targetUsername)}
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Unblock User</span>
                </button>
              ) : (
                <button
                  onClick={() => onBlockUser(targetUsername)}
                  className="flex items-center gap-1.5 text-xs font-bold text-orange-400 hover:text-orange-300 transition cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Block User</span>
                </button>
              )}

              <button
                onClick={() => onReportUser(targetUsername)}
                className="flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Report Player</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
