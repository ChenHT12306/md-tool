interface WailsApp {
  OpenFile(): Promise<{ path: string; content: string; name: string } | null>;
  OpenPath(path: string): Promise<{ path: string; content: string; name: string } | null>;
  GetStartupFile(): Promise<string>;
  SaveFile(content: string, currentPath: string): Promise<{ path: string; name: string } | null>;
  ExportFile(content: string, ext: string): Promise<void>;
}

interface Window {
  go?: {
    main?: {
      App?: WailsApp;
    };
  };
}
