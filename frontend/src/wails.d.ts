interface WailsApp {
  OpenFile(): Promise<{ path: string; content: string; name: string } | null>;
  OpenPath(path: string): Promise<{ path: string; content: string; name: string } | null>;
  OpenInNewWindow(path: string, content: string): Promise<void>;
  GetStartupFile(): Promise<string>;
  GetPid(): Promise<number>;
  RegisterWindow(x: number, y: number, w: number, h: number): Promise<void>;
  GetWindows(): Promise<Array<{ pid: number; uid: string; x: number; y: number; w: number; h: number }>>;
  UnregisterWindow(): Promise<void>;
  SendTabToWindow(targetUid: string, path: string, content: string): Promise<void>;
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
