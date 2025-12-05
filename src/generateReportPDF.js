import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * generateReportPDF(report)
 * - report: objeto de report con la estructura que ya tienes (id, timestamp, photos[], observations, locationText, latitude, longitude, infractor, video, etc)
 *
 * La función genera y descarga el PDF automáticamente.
 */

// --- CONSTANTES DE ESTILO ---
const ACCENT_COLOR = rgb(0.1, 0.4, 0.7); // Azul oscuro para títulos
const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const LIGHT_GREY = rgb(0.97, 0.97, 0.97); // Gris muy suave para fondos de bloque
const BACKGROUND_COLOR = rgb(1, 1, 1); // Fondo blanco puro para la página

// --- UTILIDADES ---
// Carga una imagen desde URL hacia un objeto Image (usa crossOrigin anonymous cuando sea posible)
function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = async () => {
      // fallback: fetch la imagen y crear blob url (útil si img.crossOrigin falla)
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const img2 = new Image();
        img2.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(img2);
        };
        img2.onerror = (e) => reject(e);
        img2.src = blobUrl;
      } catch (e) {
        reject(e);
      }
    };
    img.src = url;
  });
}

// Redimensiona/comprime la imagen usando canvas y devuelve ArrayBuffer (JPEG) listo para embed
async function fetchAndResizeImageAsArrayBuffer(url, maxWidth = 1200, quality = 0.7) {
  try {
    const img = await loadImageElement(url);
    const scale = Math.min(1, maxWidth / img.width);
    const cw = Math.round(img.width * scale);
    const ch = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    // fondo blanco para evitar problemas con PNG translúcido al convertir a JPG
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    // convierte a blob (jpeg) y luego a arrayBuffer
    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", quality)
    );
    return await blob.arrayBuffer();
  } catch (e) {
    console.warn("No se pudo redimensionar la imagen, intentando descargar original:", url, e);
    try {
      const resp = await fetch(url);
      return await resp.arrayBuffer();
    } catch (err) {
      console.warn("No se pudo descargar/convertir la imagen:", url, err);
      throw err;
    }
  }
}

// Intenta incrustar PNG o JPG (detecta en orden)
async function embedSmartImage(pdfDoc, arrBuf) {
  try {
    return await pdfDoc.embedPng(arrBuf);
  } catch {
    try {
      return await pdfDoc.embedJpg(arrBuf);
    } catch {
      return null;
    }
  }
}

// Añade pie con numero de pagina (Se mantiene por si el contenido desborda)
function addFooter(page, pageIndex, total, font) {
  const { width } = page.getSize();
  const text = `Página ${pageIndex} de ${total}`;
  page.drawText(text, {
    x: width / 2 - 40, // Centrado manual
    y: 25,
    size: 10,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
}

// Envuelve texto a un ancho máximo
function wrapText(text, font, size, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const proposedLine = currentLine + " " + word;
    // Usar widthOfTextAtSize, no widthOfText, para medir el ancho
    if (font.widthOfTextAtSize(proposedLine, size) < maxWidth) {
      currentLine = proposedLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// --- GENERADOR PRINCIPAL ---
export async function generateReportPDF(report) {
  try {
    console.log("Generando PDF para reporte:", report);

    // Preparar datos (normalize)
    const data = {
      id: report.id || report.reportId || "SIN_ID",
      observations: report.observations || "No se registraron observaciones.",
      locationText: report.locationText || "Ubicación no especificada.",
      infractor: report.infractor || "Infractor no identificado.",
      timestamp: report.timestamp ? new Date(report.timestamp).toLocaleString() : "Fecha/Hora no registrada.",
      photos: Array.isArray(report.photos) ? report.photos : (report.images || []),
      latitude: report.latitude ?? null,
      longitude: report.longitude ?? null,
      video: report.video ?? null,
    };

    // Crear PDF
    const pdfDoc = await PDFDocument.create();
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // --- PORTADA (PÁGINA 1) ---
    let page = pdfDoc.addPage([595, 842]); // A4-ish
    const { width, height } = page.getSize();
    const marginX = 50;
    const contentW = width - 2 * marginX;
    
    // 1. Fondo blanco puro
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: BACKGROUND_COLOR, // Fondo blanco
    });

    let cursorY = height - 50; // starting y para el primer logo

    // --- LOGOS Y TÍTULO (SIN FRANJA AZUL) ---
    const logoSize = 50;

    // Cargar y comprimir logos
    let logo1Arr = null, logo2Arr = null;
    try {
      logo1Arr = await fetchAndResizeImageAsArrayBuffer("/icons/logotipo.png", 300, 0.9);
    } catch (e) {
      console.warn("Logo1 no cargado", e);
    }
    try {
      logo2Arr = await fetchAndResizeImageAsArrayBuffer("/icons/logo-vertical.png", 300, 0.9);
    } catch (e) {
      console.warn("Logo2 no cargado", e);
    }

    // Dibujar logos
    if (logo1Arr) {
      const emb = await embedSmartImage(pdfDoc, logo1Arr);
      if (emb) {
        page.drawImage(emb, {
          x: marginX,
          y: cursorY - logoSize, // Posición superior izquierda
          width: logoSize,
          height: logoSize,
        });
      }
    }
    if (logo2Arr) {
      const emb2 = await embedSmartImage(pdfDoc, logo2Arr);
      if (emb2) {
        page.drawImage(emb2, {
          x: width - marginX - logoSize,
          y: cursorY - logoSize, // Posición superior derecha
          width: logoSize,
          height: logoSize,
        });
      }
    }
    cursorY -= (logoSize + 30); // Mover cursor debajo de los logos

    // Título Principal Centrado
    const titleText = "REPORTE DE INFRACCIÓN AMBIENTAL";
    page.drawText(titleText, {
      x: width / 2 - (helvBold.widthOfTextAtSize(titleText, 18) / 2),
      y: cursorY,
      size: 18,
      font: helvBold,
      color: ACCENT_COLOR, // Color de acento
    });
    cursorY -= 40; // Mover cursor debajo del título

    // --- SECCIÓN DE DETALLES (2 Columnas) ---
    page.drawText("DATOS PRINCIPALES DEL REPORTE", {
      x: marginX,
      y: cursorY,
      size: 14,
      font: helvBold,
      color: ACCENT_COLOR,
    });
    cursorY -= 20;

    const dataBlockYStart = cursorY;
    const lh = 15; // Line height (reducido a 15 de 18 para compactar)
    const colGap = 2; // Espacio entre etiqueta y valor
    const labelX1 = marginX; // Columna 1
    const valueX1 = marginX + 95 + colGap;
    const labelX2 = width / 2 + 20; // Columna 2
    const valueX2 = labelX2 + 95 + colGap;

    // --- COLUMNA 1 ---
    let detailY1 = dataBlockYStart;
    
    // ID
    detailY1 -= lh;
    page.drawText("ID del Reporte:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    page.drawText(data.id, { x: valueX1, y: detailY1, size: 10, font: helv });
    // Fecha
    detailY1 -= lh;
    page.drawText("Fecha / Hora:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    page.drawText(data.timestamp, { x: valueX1, y: detailY1, size: 10, font: helv });
    // Infractor
    detailY1 -= lh;
    page.drawText("Infractor:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    const infractorLines = wrapText(data.infractor, helv, 10, width / 2 - valueX1 - 5);
    for(const line of infractorLines) {
        page.drawText(line, { x: valueX1, y: detailY1, size: 10, font: helv });
        detailY1 -= lh;
    }
    
    // --- COLUMNA 2 ---
    let detailY2 = dataBlockYStart;
    
    // Ubicación textual
    detailY2 -= lh;
    page.drawText("Lugar reportado:", { x: labelX2, y: detailY2, size: 10, font: helvBold, color: TEXT_COLOR });
    // Aquí usamos un tamaño de texto ligeramente menor para evitar que se monte si es largo
    const locationLines = wrapText(data.locationText || "—", helv, 9, width - valueX2 - marginX);
    let locationCurrentY = detailY2;
    for(const line of locationLines) {
        page.drawText(line, { x: valueX2, y: locationCurrentY, size: 9, font: helv });
        locationCurrentY -= 12; // Un poco menos de interlineado para el texto ajustado
    }
    detailY2 = locationCurrentY + lh; // Ajustar detailY2 al último punto de texto.

    
    // Coordenadas (si existen)
    if (data.latitude && data.longitude) {
      detailY2 -= lh;
      page.drawText("Coordenadas:", { x: labelX2, y: detailY2, size: 10, font: helvBold, color: TEXT_COLOR });
      page.drawText(`Lat: ${data.latitude} · Lng: ${data.longitude}`, { x: valueX2, y: detailY2, size: 10, font: helv });
    }
    
    // 2. Definir el nuevo cursor Y basado en la columna más larga (espacio reducido)
    const finalDetailY = Math.min(detailY1, detailY2); 

    // Línea separadora
    page.drawLine({
      start: { x: marginX, y: finalDetailY - 5 },
      end: { x: width - marginX, y: finalDetailY - 5 },
      thickness: 0.5,
      color: ACCENT_COLOR,
    });
    cursorY = finalDetailY - 25; // Espacio reducido a 10pt (de 25pt)

    // --- SECCIÓN DE OBSERVACIONES ---
    page.drawText("DESCRIPCIÓN DEL REPORTE", {
      x: marginX,
      y: cursorY,
      size: 14,
      font: helvBold,
      color: ACCENT_COLOR,
    });
    cursorY -= 20;

    const obsText = data.observations || "No se registraron observaciones.";
    // Wrap text con espacio para 5pt de padding interno
    const obsLines = wrapText(obsText, helv, 10, contentW - 10);
    let obsLineY = cursorY;
    const obsLineHeight = 13;
    const paddingY = 10;
    const boxHeight = (obsLines.length * obsLineHeight) + paddingY;

    // Dibujar el rectángulo de fondo
    page.drawRectangle({
        x: marginX,
        y: obsLineY - boxHeight,
        width: contentW,
        height: boxHeight,
        color: LIGHT_GREY, // Fondo gris muy suave
        borderWidth: 0.5,
        borderColor: rgb(0.9, 0.9, 0.9) // Borde muy claro
    })

    for (const ln of obsLines) {
      // Dibujar el texto 5pt más adentro para padding visual
      page.drawText(ln, { x: marginX + 5, y: obsLineY - 10, size: 10, font: helv, color: TEXT_COLOR });
      obsLineY -= obsLineHeight;
    }
    cursorY = obsLineY - 30; // Espacio reducido a 15pt antes del título de evidencias

    // --- EVIDENCIAS FOTOGRÁFICAS (EN LA MISMA PÁGINA) ---

    // Título de Evidencias
    page.drawText("EVIDENCIAS FOTOGRÁFICAS", { 
      x: marginX, 
      y: cursorY, 
      size: 14, 
      font: helvBold, 
      color: ACCENT_COLOR 
    });
    cursorY -= 20;
    
    // Configuración de la cuadrícula
    const numCols = 3;
    colGap == 10;
    const rowGap = 15; // Espacio entre filas reducido
    const photoCaptionH = 15;
    const colW = (contentW - colGap * (numCols - 1)) / numCols;
    let px = marginX;
    let py = cursorY; 
    let col = 0;

    for (let i = 0; i < data.photos.length; i++) {
      const url = data.photos[i];
      try {
        const bytes = await fetchAndResizeImageAsArrayBuffer(url, 1200, 0.70);
        const img = await embedSmartImage(pdfDoc, bytes);
        if (!img) {
          console.warn("Imagen no embebible:", url);
          continue;
        }

        // calculamos escala para que encaje en colW
        const imgW = colW;
        // La altura máxima se limita para prevenir desbordes
        let imgH = (img.height / img.width) * imgW;
        const maxHeight = 120; // Altura máxima REDUCIDA para maximizar espacio
        if (imgH > maxHeight) {
            imgH = maxHeight;
        }

        // Revisar si hay espacio para la foto y su pie de página (Margen inferior: 40pt)
        if (py - imgH - photoCaptionH < 40) { 
          // NO HAY ESPACIO. Añadir nota y romper el bucle para mantener el PDF en 1 página.
          if (i > 0) { // Solo si ya se ha dibujado al menos una foto
            page.drawText(`... ${data.photos.length - i} evidencias adicionales omitidas por límite de espacio en una sola página.`, { 
              x: marginX, 
              y: py - 10, 
              size: 10, 
              font: helvOblique, 
              color: TEXT_COLOR 
            });
          } else {
             page.drawText("No hay espacio suficiente para mostrar evidencias en la página.", { 
              x: marginX, 
              y: py - 10, 
              size: 10, 
              font: helvOblique, 
              color: TEXT_COLOR 
            });
          }
          py = 40; // Asegurar que el cursor apunte al final de la nota para el video o fin de página.
          break; 
        }

        // Dibuja imagen
        page.drawImage(img, {
          x: px,
          y: py - imgH,
          width: imgW,
          height: imgH,
        });

        // Dibuja borde (opcional, para separar visualmente)
        page.drawRectangle({
            x: px - 1,
            y: py - imgH - 1,
            width: imgW + 2,
            height: imgH + 2,
            borderWidth: 1,
            borderColor: rgb(0.8, 0.8, 0.8)
        });

        // Caption
        const caption = `Evidencia ${i + 1}`;
        page.drawText(caption, {
          x: px,
          y: py - imgH - 10,
          size: 9,
          font: helvOblique,
          color: TEXT_COLOR,
        });

        // Avanzar columna/fila
        col++;
        if (col < numCols) {
          px += colW + colGap;
        } else {
          // Nueva fila
          col = 0;
          px = marginX;
          py -= imgH + photoCaptionH + rowGap; // Mover cursor hacia abajo
        }

      } catch (err) {
        console.warn("Error procesando foto para PDF:", url, err);
      }
    }
    
    cursorY = py; // Actualizar cursorY para la siguiente sección

    // --- REFERENCIA DE VIDEO (Si existe) ---
    if (data.video && cursorY > 100) { // Comprobar si hay espacio suficiente para el bloque de video
        cursorY -= 20;

        page.drawText("ENLACE DE EVIDENCIA DE VIDEO", { 
            x: marginX, 
            y: cursorY, 
            size: 12, // Título ligeramente menor
            font: helvBold, 
            color: ACCENT_COLOR 
        });
        cursorY -= 15;
        
        page.drawText("El reporte incluye una referencia de video. Acceda al enlace para visualizar:", { 
            x: marginX, 
            y: cursorY, 
            size: 9, 
            font: helv, 
            color: TEXT_COLOR 
        });
        cursorY -= 20;
        
        // Agregar un rectángulo de fondo para destacarlo
        page.drawRectangle({
             x: marginX,
             y: cursorY - 3,
             width: contentW,
             height: 15,
             color: LIGHT_GREY
        });
        
        // Dibuja el enlace (Azul para simular hipervínculo)
        page.drawText(data.video, { 
            x: marginX + 5, // 5pt de padding
            y: cursorY, 
            size: 10, 
            font: helv, 
            color: rgb(0, 0, 0.6) 
        });
    }

    // --- PIE DE PÁGINA / NÚMERO DE PÁGINA ---
    // Usamos el pie de página para darle un toque final (1 de 1)
    addFooter(page, 1, 1, helv);

    // --- GENERAR Y DESCARGAR ---
    const pdfBytes = await pdfDoc.save();
    // descarga automática en navegador
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Reporte_${data.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    console.log("PDF generado y descargado:", data.id);
    return true;
  } catch (e) {
    console.error("Error generando PDF:", e);
    // puedes lanzar error o mostrar notificación según prefieras
    throw e;
  }
}