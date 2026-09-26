export interface Document {
  id: string;
  title: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  /** Folder segments under workspace, e.g. "Research / Notes" */
  folderPath?: string;
  workspaceId?: string | null;
  /** Set when the note is a row of a database. */
  databaseId?: string | null;
  tags?: string[];
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  isPublic: boolean;
  createdAt?: string;
}

export interface ConnectionContext {
  userId: string;
  docId: string;
  clientId: string;
  connectedAt: number;
  isAlive: boolean;
  isOfflineClient: boolean;
}
