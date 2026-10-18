/**
 * Cache local (IndexedDB) du texte des pages déjà lues, par empreinte de fichier :
 * permet de reprendre un import interrompu (fermeture de l'onglet, coupure) sans
 * refaire la lecture ni l'OCR des pages déjà traitées. Simple confort : si le
 * navigateur refuse IndexedDB, l'import repart du début.
 */
import type { PageText } from "@/domain/extraction/layout";

const DB = "smart-invoice-imports";
const STORE = "pages";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadCachedPages(hash: string): Promise<PageText[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(hash);
      req.onsuccess = () => resolve((req.result as PageText[] | undefined) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveCachedPages(hash: string, pages: PageText[]): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(pages, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearCachedPages(hash: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(hash);
  } catch {
    /* sans conséquence */
  }
}

/** Fichiers ouverts pendant la session (aperçu de la page source sans retéléchargement). */
export const sessionFiles = new Map<string, ArrayBuffer>();

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
