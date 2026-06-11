export function normalizeFolder(folder, index = 0) {
  const children = Array.isArray(folder.children) ? folder.children : [];

  return {
    ...folder,
    number: typeof folder.number === 'number' ? folder.number : index + 1,
    videos: Array.isArray(folder.videos) ? folder.videos : [],
    pdfs: Array.isArray(folder.pdfs) ? folder.pdfs : [],
    exams: Array.isArray(folder.exams) ? folder.exams : [],
    children: children.map((child, childIndex) => normalizeFolder(child, childIndex)),
  };
}

export function normalizeFolderList(folders) {
  return (Array.isArray(folders) ? folders : []).map((folder, index) => normalizeFolder(folder, index));
}

export function normalizeTeacherLibrary(teacher) {
  return {
    ...teacher,
    lessons: normalizeFolderList(teacher.lessons),
  };
}

export function findFolderById(folders, folderId) {
  for (const folder of folders ?? []) {
    if (folder.id === folderId) return folder;
    const nested = findFolderById(folder.children, folderId);
    if (nested) return nested;
  }

  return null;
}

export function updateFolderById(folders, folderId, updater) {
  return normalizeFolderList(
    (folders ?? []).map((folder) => {
      if (folder.id === folderId) {
        return updater(folder);
      }

      if (folder.children?.length) {
        return {
          ...folder,
          children: updateFolderById(folder.children, folderId, updater),
        };
      }

      return folder;
    }),
  );
}

export function appendChildFolder(folders, parentFolderId, newFolder) {
  if (!parentFolderId) {
    return normalizeFolderList([...(folders ?? []), newFolder]);
  }

  return updateFolderById(folders, parentFolderId, (folder) => ({
    ...folder,
    children: [...(folder.children ?? []), newFolder],
  }));
}

export function removeFolderById(folders, folderId) {
  return normalizeFolderList(
    (folders ?? [])
      .filter((folder) => folder.id !== folderId)
      .map((folder) => ({
        ...folder,
        children: removeFolderById(folder.children, folderId),
      })),
  );
}

export function moveFolderWithinParent(folders, folderId, direction, parentFolderId = '') {
  const siblings = parentFolderId ? findFolderById(folders, parentFolderId)?.children ?? [] : folders ?? [];
  const index = siblings.findIndex((folder) => folder.id === folderId);
  const targetIndex = index + direction;

  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
    return normalizeFolderList(folders);
  }

  const reordered = [...siblings];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

  if (!parentFolderId) {
    return normalizeFolderList(reordered);
  }

  return updateFolderById(folders, parentFolderId, (folder) => ({
    ...folder,
    children: reordered,
  }));
}

export function countNestedFolders(folders) {
  return (folders ?? []).reduce((total, folder) => total + 1 + countNestedFolders(folder.children), 0);
}

export function countNestedVideos(folders) {
  return (folders ?? []).reduce(
    (total, folder) => total + folder.videos.length + countNestedVideos(folder.children),
    0,
  );
}

export function folderResourceSummary(folder) {
  return {
    childFolders: folder.children?.length ?? 0,
    videos: folder.videos?.length ?? 0,
    pdfs: folder.pdfs?.length ?? 0,
    exams: folder.exams?.length ?? 0,
  };
}
