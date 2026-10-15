import React, { useState, useRef, useEffect } from "react";
import { 
  Phone, 
  Video,
  Gamepad2, 
  MoreVertical, 
  Search, 
  Smile, 
  Plus, 
  Send, 
  Mic, 
  Trash2, 
  Check, 
  CheckCheck, 
  Reply, 
  Share2, 
  Copy, 
  CornerDownRight, 
  X, 
  Users, 
  Crown, 
  Image as ImageIcon, 
  AlertTriangle,
  Play,
  Eye,
  Microscope,
  Square
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { 
  LoungeConversation, 
  LoungeMessage, 
  ReplyContext, 
  Sticker, 
  GameShareData 
} from "./types";
import { 
  STICKER_PACK, 
  REACTION_EMOJIS, 
  QUICK_GAME_MESSAGES, 
  formatMessageTime, 
  getRankBadge, 
  playLoungeSound 
} from "./constants";
import { VoicePlayer } from "./VoicePlayer";
import { pickRecordingMimeType, blobTypeFor } from "../../lib/voiceNoteMime";

interface ChatAreaProps {
  conversation?: LoungeConversation;
  messages: LoungeMessage[];
  currentUsername: string;
  onSendMessage: (payload: {
    text?: string;
    voiceNote?: string;
    duration?: number;
    sticker?: string;
    stickerEmoji?: string;
    stickerImageUrl?: string;
    stickerLabel?: string;
    gameShare?: GameShareData;
    mediaUrl?: string;
    mediaType?: "image" | "video" | "file";
    replyTo?: ReplyContext;
    forwardedFrom?: string;
  }) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string, forEveryone: boolean) => void;
  onForwardMessage: (message: LoungeMessage) => void;
  onOpenRecentGames: () => void;
  onOpenUserProfile: (username: string) => void;
  onOpenGroupInfo: () => void;
  onStartVoiceCall?: (targetUser: string, type?: "voice" | "video") => void;
  onReport: (targetUser: string, messageId?: string) => void;
  onBlockUser?: (targetUser: string) => void;
  onLoadSavedGame?: (game: any) => void;
  activeReply: ReplyContext | null;
  onSetActiveReply: (reply: ReplyContext | null) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  messages,
  currentUsername,
  onSendMessage,
  onReact,
  onDeleteMessage,
  onForwardMessage,
  onOpenRecentGames,
  onOpenUserProfile,
  onOpenGroupInfo,
  onStartVoiceCall,
  onReport,
  onBlockUser,
  onLoadSavedGame,
  activeReply,
  onSetActiveReply
}) => {
  const [inputText, setInputText] = useState("");
  const [showStickerTray, setShowStickerTray] = useState(false);
  const [stickerCategory, setStickerCategory] = useState<"meme" | "emoji">("meme");
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [activeMessageActionId, setActiveMessageActionId] = useState<string | null>(null);
  const [inChatSearch, setInChatSearch] = useState("");
  const [showInChatSearchBar, setShowInChatSearchBar] = useState(false);
  const [selectedMediaUrl, setSelectedMediaUrl] = useState<string | null>(null);

  // Voice Note Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const recordingDurationRef = useRef(0);
  const recordingErrorTimerRef = useRef<any>(null);
  const discardRecordingRef = useRef(false);
  const recordingGenerationRef = useRef(0);
  const recordingPendingRef = useRef(false);
  useEffect(() => {
    recordingGenerationRef.current += 1;
    setIsRecording(false);
    return () => {
      recordingGenerationRef.current += 1;
      recordingPendingRef.current = false;
      discardRecordingRef.current = true;
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder) {
        recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null;
        if (recorder.state !== 'inactive') try { recorder.stop(); } catch {}
        recorder.stream.getTracks().forEach(track => track.stop());
      }
      audioChunksRef.current = [];
      clearInterval(recordingTimerRef.current);
      clearTimeout(recordingErrorTimerRef.current);
    };
  }, [conversation?.id]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation?.id]);

  const showRecordingError = (msg: string) => {
    setRecordingError(msg);
    if (recordingErrorTimerRef.current) clearTimeout(recordingErrorTimerRef.current);
    recordingErrorTimerRef.current = setTimeout(() => setRecordingError(null), 5000);
  };

  const stopRecordingStream = (stream: MediaStream | null | undefined) => {
    stream?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  };

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Handle Voice Recording using MediaRecorder. The container is picked per
  // browser (Safari has no WebM encoder), the mic is released on every path,
  // and failures show an error instead of sending a fake message.
  const startRecording = async () => {
    if (isRecording || recordingPendingRef.current) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      showRecordingError("Voice notes aren't supported in this browser.");
      return;
    }
    const generation = recordingGenerationRef.current;
    recordingPendingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== recordingGenerationRef.current) { stopRecordingStream(stream); return; }
      const recStream = stream;
      const mimeType = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
      const mediaRecorder = mimeType ? new MediaRecorder(recStream, { mimeType }) : new MediaRecorder(recStream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onerror = () => {
        stopRecordingStream(recStream);
        clearRecordingTimer();
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        setIsRecording(false);
        showRecordingError("Recording failed. Please try again.");
      };

      mediaRecorder.onstop = () => {
        stopRecordingStream(recStream);
        if (generation !== recordingGenerationRef.current) return;
        mediaRecorderRef.current = null;
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }
        if (chunks.length === 0) {
          showRecordingError("Nothing was recorded — check your microphone.");
          return;
        }
        const audioBlob = new Blob(chunks, { type: blobTypeFor(mediaRecorder.mimeType, mimeType) });
        if (audioBlob.size > 120000) { showRecordingError("Voice note exceeds the 120 KB attachment limit. Record a shorter note."); return; }
        const reader = new FileReader();
        reader.onloadend = () => {
          if (generation !== recordingGenerationRef.current) return;
          const base64Audio = typeof reader.result === "string" ? reader.result : "";
          if (!base64Audio) {
            showRecordingError("Couldn't encode the voice note.");
            return;
          }
          onSendMessage({
            voiceNote: base64Audio,
            duration: recordingDurationRef.current || 1,
            replyTo: activeReply || undefined
          });
        };
        reader.onerror = () => showRecordingError("Couldn't encode the voice note.");
        reader.readAsDataURL(audioBlob);
      };

      playLoungeSound("record_start");
      mediaRecorder.start();
      setRecordingError(null);
      setIsRecording(true);
      setRecordingDuration(0);
      recordingDurationRef.current = 0;

      clearRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const next = prev + 1;
          recordingDurationRef.current = next;
          if (next >= 15) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      stopRecordingStream(stream);
      if (generation !== recordingGenerationRef.current) return;
      console.warn("Could not start audio recorder:", err);
      mediaRecorderRef.current = null;
      clearRecordingTimer();
      setIsRecording(false);
      const name = (err as { name?: string })?.name;
      showRecordingError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone permission is required to record a voice note."
          : name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Couldn't start recording on this device."
      );
    } finally { if (generation === recordingGenerationRef.current) recordingPendingRef.current = false; }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        stopRecordingStream(rec.stream);
        mediaRecorderRef.current = null;
      }
    } else if (rec) {
      stopRecordingStream(rec.stream);
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
    playLoungeSound("record_stop");
    clearRecordingTimer();
  };

  const cancelRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      discardRecordingRef.current = true;
      try {
        rec.stop();
      } catch {
        stopRecordingStream(rec.stream);
        mediaRecorderRef.current = null;
        discardRecordingRef.current = false;
      }
    } else if (rec) {
      stopRecordingStream(rec.stream);
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    playLoungeSound("record_stop");
    clearRecordingTimer();
  };

  const handleSendText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage({
      text: inputText.trim(),
      replyTo: activeReply || undefined
    });

    setInputText("");
    onSetActiveReply(null);
  };

  const handleSendSticker = (sticker: Sticker) => {
    onSendMessage({
      sticker: sticker.id,
      stickerEmoji: sticker.emoji,
      stickerImageUrl: sticker.imageUrl,
      stickerLabel: sticker.label,
      replyTo: activeReply || undefined
    });
    setShowStickerTray(false);
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 120000 || !/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.type)) {
      showRecordingError('Choose a PNG, JPEG, WebP, GIF, MP4 or WebM attachment up to 120 KB.'); return;
    }
    const generation = recordingGenerationRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (generation !== recordingGenerationRef.current) return;
      const base64Url = reader.result as string;
      const isVideo = file.type.startsWith("video");
      onSendMessage({
        mediaUrl: base64Url,
        mediaType: isVideo ? "video" : "image",
        text: file.name,
        replyTo: activeReply || undefined
      });
    };
    reader.onerror = () => showRecordingError("Could not read the attachment.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Filter messages if search inside chat is active
  const displayedMessages = inChatSearch.trim()
    ? messages.filter((m) =>
        m.text?.toLowerCase().includes(inChatSearch.toLowerCase().trim()) ||
        m.sender.toLowerCase().includes(inChatSearch.toLowerCase().trim())
      )
    : messages;

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#070913] text-center select-none">
        <div className="w-16 h-16 rounded-3xl bg-slate-900/60 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-xl mb-4">
          <Crown className="w-8 h-8" />
        </div>
        <h2 className="text-base font-black text-white uppercase tracking-wider mb-2 font-sans">
          Welcome to the Grandmaster Lounge
        </h2>
        <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-6 font-sans">
          Connect directly with top KentroDraught players, analyze tactical games, exchange voice notes, and coordinate rapid rematches in real-time.
        </p>
      </div>
    );
  }

  const isDirect = conversation.type === "direct";
  const isGroup = conversation.type === "group";
  const isPublic = conversation.type === "public";
  const targetUser = conversation.targetUsername || conversation.name;
  const rank = isDirect && conversation.elo ? getRankBadge(conversation.elo) : null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#070913] relative overflow-hidden select-none">
      {/* Hidden File Input for Image/Video Attachments */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleMediaUpload}
      />

      {/* TOP HEADER BAR */}
      <div className="h-16 px-4 border-b border-slate-900 bg-slate-950/80 flex items-center justify-between shrink-0 z-10 backdrop-blur-md">
        {/* Left: Avatar + Title & Status */}
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => {
            if (isDirect) onOpenUserProfile(targetUser);
            if (isGroup) onOpenGroupInfo();
          }}
        >
          <div className="relative">
            {isPublic ? (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-900/40 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-md">
                <Crown className="w-5 h-5 text-amber-400" />
              </div>
            ) : isGroup ? (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-950 to-slate-900 border border-indigo-800/40 flex items-center justify-center text-lg shadow-md">
                {conversation.avatarUrl || "👥"}
              </div>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700/50 flex items-center justify-center text-slate-200 font-black text-sm shadow-md">
                {conversation.name.charAt(0).toUpperCase()}
              </div>
            )}

            {isDirect && (
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                  conversation.isOnline ? "bg-emerald-500" : "bg-slate-600"
                }`}
              />
            )}
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-white group-hover:text-amber-400 transition truncate">
                {conversation.name}
              </span>
              {rank && (
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black border uppercase tracking-wider ${rank.style}`}>
                  {rank.title}
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {isPublic
                ? "Public Hall · All players can read & write"
                : isGroup
                ? `${conversation.groupData?.members.length || 0} Members · Tactical Circle`
                : conversation.isOnline
                ? "Online · Ready to play"
                : "Offline"}
            </span>
          </div>
        </div>

        {/* Right Action Icons */}
        <div className="flex items-center gap-1.5">
          {/* In-chat Search toggle */}
          <button
            onClick={() => setShowInChatSearchBar(!showInChatSearchBar)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
            title="Search in this chat"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Share Recent Game quick button */}
          <button
            onClick={onOpenRecentGames}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold transition cursor-pointer"
            title="Share a completed KentroDraught game"
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share Game</span>
          </button>

          {/* Direct Video Call and Voice Call buttons for 1-to-1 chats */}
          {isDirect && onStartVoiceCall && (
            <>
              <button
                onClick={() => onStartVoiceCall(targetUser, "voice")}
                className="p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition cursor-pointer"
                title={`Direct Voice Call with @${targetUser}`}
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={() => onStartVoiceCall(targetUser, "video")}
                className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 transition cursor-pointer"
                title={`Direct HD Video Call with @${targetUser}`}
              >
                <Video className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Options Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setShowActionMenu(!showActionMenu)}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showActionMenu && (
              <div 
                className="absolute right-0 top-12 w-48 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-1.5 z-30 flex flex-col font-sans text-xs"
                onClick={() => setShowActionMenu(false)}
              >
                {isDirect && (
                  <button
                    onClick={() => onOpenUserProfile(targetUser)}
                    className="px-3.5 py-2 hover:bg-slate-800 text-left text-slate-200 hover:text-amber-400 font-bold transition cursor-pointer"
                  >
                    View Player Profile
                  </button>
                )}
                {isGroup && (
                  <button
                    onClick={onOpenGroupInfo}
                    className="px-3.5 py-2 hover:bg-slate-800 text-left text-slate-200 hover:text-amber-400 font-bold transition cursor-pointer"
                  >
                    Group Info & Members
                  </button>
                )}
                <button
                  onClick={onOpenRecentGames}
                  className="px-3.5 py-2 hover:bg-slate-800 text-left text-slate-200 hover:text-amber-400 font-bold transition cursor-pointer"
                >
                  Share KentroDraught Match
                </button>
                {isDirect && onBlockUser && (
                  <button
                    onClick={() => onBlockUser(targetUser)}
                    className="px-3.5 py-2 hover:bg-slate-800 text-left text-orange-400 font-bold transition cursor-pointer"
                  >
                    Block @{targetUser}
                  </button>
                )}
                <button
                  onClick={() => onReport(targetUser)}
                  className="px-3.5 py-2 hover:bg-slate-800 text-left text-rose-400 font-bold transition cursor-pointer"
                >
                  Report Inappropriate
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-Chat Search Bar Banner */}
      <AnimatePresence>
        {showInChatSearchBar && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-2 bg-slate-950 border-b border-slate-900 flex items-center gap-2"
          >
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search in this conversation..."
              value={inChatSearch}
              onChange={(e) => setInChatSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-white outline-none placeholder-slate-500 font-sans"
            />
            {inChatSearch && (
              <span className="text-[10px] text-amber-400 font-mono">
                {displayedMessages.length} match(es)
              </span>
            )}
            <button
              onClick={() => {
                setShowInChatSearchBar(false);
                setInChatSearch("");
              }}
              className="text-slate-500 hover:text-white text-xs cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MESSAGES FEED CONTAINER */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 scrollbar-thin">
        {displayedMessages.length === 0 ? (
          <div className="my-auto text-center text-slate-500 flex flex-col items-center gap-3 p-6 max-w-sm mx-auto select-none">
            <div className="w-12 h-12 rounded-2xl bg-slate-900/50 border border-slate-800 flex items-center justify-center text-amber-500">
              {isPublic ? <Crown className="w-6 h-6" /> : isGroup ? <Users className="w-6 h-6" /> : <Smile className="w-6 h-6" />}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-300">No messages yet</span>
              <span className="text-[10px] text-slate-500 leading-relaxed">
                {isPublic
                  ? "This is the open Grandmaster Hall. Say hello or post a draughts challenge!"
                  : `Send a text, voice note, or share an epic Draughts match with ${conversation.name}!`}
              </span>
            </div>
            {/* Quick Greeting Chips */}
            <div className="flex flex-wrap gap-1.5 justify-center mt-2">
              {QUICK_GAME_MESSAGES.slice(0, 4).map((msg) => (
                <button
                  key={msg}
                  onClick={() => onSendMessage({ text: msg })}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-400 rounded-full text-[10px] font-bold transition cursor-pointer"
                >
                  {msg}
                </button>
              ))}
            </div>
          </div>
        ) : (
          displayedMessages.map((msg) => {
            const isMe = msg.sender.toLowerCase() === currentUsername.toLowerCase();
            const isDeleted = msg.deletedForEveryone;

            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] sm:max-w-[70%] relative group ${
                  isMe ? "self-end items-end" : "self-start items-start"
                }`}
                onMouseEnter={() => setActiveMessageActionId(msg.id)}
                onMouseLeave={() => setActiveMessageActionId(null)}
              >
                {/* Sender Title in Groups / Public Hall */}
                {!isMe && (isGroup || isPublic) && (
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] font-bold">
                    <span 
                      onClick={() => onOpenUserProfile(msg.sender)}
                      className="text-amber-400 font-extrabold hover:underline cursor-pointer"
                    >
                      {msg.sender}
                    </span>
                    {msg.elo && (
                      <span className="text-[8px] font-mono text-slate-400">
                        ({msg.elo})
                      </span>
                    )}
                  </div>
                )}

                {/* Message Bubble Body */}
                <div
                  className={`p-3 rounded-2xl flex flex-col gap-1.5 relative border transition-all shadow-md ${
                    isMe
                      ? "bg-[#241a0e] border-amber-600/40 text-amber-100 rounded-tr-xs"
                      : "bg-[#141a29] border-slate-800 text-slate-200 rounded-tl-xs"
                  }`}
                >
                  {/* Forwarded Tag */}
                  {msg.forwardedFrom && (
                    <div className="flex items-center gap-1 text-[9px] text-slate-400 italic mb-0.5">
                      <Share2 className="w-2.5 h-2.5" />
                      <span>Forwarded from {msg.forwardedFrom}</span>
                    </div>
                  )}

                  {/* Reply Reference Preview Banner */}
                  {msg.replyTo && (
                    <div className={`p-2 rounded-xl border text-[10px] mb-1 flex flex-col gap-0.5 border-l-4 ${
                      isMe 
                        ? "bg-amber-950/40 border-amber-500 text-amber-200" 
                        : "bg-slate-900 border-slate-700 text-slate-300"
                    }`}>
                      <span className="font-bold text-amber-400 flex items-center gap-1">
                        <CornerDownRight className="w-2.5 h-2.5" />
                        <span>{msg.replyTo.sender}</span>
                      </span>
                      <span className="truncate opacity-80">
                        {msg.replyTo.text || "Voice Note / Game / Attachment"}
                      </span>
                    </div>
                  )}

                  {/* DELETED MESSAGE PLACEHOLDER */}
                  {isDeleted ? (
                    <div className="italic text-xs text-slate-500 flex items-center gap-1.5 py-1">
                      <Trash2 className="w-3.5 h-3.5 text-slate-600" />
                      <span>This message was deleted.</span>
                    </div>
                  ) : (
                    <>
                      {/* TEXT CONTENT */}
                      {msg.text && (
                        <p className="text-xs leading-relaxed font-sans whitespace-pre-wrap select-text font-normal break-words">
                          {msg.text}
                        </p>
                      )}

                      {/* VOICE NOTE PLAYER */}
                      {msg.voiceNote && (
                        <VoicePlayer 
                          src={msg.voiceNote} 
                          duration={msg.duration || 1} 
                          isOutgoing={isMe} 
                        />
                      )}

                      {/* MEDIA PHOTO / VIDEO */}
                      {msg.mediaUrl && (
                        <div className="rounded-xl overflow-hidden my-1 max-w-xs border border-slate-800 bg-slate-950">
                          {msg.mediaType === "video" ? (
                            <video src={msg.mediaUrl} controls className="w-full max-h-56 object-cover" />
                          ) : (
                            <img
                              src={msg.mediaUrl}
                              alt="Shared photo"
                              className="w-full max-h-56 object-cover cursor-pointer hover:opacity-90 transition"
                              onClick={() => setSelectedMediaUrl(msg.mediaUrl || null)}
                            />
                          )}
                        </div>
                      )}

                      {/* STICKER */}
                      {msg.sticker && (
                        <div className="my-1 flex flex-col items-center">
                          {msg.stickerImageUrl ? (
                            <img
                              src={msg.stickerImageUrl}
                              alt={msg.stickerLabel}
                              className="w-28 h-28 object-cover rounded-xl shadow-md border border-slate-800/40 hover:scale-105 transition-transform"
                            />
                          ) : (
                            <span className="text-6xl p-2 select-none hover:scale-110 transition-transform">
                              {msg.stickerEmoji}
                            </span>
                          )}
                          <span className="text-[8px] text-slate-400 font-bold uppercase mt-1">
                            {msg.stickerLabel}
                          </span>
                        </div>
                      )}

                      {/* SHARED KENTRODRAUGHT GAME CARD */}
                      {msg.gameShare && (
                        <div className="p-3 bg-gradient-to-br from-amber-950/40 via-slate-950 to-slate-900 border border-amber-500/30 rounded-xl flex flex-col gap-2 my-1 shadow-inner">
                          <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5">
                            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                              <Crown className="w-3.5 h-3.5 text-amber-400" />
                              <span>KENTRODRAUGHT MATCH</span>
                            </span>
                            <span className="text-[9px] font-mono font-bold text-slate-400">
                              #{msg.gameShare.gameCode}
                            </span>
                          </div>

                          <div className="flex flex-col gap-0.5 text-xs font-sans">
                            <div className="font-bold text-slate-200">
                              {msg.gameShare.whitePlayer} <span className="text-amber-500">vs</span> {msg.gameShare.blackPlayer}
                            </div>
                            <div className="text-[10px] text-amber-400/90 font-semibold">
                              Result: {msg.gameShare.result}
                            </div>
                            {msg.gameShare.movesCount && (
                              <div className="text-[9px] text-slate-400 font-mono">
                                Total Moves: {msg.gameShare.movesCount} {msg.gameShare.timeControl ? `• ${msg.gameShare.timeControl}` : ""}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons to View or Analyze */}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => onLoadSavedGame && onLoadSavedGame(msg.gameShare?.gameData || msg.gameShare)}
                              className="flex-1 py-1.5 px-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-[10px] font-black uppercase transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View Match</span>
                            </button>
                            <button
                              onClick={() => onLoadSavedGame && onLoadSavedGame(msg.gameShare?.gameData || msg.gameShare)}
                              className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-amber-400 rounded-lg text-[10px] font-bold uppercase transition flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Microscope className="w-3 h-3" />
                              <span>Analyze</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Bubble Timestamp & Status checkmarks */}
                  <div className="flex items-center justify-end gap-1 text-[9px] font-mono opacity-70 mt-0.5">
                    <span>{formatMessageTime(msg.timestamp)}</span>
                    {isMe && !isDeleted && (
                      <span>
                        {msg.status === "failed" ? (<span role="alert" className="text-rose-300 font-sans">Not sent. Try again.</span>) : msg.status === "sending" ? (<span className="font-sans">Sending…</span>) : msg.status === "seen" ? (
                          <CheckCheck className="w-3 h-3 text-amber-400 stroke-[2.5]" role="img" aria-label="Read/Seen" />
                        ) : msg.status === "delivered" ? (
                          <CheckCheck className="w-3 h-3 text-slate-400" role="img" aria-label="Delivered" />
                        ) : (
                          <Check className="w-3 h-3 text-slate-500" role="img" aria-label="Sent" />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Emoji Reactions Bar */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 px-1">
                    {Object.entries(msg.reactions).map(([emoji, reactors]) => {
                      const reactorList: string[] = Array.isArray(reactors) ? reactors : [];
                      const hasReacted = reactorList.includes(currentUsername);
                      return (
                        <button
                          key={emoji}
                          onClick={() => onReact(msg.id, emoji)}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold font-mono border transition cursor-pointer ${
                            hasReacted
                              ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                              : "bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                          title={`Reacted by: ${reactorList.join(", ")}`}
                        >
                          <span>{emoji}</span>
                          <span>{reactorList.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Floating Quick Action Overlay on Hover/Tap */}
                <div
                  className={`absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center gap-1 bg-slate-900/95 border border-slate-800 p-1 rounded-full shadow-2xl ${
                    isMe ? "-left-14 -translate-x-full" : "-right-14 translate-x-full"
                  }`}
                >
                  {/* Quick Reactions */}
                  {REACTION_EMOJIS.slice(0, 3).map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => onReact(msg.id, emoji)}
                      className="hover:scale-125 transition-transform p-0.5 text-xs cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}

                  {/* Reply Button */}
                  <button
                    onClick={() =>
                      onSetActiveReply({
                        id: msg.id,
                        sender: msg.sender,
                        text: msg.text || (msg.voiceNote ? "🎤 Voice Note" : "Shared Card")
                      })
                    }
                    className="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition cursor-pointer"
                    title="Reply"
                  >
                    <Reply className="w-3 h-3" />
                  </button>

                  {/* Forward Button */}
                  <button
                    onClick={() => onForwardMessage(msg)}
                    className="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition cursor-pointer"
                    title="Forward"
                  >
                    <Share2 className="w-3 h-3" />
                  </button>

                  {/* Copy Button if text */}
                  {msg.text && (
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.text || "")}
                      className="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition cursor-pointer"
                      title="Copy Text"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}

                  {/* Delete Button */}
                  <button
                    onClick={() => onDeleteMessage(msg.id, false)}
                    className="p-1 text-slate-400 hover:text-rose-400 rounded-full hover:bg-slate-800 transition cursor-pointer"
                    title="Hide in this view until reload"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* INPUT FOOTER CONTROLS */}
      <div className="p-3 border-t border-slate-900 bg-slate-950/90 flex flex-col gap-2 shrink-0 z-10">
        {/* Reply Context Banner */}
        <AnimatePresence>
          {activeReply && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between text-xs"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-black text-amber-400">
                  Replying to @{activeReply.sender}
                </span>
                <span className="text-[11px] text-slate-300 truncate">
                  {activeReply.text}
                </span>
              </div>
              <button
                onClick={() => onSetActiveReply(null)}
                className="p-1 text-slate-500 hover:text-white transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sticker Tray Drawer */}
        <AnimatePresence>
          {showStickerTray && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="bg-[#090b16] border border-slate-800 rounded-2xl p-3 flex flex-col gap-2.5 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-900">
                  <button
                    type="button"
                    onClick={() => setStickerCategory("meme")}
                    className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition ${
                      stickerCategory === "meme"
                        ? "bg-amber-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    🇳🇬 Naija Memes
                  </button>
                  <button
                    type="button"
                    onClick={() => setStickerCategory("emoji")}
                    className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition ${
                      stickerCategory === "emoji"
                        ? "bg-amber-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Classic Stickers
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStickerTray(false)}
                  className="text-[9px] text-amber-500 font-extrabold hover:text-amber-400 cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5 max-h-[160px] overflow-y-auto pr-1">
                {STICKER_PACK.filter((st) => st.category === stickerCategory).map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => handleSendSticker(sticker)}
                    className="flex flex-col items-center gap-1 p-2 bg-slate-950/60 border border-slate-900 hover:border-amber-500/50 hover:bg-slate-900/40 rounded-xl transition cursor-pointer group"
                    title={sticker.desc}
                  >
                    {sticker.imageUrl ? (
                      <img
                        src={sticker.imageUrl}
                        alt={sticker.label}
                        className="w-12 h-12 object-cover rounded-lg group-hover:scale-110 transition-transform"
                      />
                    ) : (
                      <span className="text-3xl group-hover:scale-110 transition-transform">
                        {sticker.emoji}
                      </span>
                    )}
                    <span className="text-[8px] text-slate-400 font-bold truncate w-full text-center">
                      {sticker.label}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Audio Recording HUD */}
        <AnimatePresence>
          {recordingError && !isRecording && (
            <motion.div
              key="voice-note-error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              role="alert"
              className="flex items-center gap-2 bg-rose-950/30 border border-rose-900/40 rounded-xl px-3 py-2 text-[11px] text-rose-200 font-semibold"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="flex-1">{recordingError}</span>
              <button
                type="button"
                onClick={() => setRecordingError(null)}
                className="p-1 text-rose-300 hover:text-white cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
          {isRecording && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex items-center justify-between bg-red-950/25 border border-red-900/40 rounded-xl p-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-red-400 font-black uppercase tracking-widest font-mono">
                    Recording Grandmaster Voice Note
                  </span>
                  <span className="text-xs font-mono font-bold text-red-200">
                    {recordingDuration}s / 15s limit
                  </span>
                </div>
              </div>

              {/* Pulsing Audio Equalizer */}
              <div className="flex items-center gap-1 h-5 px-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[2.5px] bg-red-500 rounded-full animate-pulse"
                    style={{
                      height: `${30 + Math.random() * 70}%`,
                      animationDuration: `${0.3 + i * 0.1}s`
                    }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="p-2 bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 rounded-lg transition cursor-pointer"
                  title="Discard"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={stopRecording}
                  className="py-1.5 px-3 bg-red-500 hover:bg-red-400 text-slate-950 rounded-lg text-[10px] font-black uppercase transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-slate-950" />
                  <span>Send</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Bar Form */}
        <form onSubmit={handleSendText} className="flex items-center gap-2">
          {/* Stickers Toggle */}
          <button
            type="button"
            onClick={() => setShowStickerTray(!showStickerTray)}
            className={`p-2.5 rounded-xl border transition flex items-center justify-center shrink-0 cursor-pointer ${
              showStickerTray
                ? "bg-amber-500 border-amber-400 text-slate-950"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
            }`}
            title="Stickers & Emojis"
          >
            <Smile className="w-4 h-4" />
          </button>

          {/* Attachment Picker */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition flex items-center justify-center shrink-0 cursor-pointer"
            title="Attach Photo or Video"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isRecording}
            placeholder={
              isRecording
                ? "Recording voice note..."
                : `Message ${conversation.name}...`
            }
            className="flex-1 bg-slate-900/90 border border-slate-800 focus:border-amber-500/50 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 outline-none transition font-sans disabled:opacity-50"
          />

          {/* Mic Voice Note Button (when empty text) */}
          {!inputText.trim() && (
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-2.5 rounded-xl border transition flex items-center justify-center shrink-0 cursor-pointer ${
                isRecording
                  ? "bg-red-500 border-red-400 text-slate-950 animate-pulse"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
              }`}
              title="Record Voice Note"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isRecording}
            className="p-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 rounded-xl transition flex items-center justify-center shrink-0 cursor-pointer shadow-md shadow-amber-500/10"
            title="Send Message"
          >
            <Send className="w-4 h-4 stroke-[2.5]" />
          </button>
        </form>
      </div>

      {/* Lightbox Modal for Media Photos */}
      {selectedMediaUrl && (
        <div
          className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setSelectedMediaUrl(null)}
        >
          <img
            src={selectedMediaUrl}
            alt="Enlarged media"
            className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
