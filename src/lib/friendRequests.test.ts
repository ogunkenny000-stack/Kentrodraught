import { describe, expect, it } from 'vitest';
import { friendRequestId, isIncomingFriendRequest, sameFriendPair } from './friendRequests';

describe('friend request identity and consent', () => {
  const incoming = { id: 'legacy_pair_id', user1: 'Ken_Player', user2: 'Ada', sender: 'Ken_Player', status: 'pending' };

  it('recognizes legacy requests by both participants regardless of order or casing', () => {
    expect(sameFriendPair(incoming, 'ada', 'KEN_PLAYER')).toBe(true);
    expect(sameFriendPair(incoming, 'ada', 'stranger')).toBe(false);
    expect(friendRequestId('ada', 'Ken_Player')).toBe(friendRequestId('ken_player', 'ADA'));
    expect(friendRequestId('ada_lovelace', 'ken')).not.toBe(friendRequestId('ada', 'lovelace_ken'));
  });

  it('allows acceptance only for the recipient of a pending request', () => {
    expect(isIncomingFriendRequest(incoming, 'ADA')).toBe(true);
    expect(isIncomingFriendRequest(incoming, 'ken_player')).toBe(false);
    expect(isIncomingFriendRequest(incoming, 'stranger')).toBe(false);
    expect(isIncomingFriendRequest({ ...incoming, status: 'accepted' }, 'ada')).toBe(false);
    expect(isIncomingFriendRequest({ ...incoming, sender: null }, 'ada')).toBe(false);
    expect(isIncomingFriendRequest({ ...incoming, sender: 'intruder' }, 'ada')).toBe(false);
    expect(isIncomingFriendRequest({ ...incoming, user1: 'Ada', sender: 'Ada' }, 'ada')).toBe(false);
  });
});
