import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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

    let unsubSnapshot: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      // Cleanup previous user snapshot listener if any
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
      
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
              const isAdminEmail = firebaseUser.email === 'mtasvir375@gmail.com' || firebaseUser.email === 'mdtasvir888@gmail.com' || firebaseUser.email === 'mdsarfarajalam727712@gmail.com';
              const newProfile: any = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || 'User',
                photoURL: firebaseUser.photoURL || '',
                role: isAdminEmail ? 'admin' : 'student',
                balance: isAdminEmail ? 17702.85 : 0,
              };
              
              try {
                await dbClient.createUserProfile(firebaseUser.uid, newProfile);
                profile = { ...newProfile, createdAt: new Date() };
              } catch (createErr) {
                profile = { ...newProfile, createdAt: new Date() };
              }
            }
          }

          if (profile) {
            const isAdminEmail = firebaseUser.email === 'mtasvir375@gmail.com' || firebaseUser.email === 'mdtasvir888@gmail.com' || firebaseUser.email === 'mdsarfarajalam727712@gmail.com';
            if (isAdminEmail) {
              profile.role = 'admin';
              if (!profile.balance || profile.balance === 0) {
                profile.balance = 17702.85;
              }
            }
            // Ensure email is always linked in profile if available from Firebase Auth
            if (!profile.email && firebaseUser.email) {
              profile.email = firebaseUser.email;
              profile.userEmail = firebaseUser.email;
              if (!profile.displayName || profile.displayName === "User") {
                profile.displayName = firebaseUser.displayName || firebaseUser.email.split("@")[0];
              }
            }

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

        // REAL-TIME SYNC ACROSS ALL DEVICES (BROWSER, PWA APP, PHONE, DESKTOP):
        // Automatically syncs balance the exact millisecond an order is placed on another device or funds are added!
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          unsubSnapshot = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) {
              const liveData = snap.data();
              const liveBal = typeof liveData.balance === 'number' ? liveData.balance : Number(liveData.balance || 0);
              setUserProfile((prev: UserProfile | null) => {
                const updated: UserProfile = {
                  uid: snap.id,
                  email: firebaseUser.email || '',
                  displayName: firebaseUser.displayName || 'User',
                  photoURL: firebaseUser.photoURL || '',
                  role: 'student',
                  createdAt: new Date(),
                  ...(prev || {}),
                  ...liveData,
                  balance: liveBal
                };
                try {
                  localStorage.setItem(`user_profile_${firebaseUser.uid}`, JSON.stringify(updated));
                } catch (e) {}
                return updated;
              });
            }
          }, (err) => {
            console.warn("[AUTH-SNAPSHOT] Real-time listener notice:", err.message);
          });
        } catch (snapErr: any) {
          console.warn("[AUTH-SNAPSHOT] Setup error:", snapErr.message);
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return () => {
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
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
