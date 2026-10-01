declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  export const MeshoptSimplifier: {
    readonly ready: Promise<void>;
    simplify(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: readonly ('LockBorder' | 'Sparse' | 'ErrorAbsolute')[],
    ): [indices: Uint32Array, error: number];
    simplifySloppy(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      vertexLock: Uint8Array | null,
      targetIndexCount: number,
      targetError: number,
    ): [indices: Uint32Array, error: number];
  };
}
