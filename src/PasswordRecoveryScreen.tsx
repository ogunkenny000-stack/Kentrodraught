import React, { useState } from 'react';
import { supabase, finishPasswordRecovery } from './supabase';

/** The recovery link restores a short-lived authenticated session. Keep the
 * password form visible until updateUser actually succeeds. */
export function PasswordRecoveryScreen() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error('This reset link has expired. Request a new password reset link.');
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword(''); setConfirmation(''); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update your password. Try again.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-5">
    <section className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6">
      <h1 className="text-xl font-bold">{saved ? 'Password updated' : 'Set a new password'}</h1>
      {saved ? <><p className="mt-3 text-sm text-slate-300">Your new password is ready to use.</p><button type="button" className="mt-5 w-full min-h-11 rounded-xl bg-amber-400 text-slate-950 font-bold" onClick={finishPasswordRecovery}>Continue to Kentro</button></> : <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <label htmlFor="recovery-password">New password</label>
        <input id="recovery-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="min-h-11 rounded-lg bg-slate-950 border border-slate-600 px-3" />
        <label htmlFor="recovery-confirmation">Confirm new password</label>
        <input id="recovery-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="min-h-11 rounded-lg bg-slate-950 border border-slate-600 px-3" />
        {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
        <button disabled={busy} className="min-h-11 rounded-xl bg-amber-400 text-slate-950 font-bold disabled:opacity-50">{busy ? 'Updating…' : 'Update password'}</button>
        <button type="button" disabled={busy} className="min-h-11 text-slate-300 underline" onClick={finishPasswordRecovery}>Back to Kentro</button>
      </form>}
    </section>
  </main>;
}
