// Separate module so tests can replace the worker URL (Vite's `?url` gives an extension-local asset URL).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export default workerUrl;
