import { z } from 'zod';
import { AmmoBoxItemSchema } from './ammo-box.js';
import { AmmoItemSchema } from './ammo.js';
import { ClothingItemSchema } from './clothing.js';
import { ContainerItemSchema } from './container.js';
import { DrinkItemSchema } from './drink.js';
import { FoodItemSchema } from './food.js';
import { LiteratureItemSchema } from './literature.js';
import { MagazineItemSchema } from './magazine.js';
import { LureItemSchema } from './lure.js';
import { MaterialItemSchema } from './material.js';
import { MedicalItemSchema } from './medical.js';
import { MiscItemSchema } from './misc.js';
import { PlaceableItemSchema } from './placeable.js';
import { ToolItemSchema } from './tool.js';
import { WeaponMeleeItemSchema } from './weapon-melee.js';
import { WeaponRangedItemSchema } from './weapon-ranged.js';

/** Każdy przedmiot: unia rozróżniana po `kind`. */
export const ItemSchema = z.discriminatedUnion('kind', [
  WeaponMeleeItemSchema,
  WeaponRangedItemSchema,
  AmmoItemSchema,
  AmmoBoxItemSchema,
  MagazineItemSchema,
  FoodItemSchema,
  DrinkItemSchema,
  ContainerItemSchema,
  ClothingItemSchema,
  MedicalItemSchema,
  ToolItemSchema,
  LiteratureItemSchema,
  MaterialItemSchema,
  PlaceableItemSchema,
  LureItemSchema,
  MiscItemSchema,
]);

export type Item = z.infer<typeof ItemSchema>;
export type ItemKind = Item['kind'];
export const ITEM_KINDS: ItemKind[] = ItemSchema.options.map((o) => o.shape.kind.value);
