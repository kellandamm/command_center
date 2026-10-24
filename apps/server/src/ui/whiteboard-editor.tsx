// @ts-nocheck — browser bundle entry; esbuild type-checks separately from server tsc.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";

declare global {
  interface Window {
    whiteboardEditor?: {
      loadScene: (scene: unknown) => void;
      getScene: () => unknown;
    };
  }
}

function sceneParts(scene: unknown) {
  const data = scene && typeof scene === "object" && !Array.isArray(scene)
    ? scene as { elements?: unknown; appState?: unknown; files?: unknown }
    : {};
  return {
    elements: Array.isArray(data.elements) ? data.elements : [],
    appState: data.appState && typeof data.appState === "object" && !Array.isArray(data.appState)
      ? data.appState as Record<string, unknown>
      : {},
    files: data.files && typeof data.files === "object" && !Array.isArray(data.files)
      ? data.files as Record<string, unknown>
      : {},
  };
}

function App() {
  const apiRef = useRef<{ updateScene: (scene: Record<string, unknown>) => void } | null>(null);
  const latest = useRef(sceneParts(null));

  useEffect(() => {
    window.whiteboardEditor = {
      loadScene: (scene) => {
        latest.current = sceneParts(scene);
        const api = apiRef.current;
        if (api) {
          api.updateScene({
            elements: latest.current.elements as never[],
            appState: latest.current.appState as never,
          });
        }
      },
      getScene: () => ({
        type: "excalidraw",
        version: 2,
        source: "command-center",
        elements: latest.current.elements,
        appState: latest.current.appState,
        files: latest.current.files,
      }),
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Excalidraw
        excalidrawAPI={(api) => { apiRef.current = api; }}
        initialData={latest.current}
        onChange={(elements, appState, files) => {
          latest.current = { elements, appState: appState as Record<string, unknown>, files };
          document.dispatchEvent(new CustomEvent("whiteboard:change"));
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            export: false,
          },
        }}
      />
    </div>
  );
}

const mount = document.getElementById("whiteboard-root");
if (mount) createRoot(mount).render(<App />);
