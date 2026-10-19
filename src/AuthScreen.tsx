import React, { useState } from "react";
import { Crown, Mail, Lock, User, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { signUpWithEmail, signInWithUsername, requestPasswordReset } from "./supabase";
import { getRoomCodeFromUrl } from "./lib/roomInvite";

interface AuthScreenProps {
  onAuthenticated: () => void;
  onPlayKenOffline?: () => void;
  onPlayOffline?: () => void;
  onContinueAsGuest?: () => void;
}

type Mode = "signin" | "signup" | "reset";

export function AuthScreen({ onAuthenticated, onPlayKenOffline, onPlayOffline, onContinueAsGuest }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const validate = (): string | null => {
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) return "Username must be at least 3 characters.";
    if (mode === "signup" && /^KGuest_/i.test(cleanUsername)) return "That username prefix is reserved for Guest Mode.";
    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) return "Username can only contain letters, numbers, and underscores.";
    if (mode === "reset") return null; // no password/email needed to request a reset
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (mode === "signup") {
      if (!email.trim()) return "Enter your email address.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "That email address doesn't look right.";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      if (mode === "reset") {
        await requestPasswordReset(username.trim());
        setResetSuccess(true);
      } else if (mode === "signup") {
        await signUpWithEmail(email.trim(), password, username.trim());
        // signUpWithEmail (supabase.ts) triggers Supabase's own signup
        // confirmation email -- the account exists and (depending on your
        // Supabase project's "Confirm email" setting) may already be usable
        // immediately either way, this is just a verification nudge, so we
        // show a clear next-step screen rather than silently dropping the
        // person into the app without mentioning it.
        setSignupSuccess(true);
      } else {
        await signInWithUsername(username.trim(), password);
        onAuthenticated();
      }
    } catch (err: any) {
      // Supabase Auth errors carry a stable .code (e.g. "invalid_credentials")
      // -- more reliable to switch on than parsing the raw .message text.
      const code = err?.code as string | undefined;
      if (code === "user_not_found") {
        setError("No account found with that username.");
      } else if (code === "invalid_credentials") {
        // We already resolved the username to a real account before calling
        // Supabase, so by this point "invalid credentials" can only mean
        // the password was wrong -- Supabase deliberately doesn't
        // distinguish "no such account" from "wrong password" itself (a
        // modern anti-enumeration default), but our own resolve-first step
        // already ruled the first case out.
        setError("Username or password is incorrect.");
      } else if (code === "email_not_confirmed") {
        setError("Please confirm your email first -- check your inbox for the confirmation link.");
      } else if (code === "user_already_exists" || code === "email_exists") {
        setError("An account with this email already exists. Try signing in instead.");
      } else if (code === "weak_password") {
        setError("Password must be at least 8 characters.");
      } else if (code === "email_address_invalid") {
        setError("That email address doesn't look right.");
      } else if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
        setError("Too many attempts -- wait a moment and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (resetSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Mail className="w-8 h-8 text-slate-950 stroke-[2.5]" />
          </div>
          <h1 className="text-xl font-bold text-white font-sans mb-2">Check your email</h1>
          <p className="text-sm text-slate-400 font-sans leading-relaxed mb-6">
            If an account exists for <span className="text-amber-400">{username.trim()}</span>, a password reset link will be sent to its email address.
            Check your inbox and follow the link to set a new password.
          </p>
          <button
            onClick={() => { setResetSuccess(false); setMode("signin"); setPassword(""); }}
            className="text-sm text-amber-400 hover:text-amber-300 font-bold font-sans transition"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Mail className="w-8 h-8 text-slate-950 stroke-[2.5]" />
          </div>
          <h1 className="text-xl font-bold text-white font-sans mb-2">Check your email</h1>
          <p className="text-sm text-slate-400 font-sans leading-relaxed mb-6">
            We sent a confirmation link to <span className="text-amber-400">{email}</span>.
            Click it to activate your account, then come back and sign in.
          </p>
          <button
            onClick={() => { setSignupSuccess(false); setMode("signin"); setPassword(""); }}
            className="text-sm text-amber-400 hover:text-amber-300 font-bold font-sans transition"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="k-auth-screen min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient board-square texture in the background, subtle, matching the game's checkered identity without competing with the form */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-conic-gradient(#d4a017 0% 25%, transparent 0% 50%)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="k-auth-layout relative">
        <aside className="k-auth-story" aria-label="Kentro Draughts">
          <span className="k-overline">WELCOME TO KENTRO</span>
          <h2>Every move<br/>means something.</h2>
          <p>Play Nigeria's game with a global community. Compete online, train with Ken, and watch the best players.</p>
          <div className="k-auth-benefits"><span>◆ Nigerian rules</span><span>◆ Live multiplayer</span><span>◆ AI training</span></div>
          <div className="k-auth-mini-board" aria-hidden="true">{Array.from({length:100},(_,i)=><span className={(Math.floor(i/10)+i%10)%2 ? "dark":"light"} key={i}/>)}</div>
        </aside>
        <div className="k-auth-form-card">
        {/* Brand header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-3">
            <Crown className="w-7 h-7 text-slate-950 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-extrabold text-white font-sans tracking-tight uppercase">Kentro Draught</h1>
          <p className="text-[11px] text-amber-300 font-sans tracking-[0.2em] uppercase mt-1">Play. Learn. Analyze. Win.</p>
        </div>

        {typeof window !== "undefined" && getRoomCodeFromUrl(window.location.search) && (
          <div className="mb-5 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center text-xs text-emerald-200 leading-relaxed">
            You've been invited to a draughts match. Continue as Guest or sign in, then tap <strong>Start Game</strong> to join.
          </div>
        )}

        {onContinueAsGuest && mode !== "reset" && (
          <div className="k-guest-entry">
            <button type="button" onClick={onContinueAsGuest} className="k-guest-cta">
              Explore as guest
            </button>
            <p className="k-guest-subtitle">Explore the app · 3 free AI games · 1 free online match</p>
          </div>
        )}
        <div className="k-auth-divider" aria-hidden="true"><span>or use your account</span></div>
        {/* Mode toggle */}
        {mode !== "reset" && (
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 mb-6">
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold font-sans transition ${
                mode === "signin" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold font-sans transition ${
                mode === "signup" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {mode === "reset" && (
          <button
            type="button"
            onClick={() => { setMode("signin"); setError(null); }}
            className="text-xs text-slate-400 hover:text-slate-300 font-sans mb-4 transition"
          >
            ← Back to sign in
          </button>
        )}

        {mode === "reset" && (
          <p className="text-xs text-slate-400 font-sans mb-4 -mt-2">
            Enter your username and we'll email a link to reset your password.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="auth-username" className="text-[11px] text-slate-400 font-bold uppercase tracking-wide font-sans mb-1.5 block">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === "signup" ? "How opponents will see you" : "Your username"}
                autoComplete="username"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-400 font-sans focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 transition"
              />
            </div>
          </div>

          {mode === "signup" && (
            <div>
              <label htmlFor="auth-email" className="text-[11px] text-slate-400 font-bold uppercase tracking-wide font-sans mb-1.5 block">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-400 font-sans focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 transition"
                />
              </div>
            </div>
          )}

          {mode !== "reset" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="auth-password" className="text-[11px] text-slate-400 font-bold uppercase tracking-wide font-sans">
                Password
              </label>
              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => { setMode("reset"); setError(null); setPassword(""); }}
                  className="text-[11px] text-amber-300 hover:text-amber-400 font-sans transition"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-400 font-sans focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center text-slate-400 hover:text-slate-200 transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          )}

          {error && (
            <div role="alert" className="text-[13px] text-rose-400 font-sans bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full bg-gradient-to-tr from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-extrabold font-sans py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-amber-500/10"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === "reset" ? (
              "Send Reset Link"
            ) : mode === "signup" ? (
              "Create Account"
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {onPlayKenOffline && <button type="button" onClick={onPlayKenOffline} className="w-full mt-4 py-3 rounded-xl border border-amber-500/40 text-amber-300 bg-amber-500/10 text-sm font-bold">Play Ken Offline · Full Strength</button>}
        {onPlayOffline && <button type="button" onClick={onPlayOffline} className="w-full mt-4 py-3 rounded-xl border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 text-sm font-bold hover:bg-emerald-500/20">Play Nearby Offline — No Sign In</button>}

        <div className="flex items-center justify-center gap-1.5 mt-6 text-[11px] text-slate-400 font-sans">
          <ShieldCheck className="w-3.5 h-3.5" />
          Your rating, coins, and match history are tied to this account.
        </div>
        </div>
      </div>
    </div>
  );
}
