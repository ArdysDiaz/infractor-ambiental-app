import React, { useEffect, useMemo, useState } from "react"
import { auth, db, storage } from "./firebase"
import { onAuthStateChanged, signInAnonymously } from "firebase/auth"
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"

// ⚠️ Solo para DEMO/PRUEBA. No uses esto en producción.
const ADMIN_USERNAME = "admin@example.com"
const ADMIN_PASSWORD = "password123"

// Estados posibles
const STATUS = ["Pendiente", "Visto", "Solucionado"]

export default function IncidentReporterApp() {
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [view, setView] = useState("user") // 'user' | 'login' | 'admin'
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLocationLoading, setIsLocationLoading] = useState(false)
  const [reports, setReports] = useState([])
  const [filterStatus, setFilterStatus] = useState("Todos")
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const [reportData, setReportData] = useState({
    photos: [],
    video: null,
    observations: "",
    locationText: "",   // ubicación manual
    infractor: "",      // infractor opcional
    latitude: null,
    longitude: null
  })

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        console.log("App instalada");
      }
      setDeferredPrompt(null);
    }
  };

  // Autenticación anónima
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) await signInAnonymously(auth)
      } catch (e) {
        console.error(e)
        setError("Error de autenticación. Intenta de nuevo.")
      } finally {
        setIsAuthReady(true)
      }
    })
    return () => unsub()
  }, [])

  // Suscripción a reportes si eres admin
  useEffect(() => {
    if (!isAdmin) return
    const q = query(collection(db, "reports"), orderBy("timestamp", "desc"))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setReports(rows)
      },
      (e) => {
        console.error(e)
        setError("Error cargando reportes.")
      }
    )
    return () => unsub()
  }, [isAdmin])

  const filteredReports = useMemo(() => {
    if (filterStatus === "Todos") return reports
    return reports.filter((r) => r.status === filterStatus)
  }, [reports, filterStatus])

  // Ubicación
  const handleLocationGet = async () => {
    const perm = await checkPermission("geolocation");
    if (perm === "denied") {
      setError("No tienes permisos de ubicación habilitados. Actívalos en ajustes.");
      return;
    }

    setIsLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setReportData((p) => ({ ...p, latitude, longitude }));
        setIsLocationLoading(false);
      },
      () => {
        setError("No fue posible obtener tu ubicación.");
        setIsLocationLoading(false);
      }
    );
  };

  // Archivos
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (e.target.name === "photos") {
      const total = reportData.photos.length + files.length
      if (total > 3) {
        setError("Máximo 3 fotos.")
        return
      }
      setReportData((p) => ({ ...p, photos: [...p.photos, ...files] }))
    } else if (e.target.name === "video") {
      if (reportData.video) {
        setError("Solo 1 video.")
        return
      }
      setReportData((p) => ({ ...p, video: files[0] }))
    }
  }

  // Enviar reporte
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (!isAuthReady || !auth.currentUser) {
      setError("La app aún no está lista. Espera un momento.")
      return
    }
    if (reportData.photos.length < 1) {
      setError("Debes subir al menos 1 foto.")
      return
    }

    setIsSubmitting(true)
    try {
      // 1) Subir media
      const photoUrls = []
      for (const file of reportData.photos) {
        const r = ref(
          storage,
          `users/${auth.currentUser.uid}/media/${Date.now()}_${file.name}`
        )
        const snap = await uploadBytes(r, file)
        const url = await getDownloadURL(snap.ref)
        photoUrls.push(url)
      }

      let videoUrl = null
      if (reportData.video) {
        const r = ref(
          storage,
          `users/${auth.currentUser.uid}/media/${Date.now()}_${reportData.video.name}`
        )
        const snap = await uploadBytes(r, reportData.video)
        videoUrl = await getDownloadURL(snap.ref)
      }

      // 2) Guardar documento
      await addDoc(collection(db, "reports"), {
        observations: reportData.observations || "",
        locationText: reportData.locationText || "",
        infractor: reportData.infractor || "",
        latitude: reportData.latitude ?? null,
        longitude: reportData.longitude ?? null,
        photos: photoUrls,
        video: videoUrl,
        status: "Pendiente",
        timestamp: Date.now(),
        userId: auth.currentUser.uid
      })

      setMessage("Reporte enviado. ¡Gracias!")
      setReportData({
        photos: [],
        video: null,
        observations: "",
        locationText: "",
        infractor: "",
        latitude: null,
        longitude: null
      })
    } catch (e) {
      console.error(e)
      setError("Error enviando el reporte. Intenta más tarde.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Login admin (demo)
  const handleAdminLogin = (e) => {
    e.preventDefault()
    const username = e.target.username.value
    const password = e.target.password.value
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      setIsAdmin(true)
      setView("admin")
      setError(null)
    } else {
      setError("Credenciales de administrador incorrectas.")
    }
  }

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "reports", id), { status: newStatus })
    } catch (e) {
      console.error(e)
      setError("No se pudo actualizar el estado.")
    }
  }

  async function checkPermission(name) {
    try {
      if (!navigator.permissions) return "unknown";
      const result = await navigator.permissions.query({ name });
      return result.state; // "granted" | "denied" | "prompt"
    } catch {
      return "unknown"; // algunos navegadores no soportan todos los permisos
    }
  }

  // async function requestCameraAccess() {
  //   try {
  //     const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  //     stream.getTracks().forEach((t) => t.stop()); // liberar cámara
  //     return true;
  //   } catch (e) {
  //     setError("No tienes permisos de cámara habilitados.");
  //     return false;
  //   }
  // }


  // UI
  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-lg font-semibold">Cargando…</p>
      </div>
    )
  }

  if (view === "login") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="card w-full max-w-sm">
          <h1 className="text-2xl font-bold text-center mb-4">Acceso Admin</h1>
          {error && <p className="text-red-600 text-sm mb-3 text-center">{error}</p>}
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">Usuario</label>
              <input
                name="username"
                type="email"
                required
                className="w-full border rounded-lg p-2"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Contraseña</label>
              <input
                name="password"
                type="password"
                required
                className="w-full border rounded-lg p-2"
                placeholder="password123"
              />
            </div>
            <button className="btn btn-primary w-full">Ingresar</button>
          </form>
          <button
            className="mt-4 text-sm text-blue-600 underline block mx-auto"
            onClick={() => setView("user")}
          >
            Volver
          </button>
        </div>
      </div>
    )
  }

  if (view === "admin" && isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold">Dashboard de Reportes</h1>
          <div className="flex items-center gap-2">
            <select
              className="border rounded-lg p-2"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option>Todos</option>
              {STATUS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setIsAdmin(false)
                setView("login")
              }}
              className="btn btn-danger"
            >
              Salir
            </button>
          </div>
        </div>

        {filteredReports.length === 0 ? (
          <p className="text-gray-500">No hay reportes.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredReports.map((r) => (
              <div key={r.id} className="card flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      r.status === "Solucionado"
                        ? "bg-green-200 text-green-800"
                        : r.status === "Visto"
                        ? "bg-blue-200 text-blue-800"
                        : "bg-yellow-200 text-yellow-800"
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(r.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mb-3">
                  {r.observations || "Sin observaciones"}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(r.photos || []).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img className="w-20 h-20 object-cover rounded" src={url} />
                    </a>
                  ))}
                  {r.video && (
                    <a href={r.video} target="_blank" rel="noreferrer">
                      <video className="w-20 h-20 object-cover rounded" src={r.video} controls />
                    </a>
                  )}
                </div>
                {r.locationText && (
                    <p className="text-sm text-gray-600">
                        📍 {r.locationText}
                    </p>
                    )}

                    {r.infractor && (
                    <p className="text-sm text-red-600">
                        🚨 Infractor: {r.infractor}
                    </p>
                )}
                {r.latitude && r.longitude && (
                  <a
                    className="text-sm text-blue-600 underline mb-4"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`}
                  >
                    Ver en mapa
                  </a>
                )}
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => handleStatusChange(r.id, "Visto")}
                    className="btn btn-primary flex-1"
                  >
                    Marcar visto
                  </button>
                  <button
                    onClick={() => handleStatusChange(r.id, "Solucionado")}
                    className="btn bg-green-600 hover:bg-green-700 text-white flex-1"
                  >
                    Marcar solucionado
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Vista usuario
  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center">
      <div className="card w-full max-w-lg">
        <h1 className="text-3xl font-extrabold text-center mb-2">Reportar Incidente</h1>
        <p className="text-center text-gray-600 mb-4">Envía tu reporte de forma anónima.</p>

        {error && (
          <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">{error}</div>
        )}
        {message && (
          <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-lg">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-lg font-medium text-gray-700 dark:text-gray-300">
                Subir Foto (1 a 3 fotos)
            </label>
            <input
              type="file"
              name="photos"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
            />

            <div className="flex flex-wrap gap-2 mt-2">
              {reportData.photos.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-gray-200 px-3 py-1 rounded-full text-xs"
                >
                  <span>{f.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setReportData((p) => ({
                        ...p,
                        photos: p.photos.filter((_, idx) => idx !== i)
                      }))
                    }
                    className="text-red-500 hover:text-red-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

          </div>

          <div>
            <label className="block text-lg font-medium text-gray-700 dark:text-gray-300">
                Subir Video (opcional)
            </label>
            <input
              type="file"
              name="video"
              accept="video/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
            />
            {reportData.video && (
              <div className="mt-2 text-xs text-gray-600">{reportData.video.name}</div>
            )}
          </div>
          {/* Ubicación manual */}
          <div>
            <label className="block font-medium mb-1">Ubicación (Barrio / Sector / Lugar)</label>
            <input
                type="text"
                value={reportData.locationText}
                onChange={(e) => setReportData((p) => ({ ...p, locationText: e.target.value }))}
                placeholder="Ej. Barrio San José"
                className="w-full border rounded-lg p-2"
            />
            </div>

            {/* Infractor opcional */}
            <div>
            <label className="block font-medium mb-1">Infractor (opcional)</label>
            <input
                type="text"
                value={reportData.infractor}
                onChange={(e) => setReportData((p) => ({ ...p, infractor: e.target.value }))}
                placeholder="Persona o entidad responsable"
                className="w-full border rounded-lg p-2"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Ubicación</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLocationGet}
                disabled={isLocationLoading}
                className="btn bg-green-600 hover:bg-green-700 text-white rounded-full"
              >
                {isLocationLoading ? "Obteniendo…" : "Obtener ubicación"}
              </button>
              {reportData.latitude && reportData.longitude && (
                <span className="text-sm text-gray-600">
                  Lat: {reportData.latitude.toFixed(4)} · Lon: {reportData.longitude.toFixed(4)}
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Observaciones</label>
            <textarea
              rows={4}
              value={reportData.observations}
              onChange={(e) =>
                setReportData((p) => ({ ...p, observations: e.target.value }))
              }
              placeholder="Describe el incidente…"
              className="w-full border rounded-lg p-2"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary w-full py-3 rounded-2xl disabled:opacity-60"
          >
            {isSubmitting ? "Enviando…" : "Enviar reporte"}
          </button>
        </form>
      </div>

      <button
        onClick={() => setView("login")}
        className="mt-4 text-sm text-blue-600 underline"
      >
        Acceso administrador
      </button>
      {deferredPrompt && (
        <button
          onClick={handleInstall}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700"
        >
          Instalar aplicación
        </button>
      )}
    </div>
  )
}
