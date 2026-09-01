import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { dbClient, UserProfile } from '@/lib/dbClient';
import axios from 'axios';

interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isPaymentAdmin: boolean;
  signOut: () => Promise<void>;
  updateUserProfileLocal?: (updatedFields: Partial<UserProfile>) => void;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  loading: true,
  isAdmin: false,
  isPaymentAdmin: false,
  signOut: async () => {},
  updateUserProfileLocal: () => {},
  refreshUserProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUserProfile = async () => {
    if (user) {
      try {
        const profile = await dbClient.getUserProfile(user.uid);
        if (profile) {
          setUserProfile(profile);
          try {
            localStorage.setItem(`user_profile_${user.uid}`, JSON.stringify(profile));
          } catch (e) {}
        }
      } catch (error) {
        console.error("Error refreshing user profile:", error);
      }
    }
  };

  useEffect(() => {
    // Add request interceptor to automatically inject the user's ID token in the Authorization header
    const interceptor = axios.interceptors.request.use(async (config) => {
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          config.headers['Authorization'] = `Bearer ${token}`;
        } catch (e) {
          console.warn("[AXIOS-INTERCEPTOR] Failed to retrieve or refresh ID token:", e);
        }
      }
      return config;
    }, (error) => {
      return Promise.reject(error);
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // First check if we have a locally cached profile to instantly show balance without waiting
        let localCached: any = null;
        try {
          const saved = localStorage.getItem(`user_profile_${firebaseUser.uid}`);
          if (saved) {
            localCached = JSON.parse(saved);
            setUserProfile(localCached);
          }
        } catch (e) {}

        try {
          // Fetch authoritative user profile from backend/database
          let profile = await dbClient.getUserProfile(firebaseUser.uid);
          
          if (!profile) {
            // If we have a local cached profile, DO NOT overwrite with 0 balance!
            if (localCached && Number(localCached.balance || 0) > 0) {
              console.log("[AUTH] Using persistent local cached profile to safeguard wallet balance:", localCached.balance);
              profile = localCached;
            } else {
              console.log("[AUTH] Profile not found in database, creating new user profile...");
              const newProfile: any = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || 'User',
                photoURL: firebaseUser.photoURL || '',
                role: 'student', // Default role
                balance: 0,
              };
              
              try {
                await dbClient.createUserProfile(firebaseUser.uid, newProfile);
                profile = { ...newProfile, createdAt: new Date() };
                console.log("[AUTH] New profile registered successfully.");
              } catch (createErr) {
                console.error("[AUTH] Error registering new profile:", createErr);
                profile = { ...newProfile, createdAt: new Date() };
              }
            }
          }
          
          if (profile) {
            setUserProfile(profile);
            try {
              localStorage.setItem(`user_profile_${firebaseUser.uid}`, JSON.stringify(profile));
            } catch (e) {}
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
          // Keep existing profile or cached profile if available, do not clobber with blank 0 balance
          setUserProfile(prev => prev || localCached || {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'User',
            photoURL: firebaseUser.photoURL || '',
            role: 'student',
            balance: 0,
            createdAt: new Date(),
            isFallback: true
          });
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return () => {
      unsubscribe();
      axios.interceptors.request.eject(interceptor);
    };
  }, []);

  const signOut = async () => {
    try {
      console.log("[AUTH_CONTEXT] Clearing local state and signing out...");
      if (user) {
        try { localStorage.removeItem(`user_profile_${user.uid}`); } catch (e) {}
      }
      setUserProfile(null);
      setUser(null);
      await firebaseSignOut(auth);
      console.log("[AUTH_CONTEXT] Sign out successful.");
    } catch (error) {
      console.error("Error signing out:", error);
      throw error;
    }
  };

  const updateUserProfileLocal = (updatedFields: Partial<UserProfile>) => {
    setUserProfile((prev) => {
      if (!prev) return null;
      const updated = {
        ...prev,
        ...updatedFields,
      };
      if (user) {
        try {
          localStorage.setItem(`user_profile_${user.uid}`, JSON.stringify(updated));
        } catch (e) {}
      }
      return updated;
    });
  };

  const value = {
    user,
    userProfile,
    loading,
    isAdmin: userProfile?.role === 'admin' || user?.email === 'mtasvir375@gmail.com',
    isPaymentAdmin: userProfile?.role === 'payment_admin' || user?.email === 'mtasvir375@gmail.com' || user?.email === 'mdsaudalam621@gmail.com',
    signOut,
    updateUserProfileLocal,
    refreshUserProfile
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
