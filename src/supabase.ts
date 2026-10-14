import { createClient, type User } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://placeholder.supabase.co';
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || 'placeholder_key';

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

if (!isSupabaseConfigured) {
  console.warn(
    'Missing Supabase config -- set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in environment or .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Row Level Security policies (see supabase/schema.sql) require auth.uid()
// to match for every gated read/write, the same way firestore.rules used to
// require request.auth != null. Real email/password accounts (below) are
// the same real, permanent identity model the app already had -- signing up
// creates one Supabase Auth user per person, and every RLS policy keyed on
// "ownerId" (see profiles in App.tsx) works the same way it always did, just
// against a Supabase auth uid instead of a Firebase one.
//
// authReady keeps the same name/shape it always had so existing `await
// authReady` call sites across the app don't need to change: it resolves
// once Supabase has restored any persisted session (signed in or not).
export const authReady: Promise<void> = supabase.auth.getSession().then(() => undefined).catch(() => undefined);

// Mirrors Firebase Auth's synchronous `auth.currentUser` -- supabase-js only
// exposes the current user asynchronously, so this keeps a live-updated
// cache in sync via onAuthStateChange, seeded immediately from any
// persisted session. Only used internally by handleSupabaseError below,
// which (like the code it replaces) needs to read "whoever's signed in
// right now" without becoming an async function itself.
let _currentUser: User | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  _currentUser = session?.user ?? null;
});
supabase.auth.getSession().then(({ data }) => {
  _currentUser = data?.session?.user ?? null;
}).catch(() => {
  _currentUser = null;
});

export async function signUpWithEmail(email: string, password: string, username: string): Promise<User> {
  const cleanUsername = username.toLowerCase().trim();

  // Check username availability BEFORE creating the account. Without this,
  // two people choosing the same username would collide at the profiles
  // insert below (RLS rejects writing a profile that isn't yours) -- but by
  // then the Supabase Auth ACCOUNT already exists, just with no matching
  // profile, leaving them unable to ever sign in by username. Catching it
  // here means signup fails cleanly, before anything is created.
  const existingEmail = await resolveUsernameToEmail(cleanUsername);
  if (existingEmail) {
    throw new Error('That username is already taken. Try another one.');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      // Without this, Supabase falls back to whatever "Site URL" is set
      // in the Dashboard (Authentication -> URL Configuration) -- which
      // defaults to http://localhost:3000 and is an easy thing to forget
      // to update after deploying, producing exactly this failure: the
      // confirmation link takes people to a dead localhost address
      // instead of back to the real app. window.location.origin always
      // points at wherever this code is actually running.
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error('Sign up did not return a user.');

  // Mirrors the existing profiles write pattern already used elsewhere in
  // this app (see App.tsx) -- ownerId ties this row to the real, permanent
  // uid from the account just created, so every existing read/write keyed
  // on username + ownerId keeps working unchanged.
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      usernameLower: cleanUsername,
      username,
      ownerId: user.id,
      createdAt: Date.now(),
    },
    { onConflict: 'usernameLower' }
  );
  if (profileError) {
    console.error('Failed to create profile after signup:', profileError);
  }

  return user;
}

/** Resolves a username to its account email via the resolve_username_to_email
 * RPC (see supabase/schema.sql) -- returns null if no account uses this
 * username. */
export async function resolveUsernameToEmail(username: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_username_to_email', { p_username: username });
  if (error) {
    console.error('resolveUsernameToEmail failed:', error);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Sign in with username instead of email -- resolves to the account's
 * real email first, then authenticates normally. Throws a clear
 * "account not found" error (distinct from "wrong password") if the
 * username doesn't match any account. */
export async function signInWithUsername(username: string, password: string): Promise<User> {
  const email = await resolveUsernameToEmail(username);
  if (!email) {
    const err = new Error('No account found with that username.');
    (err as any).code = 'user_not_found';
    throw err;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Password reset by username, not email -- consistent with the rest of
 * this app's UX (email is only ever collected once, at signup). Resolves
 * the username to its account email via the same resolve_username_to_email
 * RPC used for sign-in, then asks Supabase to send the reset link. Throws
 * "user_not_found" if the username doesn't match any account, same
 * distinguishable error shape signInWithUsername already uses. */
export async function requestPasswordReset(username: string): Promise<void> {
  const email = await resolveUsernameToEmail(username);
  if (!email) {
    const err = new Error('No account found with that username.');
    (err as any).code = 'user_not_found';
    throw err;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

/** Re-sends the verification email to whoever is currently signed in.
 * No-op if already verified or if no one's signed in -- callers should
 * gate the UI on email_confirmed_at themselves; this just avoids a
 * confusing error if it's ever called at the wrong moment. Uses a fresh
 * getUser() call rather than the module-level _currentUser cache below,
 * since this is worth getting right regardless of that cache's timing. */
export async function resendVerificationEmail(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email_confirmed_at || !user.email) return;
  const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
  if (error) throw error;
}

export async function signOutUser(): Promise<void> {
  // Revoke this device's background subscription while the access token is
  // still valid, so a shared phone doesn't receive the previous user's game alerts.
  try {
    const { disableBackgroundPush } = await import('./lib/pushSubscription');
    await disableBackgroundPush();
  } catch (error) { console.warn('Could not revoke push subscription on sign out:', error); }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  return () => subscription.unsubscribe();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface SupabaseErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleSupabaseError(error: unknown, operationType: OperationType, path: string | null) {
  let errorMessage = '';
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'object' && error !== null) {
    const pErr = error as Record<string, any>;
    errorMessage = pErr.message || pErr.error_description || pErr.details || pErr.hint || JSON.stringify(error);
  } else {
    errorMessage = String(error);
  }

  // Gracefully log network/fetch failures without breaking app execution or throwing severe errors
  if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('TypeError')) {
    console.warn(`Supabase network connection unavailable for ${operationType} on ${path}:`, errorMessage);
    return;
  }

  const errInfo: SupabaseErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: _currentUser?.id || null,
      email: _currentUser?.email || null,
      emailVerified: !!_currentUser?.email_confirmed_at,
      isAnonymous: _currentUser?.is_anonymous ?? null,
      providerInfo:
        _currentUser?.identities?.map((identity) => ({
          providerId: identity.provider,
          email: (identity.identity_data as { email?: string } | undefined)?.email ?? null,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Supabase Error: ', JSON.stringify(errInfo));
}
