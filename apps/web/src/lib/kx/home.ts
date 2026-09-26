export interface HomeData {
  counts: {
    notes: number;
    links: number;
    files: number;
    databases: number;
    tags: number;
  };
  recent: {
    id: string;
    title: string;
    updatedAt: number;
    folderPath: string;
    isRow: boolean;
    tags: string[];
    snippet: string;
  }[];
  suggestions: {
    a: string;
    b: string;
    aTitle: string;
    bTitle: string;
    score: number;
  }[];
  databases: { id: string; name: string; icon: string; rowCount: number }[];
}
