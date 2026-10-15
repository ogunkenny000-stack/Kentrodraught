import React, { useState, useEffect, useCallback } from "react";
import type { GlobalChatLoungeProps, LoungeMessage, GameShareData } from "./lounge/types";
import { useLoungeData } from "./lounge/useLoungeData";
import { LoungeHeader } from "./lounge/LoungeHeader";
import { ConversationList } from "./lounge/ConversationList";
import { ChatArea } from "./lounge/ChatArea";
import { RecentGamesModal } from "./lounge/RecentGamesModal";
import { UserProfileModal } from "./lounge/UserProfileModal";
import { CreateGroupModal } from "./lounge/CreateGroupModal";
import { GroupInfoModal } from "./lounge/GroupInfoModal";
import { NewChatModal } from "./lounge/NewChatModal";
import { ForwardModal } from "./lounge/ForwardModal";
import { ReportModal } from "./lounge/ReportModal";
import { VoiceCallModal } from "./lounge/VoiceCallModal";
import { VoicePlayer } from "./lounge/VoicePlayer";

export { VoicePlayer };

function GlobalChatLoungeImpl({
  username,
  profileStats,
  onlineUsers = [],
  onSelectMode,
  onLoadSavedGame,
  myGamesList = [],
  savedGamesList = [],
  fetchMyGames,
  onStartVoiceCall,
  activeVoiceCall
}: GlobalChatLoungeProps) {
  const {
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
  } = useLoungeData(username, profileStats, onlineUsers);

  // Mobile View Navigation: "list" or "chat"
  const [mobileView, setMobileView] = useState<"list" | "chat">("chat");

  // Modals state
  const [showRecentGamesModal, setShowRecentGamesModal] = useState(false);
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [profileTargetUser, setProfileTargetUser] = useState<string>(username);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<LoungeMessage | null>(null);
  const [reportingData, setReportingData] = useState<{ user: string; messageId?: string } | null>(null);

  // Local Voice Call state if activeVoiceCall not provided from outside
  const [localVoiceCall, setLocalVoiceCall] = useState<{
    callState: "calling" | "ringing" | "connected" | "ended";
    targetUser: string;
    duration: number;
    isMicMuted: boolean;
  }>({
    callState: "ended",
    targetUser: "",
    duration: 0,
    isMicMuted: false
  });

  // Automatically mark active conversation as seen
  useEffect(() => {
    if (activeChatId) {
      markAsSeen(activeChatId);
    }
  }, [activeChatId, activeMessages.length, markAsSeen]);

  // Handle select conversation
  const handleSelectConversation = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setMobileView("chat");
  }, [setActiveChatId]);

  // Handle Voice/Video Call initiation
  const handleStartCall = useCallback(
    (targetUser: string, type: "voice" | "video" = "voice") => {
      if (onStartVoiceCall) {
        onStartVoiceCall(targetUser, type);
      } else {
        window.alert('Calling is unavailable until the online voice connection is ready. No call was started.');
      }
    },
    [onStartVoiceCall]
  );

  // Voice Call timer
  useEffect(() => {
    if (localVoiceCall.callState !== "connected") return;
    const interval = setInterval(() => {
      setLocalVoiceCall((prev) => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
    return () => clearInterval(interval);
  }, [localVoiceCall.callState]);

  // Open user profile
  const handleOpenUserProfile = useCallback((target: string) => {
    setProfileTargetUser(target);
    setShowUserProfileModal(true);
  }, []);

  return (
    <div className="k-lounge w-full h-full flex flex-col bg-[#070913] text-slate-100 select-none overflow-hidden font-sans">
      {/* 1. TOP BRAND NAVIGATION HEADER */}
      {groupError && <p role="alert" className="p-3 text-sm text-rose-300">{groupError}</p>}
      {groups.filter(group => group.invited).map(group => <div key={group.id} className="p-3 border-b border-slate-700 text-sm">
        Invitation to {group.name} <button onClick={() => acceptGroup(group.id)} className="p-2 text-amber-300">Accept invitation</button>
        <button onClick={() => declineGroup(group.id)} className="p-2">Decline</button>
      </div>)}
      <LoungeHeader
        username={username}
        profileStats={profileStats}
        totalUnreadCount={totalUnreadCount}
        onBackToHome={() => onSelectMode && onSelectMode("Home")}
        onOpenMyProfile={() => handleOpenUserProfile(username)}
        onOpenCreateGroup={() => setShowCreateGroupModal(true)}
        onOpenNewChat={() => setShowNewChatModal(true)}
      />

      {/* Mobile back banner if in mobile chat view */}
      <div className="md:hidden flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-900 text-xs">
        {mobileView === "chat" ? (
          <button
            onClick={() => setMobileView("list")}
            className="flex items-center gap-1 text-amber-400 font-bold hover:text-amber-300 py-1 cursor-pointer"
          >
            <span>← All Conversations</span>
          </button>
        ) : (
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Conversations ({filteredConversations.length})
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="text-[10px] font-bold text-amber-400 uppercase bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20"
          >
            + New Chat
          </button>
        </div>
      </div>

      {/* 2. MAIN SPLIT PANE BODY */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* LEFT PANE: Conversation & Group List */}
        <div
          className={`h-full ${
            mobileView === "list" ? "w-full flex" : "hidden md:flex"
          }`}
        >
          <ConversationList
            conversations={filteredConversations}
            activeChatId={activeChatId}
            onSelectConversation={handleSelectConversation}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeFilterTab={activeFilterTab}
            onFilterTabChange={setActiveFilterTab}
            onOpenNewChat={() => setShowNewChatModal(true)}
            onOpenCreateGroup={() => setShowCreateGroupModal(true)}
            currentUsername={username}
          />
        </div>

        {/* RIGHT PANE: Chat Area */}
        <div
          className={`flex-1 h-full min-w-0 ${
            mobileView === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          <ChatArea
            conversation={activeConversation}
            messages={activeMessages}
            currentUsername={username}
            onSendMessage={sendMessage}
            onReact={reactToMessage}
            onDeleteMessage={deleteMessage}
            onForwardMessage={(msg) => setForwardingMessage(msg)}
            onOpenRecentGames={() => setShowRecentGamesModal(true)}
            onOpenUserProfile={handleOpenUserProfile}
            onOpenGroupInfo={() => setShowGroupInfoModal(true)}
            onStartVoiceCall={handleStartCall}
            onReport={(targetUser, msgId) => setReportingData({ user: targetUser, messageId: msgId })}
            onBlockUser={blockUser}
            onLoadSavedGame={onLoadSavedGame}
            activeReply={activeReply}
            onSetActiveReply={setActiveReply}
          />
        </div>
      </div>

      {/* 3. MODALS CONTAINER */}
      {/* Recent Completed Games Picker */}
      <RecentGamesModal
        isOpen={showRecentGamesModal}
        onClose={() => setShowRecentGamesModal(false)}
        username={username}
        myGamesList={myGamesList.length > 0 ? myGamesList : savedGamesList}
        fetchMyGames={fetchMyGames}
        onShareGame={(gameData) => {
          sendMessage({
            gameShare: gameData
          });
        }}
      />

      {/* User Profile / Edit Profile Modal */}
      <UserProfileModal
        isOpen={showUserProfileModal}
        onClose={() => setShowUserProfileModal(false)}
        targetUsername={profileTargetUser}
        currentUsername={username}
        profileStats={profileStats}
        customProfile={customProfiles[profileTargetUser.toLowerCase()]}
        isBlocked={blockedUsers.includes(profileTargetUser)}
        onBlockUser={blockUser}
        onUnblockUser={unblockUser}
        onStartDirectChat={(target) => {
          startDirectChat(target);
          setShowUserProfileModal(false);
          setMobileView("chat");
        }}
        onReportUser={(target) => {
          setShowUserProfileModal(false);
          setReportingData({ user: target });
        }}
        onUpdateProfile={updateMyProfile}
        isOnline={onlineUsers.some((u) => u.toLowerCase() === profileTargetUser.toLowerCase())}
      />

      {/* Create Tactical Group Modal */}
      <CreateGroupModal
        isOpen={showCreateGroupModal}
        onClose={() => setShowCreateGroupModal(false)}
        onCreateGroup={createGroup}
        onlineUsers={onlineUsers}
        currentUsername={username}
      />

      {/* Group Info & Members Modal */}
      {activeConversation?.groupData && (<>
        {showGroupInfoModal && activeConversation?.groupData?.createdBy?.toLowerCase() === username.toLowerCase() && <div className="fixed bottom-5 left-5 z-[60] rounded bg-slate-900 p-3 text-sm">
        <button onClick={() => { const target = window.prompt('Transfer ownership to which active member?'); if (target) transferGroup(activeConversation.groupData!.id, target); }} className="p-2 text-amber-300">Transfer ownership</button>
        <button onClick={() => { if (window.confirm('Delete this group and its messages?')) { deleteGroup(activeConversation.groupData!.id); setShowGroupInfoModal(false); } }} className="p-2 text-rose-300">Delete group</button>
      </div>}
      <GroupInfoModal
          isOpen={showGroupInfoModal}
          onClose={() => setShowGroupInfoModal(false)}
          group={activeConversation.groupData}
          currentUsername={username}
          onAddMember={addGroupMember}
          onRemoveMember={removeGroupMember}
          onMakeAdmin={makeGroupAdmin}
          onLeaveGroup={leaveGroup}
          onReportGroup={(grpName) => setReportingData({ user: `Group: ${grpName}` })}
        />
      </>)}

      {/* New Chat / Player Search Modal */}
      <NewChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onStartDirectChat={(target, elo) => {
          startDirectChat(target, elo);
          setMobileView("chat");
        }}
        onlineUsers={onlineUsers}
        currentUsername={username}
      />

      {/* Forward Message Modal */}
      <ForwardModal
        isOpen={Boolean(forwardingMessage)}
        onClose={() => setForwardingMessage(null)}
        message={forwardingMessage}
        conversations={conversations}
        onForwardToChat={(targetId) => {
          if (forwardingMessage) {
            forwardMessage(forwardingMessage, targetId);
          }
        }}
      />

      {/* Report Modal */}
      <ReportModal
        isOpen={Boolean(reportingData)}
        onClose={() => setReportingData(null)}
        targetUser={reportingData?.user || ""}
        messageId={reportingData?.messageId}
        onSubmitReport={(payload) => {
          reportUserOrMessage(payload);
        }}
      />

      {/* Voice Call Modal (fallback if triggered internally) */}
      <VoiceCallModal
        isOpen={!onStartVoiceCall && localVoiceCall.callState !== "ended"}
        targetUsername={localVoiceCall.targetUser}
        callState={localVoiceCall.callState}
        callDuration={localVoiceCall.duration}
        isMicMuted={localVoiceCall.isMicMuted}
        onToggleMic={() =>
          setLocalVoiceCall((prev) => ({ ...prev, isMicMuted: !prev.isMicMuted }))
        }
        onEndCall={() =>
          setLocalVoiceCall((prev) => ({ ...prev, callState: "ended" }))
        }
      />
    </div>
  );
}

export const GlobalChatLounge = React.memo(GlobalChatLoungeImpl);
