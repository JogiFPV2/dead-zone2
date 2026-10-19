import {
  Box3,
  Group,
  Mesh,
  Vector3,
  type AnimationClip,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { AssetLoader } from '../assets/loader.js';

let sharedKtx2: KTX2Loader | undefined;

/**
 * One KTX2Loader (transcoder workers) for the whole page: menu, creator and game renderers all
 * run on the same GPU, so the first renderer's format detection holds for the others.
 */
export function ktx2For(renderer: WebGLRenderer): KTX2Loader {
  sharedKtx2 ??= new KTX2Loader()
    .setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
    .detectSupport(renderer);
  return sharedKtx2;
}

/** Asset loader with the shared KTX2Loader. */
export const createAssetLoader = (renderer: WebGLRenderer): AssetLoader =>
  new AssetLoader({ renderer, ktx2: ktx2For(renderer) });

/** Container / furniture content id → model asset id (CC0 packs, see ASSETS.md). */
export const CONTAINER_MODELS: Record<string, string> = {
  'base:fridge': 'kenney-furniture/fridge',
  'base:freezer': 'kenney-furniture/fridge-small',
  'base:kitchen-cabinet': 'kenney-furniture/kitchen-cabinet',
  'base:kitchen-counter': 'kenney-furniture/kitchen-cabinet-drawer',
  'base:wardrobe': 'kenney-furniture/bookcase-closed-doors',
  'base:dresser': 'kenney-furniture/cabinet-bed-drawer',
  'base:bookshelf': 'kenney-furniture/bookcase-open',
  'base:wooden-chest': 'kenney-survival/chest',
  'base:crate': 'kenney-survival/box-large',
  // Designer's real-scale models (1 m = 1 tile, origin = footprint centre, back to the wall at
  // -z): loaded as authored (`isRealScale`, `REAL_SCALE_FURNITURE`), never fit by height.
  'base:metal-shelf': 'deadzone-furniture/metal-shelf',
  'base:bed': 'deadzone-furniture/bed',
  'base:double-bed': 'deadzone-furniture/double-bed',
  'base:sofa': 'deadzone-furniture/sofa',
  'base:desk': 'deadzone-furniture/desk',
  'base:shop-counter': 'deadzone-furniture/shop-counter',
  'base:oven': 'deadzone-furniture/oven',
  'base:gas-stove': 'deadzone-furniture/gas-stove',
  'base:fridge-freezer': 'deadzone-furniture/fridge-freezer',
  'base:tv-stand': 'deadzone-furniture/tv-stand',
  'base:bathroom-cabinet': 'deadzone-furniture/bathroom-cabinet',
  'base:range': 'deadzone-furniture/range',
  'base:kitchen-sink': 'deadzone-furniture/kitchen-sink',
  'base:bathroom-sink': 'deadzone-furniture/bathroom-sink',
  'base:bathtub': 'deadzone-furniture/bathtub',
  'base:shower': 'deadzone-furniture/shower',
  'base:vcr': 'deadzone-furniture/vcr',
  'base:radio-set': 'deadzone-furniture/radio-set',
  'base:tool-chest': 'kenney-survival/box',
  'base:locker': 'kenney-furniture/bookcase-closed',
  'base:gun-locker': 'kenney-furniture/bookcase-closed',
  // #254 (Kenney Furniture Kit, CC0) until Designer's real-scale models.
  'base:table': 'kenney-furniture/table',
  'base:chair': 'kenney-furniture/chair',
  'base:floor-lamp': 'kenney-furniture/lamp-round-floor',
  'base:desk-lamp': 'kenney-furniture/lamp-round-table',
  'base:ceiling-lamp': 'kenney-furniture/lamp-square-ceiling',
  'base:toilet': 'kenney-furniture/toilet',
};
export const PILE_MODEL = 'kenney-furniture/cardboard-box-closed';
export const PLAYER_MODEL = 'quaternius-characters/casual';
export const ZOMBIE_MODELS = ['quaternius-characters/worker', 'quaternius-characters/hoodie'];

export interface CharacterTemplate {
  load(): Promise<{ object: Object3D; clips: AnimationClip[] }>;
}

/**
 * Loaded models for the world. Static models are loaded once and cloned; characters are
 * cloned with their skeleton per instance. Missing models → undefined (grey placeholders stay).
 */
export class ModelKit {
  private readonly statics = new Map<string, Object3D>();

  private constructor(private readonly loader: AssetLoader) {}

  static async create(renderer: WebGLRenderer): Promise<ModelKit | undefined> {
    try {
      const loader = createAssetLoader(renderer);
      await loader.loadManifest();
      const kit = new ModelKit(loader);
      const ids = new Set([...Object.values(CONTAINER_MODELS), PILE_MODEL]);
      await Promise.all(
        [...ids].map(async (id) => {
          try {
            const o = await loader.loadLevel(id, 0);
            o.traverse((m) => {
              if (m instanceof Mesh) m.castShadow = m.receiveShadow = true;
            });
            kit.statics.set(id, o);
          } catch (e) {
            console.warn(`model ${id}`, e);
          }
        }),
      );
      return kit;
    } catch (e) {
      console.warn('models unavailable, placeholders stay', e);
      return undefined;
    }
  }

  /**
   * Clone of a static model scaled so its height is `height` (world units), centred on x/z with
   * its base at y = 0. Without `height`: a real-scale model (Designer, 1 m = 1 world unit) as
   * authored, neither scaled nor re-centred: its origin is the footprint centre with the
   * back-to-wall offset baked in (`fitted` would erase that offset).
   */
  staticModel(id: string, height?: number): Object3D | undefined {
    const src = this.statics.get(id);
    if (!src) return undefined;
    if (height === undefined) {
      const wrap = new Group();
      wrap.add(src.clone());
      return wrap;
    }
    return fitted(src.clone(), height);
  }

  /** Animated model as loaded (skeleton cloned, no fit): the caller scales / bakes it. */
  animated(id: string): Promise<{ object: Object3D; clips: AnimationClip[] }> {
    return this.loader.loadAnimated(id);
  }

  character(id: string, height: number): Promise<{ object: Object3D; clips: AnimationClip[] }> {
    return this.loader.loadAnimated(id).then(({ object, clips }) => {
      object.traverse((m) => {
        if (m instanceof Mesh) {
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
      return { object: fitted(object, height), clips };
    });
  }
}

const box = new Box3();
const size = new Vector3();
const centre = new Vector3();

/** Wraps `o` so its bounding box has height `height`, base at 0, centred on x/z. */
export function fitted(o: Object3D, height: number): Object3D {
  o.updateMatrixWorld(true);
  box.setFromObject(o);
  box.getSize(size);
  box.getCenter(centre);
  const s = size.y > 0 ? height / size.y : 1;
  o.scale.multiplyScalar(s);
  o.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
  const wrap = new Group();
  wrap.add(o);
  return wrap;
}
