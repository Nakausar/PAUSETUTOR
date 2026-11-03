import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, UserRole } from './types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, role: UserRole, consent: boolean) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function formatAuthError(message: string, action: 'signin' | 'signup'): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('already registered') || normalized.includes('already exists') || normalized.includes('user already')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    return 'The email or password is incorrect. Please check them and try again.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'This account still needs email confirmation. Please contact the study team while confirmation is being disabled.';
  }
  if (normalized.includes('password') && normalized.includes('at least')) {
    return 'Your password must be at least 6 characters long.';
  }
  if (normalized.includes('weak') || normalized.includes('easy to guess')) {
    return 'That password is too common or easy to guess. Please choose a stronger, more unique password.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many attempts were made. Please wait a moment and try again.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'The service could not be reached. Check your connection and try again.';
  }
  return action === 'signup'
    ? 'We could not create your account. Please check your details and try again.'
    : 'We could not sign you in. Please check your details and try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      setProfile(null);
      return 'Your account was created, but your participant profile could not be loaded. Please try signing in again.';
    }
    if (!data) {
      setProfile(null);
      return 'Your account was created, but your participant profile is not ready yet. Please try signing in again.';
    }
    setProfile(data as Profile);
    return null;
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        if (newSession?.user) {
          await loadProfile(newSession.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  async function signUp(email: string, password: string, role: UserRole, consent: boolean) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      // Role is NOT sent: every new account is a student. Researchers are promoted
      // by the study team in the database.
      options: { data: { consent_acknowledged: consent } },
    });
    if (error) {
      console.error('Signup failed:', { message: error.message, name: error.name, status: error.status });
      return { error: formatAuthError(error.message, 'signup') };
    }
    if (!data.user) return { error: 'We could not create your account. Please try again.' };

    if (!data.session) {
      const signInResult = await signIn(email, password);
      if (signInResult.error) {
        return { error: 'Your account was created, but it is not active yet. Please try again or contact the study team.' };
      }
      return signInResult;
    }

    setSession(data.session);
    const profileError = await loadProfile(data.user.id);
    return { error: profileError };
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      console.error('Sign in failed:', { message: error.message, name: error.name, status: error.status });
      return { error: formatAuthError(error.message, 'signin') };
    }
    if (!data.session || !data.user) return { error: 'We could not start your session. Please try again.' };

    setSession(data.session);
    const profileError = await loadProfile(data.user.id);
    return { error: profileError };
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    if (error) console.error('Sign out error:', error.message);
  }

  async function refreshProfile() {
    if (session?.user) {
      await loadProfile(session.user.id);
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
