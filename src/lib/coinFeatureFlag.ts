// User-facing wagers are disabled by default. Turn on at build time only
// after the matching server has KENTRO_COINS_ENABLED=1 AND its startup
// preflight has verified the hosted SQL. The server always makes the
// authoritative decision; a client build flag alone cannot enable payments.
export const KENTRO_COINS_ENABLED = import.meta.env.VITE_KENTRO_COINS_ENABLED === "1";

