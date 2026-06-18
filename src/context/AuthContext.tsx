import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { dbClient } from "@/lib/dbClient";

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  isAdmin: boolean;
  isPaymentAdmin: boolean;
  isInstructor: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isPaymentAdmin: false,
  isInstructor: false,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) {
      const p = await dbClient.getUserProfile(user.id);
      if (p) setProfile(p);
    }
  };

  useEffect(() => {
    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleUserChange(session);
    });

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUserChange(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleUserChange = async (session: Session | null) => {
    const sbUser = session?.user || null;
    setUser(sbUser);
    
    if (!sbUser) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      // Fetch or create profile
      let userProfile = await dbClient.getUserProfile(sbUser.id);
      
      if (!userProfile) {
        // Create new profile if it doesn't exist
        const role = sbUser.email === "mtasvir375@gmail.com" ? "admin" : "student";
        userProfile = {
          id: sbUser.id,
          email: sbUser.email,
          display_name: sbUser.user_metadata?.full_name || sbUser.email?.split('@')[0],
          role: role,
          balance: 0,
        };
        await dbClient.createUserProfile(sbUser.id, userProfile);
      } else if (sbUser.email === "mtasvir375@gmail.com" && userProfile.role !== "admin") {
        // Ensure main admin email always has admin role in database
        await dbClient.updateUserProfile(sbUser.id, { role: "admin" });
        userProfile.role = "admin";
      }

      setProfile(userProfile);

      // Subscribe to profile updates
      dbClient.observeUserProfile(sbUser.id, (data) => {
        if (data) setProfile(data);
      });

    } catch (err) {
      console.error("Supabase Auth profile init error:", err);
    } finally {
      setLoading(false);
    }
  };

  const value = React.useMemo(() => ({
    user,
    profile,
    loading,
    isAdmin: profile?.role === "admin" || user?.email === "mtasvir375@gmail.com",
    isPaymentAdmin: profile?.role === "payment_admin",
    isInstructor: profile?.role === "instructor" || profile?.role === "admin" || user?.email === "mtasvir375@gmail.com",
    signOut,
    refreshProfile
  }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
