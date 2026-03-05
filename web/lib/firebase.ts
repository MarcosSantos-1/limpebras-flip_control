import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAc8QzsB9XmWu52dNUM4_RTGWnhl6oXDbA",
  authDomain: "limpebras-flip-control.firebaseapp.com",
  projectId: "limpebras-flip-control",
  storageBucket: "limpebras-flip-control.firebasestorage.app",
  messagingSenderId: "392603263683",
  appId: "1:392603263683:web:c4daacfff84f4b790cf876",
};

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : (getApps()[0] as FirebaseApp);
export const storage = getStorage(app);
