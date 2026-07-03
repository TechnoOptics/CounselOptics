export type ProjectStatus = 'active' | 'archived';

export type Project = {
  id: string;
  firmId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFolder = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
};

export type ProjectItemKind = 'note' | 'document';

export type ProjectItem = {
  id: string;
  projectId: string;
  folderId: string | null;
  kind: ProjectItemKind;
  title: string;
  noteBody: string | null;
  storagePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  archived: boolean;
  createdAt: string;
};
