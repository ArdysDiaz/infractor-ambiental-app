    // Importa las funciones necesarias desde los SDK de Firebase
    import { initializeApp } from "firebase/app";
    import { getAuth } from "firebase/auth";
    import { getFirestore } from "firebase/firestore";
    import { getStorage } from "firebase/storage";

    // Tu objeto de configuración de Firebase
    const firebaseConfig = {
      apiKey: "AIzaSyA_72zsdtk6lDezrgT7vrvuCz-DhTrI4Ik",
      authDomain: "incident-reporter-app-f834d.firebaseapp.com",
      projectId: "incident-reporter-app-f834d",
      storageBucket: "incident-reporter-app-f834d.firebasestorage.app",
      messagingSenderId: "1075519620193",
      appId: "1:1075519620193:web:8bcd1e975537d680e81620",
      measurementId: "G-KX7TPGEM8E"
    };

    // Inicializa Firebase
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app); // Habilitamos Storage para producción

    const appId = firebaseConfig.projectId;

    export { db, auth, storage, appId };
    
