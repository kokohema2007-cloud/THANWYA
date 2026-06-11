import { buildApiUrl, getAuthToken } from './serverApi.js';

async function uploadProtectedAsset(path, file, logPrefix) {
  console.info(`[${logPrefix}] upload-started`, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    bytes: file.size,
  });
  const formData = new FormData();
  formData.append('file', file);
  const token = getAuthToken();
  const response = await fetch(buildApiUrl(path), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });
  if (!response.ok) {
    throw new Error((await response.text()) || 'Failed to upload video');
  }
  const data = await response.json();
  console.info(`[${logPrefix}] upload-finished`, data);
  return data;
}

async function deleteProtectedAsset(path) {
  const token = getAuthToken();
  const response = await fetch(buildApiUrl(path), {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error((await response.text()) || 'Failed to delete asset');
  }
}

export async function saveVideoAsset(file) {
  return uploadProtectedAsset('/api/uploads/video', file, 'video-flow');
}

export async function savePdfAsset(file) {
  return uploadProtectedAsset('/api/uploads/pdf', file, 'pdf-flow');
}

export async function saveTeacherImageAsset(file) {
  return uploadProtectedAsset('/api/uploads/teacher-image', file, 'teacher-image-flow');
}

export async function loadVideoAsset(id) {
  if (!id) return null;
  console.info('[video-flow] asset-fetch-started', { assetId: id });
  const token = getAuthToken();
  const response = await fetch(buildApiUrl(`/api/uploads/video/${encodeURIComponent(id)}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    console.warn('[video-flow] asset-fetch-failed', { assetId: id, status: response.status });
    return null;
  }
  console.info('[video-flow] asset-fetch-finished', { assetId: id, mimeType: response.headers.get('content-type') || '' });
  return {
    id,
    blob: await response.blob(),
    fileName: id,
  };
}

export async function deleteVideoAsset(id) {
  return deleteProtectedAsset(`/api/uploads/video/${encodeURIComponent(id)}`);
}

export async function deletePdfAsset(id) {
  return deleteProtectedAsset(`/api/uploads/pdf/${encodeURIComponent(id)}`);
}
