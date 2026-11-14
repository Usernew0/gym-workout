import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, getDocFromServer, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import config from '../../firebase-applet-config.json';

// Suppress internal WebChannel transport-cycling warnings (e.g. transient RPC 'Listen' stream warnings during socket cycling)
// while ensuring actual operational errors are preserved.
if (typeof window !== 'undefined') {
  const isWebChannelTransportLog = (arg: unknown) => {
    if (typeof arg === 'string') {
      return (
        arg.includes('WebChannelConnection') ||
        (arg.includes("RPC 'Listen'") && arg.includes('transport errored'))
      );
    }
    return false;
  };

  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (args.some(isWebChannelTransportLog)) return;
    originalWarn.apply(console, args);
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (args.some(isWebChannelTransportLog)) return;
    originalError.apply(console, args);
  };
}

setLogLevel('error');

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId
};

const app = initializeApp(firebaseConfig);

// Initialize Firebase Storage
export const firebaseStorage = getStorage(app);

// Initialize Firestore with long-polling and a 15-second timeout window.
// This prevents intermediate proxies/sandboxes from abruptly severing the hanging GET connection,
// completely eliminating WebChannel "RPC 'Listen' stream transport errored" warnings.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalLongPollingOptions: {
    timeoutSeconds: 15
  }
}, (config as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)');

// Expose connection status globally so the app UI can display helpful troubleshooting if needed
export let isFirestoreOnline = true;

async function testConnection() {
  try {
    // Attempt a quick metadata fetch from an allowed document to verify server reachability
    await getDocFromServer(doc(db, 'adminSettings', 'connectivity_ping'));
    isFirestoreOnline = true;
    console.log("Firestore backend reached successfully.");
  } catch (error) {
    if (error instanceof Error && (error.message.includes('offline') || error.message.includes('reach') || error.message.includes('respond'))) {
      isFirestoreOnline = false;
      console.warn("Please check your Firebase configuration or network access. Firestore is operating in offline mode.");
    }
  }
}

testConnection();
