import { buildApiUrl, getAuthToken } from './serverApi.js';

const DB_NAME = 'thanwya-assets';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveVideoAsset(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const token = getAuthToken();
    const response = await fetch(buildApiUrl('/api/uploads/video'), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    if (response.ok) {
      return response.json();
    }
  } catch (error) {
    console.warn('Remote video upload failed, falling back to IndexedDB', error);
  }

  const db = await openDb();
  const id = `video-${crypto.randomUUID()}`;
  const asset = {
    id,
    fileName: file.name,
    mimeType: file.type || 'video/mp4',
    blob: file,
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return { id, fileName: file.name, url: '' };
}

export async function loadVideoAsset(id) {
  if (!id) return null;
  try {
  const token = getAuthToken();
    const response = await fetch(buildApiUrl(`/api/uploads/video/${encodeURIComponent(id)}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (response.ok) {
      const blob = await response.blob();
      return {
        id,
        blob,
        fileName: id,
      };
    }
  } catch (error) {
    console.warn('Remote video fetch failed, trying IndexedDB', error);
  }

  const db = await openDb();
  const asset = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return asset;
}

export async function deleteVideoAsset(id) {
  try {
    const token = getAuthToken();
    await fetch(buildApiUrl(`/api/uploads/video/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return;
  } catch (error) {
    console.warn('Remote video delete failed, trying IndexedDB', error);
  }

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
