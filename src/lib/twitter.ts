import "server-only";
import { createHmac, randomBytes } from "node:crypto";

const API_KEY = process.env.TWITTER_API_KEY;
const API_SECRET = process.env.TWITTER_API_SECRET;
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const BOT_ENABLED = process.env.TWITTER_BOT_ENABLED === "true";

const TWEET_URL = "https://api.x.com/2/tweets";

// RFC 3986 percent-encoding — encodeURIComponent leaves !*'() unescaped, OAuth 1.0a requires
// those escaped too, or the signature won't match what X computes on its end.
function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// OAuth 1.0a request signing (HMAC-SHA1) — static long-lived credentials, no token refresh needed,
// the right fit for an unattended background bot (unlike OAuth 2.0 user-context tokens, which
// expire in ~2h and need a refresh flow with nobody around to re-authorize). Only the oauth_*
// protocol params go into the signature base string, not the JSON body — that's correct per spec
// for a non-form-urlencoded request (form bodies get included, JSON bodies don't).
function buildAuthHeader(method: string, url: string): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: ACCESS_TOKEN!,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${oauthEncode(k)}=${oauthEncode(oauthParams[k])}`)
    .join("&");

  const baseString = `${method}&${oauthEncode(url)}&${oauthEncode(paramString)}`;
  const signingKey = `${oauthEncode(API_SECRET!)}&${oauthEncode(ACCESS_TOKEN_SECRET!)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${oauthEncode(k)}="${oauthEncode(headerParams[k])}"`)
      .join(", ")
  );
}

/**
 * Posts to X — but only for real if `TWITTER_BOT_ENABLED=true` AND all four credentials are set.
 * Otherwise this is a no-op that just logs what would have been posted ("DRY-RUN"). Deliberately
 * gated *inside* this function, not by the caller, so the bot stays silent-by-default even if the
 * call site is wired into a background loop ahead of the user actually being ready to launch —
 * X has no free API tier as of 2026 (pay-per-post), so an accidental live post has a real cost.
 */
export async function postTweet(text: string): Promise<{ posted: boolean; id?: string }> {
  const credentialsPresent = Boolean(API_KEY && API_SECRET && ACCESS_TOKEN && ACCESS_TOKEN_SECRET);
  if (!BOT_ENABLED || !credentialsPresent) {
    console.log(
      `[twitter] DRY-RUN (bot ${BOT_ENABLED ? "enabled but missing credentials" : "disabled"}):\n${text}`
    );
    return { posted: false };
  }

  const authHeader = buildAuthHeader("POST", TWEET_URL);
  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.error(`[twitter] Post fehlgeschlagen (${res.status}):`, await res.text());
    return { posted: false };
  }

  const body = (await res.json()) as { data?: { id?: string } };
  return { posted: true, id: body.data?.id };
}
