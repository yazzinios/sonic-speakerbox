import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Radio, Headphones, Mail, Lock, User } from 'lucide-react';

const AuthPage = () => {
  const { user, loading } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-primary animate-pulse text-lg tracking-widest">LOADING...</div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (isForgot) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success('Password reset email sent! Check your inbox.');
        setIsForgot(false);
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success('Check your email to confirm your account!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Radio className="h-8 w-8 text-primary" />
            <Headphones className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-primary tracking-[0.3em]">DJ CONSOLE</h1>
          <p className="text-xs text-muted-foreground">
            {isForgot ? 'Reset your password' : isSignUp ? 'Create your DJ account' : 'Sign in to your console'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-card p-5">
          {isSignUp && (
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1"><User className="h-3 w-3" /> DJ Name</Label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="DJ Awesome" required />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" /> Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="dj@example.com" required />
          </div>

          {!isForgot && (
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1"><Lock className="h-3 w-3" /> Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Please wait...' : isForgot ? 'Send Reset Email' : isSignUp ? 'Create Account' : 'Sign In'}
          </Button>

          <div className="flex justify-between text-xs">
            {!isForgot && (
              <button type="button" className="text-muted-foreground hover:text-primary transition-colors" onClick={() => setIsForgot(true)}>
                Forgot password?
              </button>
            )}
            <button type="button" className="text-muted-foreground hover:text-primary transition-colors ml-auto"
              onClick={() => { setIsSignUp(!isSignUp); setIsForgot(false); }}>
              {isSignUp ? 'Already have an account?' : 'Create account'}
            </button>
          </div>
        </form>

        {/* Listener access */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Listener? <a href="/listen" className="text-primary hover:underline">Join a channel →</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
