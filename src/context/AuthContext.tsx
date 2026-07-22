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
        if (profile) setUserProfile(profile);
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
        try {
          // Fetch user profile from Firestore
          let profile = await dbClient.getUserProfile(firebaseUser.uid);
          
          if (!profile) {
            console.log("[AUTH] Profile not found, attempting to create...");
            // Create profile if it doesn't exist
            const newProfile: any = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || 'User',
              photoURL: firebaseUser.photoURL || '',
              role: 'student', // Default role
              balance: 1, // Welcome bonus ₹1
            };
            
            try {
              await dbClient.createUserProfile(firebaseUser.uid, newProfile);
              profile = { ...newProfile, createdAt: new Date() };
              console.log("[AUTH] Profile created successfully.");
            } catch (createErr) {
              console.error("[AUTH] Error creating profile, using local fallback:", createErr);
              // Set local profile so user can use the app, backend will auto-create if needed
              profile = { ...newProfile, createdAt: new Date() };
            }
          }
          
          setUserProfile(profile);
        } catch (error) {
          console.error("Error fetching/creating user profile:", error);
          // Fallback to minimal profile if everything fails to avoid blocking the app
          setUserProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'User',
            photoURL: firebaseUser.photoURL || '',
            role: 'student',
            balance: 1,
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
      return {
        ...prev,
        ...updatedFields,
      };
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
