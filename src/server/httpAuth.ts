/** Accept standard bearer tokens and the existing client header contract. */
export function requestAccessToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const authorization = headers.authorization;
  if (typeof authorization === "string" && /^Bearer\s+\S+$/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "");
  return typeof headers["x-access-token"] === "string" ? headers["x-access-token"] : undefined;
}

export function canReadGameRecord(record: { private?: boolean; participantUserIds?: string[] }, verifiedUid: string | null): boolean {
  return record.private !== true || !!(verifiedUid && record.participantUserIds?.includes(verifiedUid));
}
