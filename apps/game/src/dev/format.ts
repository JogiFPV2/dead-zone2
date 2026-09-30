export interface FrameStats {
  fps: number;
  calls: number;
  triangles: number;
}

export function formatStats({ fps, calls, triangles }: FrameStats): string {
  return `${fps.toFixed(0)} fps · ${calls} draw calls · ${triangles.toLocaleString('en-US')} tris`;
}
