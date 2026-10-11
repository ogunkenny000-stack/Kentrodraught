import type { PlayerStats } from "../../types";

export interface Sticker {
  id: string;
  emoji?: string;
  imageUrl?: string;
  label: string;
  desc: string;
  category: "meme" | "emoji";
}

export interface GameShareData {
  gameCode: string;
  whitePlayer: string;
  blackPlayer: string;
  result: string;
  resultDetail?: string;
  movesCount?: number;
  timeControl?: string;
  date?: string;
  gameData?: any;
}

export interface ReplyContext {
  id: string;
  sender: string;
  text?: string;
  type?: "text" | "voice" | "game" | "media" | "sticker";
  mediaUrl?: string;
}

export interface LoungeMessage {
  id: string;
  chatId: string; // "userA_userB" for 1-to-1, "group_XXX" for groups, "global_hall" for public lounge
  sender: string;
  senderOwnerId?: string | null;
  recipient?: string;
  recipientOwnerId?: string | null;
  text?: string;
  voiceNote?: string; // base64 or audio URL
  duration?: number; // duration in seconds
  mediaUrl?: string;
  mediaType?: "image" | "video" | "file";
  fileName?: string;
  sticker?: string;
  stickerEmoji?: string;
  stickerImageUrl?: string;
  stickerLabel?: string;
  gameShare?: GameShareData;
  replyTo?: ReplyContext;
  forwardedFrom?: string;
  reactions: Record<string, string[]>; // emoji -> array of usernames
  status: "sent" | "delivered" | "seen";
  deletedFor: string[]; // usernames who deleted for themselves
  deletedForEveryone?: boolean;
  timestamp: string | number; // ISO string or epoch ms
  elo?: number;
}

export interface LoungeGroup {
  id: string;
  name: string;
  description: string;
  icon?: string;
  createdBy: string;
  createdAt: number;
  admins: string[]; // usernames
  members: string[]; // usernames
}

export interface LoungeConversation {
  id: string;
  type: "direct" | "group" | "public";
  targetUsername?: string; // for direct
  groupData?: LoungeGroup; // for group
  name: string;
  description?: string;
  avatarUrl?: string;
  elo?: number;
  lastMessage?: LoungeMessage;
  unreadCount: number;
  isOnline?: boolean;
  isPinned?: boolean;
  isMuted?: boolean;
  typingUsers?: string[];
  updatedAt: number;
}

export interface LoungeUserProfile {
  username: string;
  usernameLower: string;
  ownerId?: string | null;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  gamesCount: number;
  totalPlayTime?: number;
  averageDuration?: number;
  maxUnlockedKenLevel?: number;
  avatarUrl?: string;
  bio?: string;
  statusQuote?: string;
  isOnline?: boolean;
  lastActive?: number;
  createdAt?: number;
}

export interface ReportPayload {
  reportedUser: string;
  reportedBy: string;
  reason: string;
  details?: string;
  messageId?: string;
  chatId?: string;
  timestamp: number;
}

export interface GlobalChatLoungeProps {
  username: string;
  profileStats?: PlayerStats;
  onlineUsers?: string[];
  onSelectMode?: (mode: any) => void;
  onLoadSavedGame?: (game: any) => void;
  myGamesList?: any[];
  savedGamesList?: any[];
  fetchMyGames?: () => void;
  onStartVoiceCall?: (targetUser: string, type?: "voice" | "video") => void;
  ws?: WebSocket | null;
  activeVoiceCall?: {
    callState: string;
    opponentName: string;
    callDuration: number;
    isMicMuted: boolean;
    toggleMic: () => void;
    endCall: () => void;
  };
}
