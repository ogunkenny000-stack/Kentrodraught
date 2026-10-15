const normalized = (value: string) => value.trim().toLowerCase();

export interface FriendRequest {
  id: string;
  user1: string;
  user2: string;
  status: string;
  sender?: string | null;
}

/** New IDs do not collide when a username contains underscores. Existing
 * requests are found by their participants, so historical IDs remain valid. */
export function friendRequestId(first: string, second: string): string {
  return `friend:${JSON.stringify([normalized(first), normalized(second)].sort())}`;
}

export function sameFriendPair(request: FriendRequest, first: string, second: string): boolean {
  const members = [normalized(request.user1), normalized(request.user2)].sort();
  return members[0] === [normalized(first), normalized(second)].sort()[0]
    && members[1] === [normalized(first), normalized(second)].sort()[1];
}

export function isIncomingFriendRequest(request: FriendRequest, username: string): boolean {
  const mine = normalized(username);
  const members = [normalized(request.user1), normalized(request.user2)];
  const sender = typeof request.sender === 'string' ? normalized(request.sender) : '';
  return request.status === 'pending' && members[0] !== members[1]
    && members.includes(mine) && !!sender && sender !== mine && members.includes(sender);
}
