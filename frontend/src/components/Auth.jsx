import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Mail, User as UserIcon, ArrowRight, ArrowLeft } from 'lucide-react';
import * as api from '@/lib/services/api';

// mode: 'login' | 'signup' | 'forgot' | 'reset'
const Auth = ({ onLoginSuccess, onBack, resetToken }) => {
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const isLogin = mode === 'login';
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';

  const switchMode = (m) => { setMode(m); setError(''); setInfo(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);

    try {
      // ── Forgot: request a reset link ──────────────────────────────
      if (isForgot) {
        const res = await api.forgotPassword(email);
        setInfo(res?.message || 'If that email is registered, a reset link has been sent.');
        return;
      }
      // ── Reset: set a new password with the token ──────────────────
      if (isReset) {
        await api.resetPassword(resetToken, password);
        setInfo('Password updated — you can now log in.');
        // Clean the ?reset token out of the URL and drop to login.
        try { window.history.replaceState({}, '', window.location.pathname); } catch (_) { /* ignore */ }
        setPassword('');
        setMode('login');
        return;
      }

      // ── Login / Signup ────────────────────────────────────────────
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
      const payload = isLogin
        ? JSON.stringify({ email, password })
        : JSON.stringify({ email, password, name: fullName });

      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Authentication failed');

      localStorage.setItem('careerForgeToken', data.access_token);
      localStorage.setItem('careerForgeUserId', data.user._id);

      // Password save/autofill is driven by the native browser heuristic via the
      // real <form> + name + autoComplete attrs (same approach as ReBuddy FE).
      // We intentionally do NOT call the Credential Management API — on some
      // Chrome builds it stores silently and suppresses the "Save password?"
      // prompt, which reads as "it didn't save".
      onLoginSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const subtitle = isReset ? 'Set a new password'
    : isForgot ? 'Reset your password'
    : 'Your AI interview & resume coach';

  const submitLabel = loading ? 'Processing…'
    : isReset ? 'Set new password'
    : isForgot ? 'Send reset link'
    : isLogin ? 'Log in' : 'Sign up';

  return (
    <div className="flex justify-center items-center min-h-screen bg-background p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[420px] bg-card rounded-[24px] shadow-glow relative overflow-hidden border border-primary/40"
      >
        <div className="relative z-10 p-10 pb-8">
          {onBack && !isReset && (
            <button
              type="button"
              onClick={() => (isForgot ? switchMode('login') : onBack())}
              className="absolute top-4 left-4 flex items-center gap-1.5 bg-transparent border-none text-muted-foreground cursor-pointer text-sm font-medium p-2 rounded-lg transition-colors hover:text-foreground"
            >
              <ArrowLeft size={16} /> {isForgot ? 'Back to login' : 'Back'}
            </button>
          )}

          <div className="text-center mb-8 mt-4">
            <h1 className="text-4xl font-bold mb-2 font-heading tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Caliber
            </h1>
            <p className="text-muted-foreground text-sm font-medium">{subtitle}</p>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-xl mb-6 text-center text-sm border border-destructive/20 font-medium">
              {error}
            </div>
          )}
          {info && (
            <div className="bg-primary/10 text-primary p-3 rounded-xl mb-6 text-center text-sm border border-primary/20 font-medium">
              {info}
            </div>
          )}

          <div className="bg-card rounded-2xl p-6 border border-border/60 shadow-soft">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {isSignup && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Full Name</label>
                  <div className="relative">
                    <UserIcon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text" name="name" autoComplete="name" placeholder="John Doe"
                      value={fullName} onChange={(e) => setFullName(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 bg-secondary/50 border border-border rounded-xl text-foreground text-sm outline-none transition-all focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                </div>
              )}

              {(isLogin || isSignup || isForgot) && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Email</label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="email" name="email" autoComplete="email" placeholder="name@company.com"
                      value={email} onChange={(e) => setEmail(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 bg-secondary/50 border border-border rounded-xl text-foreground text-sm outline-none transition-all focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                </div>
              )}

              {(isLogin || isSignup || isReset) && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {isReset ? 'New Password' : 'Password'}
                    </label>
                    {isLogin && (
                      <button type="button" onClick={() => switchMode('forgot')}
                        className="text-xs text-primary cursor-pointer font-medium hover:underline bg-transparent border-none p-0">
                        Forgot?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="password" name="password"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      placeholder="••••••••"
                      value={password} onChange={(e) => setPassword(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 bg-secondary/50 border border-border rounded-xl text-foreground text-sm outline-none transition-all focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="flex justify-center items-center gap-2 py-3.5 bg-gradient-to-r from-primary to-accent text-primary-foreground border-none rounded-xl font-semibold text-sm mt-2 cursor-pointer shadow-soft transition-all hover:opacity-90 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitLabel}
                {!loading && !isForgot && <ArrowRight size={18} />}
              </button>
            </form>

            {(isLogin || isSignup) && (
              <p className="text-center mt-6 text-muted-foreground text-sm font-medium">
                {isLogin ? "No account? " : 'Already have an account? '}
                <span onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                  className="text-primary cursor-pointer font-semibold hover:underline">
                  {isLogin ? 'Sign up' : 'Log in'}
                </span>
              </p>
            )}
            {isForgot && (
              <p className="text-center mt-6 text-muted-foreground text-sm font-medium">
                Remembered it?{' '}
                <span onClick={() => switchMode('login')} className="text-primary cursor-pointer font-semibold hover:underline">Log in</span>
              </p>
            )}
            {isReset && (
              <p className="text-center mt-6 text-muted-foreground text-sm font-medium">
                <span onClick={() => switchMode('login')} className="text-primary cursor-pointer font-semibold hover:underline">Back to login</span>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
