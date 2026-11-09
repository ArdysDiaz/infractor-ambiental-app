// C:\proyectos\infractorambiental\setAdmin.js

// Importamos el SDK de Firebase Admin
import admin from "firebase-admin";
import fs from "fs";

// --- PASO 1: MODIFICA AQUÍ ---
// Reemplaza la ruta con la ubicación REAL de tu archivo de clave de servicio.
// ¡IMPORTANTE! No subas este archivo de clave a GitHub.
const serviceAccount = JSON.parse(
  fs.readFileSync(
    new URL("./incident-reporter-app-f834d-firebase-adminsdk-fbsvc-42c5e33eac.json", import.meta.url),
    "utf8"
  )
);

// --- PASO 2: MODIFICA AQUÍ ---
// Emails de los usuarios que quieres hacer administradores.
const adminEmails = [
  "semader@quibdo-choco.gov.co",
  "frankcorpa54@gmail.com",
  "viasneyiris20@gmail.com"
];

// --- NO MODIFICAR DE AQUÍ EN ADELANTE ---

// Inicializamos la app de admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function assignAdmins() {
  for (const email of adminEmails) {
    try {
      console.log(`Intentando asignar rol de admin a: ${email}`);
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().setCustomUserClaims(user.uid, { admin: true });
      console.log(`¡Éxito! Se asignó el rol de admin a ${email}.`);
    } catch (error) {
      console.error(`Error asignando rol de admin a ${email}:`, error.message);
    }
  }
  console.log("Proceso finalizado. Ya pueden iniciar sesión con credenciales de administrador.");
  process.exit(0);
}

assignAdmins();
