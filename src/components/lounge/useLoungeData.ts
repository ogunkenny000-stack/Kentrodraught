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
import { directChatId, directChatTarget, encodeLoungePayload, decodeLoungePayload } from "../../lib/loungeProtocol";

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
  // Shared groups need a server-owned membership model. Keep saved local
  // data untouched, but do not present seeded browser-only clubs as real rooms.
  const [groups, setGroups] = useState<LoungeGroup[]>([]);
  const [groupError, setGroupError] = useState('');
  const refreshGroups = useCallback(async () => {
    const { data, error } = await supabase.rpc('kentro_group_list');
    if (error) throw error;
    setGroups(Array.isArray(data) ? data : []);
  }, []);
  const groupAction = useCallback(async (groupId: string | null, action: string, data: Record<string, unknown> = {}) => {
    setGroupError('');
    try {
      const result = await supabase.rpc('kentro_group_action', { p_group: groupId, p_action: action, p_data: data });
      if (result.error) throw result.error;
      await refreshGroups();
      return result.data;
    } catch (error) { setGroupError(error instanceof Error ? error.message : (error as any)?.message || 'Group operation failed.'); throw error; }
  }, [refreshGroups]);
  useEffect(() => {
    let live = true;
    const load = async () => { try { await refreshGroups(); } catch { if (live) setGroupError('Shared groups could not load. Check the Supabase connection and group migrations.'); } };
    void load(); const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [username, refreshGroups]);
  useEffect(() => {
    if (!activeChatId.startsWith('group_')) return;
    const group = groups.find(item => 'group_' + item.id === activeChatId);
    if (!group || group.invited) return;
    let live = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('kentro_group_feed', { p_group: group.id });
      if (!live) return;
      if (error) { setGroupError(error.message); return; }
      const messages: LoungeMessage[] = (data || []).map((row: any) => ({ id: row.id, chatId: activeChatId, sender: row.sender,
        timestamp: row.created_at, reactions: row.reactions || {}, status: row.sender === username ? 'sent' : 'delivered', deletedFor: [], deletedForEveryone: row.deleted,
        ...decodeLoungePayload(row.text) }));
      setMessagesMap(previous => ({ ...previous, [activeChatId]: messages }));
    };
    void load(); const timer = setInterval(load, 2500);
    return () => { live = false; clearInterval(timer); };
  }, [activeChatId, groups]);


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
        .eq("usernameLower", targetUsername.toLowerCase().trim())
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
    return directChatId(u1, u2);
  }, []);

  // Fetch Public Global Chat Messages
  useEffect(() => {
    let isMounted = true;
    const fetchGlobalMessages = async () => {
      try {
        const { data, error } = await supabase
          .from("global_chat")
          .select("*")
          .order("timestamp", { ascending: false })
          .limit(100);

        if (error) throw error;
        if (data && isMounted) {
          const parsed: LoungeMessage[] = [...data].reverse().map((d: any) => ({
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
            forwardedFrom: d.forwardedFrom,
            ...decodeLoungePayload(d.text)
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
            forwardedFrom: d.forwardedFrom,
            ...decodeLoungePayload(d.text)
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
          .order("timestamp", { ascending: false })
          .limit(300);

        if (error) throw error;
        if (data && isMounted) {
          const map: Record<string, LoungeMessage[]> = {};
          [...data].reverse().forEach((d: any) => {
            if (blockedUsers.includes(d.sender)) return;

            const cId = getDirectChatId(d.sender, d.recipient);
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
              elo: d.elo || 1500,
              ...decodeLoungePayload(d.text)
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

            const cId = getDirectChatId(d.sender, d.recipient);
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
              elo: d.elo || 1500,
              ...decodeLoungePayload(d.text)
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
            const cId = getDirectChatId(d.sender, d.recipient);
            setMessagesMap((prev) => {
              const list = prev[cId] || [];
              return {
                ...prev,
                [cId]: list.map((m) => (m.id === d.id ? { ...m, ...d, chatId: cId, ...decodeLoungePayload(d.text) } : m))
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

      // Seen state is local; no shared receipt exists in the current schema.

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
      const targetUser = directChatTarget(cId, username);
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
      const tempId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      let targetUser = "";
      if (!isGlobal && !isGroup) {
        targetUser = directChatTarget(activeChatId, username);
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
        status: "sending",
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

        if (!session?.user) throw new Error('Sign in to send messages.');
        if (!isGlobal && !isGroup && (!targetUser || !recipientOwnerId)) throw new Error('The recipient could not be verified.');
        const row: Record<string, unknown> = isGlobal ? {
          id: tempId, sender: username, text: encodeLoungePayload(payload), timestamp,
        } : {
          id: tempId, chatId: activeChatId, sender: username, recipient: targetUser,
          senderOwnerId: session.user.id, recipientOwnerId,
          text: encodeLoungePayload(payload), timestamp,
        };
        const { error } = isGroup ? await supabase.rpc('kentro_group_action', { p_group: activeChatId.slice(6), p_action: 'send', p_data: { id: tempId, text: encodeLoungePayload(payload) } }) : await supabase.from(isGlobal ? 'global_chat' : 'private_messages').insert(row);
        if (error) throw error;
        setMessagesMap(previous => ({ ...previous, [activeChatId]: (previous[activeChatId] || []).map(message => message.id === tempId ? { ...message, status: 'sent' } : message) }));
      } catch (err) {
        console.error("Failed sending message:", err);
        setMessagesMap(previous => ({ ...previous, [activeChatId]: (previous[activeChatId] || []).map(message => message.id === tempId ? { ...message, status: 'failed' } : message) }));
      }

    },
    [activeChatId, username, profileStats, resolveOwnerId]
  );

  // EMOJI REACTION HANDLER
  const reactToMessage = useCallback(
    async (msgId: string, emoji: string) => {
      if (activeChatId.startsWith('group_')) {
        try { await groupAction(activeChatId.slice(6), 'react', { id: msgId, emoji }); }
        catch { /* groupError carries the actual server failure */ }
        return;
      }

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
        const { data, error } = await supabase.from(table).update({ reactions: currentReactions }).eq("id", msgId).select("id");
        if (error || !data?.length) throw new Error("Reactions are unavailable for this message.");
      } catch (err) {
        console.warn("Failed persisting reaction:", err);
        setMessagesMap(previous => ({ ...previous, [activeChatId]: (previous[activeChatId] || []).map(message => message.id === msgId ? { ...message, reactions: targetMsg.reactions } : message) }));
        window.alert("Could not save this reaction. Please try again later.");
      }
    },
    [activeChatId, messagesMap, username]
  );

  // DELETE MESSAGE HANDLER
  const deleteMessage = useCallback(
    async (msgId: string, forEveryone = false) => {
      if (forEveryone && activeChatId.startsWith('group_')) {
        try { await groupAction(activeChatId.slice(6), 'delete_message', { id: msgId }); }
        catch { /* groupError is visible */ }
        return;
      }

      const currentMsgs = messagesMap[activeChatId] || [];
      const targetMsg = currentMsgs.find((m) => m.id === msgId);
      if (!targetMsg) return;

      // Hiding a message affects this view only. The server schema has no
      // deletion tombstone; never claim a shared deletion succeeded.
      setMessagesMap(previous => ({ ...previous, [activeChatId]: (previous[activeChatId] || []).map(message => message.id === msgId ? { ...message, deletedFor: [...(message.deletedFor || []), username] } : message) }));

    },
    [activeChatId, messagesMap, username]
  );

  // Forward through the same persistence contract, without trusting sender data.
  const forwardMessage = useCallback(async (msg: LoungeMessage, targetChatId: string) => {
    if (targetChatId.startsWith('group_')) {
      await groupAction(targetChatId.slice(6), 'send', { id: crypto.randomUUID(), text: encodeLoungePayload({ ...msg, forwardedFrom: msg.sender }) });
      return;
    }
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const targetUser = directChatTarget(targetChatId, username);
    const isGlobal = targetChatId === GLOBAL_CHAT_ID;
    const forwardedMsg: LoungeMessage = { ...msg, id, chatId: targetChatId, sender: username, recipient: targetUser, forwardedFrom: msg.sender, status: 'sending', timestamp, reactions: {} };
    setMessagesMap(previous => ({ ...previous, [targetChatId]: [...(previous[targetChatId] || []), forwardedMsg] }));
    try {
      const { data } = await supabase.auth.getSession();
      const recipientOwnerId = targetUser ? await resolveOwnerId(targetUser) : null;
      if (!data.session || (!isGlobal && !recipientOwnerId)) throw new Error('The recipient could not be verified.');
      const row: Record<string, unknown> = isGlobal ? { id, sender: username, text: encodeLoungePayload({ ...msg, forwardedFrom: msg.sender }), timestamp } : {
        id, sender: username, recipient: targetUser, chatId: targetChatId,
        senderOwnerId: data.session.user.id, recipientOwnerId,
        text: encodeLoungePayload({ ...msg, forwardedFrom: msg.sender }), timestamp,
      };
      const { error } = await supabase.from(isGlobal ? 'global_chat' : 'private_messages').insert(row);
      if (error) throw error;
      setMessagesMap(previous => ({ ...previous, [targetChatId]: (previous[targetChatId] || []).map(message => message.id === id ? { ...message, status: 'sent' } : message) }));
    } catch (error) {
      console.error('Failed forwarding message:', error);
      setMessagesMap(previous => ({ ...previous, [targetChatId]: (previous[targetChatId] || []).map(message => message.id === id ? { ...message, status: 'failed' } : message) }));
    }
  }, [username, resolveOwnerId]);

  // START DIRECT CHAT WITH USER
  const startDirectChat = useCallback(
    (targetUsername: string, targetElo = 1500) => {
      const cleanTarget = targetUsername.trim();
      if (!cleanTarget || cleanTarget.toLowerCase() === username.toLowerCase()) return;

      const cId = getDirectChatId(username, cleanTarget);

      // Opening a DM does not change friendship or consent.
      setActiveChatId(cId);
    },
    [username, profileStats, getDirectChatId]
  );

  // Retain the operation identity across a lost response or partial invitation failure.
  const pendingCreation = useRef<{ signature: string; id: string } | null>(null);
  // Every shared group mutation is authorized and persisted by PostgreSQL.
  const createGroup = useCallback(async (name: string, description: string, icon = '👥', initialMembers: string[] = []) => {
    const signature = JSON.stringify([name, description, icon, initialMembers.slice().sort()]);
    if (pendingCreation.current?.signature !== signature) pendingCreation.current = { signature, id: crypto.randomUUID() };
    const group = await groupAction(pendingCreation.current.id, 'create', { name, description, icon });
    setActiveChatId('group_' + group.id);
    for (const member of [...new Set(initialMembers)].filter(member => member.toLowerCase() !== username.toLowerCase())) {
      await groupAction(group.id, 'invite', { username: member });
    }
    pendingCreation.current = null;
  }, [groupAction, username]);
  const updateGroup = useCallback((id: string, updates: Partial<LoungeGroup>) => { void groupAction(id, 'update', updates).catch(() => {}); }, [groupAction]);
  const addGroupMember = useCallback((id: string, member: string) => { void groupAction(id, 'invite', { username: member }).catch(() => {}); }, [groupAction]);
  const removeGroupMember = useCallback((id: string, member: string) => { void groupAction(id, 'remove', { username: member }).catch(() => {}); }, [groupAction]);
  const makeGroupAdmin = useCallback((id: string, member: string) => { void groupAction(id, 'promote', { username: member }).catch(() => {}); }, [groupAction]);
  const leaveGroup = useCallback((id: string) => { void groupAction(id, 'leave').then(() => setActiveChatId(GLOBAL_CHAT_ID)).catch(() => {}); }, [groupAction]);
  const acceptGroup = useCallback((id: string) => { void groupAction(id, 'accept').then(() => setActiveChatId('group_' + id)).catch(() => {}); }, [groupAction]);
  const declineGroup = useCallback((id: string) => { void groupAction(id, 'decline').catch(() => {}); }, [groupAction]);
  const transferGroup = useCallback((id: string, member: string) => { void groupAction(id, 'transfer', { username: member }).catch(() => {}); }, [groupAction]);
  const deleteGroup = useCallback((id: string) => { void groupAction(id, 'delete').then(() => setActiveChatId(GLOBAL_CHAT_ID)).catch(() => {}); }, [groupAction]);

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
    groupError, acceptGroup, declineGroup, transferGroup, deleteGroup,
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
