import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * generateReportPDF(report)
 * - report: objeto de report con la estructura (id, timestamp, photos[], observations, locationText, latitude, longitude, infractor, video, etc)
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

// Añade pie con número de página
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
  const words = String(text || "").split(" ");
  const lines = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const proposedLine = currentLine + " " + word;
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
      timestamp: report.timestamp ? new Date(report.timestamp).toLocaleString("es-CO") : "Fecha/Hora no registrada.",
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
      color: BACKGROUND_COLOR,
    });

    let cursorY = height - 50; // starting y para el primer logo

    // --- LOGOS Y TÍTULO ---
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
          y: cursorY - logoSize,
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
          y: cursorY - logoSize,
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
      color: ACCENT_COLOR,
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
    const lh = 15; // Line height
    const labelX1 = marginX; // Columna 1
    const valueX1 = marginX + 95 + 2;
    const labelX2 = width / 2 + 20; // Columna 2
    const valueX2 = labelX2 + 95 + 2;

    // --- COLUMNA 1 ---
    let detailY1 = dataBlockYStart;
    
    // ID
    detailY1 -= lh;
    page.drawText("ID del Reporte:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    page.drawText(String(data.id), { x: valueX1, y: detailY1, size: 10, font: helv });
    
    // Fecha
    detailY1 -= lh;
    page.drawText("Fecha / Hora:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    page.drawText(String(data.timestamp), { x: valueX1, y: detailY1, size: 10, font: helv });
    
    // Infractor
    detailY1 -= lh;
    page.drawText("Infractor:", { x: labelX1, y: detailY1, size: 10, font: helvBold, color: TEXT_COLOR });
    const infractorLines = wrapText(data.infractor, helv, 10, width / 2 - valueX1 - 5);
    for (const line of infractorLines) {
      page.drawText(line, { x: valueX1, y: detailY1, size: 10, font: helv });
      detailY1 -= lh;
    }
    
    // --- COLUMNA 2 ---
    let detailY2 = dataBlockYStart;
    
    // Ubicación textual
    detailY2 -= lh;
    page.drawText("Lugar reportado:", { x: labelX2, y: detailY2, size: 10, font: helvBold, color: TEXT_COLOR });
    const locationLines = wrapText(data.locationText || "—", helv, 9, width - valueX2 - marginX);
    for (const line of locationLines) {
      page.drawText(line, { x: valueX2, y: detailY2, size: 9, font: helv });
      detailY2 -= 12;
    }
    
    // Coordenadas (si existen)
    if (data.latitude != null && data.longitude != null) {
      detailY2 -= lh;
      page.drawText("Coordenadas:", { x: labelX2, y: detailY2, size: 10, font: helvBold, color: TEXT_COLOR });
      const latStr = typeof data.latitude === "number" ? data.latitude.toFixed(5) : String(data.latitude);
      const lngStr = typeof data.longitude === "number" ? data.longitude.toFixed(5) : String(data.longitude);
      page.drawText(`Lat: ${latStr} · Lng: ${lngStr}`, { x: valueX2, y: detailY2, size: 10, font: helv });
      detailY2 -= lh;
    }
    
    // Cursor Y basado en la columna más larga
    const finalDetailY = Math.min(detailY1, detailY2); 

    // Línea separadora
    page.drawLine({
      start: { x: marginX, y: finalDetailY - 5 },
      end: { x: width - marginX, y: finalDetailY - 5 },
      thickness: 0.5,
      color: ACCENT_COLOR,
    });
    cursorY = finalDetailY - 25;

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
      color: LIGHT_GREY,
      borderWidth: 0.5,
      borderColor: rgb(0.9, 0.9, 0.9)
    });

    for (const ln of obsLines) {
      page.drawText(ln, { x: marginX + 5, y: obsLineY - 10, size: 10, font: helv, color: TEXT_COLOR });
      obsLineY -= obsLineHeight;
    }
    cursorY = obsLineY - 30;

    // --- EVIDENCIAS FOTOGRÁFICAS ---
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
    const photoColGap = 10;
    const rowGap = 15;
    const photoCaptionH = 15;
    const colW = (contentW - photoColGap * (numCols - 1)) / numCols;
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
        let imgH = (img.height / img.width) * imgW;
        const maxHeight = 120;
        if (imgH > maxHeight) {
          imgH = maxHeight;
        }

        // Revisar si hay espacio para la foto y su pie de página (Margen inferior: 40pt)
        if (py - imgH - photoCaptionH < 40) { 
          if (i > 0) {
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
          py = 40;
          break; 
        }

        // Dibuja imagen
        page.drawImage(img, {
          x: px,
          y: py - imgH,
          width: imgW,
          height: imgH,
        });

        // Borde
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
          px += colW + photoColGap;
        } else {
          col = 0;
          px = marginX;
          py -= imgH + photoCaptionH + rowGap;
        }

      } catch (err) {
        console.warn("Error procesando foto para PDF:", url, err);
      }
    }
    
    cursorY = py;

    // --- REFERENCIA DE VIDEO (Si existe) ---
    if (data.video && cursorY > 80) {
      cursorY -= 25;

      page.drawText("ENLACE DE EVIDENCIA DE VIDEO", { 
        x: marginX, 
        y: cursorY, 
        size: 12, 
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
      
      page.drawRectangle({
        x: marginX,
        y: cursorY - 3,
        width: contentW,
        height: 15,
        color: LIGHT_GREY
      });
      
      page.drawText(String(data.video), { 
        x: marginX + 5,
        y: cursorY, 
        size: 10, 
        font: helv, 
        color: rgb(0, 0, 0.6) 
      });
    }

    // --- PIE DE PÁGINA ---
    addFooter(page, 1, 1, helv);

    // --- GENERAR Y DESCARGAR ---
    const pdfBytes = await pdfDoc.save();
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
    throw e;
  }
}
