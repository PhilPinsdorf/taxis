import { api } from './api';

const MAX_SIDE = 8000;

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/png'),
  );
}

async function pdfToPng(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4000 / Math.max(base.width, base.height), 6);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { blob: await canvasToBlob(canvas), width: canvas.width, height: canvas.height };
}

/** Lädt Bild oder PDF (1. Seite) hoch, verkleinert sehr große Bilder */
export async function uploadPlanFile(file: File): Promise<{ id: string; width: number; height: number }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { blob, width, height } = await pdfToPng(file);
    return api.uploadImage(blob, width, height, 'plan.png');
  }
  const img = await loadImage(file);
  let { naturalWidth: w, naturalHeight: h } = img;
  const longSide = Math.max(w, h);
  if (longSide > MAX_SIDE || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    const f = Math.min(1, MAX_SIDE / longSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * f);
    canvas.height = Math.round(h * f);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    w = canvas.width;
    h = canvas.height;
    return api.uploadImage(await canvasToBlob(canvas), w, h, 'plan.png');
  }
  return api.uploadImage(file, w, h, file.name);
}
