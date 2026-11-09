import { onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from "firebase/auth"
import {
  addDoc,
  collection,
  getDocs,
  doc,
  orderBy,
  query,
  updateDoc,
  limit,
  startAfter,
  where
} from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRegisterSW } from 'virtual:pwa-register/react'
import { auth, db, storage } from "./firebase"
import { generateReportPDF } from "./generateReportPDF"

// Constante para la paginación
const REPORTS_PER_PAGE = 9;

// Estados posibles
const STATUS = ["Pendiente", "Visto", "Solucionado"]

// Administradores autorizados
const ADMIN_EMAILS = [
  "semader@quibdo-choco.gov.co",
  "frankcorpa54@gmail.com",
  "viasneyiris20@gmail.com"
];

// Componente para manejar la actualización de la PWA
function PwaUpdater() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('Service Worker registrado:', r)
    },
    onRegisterError(error) {
      console.error('Error al registrar el Service Worker:', error)
    },
  })

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      { (offlineReady || needRefresh) &&
        <div className="p-4 rounded-lg shadow-lg bg-gray-800 text-white flex items-center gap-4">
          <div className="flex-grow">
            { needRefresh
              ? <span>¡Nueva versión disponible!</span>
              : <span>La aplicación está lista para funcionar sin conexión.</span>
            }
          </div>
          <div className="flex gap-2">
            { needRefresh &&
              <button className="btn btn-primary" onClick={() => updateServiceWorker(true)}>Actualizar</button>
            }
            <button
              className="p-2 leading-none rounded-full hover:bg-gray-700 transition-colors"
              aria-label="Cerrar"
              onClick={() => close()}>�S"</button>
          </div>
        </div>
      }
    </div>
  );

}

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
  const [lastVisible, setLastVisible] = useState(null); // Para paginación
  const [hasMore, setHasMore] = useState(true); // Para saber si hay más reportes
  const [isLoadingMore, setIsLoadingMore] = useState(false); // Para el botón "Cargar más"
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [generatingPdfId, setGeneratingPdfId] = useState(null);
  const [installable, setInstallable] = useState(false);

  const [reportData, setReportData] = useState({
    photos: [],
    video: null,
    observations: "",
    locationText: "",   // ubicación manual
    infractor: "",      // infractor opcional
    latitude: null,
    longitude: null
  })

  // --- Lógica PWA ---
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isInStandaloneMode = () => 'standalone' in window.navigator && (window.navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    if (isInStandaloneMode()) {
      return;
    }
    const oneDay = 24 * 60 * 60 * 1000;
    
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setInstallable(true);

      const lastPromptTime = localStorage.getItem('pwaInstallPromptLastShown');

      // Lógica para mostrar el modal automáticamente solo si ha pasado el tiempo de enfriamiento.
      // Esto es independiente de si el botón de instalación manual es visible.
      if (!lastPromptTime || (Date.now() - parseInt(lastPromptTime, 10)) > oneDay) {
        setShowInstallModal(true);
      }
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Si no es un navegador que dispare 'beforeinstallprompt',
    // comprobamos si es iOS para mostrar la opción de instalación manual.
    if (isIos()) {
      setInstallable(true);
      const lastPromptTime = localStorage.getItem('pwaInstallPromptLastShown');
      if (!lastPromptTime || (Date.now() - parseInt(lastPromptTime, 10)) > oneDay) {
        setShowInstallModal(true);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  // --- Fin Lógica PWA ---


  // Tema oscuro automático
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = (event) => {
      const isDark = event ? event.matches : mediaQuery.matches;
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    // Ejecutar una vez al cargar
    applyTheme(mediaQuery);

    // Compatibilidad: algunos navegadores usan addEventListener, otros addListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", applyTheme);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(applyTheme);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", applyTheme);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(applyTheme);
      }
    };
  }, []);

  const handleInstall = async () => {
    setShowInstallModal(false);
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        // Opcional: Analítica para registrar la instalación exitosa.
      }
      setDeferredPrompt(null);
    }
  };
  const dismissInstall = () => {
    localStorage.setItem('pwaInstallPromptLastShown', Date.now().toString());
    setShowInstallModal(false);
  };


  // Autenticación anónima
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {      
      try {
        if (user) {
          // Si hay un usuario, verificar si es admin
          const idTokenResult = await user.getIdTokenResult();
          const isUserAdmin = Boolean(
            idTokenResult.claims.admin ||
            (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase()))
          );
          if (isUserAdmin) {
            setIsAdmin(true);
            setView("admin");
          } else {
            // Es un usuario anónimo o un usuario normal sin rol de admin
            setIsAdmin(false);
          }
        } else {
          // Si no hay usuario, iniciar sesión anónima para los reportes
          await signInAnonymously(auth);
          setIsAdmin(false);
        }
      } catch (e) {
        console.error(e)
        setError("Error de autenticación. Intenta de nuevo.")
      } finally {
        setIsAuthReady(true)
      }
    })
    return () => unsub()
  }, [])

  // Carga inicial y reseteo de reportes al cambiar de filtro
  useEffect(() => {
    if (isAdmin) {
      setReports([]); // Limpiar reportes al cambiar de filtro
      setLastVisible(null);
      setHasMore(true);
      loadMoreReports(true, filterStatus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, filterStatus]);

  const loadMoreReports = useCallback(async (isInitialLoad = false, statusOverride = null) => {
    if ((!isInitialLoad && !hasMore) || isLoadingMore) return;

    setIsLoadingMore(true);
    setError(null);

    const activeStatus = statusOverride !== null ? statusOverride : filterStatus;
    const reportsRef = collection(db, "reports");

    try {
      const constraints = [orderBy("timestamp", "desc")];

      if (activeStatus !== "Todos") {
        constraints.push(where("status", "==", activeStatus));
      }

      if (lastVisible && !isInitialLoad) {
        constraints.push(startAfter(lastVisible));
      }

      constraints.push(limit(REPORTS_PER_PAGE));

      const q = query(reportsRef, ...constraints);
      const documentSnapshots = await getDocs(q);

      const newReports = documentSnapshots.docs.map((d) => ({ id: d.id, ...d.data() }));
      const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1] || null;

      setReports((prevReports) => isInitialLoad ? newReports : [...prevReports, ...newReports]);
      setLastVisible(lastDoc);
      setHasMore(documentSnapshots.docs.length >= REPORTS_PER_PAGE);
    } catch (e) {
      console.error("Error cargando más reportes:", e);
      // Fallback si no está creado el índice compuesto en Firestore para status + timestamp
      if (activeStatus !== "Todos" && (e?.code === 'failed-precondition' || (e?.message && e.message.includes('index')))) {
        try {
          const fallbackConstraints = [orderBy("timestamp", "desc")];
          if (lastVisible && !isInitialLoad) {
            fallbackConstraints.push(startAfter(lastVisible));
          }
          fallbackConstraints.push(limit(50));
          const fallbackSnap = await getDocs(query(reportsRef, ...fallbackConstraints));
          const allDocs = fallbackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const matched = allDocs.filter((r) => r.status === activeStatus);
          const lastDoc = fallbackSnap.docs[fallbackSnap.docs.length - 1] || null;
          setReports((prevReports) => isInitialLoad ? matched : [...prevReports, ...matched]);
          setLastVisible(lastDoc);
          setHasMore(false);
          return;
        } catch (fallbackErr) {
          console.error("Error en fallback de reportes:", fallbackErr);
        }
      }
      setError("No se pudieron cargar más reportes.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [filterStatus, hasMore, isLoadingMore, lastVisible]);

  const filteredReports = useMemo(() => {
    return reports;
  }, [reports]);

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
  
  const handleTakePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (reportData.photos.length >= 3) {
      setError("Máximo 3 fotos.");
      return;
    }
    setReportData((p) => ({ ...p, photos: [...p.photos, file] }));
  };

  const handleRecordVideo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (reportData.video) {
      setError("Solo se permite 1 video. Elimina el actual para grabar uno nuevo.");
      return;
    }
    setReportData((p) => ({ ...p, video: file }));
  };

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
      // 1) Subir media en paralelo
      const photoPromises = reportData.photos.map(async (file) => {
        const r = ref(
          storage,
          `users/${auth.currentUser.uid}/media/${Date.now()}_${file.name}`
        )
        const snap = await uploadBytes(r, file)
        return getDownloadURL(snap.ref)
      })
      const photoUrls = await Promise.all(photoPromises)

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

  // Login admin con Firebase Auth
  const handleAdminLogin = async (e) => {
    e.preventDefault()
    setError(null);
    const username = e.target.username.value
    const password = e.target.password.value
    try {
      const userCredential = await signInWithEmailAndPassword(auth, username, password);
      const idTokenResult = await userCredential.user.getIdTokenResult();
      
      const isUserAdmin = Boolean(
        idTokenResult.claims.admin ||
        (userCredential.user.email && ADMIN_EMAILS.includes(userCredential.user.email.toLowerCase()))
      );

      // Verificar si el usuario tiene el claim de admin o email autorizado
      if (isUserAdmin) {
        setIsAdmin(true);
        setView("admin");
      } else {
        // Si el usuario es válido pero no es admin, cerramos su sesión para evitar confusiones
        await signOut(auth);
        setError("No tienes permisos de administrador.");
      }
    } catch (error) {
      console.error("Error en login de admin:", error.code);
      setError("Credenciales de administrador incorrectas.");
    }
  };
  const handleAdminLogout = async () => {
    await signOut(auth); // Cierra la sesión del admin
    setIsAdmin(false);
    setView("user"); // Vuelve a la vista de usuario (que iniciará sesión anónima)
  }

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "reports", id), { status: newStatus })
    } catch (e) {
      console.error(e)
      setError("No se pudo actualizar el estado.")
    }
  }

  const handleGeneratePdfClick = async (report) => {
    if (generatingPdfId) return; // Evitar múltiples generaciones a la vez
    setGeneratingPdfId(report.id);
    try {
      await generateReportPDF(report);
    } catch (e) {
      console.error("Error al generar el PDF:", e);
      setError("Ocurrió un error al generar el PDF. Revisa la consola para más detalles.");
    } finally {
      setGeneratingPdfId(null); // Restablecer el estado
    }
  };


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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">Cargando⬦</p>
      </div>
    )
  }

  if (view === "login") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
        <div className="card w-full max-w-sm bg-white dark:bg-gray-800 shadow-lg rounded-xl p-6">
          <h1 className="text-2xl font-bold text-center mb-4 text-gray-900 dark:text-gray-100">
            Acceso Admin
          </h1>
          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm mb-3 text-center">{error}</p>
          )}
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Usuario</label>
              <input
                name="username"
                type="email"
                required
                className="w-full border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Contraseña</label>
              <input
                name="password"
                type="password"
                required
                className="w-full border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
                placeholder="password123"
              />
            </div>
            <button className="btn btn-primary w-full">Ingresar</button>
          </form>
          <button
            className="mt-4 text-sm text-blue-600 dark:text-blue-400 underline block mx-auto"
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            Dashboard de Reportes
          </h1>
          <div className="flex items-center gap-2">
            <select
              // Futuro: Aquí se podría añadir un input de búsqueda
              // <input type="search" placeholder="Buscar por ID, lugar..."
              //   className="border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
              // />
              className="border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
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
                handleAdminLogout();
              }}
              className="btn btn-danger"
            >
              Salir
            </button>
          </div>
        </div>

        {filteredReports.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No hay reportes.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredReports.map((r) => (
              <div key={r.id} className="card flex flex-col bg-white dark:bg-gray-800 shadow-md rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      r.status === "Solucionado"
                        ? "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-100"
                        : r.status === "Visto"
                        ? "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100"
                        : "bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100"
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(r.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
                  {r.observations || "Sin observaciones"}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(r.photos || []).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img className="w-20 h-20 object-cover rounded" src={url} loading="lazy" alt={`Evidencia ${i+1}`} />
                    </a>
                  ))}
                  {r.video && (
                    <a href={r.video} target="_blank" rel="noreferrer">
                      <video className="w-20 h-20 object-cover rounded" src={r.video} controls />
                    </a>
                  )}
                </div>
                {r.locationText && (
                  <p className="text-sm text-gray-600 dark:text-gray-300">�x� {r.locationText}</p>
                )}

                {r.infractor && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    �xa� Infractor: {r.infractor}
                  </p>
                )}
                {r.latitude != null && r.longitude != null && (
                  <a
                    className="text-sm text-blue-600 dark:text-blue-400 underline mb-4"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`}
                  >
                    Ver en mapa
                  </a>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
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
                  <button
                    onClick={() => handleGeneratePdfClick(r)}
                    disabled={generatingPdfId === r.id}
                    className="btn bg-purple-600 hover:bg-purple-700 text-white w-full mt-2 disabled:opacity-50 disabled:cursor-wait"
                  >
                    {generatingPdfId === r.id
                      ? "Generando..."
                      : "Generar PDF"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={() => loadMoreReports()}
              disabled={isLoadingMore}
              className="btn btn-secondary disabled:opacity-50"
            >
              {isLoadingMore ? "Cargando..." : "Cargar más"}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Vista usuario
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 flex flex-col items-center">
      <div className="card w-full max-w-lg bg-white dark:bg-gray-800 shadow-lg rounded-xl p-6">
        {/* Prueba de logos juntos */}
        <div className="flex justify-center items-center gap-4 mb-5 h-20">
          <img
            src="/icons/logotipo.png" 
            alt="Logotipo App"
            className="h-28 w-auto"
          />
          <img
            src="/icons/logo-vertical.png"
            alt="Logo Alcaldía"
            className="h-20 w-auto"
          />
        </div>
        <h1 className="text-3xl font-extrabold text-center mb-2 text-gray-900 dark:text-gray-100">
          Reportar Infracción Ambiental
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-300 mb-4">
          Envía tu reporte de forma anónima.
        </p>

        {error && (
          <div className="p-3 mb-4 text-sm text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900 rounded-lg" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 mb-4 text-sm text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900 rounded-lg" role="alert">
            {message}
          </div>
        )}

        {/* Mantenemos la estructura original del formulario y sus mensajes */}
        {/* {error && (
          <div className="p-3 mb-4 text-sm text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900 rounded-lg">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 mb-4 text-sm text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900 rounded-lg">
            {message}
          </div>
        )} */}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-lg font-medium text-gray-700 dark:text-gray-300">
              Fotos del Incidente (1 a 3)
            </label>
            <div className="flex gap-2 mt-2">
              <label className="btn btn-secondary flex-1 cursor-pointer">
                <span>Subir Foto</span>
                <input
                  type="file"
                  name="photos"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <label className="btn bg-blue-600 hover:bg-blue-700 text-white flex-1 cursor-pointer">
                <span>Tomar Foto</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleTakePhoto}
                  className="hidden"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {reportData.photos.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-800 dark:text-gray-100"
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
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    �S"
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-lg font-medium text-gray-700 dark:text-gray-300">
              Video del Incidente (opcional)
            </label>
            <div className="flex gap-2 mt-2">
              <label className="btn btn-secondary flex-1 cursor-pointer">
                <span>Subir Video</span>
                <input
                  type="file"
                  name="video"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <label className="btn bg-blue-600 hover:bg-blue-700 text-white flex-1 cursor-pointer">
                <span>Grabar Video</span>
                <input
                  type="file"
                  accept="video/*"
                  capture="environment"
                  onChange={handleRecordVideo}
                  className="hidden"
                />
              </label>
            </div>
            {reportData.video && (
              <div className="flex flex-wrap gap-2 mt-2">
                <div className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-xs text-gray-800 dark:text-gray-100">
                  <span>{reportData.video.name}</span>
                  <button
                    type="button"
                    onClick={() => setReportData((p) => ({ ...p, video: null }))}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    �S"
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Ubicación manual */}
          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
              Ubicación (Barrio / Sector / Lugar)
            </label>
            <input
              type="text"
              value={reportData.locationText}
              onChange={(e) => setReportData((p) => ({ ...p, locationText: e.target.value }))}
              placeholder="Ej. Barrio San José"
              className="w-full border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          {/* Infractor opcional */}
          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
              Infractor (opcional)
            </label>
            <input
              type="text"
              value={reportData.infractor}
              onChange={(e) => setReportData((p) => ({ ...p, infractor: e.target.value }))}
              placeholder="Persona o entidad responsable"
              className="w-full border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">Ubicación</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLocationGet}
                disabled={isLocationLoading}
                className="btn bg-green-600 hover:bg-green-700 text-white rounded-full"
              >
                {isLocationLoading ? "Obteniendo⬦" : "Obtener ubicación"}
              </button>
              {reportData.latitude != null && reportData.longitude != null && (
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Lat: {reportData.latitude.toFixed(4)} · Lon: {reportData.longitude.toFixed(4)}
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1 text-gray-700 dark:text-gray-300">
              Observaciones
            </label>
            <textarea
              rows={4}
              value={reportData.observations}
              onChange={(e) =>
                setReportData((p) => ({ ...p, observations: e.target.value }))
              }
              placeholder="Describe el incidente⬦"
              className="w-full border rounded-lg p-2 bg-white dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary w-full py-3 rounded-2xl disabled:opacity-60"
          >
            {isSubmitting ? "Enviando⬦" : "Enviar reporte"}
          </button>
        </form>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2">
        {installable && !isInStandaloneMode() && (
          <button
            onClick={() => setShowInstallModal(true)}
            className="btn bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Instalar Aplicación en el dispositivo
          </button>
        )}

        <button
          onClick={() => setView("login")}
          className="text-sm text-blue-600 dark:text-blue-400 underline"
        >
          Acceso administrador
        </button>
      </div>

      {/* Modal de Instalación PWA */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
            <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-gray-100">Instalar Aplicación</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {deferredPrompt
                ? "Añade esta aplicación a tu pantalla de inicio para un acceso rápido y sin conexión."
                : "Para instalar, pulsa el botón de Compartir y luego 'Añadir a pantalla de inicio'."
              }
            </p>
            <div className="flex justify-center gap-4">
              <button onClick={dismissInstall} className="btn btn-secondary">
                Más tarde
              </button>
              {deferredPrompt && (
                <button onClick={handleInstall} className="btn btn-primary">
                  Instalar ahora
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Componente para gestionar actualizaciones de la PWA */}
      <PwaUpdater />

    </div>
  )

}
