import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "../../supabase";
import type { PlayerStats } from "../../types";
import type {
  LoungeMessage,
  LoungeConversation,
  LoungeGroup,
  LoungeUserProfile,
  ReportPayload,
  GameShareData,
  ReplyContext,
  Sticker
} from "./types";
import { playLoungeSound } from "./constants";

const GLOBAL_CHAT_ID = "global_hall";
const GROUPS_STORAGE_KEY = "kentro_lounge_groups_v2";
const BLOCKED_STORAGE_KEY = "kentro_lounge_blocked_v2";
const PROFILES_STORAGE_KEY = "kentro_lounge_profiles_v2";
const REPORTS_STORAGE_KEY = "kentro_lounge_reports_v2";

export function useLoungeData(
  username: string,
  profileStats?: PlayerStats,
  onlineUsers: string[] = []
) {
  const [activeChatId, setActiveChatId] = useState<string>(GLOBAL_CHAT_ID);
  const [messagesMap, setMessagesMap] = useState<Record<string, LoungeMessage[]>>({});
  const [contacts, setContacts] = useState<{ id: string; user1: string; user2: string; user1Elo?: number; user2Elo?: number; status: string }[]>([]);
  const [groups, setGroups] = useState<LoungeGroup[]>(() => {
    try {
      const saved = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed reading saved groups:", e);
    }
    return [
      {
        id: "lagos_masters",
        name: "Lagos Draughts Masters",
        description: "Official tactical circle for top-tier Nigerian draughts tacticians.",
        icon: "🇳🇬",
        createdBy: "System",
        createdAt: Date.now() - 86400000 * 5,
        admins: ["ade", "System"],
        members: ["ade", "babatunde", "chidi", username]
      },
      {
        id: "grandmaster_academy",
        name: "Ken Academy & Analysis",
        description: "Post game reviews, tricky endgames, and ask for King vs King strategies.",
        icon: "👑",
        createdBy: "System",
        createdAt: Date.now() - 86400000 * 12,
        admins: ["System"],
        members: ["ade", "babatunde", username]
      }
    ];
  });

  const [blockedUsers, setBlockedUsers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(BLOCKED_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [customProfiles, setCustomProfiles] = useState<Record<string, LoungeUserProfile>>(() => {
    try {
      const saved = localStorage.getItem(PROFILES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeFilterTab, setActiveFilterTab] = useState<"all" | "direct" | "groups" | "hall">("all");
  const [activeReply, setActiveReply] = useState<ReplyContext | null>(null);

  // Sync groups & blocked users to storage
  useEffect(() => {
    try {
      localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
    } catch {}
  }, [groups]);

  useEffect(() => {
    try {
      localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(blockedUsers));
    } catch {}
  }, [blockedUsers]);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(customProfiles));
    } catch {}
  }, [customProfiles]);

  // Helper to resolve Supabase owner ID for target user
  const resolveOwnerId = useCallback(async (targetUsername: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("ownerId")
        .ilike("usernameLower", targetUsername.toLowerCase().trim())
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data?.ownerId || null;
    } catch {
      return null;
    }
  }, []);

  // Format 1-to-1 chatId
  const getDirectChatId = useCallback((u1: string, u2: string) => {
    return [u1.toLowerCase().trim(), u2.toLowerCase().trim()].sort().join("_");
  }, []);

  // Fetch Public Global Chat Messages
  useEffect(() => {
    let isMounted = true;
    const fetchGlobalMessages = async () => {
      try {
        const { data, error } = await supabase
          .from("global_chat")
          .select("*")
          .order("timestamp", { ascending: true })
          .limit(100);

        if (error) throw error;
        if (data && isMounted) {
          const parsed: LoungeMessage[] = data.map((d: any) => ({
            id: d.id,
            chatId: GLOBAL_CHAT_ID,
            sender: d.sender || "Anonymous",
            text: d.text,
            timestamp: d.timestamp || d.created_at || Date.now(),
            reactions: d.reactions || {},
            status: "delivered",
            deletedFor: [],
            elo: d.elo || 1500,
            voiceNote: d.voiceNote,
            duration: d.duration,
            sticker: d.sticker,
            stickerEmoji: d.stickerEmoji,
            stickerImageUrl: d.stickerImageUrl,
            stickerLabel: d.stickerLabel,
            gameShare: d.gameShare,
            replyTo: d.replyTo,
            forwardedFrom: d.forwardedFrom
          }));

          setMessagesMap((prev) => ({
            ...prev,
            [GLOBAL_CHAT_ID]: parsed
          }));
        }
      } catch (err) {
        console.warn("Could not load global chat messages:", err);
      }
    };

    fetchGlobalMessages();

    // Supabase Realtime Subscription for Global Chat
    const channel = supabase
      .channel("lounge_global_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_chat" },
        (payload) => {
          const d = payload.new as any;
          if (blockedUsers.includes(d.sender)) return;

          const newMsg: LoungeMessage = {
            id: d.id,
            chatId: GLOBAL_CHAT_ID,
            sender: d.sender || "Anonymous",
            text: d.text,
            timestamp: d.timestamp || d.created_at || Date.now(),
            reactions: d.reactions || {},
            status: "delivered",
            deletedFor: [],
            elo: d.elo || 1500,
            voiceNote: d.voiceNote,
            duration: d.duration,
            sticker: d.sticker,
            stickerEmoji: d.stickerEmoji,
            stickerImageUrl: d.stickerImageUrl,
            stickerLabel: d.stickerLabel,
            gameShare: d.gameShare,
            replyTo: d.replyTo,
            forwardedFrom: d.forwardedFrom
          };

          setMessagesMap((prev) => {
            const list = prev[GLOBAL_CHAT_ID] || [];
            if (list.some((m) => m.id === newMsg.id)) return prev;
            return {
              ...prev,
              [GLOBAL_CHAT_ID]: [...list, newMsg]
            };
          });

          if (d.sender !== username) {
            playLoungeSound("receive");
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [username, blockedUsers]);

  // Fetch Private & Group Messages
  useEffect(() => {
    let isMounted = true;
    const fetchPrivateMessages = async () => {
      try {
        const { data, error } = await supabase
          .from("private_messages")
          .select("*")
          .order("timestamp", { ascending: true })
          .limit(300);

        if (error) throw error;
        if (data && isMounted) {
          const map: Record<string, LoungeMessage[]> = {};
          data.forEach((d: any) => {
            if (blockedUsers.includes(d.sender)) return;

            const cId = d.chatId || getDirectChatId(d.sender, d.recipient);
            if (!map[cId]) map[cId] = [];

            // Parse rich metadata if stored in text or JSON
            let gameShare = d.gameShare;
            let replyTo = d.replyTo;
            let forwardedFrom = d.forwardedFrom;
            let text = d.text;

            if (text && text.startsWith("___KENTRO_META___:")) {
              try {
                const meta = JSON.parse(text.replace("___KENTRO_META___:", ""));
                text = meta.text || "";
                gameShare = meta.gameShare || gameShare;
                replyTo = meta.replyTo || replyTo;
                forwardedFrom = meta.forwardedFrom || forwardedFrom;
              } catch {}
            }

            map[cId].push({
              id: d.id,
              chatId: cId,
              sender: d.sender,
              senderOwnerId: d.senderOwnerId,
              recipient: d.recipient,
              recipientOwnerId: d.recipientOwnerId,
              text,
              voiceNote: d.voiceNote,
              duration: d.duration,
              mediaUrl: d.mediaUrl,
              mediaType: d.mediaType,
              sticker: d.sticker,
              stickerEmoji: d.stickerEmoji,
              stickerImageUrl: d.stickerImageUrl,
              stickerLabel: d.stickerLabel,
              gameShare,
              replyTo,
              forwardedFrom,
              reactions: d.reactions || {},
              status: d.status || "delivered",
              deletedFor: d.deletedFor || [],
              deletedForEveryone: d.deletedForEveryone || false,
              timestamp: d.timestamp || d.created_at || Date.now(),
              elo: d.elo || 1500
            });
          });

          setMessagesMap((prev) => ({
            ...prev,
            ...map
          }));
        }
      } catch (err) {
        console.warn("Could not load private messages:", err);
      }
    };

    fetchPrivateMessages();

    // Supabase Realtime Subscription for Private Messages
    const channel = supabase
      .channel("lounge_private_feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "private_messages" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const d = payload.new as any;
            if (blockedUsers.includes(d.sender)) return;

            const cId = d.chatId || getDirectChatId(d.sender, d.recipient);
            let gameShare = d.gameShare;
            let replyTo = d.replyTo;
            let forwardedFrom = d.forwardedFrom;
            let text = d.text;

            if (text && text.startsWith("___KENTRO_META___:")) {
              try {
                const meta = JSON.parse(text.replace("___KENTRO_META___:", ""));
                text = meta.text || "";
                gameShare = meta.gameShare || gameShare;
                replyTo = meta.replyTo || replyTo;
                forwardedFrom = meta.forwardedFrom || forwardedFrom;
              } catch {}
            }

            const newMsg: LoungeMessage = {
              id: d.id,
              chatId: cId,
              sender: d.sender,
              senderOwnerId: d.senderOwnerId,
              recipient: d.recipient,
              recipientOwnerId: d.recipientOwnerId,
              text,
              voiceNote: d.voiceNote,
              duration: d.duration,
              mediaUrl: d.mediaUrl,
              mediaType: d.mediaType,
              sticker: d.sticker,
              stickerEmoji: d.stickerEmoji,
              stickerImageUrl: d.stickerImageUrl,
              stickerLabel: d.stickerLabel,
              gameShare,
              replyTo,
              forwardedFrom,
              reactions: d.reactions || {},
              status: d.status || "delivered",
              deletedFor: d.deletedFor || [],
              deletedForEveryone: d.deletedForEveryone || false,
              timestamp: d.timestamp || d.created_at || Date.now(),
              elo: d.elo || 1500
            };

            setMessagesMap((prev) => {
              const list = prev[cId] || [];
              if (list.some((m) => m.id === newMsg.id)) return prev;
              return {
                ...prev,
                [cId]: [...list, newMsg]
              };
            });

            if (d.sender !== username) {
              playLoungeSound("receive");
            }
          } else if (payload.eventType === "UPDATE") {
            const d = payload.new as any;
            const cId = d.chatId || getDirectChatId(d.sender, d.recipient);
            setMessagesMap((prev) => {
              const list = prev[cId] || [];
              return {
                ...prev,
                [cId]: list.map((m) => (m.id === d.id ? { ...m, ...d } : m))
              };
            });
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [username, blockedUsers, getDirectChatId]);

  // Fetch Friends / Contacts
  useEffect(() => {
    let isMounted = true;
    const fetchFriends = async () => {
      try {
        const { data, error } = await supabase
          .from("friends")
          .select("*")
          .or(`user1.eq.${username},user2.eq.${username}`);

        if (error) throw error;
        if (data && isMounted) {
          setContacts(data);
        }
      } catch (err) {
        console.warn("Could not fetch contacts:", err);
      }
    };

    fetchFriends();

    const channel = supabase
      .channel("lounge_friends_feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "friends" }, () => {
        fetchFriends();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [username]);

  // Read message receipt tracking: set to seen in local state
  const markAsSeen = useCallback(
    async (chatId: string) => {
      const msgs = messagesMap[chatId] || [];
      const unseenIds = msgs
        .filter((m) => m.sender !== username && m.status !== "seen")
        .map((m) => m.id);

      if (unseenIds.length === 0) return;

      setMessagesMap((prev) => {
        const list = prev[chatId] || [];
        return {
          ...prev,
          [chatId]: list.map((m) =>
            unseenIds.includes(m.id) ? { ...m, status: "seen" } : m
          )
        };
      });

      // Update in Supabase
      try {
        await supabase
          .from("private_messages")
          .update({ status: "seen" })
          .in("id", unseenIds);
      } catch {}
    },
    [messagesMap, username]
  );

  // Compute Conversations List
  const conversations = useMemo<LoungeConversation[]>(() => {
    const list: LoungeConversation[] = [];

    // 1. Global Hall
    const globalMsgs = messagesMap[GLOBAL_CHAT_ID] || [];
    const globalLast = globalMsgs[globalMsgs.length - 1];
    list.push({
      id: GLOBAL_CHAT_ID,
      type: "public",
      name: "Grandmaster Hall",
      description: "Public room — everyone in the Lounge can participate",
      avatarUrl: "👑",
      lastMessage: globalLast,
      unreadCount: 0,
      isPinned: true,
      updatedAt: globalLast ? new Date(globalLast.timestamp).getTime() : 1
    });

    // 2. Direct Conversations from messagesMap and contacts
    const directChatIds = new Set<string>();

    // From active messages
    Object.keys(messagesMap).forEach((cId) => {
      if (cId === GLOBAL_CHAT_ID || cId.startsWith("group_")) return;
      directChatIds.add(cId);
    });

    // From contacts
    contacts.forEach((con) => {
      const otherUser = con.user1.toLowerCase() === username.toLowerCase() ? con.user2 : con.user1;
      directChatIds.add(getDirectChatId(username, otherUser));
    });

    directChatIds.forEach((cId) => {
      const parts = cId.split("_");
      const targetUser = parts[0]?.toLowerCase() === username.toLowerCase() ? parts[1] : parts[0];
      if (!targetUser || blockedUsers.includes(targetUser)) return;

      const msgs = messagesMap[cId] || [];
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(
        (m) => m.sender.toLowerCase() !== username.toLowerCase() && m.status !== "seen"
      ).length;

      const contact = contacts.find(
        (c) =>
          c.user1.toLowerCase() === targetUser.toLowerCase() ||
          c.user2.toLowerCase() === targetUser.toLowerCase()
      );
      const elo =
        contact?.user1.toLowerCase() === targetUser.toLowerCase()
          ? contact.user1Elo
          : contact?.user2Elo;

      const isOnline = onlineUsers.some((u) => u.toLowerCase() === targetUser.toLowerCase());

      list.push({
        id: cId,
        type: "direct",
        targetUsername: targetUser,
        name: targetUser,
        elo: elo || 1500,
        lastMessage: lastMsg,
        unreadCount,
        isOnline,
        updatedAt: lastMsg ? new Date(lastMsg.timestamp).getTime() : 0
      });
    });

    // 3. Groups
    groups.forEach((grp) => {
      if (!grp.members.map((m) => m.toLowerCase()).includes(username.toLowerCase())) return;
      const cId = `group_${grp.id}`;
      const msgs = messagesMap[cId] || [];
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = msgs.filter(
        (m) => m.sender.toLowerCase() !== username.toLowerCase() && m.status !== "seen"
      ).length;

      list.push({
        id: cId,
        type: "group",
        groupData: grp,
        name: grp.name,
        avatarUrl: grp.icon || "👥",
        lastMessage: lastMsg,
        unreadCount,
        updatedAt: lastMsg ? new Date(lastMsg.timestamp).getTime() : grp.createdAt
      });
    });

    // Sort: pinned first, then by updatedAt descending
    return list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [messagesMap, contacts, groups, blockedUsers, username, onlineUsers, getDirectChatId]);

  // Filtered conversations based on search and tab
  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return conversations.filter((conv) => {
      // Tab filter
      if (activeFilterTab === "direct" && conv.type !== "direct") return false;
      if (activeFilterTab === "groups" && conv.type !== "group") return false;
      if (activeFilterTab === "hall" && conv.type !== "public") return false;

      // Search query filter
      if (!q) return true;
      if (conv.name.toLowerCase().includes(q)) return true;
      if (conv.targetUsername?.toLowerCase().includes(q)) return true;
      if (conv.lastMessage?.text?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [conversations, activeFilterTab, searchQuery]);

  // Total unread count across all conversations
  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  }, [conversations]);

  // Active conversation object
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeChatId) || conversations[0];
  }, [conversations, activeChatId]);

  // Active messages list (with deleted messages filtered out for user)
  const activeMessages = useMemo(() => {
    const list = messagesMap[activeChatId] || [];
    return list.filter((m) => {
      if (m.deletedFor?.includes(username)) return false;
      if (m.deletedForEveryone) return true; // Keep placeholder "This message was deleted"
      return true;
    });
  }, [messagesMap, activeChatId, username]);

  // SEND MESSAGE HANDLER
  const sendMessage = useCallback(
    async (payload: {
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
      fileName?: string;
      replyTo?: ReplyContext;
      forwardedFrom?: string;
    }) => {
      if (!activeChatId) return;

      const isGlobal = activeChatId === GLOBAL_CHAT_ID;
      const isGroup = activeChatId.startsWith("group_");
      const currentElo = profileStats?.elo || 1500;
      const tempId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const timestamp = new Date().toISOString();

      let targetUser = "";
      if (!isGlobal && !isGroup) {
        const parts = activeChatId.split("_");
        targetUser = parts[0]?.toLowerCase() === username.toLowerCase() ? parts[1] : parts[0];
      }

      // Optimistic message
      const optimisticMsg: LoungeMessage = {
        id: tempId,
        chatId: activeChatId,
        sender: username,
        recipient: targetUser || undefined,
        text: payload.text,
        voiceNote: payload.voiceNote,
        duration: payload.duration,
        mediaUrl: payload.mediaUrl,
        mediaType: payload.mediaType,
        fileName: payload.fileName,
        sticker: payload.sticker,
        stickerEmoji: payload.stickerEmoji,
        stickerImageUrl: payload.stickerImageUrl,
        stickerLabel: payload.stickerLabel,
        gameShare: payload.gameShare,
        replyTo: payload.replyTo,
        forwardedFrom: payload.forwardedFrom,
        reactions: {},
        status: "sent",
        deletedFor: [],
        timestamp,
        elo: currentElo
      };

      setMessagesMap((prev) => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), optimisticMsg]
      }));

      playLoungeSound(payload.voiceNote ? "send" : payload.sticker ? "sticker" : "send");
      setActiveReply(null);

      // Persist to Supabase
      try {
        const [{ data: sessionData }, recipientOwnerId] = await Promise.all([
          supabase.auth.getSession(),
          targetUser ? resolveOwnerId(targetUser) : Promise.resolve(null)
        ]);

        const session = sessionData?.session;

        if (isGlobal) {
          const { error } = await supabase.from("global_chat").insert({
            sender: username,
            text: payload.text || (payload.gameShare ? `Shared Draughts Match: #${payload.gameShare.gameCode}` : ""),
            timestamp,
            reactions: {},
            elo: currentElo,
            voiceNote: payload.voiceNote,
            duration: payload.duration,
            sticker: payload.sticker,
            stickerEmoji: payload.stickerEmoji,
            stickerImageUrl: payload.stickerImageUrl,
            stickerLabel: payload.stickerLabel
          });
          if (error) console.warn("Supabase global chat error:", error);
        } else {
          // If rich payload, encode metadata in text to guarantee 100% preservation
          let textToSend = payload.text || "";
          if (payload.gameShare || payload.replyTo || payload.forwardedFrom) {
            textToSend = `___KENTRO_META___:${JSON.stringify({
              text: payload.text || "",
              gameShare: payload.gameShare,
              replyTo: payload.replyTo,
              forwardedFrom: payload.forwardedFrom
            })}`;
          }

          const { error } = await supabase.from("private_messages").insert({
            chatId: activeChatId,
            sender: username,
            recipient: targetUser || activeChatId,
            senderOwnerId: session?.user?.id || null,
            recipientOwnerId,
            text: textToSend,
            voiceNote: payload.voiceNote,
            duration: payload.duration,
            sticker: payload.sticker,
            stickerEmoji: payload.stickerEmoji,
            stickerImageUrl: payload.stickerImageUrl,
            stickerLabel: payload.stickerLabel,
            status: "delivered",
            reactions: {}
          });
          if (error) console.warn("Supabase private message error:", error);
        }
      } catch (err) {
        console.error("Failed sending message:", err);
      }
    },
    [activeChatId, username, profileStats, resolveOwnerId]
  );

  // EMOJI REACTION HANDLER
  const reactToMessage = useCallback(
    async (msgId: string, emoji: string) => {
      const currentMsgs = messagesMap[activeChatId] || [];
      const targetMsg = currentMsgs.find((m) => m.id === msgId);
      if (!targetMsg) return;

      const currentReactions = { ...targetMsg.reactions };
      const reactors = currentReactions[emoji] || [];
      const hasReacted = reactors.includes(username);

      const updatedReactors = hasReacted
        ? reactors.filter((u) => u !== username)
        : [...reactors, username];

      if (updatedReactors.length === 0) {
        delete currentReactions[emoji];
      } else {
        currentReactions[emoji] = updatedReactors;
      }

      setMessagesMap((prev) => {
        const list = prev[activeChatId] || [];
        return {
          ...prev,
          [activeChatId]: list.map((m) =>
            m.id === msgId ? { ...m, reactions: currentReactions } : m
          )
        };
      });

      try {
        const table = activeChatId === GLOBAL_CHAT_ID ? "global_chat" : "private_messages";
        await supabase.from(table).update({ reactions: currentReactions }).eq("id", msgId);
      } catch (err) {
        console.warn("Failed persisting reaction:", err);
      }
    },
    [activeChatId, messagesMap, username]
  );

  // DELETE MESSAGE HANDLER
  const deleteMessage = useCallback(
    async (msgId: string, forEveryone = false) => {
      const currentMsgs = messagesMap[activeChatId] || [];
      const targetMsg = currentMsgs.find((m) => m.id === msgId);
      if (!targetMsg) return;

      if (forEveryone) {
        setMessagesMap((prev) => {
          const list = prev[activeChatId] || [];
          return {
            ...prev,
            [activeChatId]: list.map((m) =>
              m.id === msgId ? { ...m, deletedForEveryone: true, text: "This message was deleted." } : m
            )
          };
        });

        try {
          const table = activeChatId === GLOBAL_CHAT_ID ? "global_chat" : "private_messages";
          await supabase
            .from(table)
            .update({ text: "This message was deleted.", deletedForEveryone: true })
            .eq("id", msgId);
        } catch {}
      } else {
        // Delete for me
        setMessagesMap((prev) => {
          const list = prev[activeChatId] || [];
          return {
            ...prev,
            [activeChatId]: list.map((m) =>
              m.id === msgId ? { ...m, deletedFor: [...(m.deletedFor || []), username] } : m
            )
          };
        });
      }
    },
    [activeChatId, messagesMap, username]
  );

  // FORWARD MESSAGE HANDLER
  const forwardMessage = useCallback(
    async (msg: LoungeMessage, targetChatId: string) => {
      const tempId = `fwd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const forwardedMsg: LoungeMessage = {
        ...msg,
        id: tempId,
        chatId: targetChatId,
        sender: username,
        forwardedFrom: msg.sender,
        status: "sent",
        timestamp: new Date().toISOString(),
        reactions: {}
      };

      setMessagesMap((prev) => ({
        ...prev,
        [targetChatId]: [...(prev[targetChatId] || []), forwardedMsg]
      }));

      playLoungeSound("send");

      try {
        const isGlobal = targetChatId === GLOBAL_CHAT_ID;
        const parts = targetChatId.split("_");
        const targetUser = parts[0]?.toLowerCase() === username.toLowerCase() ? parts[1] : parts[0];

        const textToSend = `___KENTRO_META___:${JSON.stringify({
          text: msg.text || "",
          gameShare: msg.gameShare,
          forwardedFrom: msg.sender
        })}`;

        if (isGlobal) {
          await supabase.from("global_chat").insert({
            sender: username,
            text: msg.text || "Forwarded Message",
            timestamp: new Date().toISOString(),
            voiceNote: msg.voiceNote,
            duration: msg.duration,
            sticker: msg.sticker,
            stickerEmoji: msg.stickerEmoji,
            stickerImageUrl: msg.stickerImageUrl,
            stickerLabel: msg.stickerLabel
          });
        } else {
          await supabase.from("private_messages").insert({
            chatId: targetChatId,
            sender: username,
            recipient: targetUser || targetChatId,
            text: textToSend,
            voiceNote: msg.voiceNote,
            duration: msg.duration,
            sticker: msg.sticker,
            stickerEmoji: msg.stickerEmoji,
            stickerImageUrl: msg.stickerImageUrl,
            stickerLabel: msg.stickerLabel,
            status: "delivered",
            reactions: {}
          });
        }
      } catch (err) {
        console.error("Failed forwarding message:", err);
      }
    },
    [username]
  );

  // START DIRECT CHAT WITH USER
  const startDirectChat = useCallback(
    (targetUsername: string, targetElo = 1500) => {
      const cleanTarget = targetUsername.trim();
      if (!cleanTarget || cleanTarget.toLowerCase() === username.toLowerCase()) return;

      const cId = getDirectChatId(username, cleanTarget);

      // Also ensure friend record exists so they stay in Rolodex
      const friendId = [username.toLowerCase(), cleanTarget.toLowerCase()].sort().join("_");
      supabase
        .from("friends")
        .upsert({
          id: friendId,
          user1: username,
          user2: cleanTarget,
          user1Elo: profileStats?.elo || 1500,
          user2Elo: targetElo,
          status: "pending",
          sender: username
        })
        .then(() => {}, () => {});

      setActiveChatId(cId);
    },
    [username, profileStats, getDirectChatId]
  );

  // GROUPS ACTIONS
  const createGroup = useCallback(
    (name: string, description: string, icon = "👥", initialMembers: string[] = []) => {
      const newGroupId = `grp_${Date.now()}`;
      const allMembers = Array.from(new Set([username, ...initialMembers]));
      const newGroup: LoungeGroup = {
        id: newGroupId,
        name,
        description,
        icon,
        createdBy: username,
        createdAt: Date.now(),
        admins: [username],
        members: allMembers
      };

      setGroups((prev) => [newGroup, ...prev]);
      setActiveChatId(`group_${newGroupId}`);
    },
    [username]
  );

  const updateGroup = useCallback((groupId: string, updates: Partial<LoungeGroup>) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...updates } : g)));
  }, []);

  const addGroupMember = useCallback((groupId: string, newMember: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (g.members.includes(newMember)) return g;
        return { ...g, members: [...g.members, newMember] };
      })
    );
  }, []);

  const removeGroupMember = useCallback((groupId: string, memberToRemove: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          members: g.members.filter((m) => m !== memberToRemove),
          admins: g.admins.filter((a) => a !== memberToRemove)
        };
      })
    );
  }, []);

  const makeGroupAdmin = useCallback((groupId: string, member: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (g.admins.includes(member)) return g;
        return { ...g, admins: [...g.admins, member] };
      })
    );
  }, []);

  const leaveGroup = useCallback(
    (groupId: string) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          return {
            ...g,
            members: g.members.filter((m) => m !== username),
            admins: g.admins.filter((a) => a !== username)
          };
        })
      );
      setActiveChatId(GLOBAL_CHAT_ID);
    },
    [username]
  );

  // BLOCK / UNBLOCK USER
  const blockUser = useCallback((targetUsername: string) => {
    setBlockedUsers((prev) => Array.from(new Set([...prev, targetUsername])));
  }, []);

  const unblockUser = useCallback((targetUsername: string) => {
    setBlockedUsers((prev) => prev.filter((u) => u !== targetUsername));
  }, []);

  // SUBMIT REPORT
  const reportUserOrMessage = useCallback(
    (payload: Omit<ReportPayload, "reportedBy" | "timestamp">) => {
      const fullReport: ReportPayload = {
        ...payload,
        reportedBy: username,
        timestamp: Date.now()
      };

      try {
        const savedReports = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || "[]");
        savedReports.push(fullReport);
        localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(savedReports));
      } catch {}

      return true;
    },
    [username]
  );

  // UPDATE PROFILE
  const updateMyProfile = useCallback(
    async (updates: Partial<LoungeUserProfile>) => {
      setCustomProfiles((prev) => ({
        ...prev,
        [username.toLowerCase()]: {
          ...(prev[username.toLowerCase()] || {
            username,
            usernameLower: username.toLowerCase(),
            elo: profileStats?.elo || 1500,
            wins: profileStats?.wins || 0,
            losses: profileStats?.losses || 0,
            draws: profileStats?.draws || 0,
            gamesCount: profileStats?.gamesCount || 0
          }),
          ...updates
        }
      }));

      // Update in Supabase profiles
      try {
        await supabase
          .from("profiles")
          .update({
            bio: updates.bio,
            statusQuote: updates.statusQuote,
            avatarUrl: updates.avatarUrl
          })
          .ilike("usernameLower", username.toLowerCase());
      } catch (err) {
        console.warn("Could not sync profile to cloud:", err);
      }
    },
    [username, profileStats]
  );

  return {
    activeChatId,
    setActiveChatId,
    conversations,
    filteredConversations,
    activeConversation,
    activeMessages,
    totalUnreadCount,
    searchQuery,
    setSearchQuery,
    activeFilterTab,
    setActiveFilterTab,
    activeReply,
    setActiveReply,
    blockedUsers,
    groups,
    customProfiles,
    sendMessage,
    reactToMessage,
    deleteMessage,
    forwardMessage,
    markAsSeen,
    startDirectChat,
    createGroup,
    updateGroup,
    addGroupMember,
    removeGroupMember,
    makeGroupAdmin,
    leaveGroup,
    blockUser,
    unblockUser,
    reportUserOrMessage,
    updateMyProfile
  };
}
