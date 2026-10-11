import type { Item } from '../../schemas/item/item.js';
import type { RefList } from './ref-collector.js';

/** Wszystkie referencje z przedmiotu, zależnie od `kind`. */
export function collectItemRefs(item: Item, r: RefList): void {
  r.add('item', item.throwable?.brokenInto, 'throwable', 'brokenInto');
  r.add('skill', item.improvisedWeapon?.skill, 'improvisedWeapon', 'skill');
  switch (item.kind) {
    case 'weapon_melee':
      r.add('skill', item.melee.skill, 'melee', 'skill');
      r.add('item', item.melee.durability.brokenInto, 'melee', 'durability', 'brokenInto');
      break;
    case 'weapon_ranged':
      r.add('skill', item.ranged.skill, 'ranged', 'skill');
      r.add('item', item.ranged.ammo, 'ranged', 'ammo');
      if (item.ranged.feed.type === 'magazine')
        r.add('item', item.ranged.feed.magazine, 'ranged', 'feed', 'magazine');
      r.add('item', item.ranged.durability.brokenInto, 'ranged', 'durability', 'brokenInto');
      break;
    case 'ammo_box':
      r.add('item', item.ammoBox.ammo, 'ammoBox', 'ammo');
      break;
    case 'magazine':
      r.add('item', item.magazine.ammo, 'magazine', 'ammo');
      break;
    case 'food':
      r.add('item', item.food.openedInto, 'food', 'openedInto');
      r.add('item', item.food.cooking?.cookedInto, 'food', 'cooking', 'cookedInto');
      r.add('item', item.food.emptyInto, 'food', 'emptyInto');
      r.add('item', item.food.spoilage?.rottenInto, 'food', 'spoilage', 'rottenInto');
      if (item.food.openWith) r.tags.push({ tag: item.food.openWith, path: ['food', 'openWith'] });
      break;
    case 'drink':
      r.add('item', item.drink.emptyInto, 'drink', 'emptyInto');
      r.add('item', item.drink.spoilage?.rottenInto, 'drink', 'spoilage', 'rottenInto');
      break;
    case 'medical':
      r.add('item', item.medical.usedInto, 'medical', 'usedInto');
      r.add('skill', item.medical.requires?.skill, 'medical', 'requires', 'skill');
      break;
    case 'clothing':
      r.add('item', item.clothing.durability?.brokenInto, 'clothing', 'durability', 'brokenInto');
      break;
    case 'tool':
      r.add('item', item.tool.durability?.brokenInto, 'tool', 'durability', 'brokenInto');
      break;
    case 'literature':
      r.add('skill', item.literature.skillBook?.skill, 'literature', 'skillBook', 'skill');
      r.many('recipe', item.literature.unlocksRecipes, 'literature', 'unlocksRecipes');
      break;
    case 'placeable':
      r.add('containerType', item.placeable.containerType, 'placeable', 'containerType');
      r.add('station', item.placeable.station?.id, 'placeable', 'station', 'id');
      if (item.placeable.powerSource) {
        const tag = item.placeable.powerSource.fuelTag;
        r.tags.push({ tag, path: ['placeable', 'powerSource', 'fuelTag'] });
      }
      break;
    case 'vhs':
      item.vhs.skills.forEach((s, i) => r.add('skill', s.skill, 'vhs', 'skills', i, 'skill'));
      break;
    case 'lure':
      if (item.lure.trigger.type === 'remote')
        r.tags.push({ tag: item.lure.trigger.remoteTag, path: ['lure', 'trigger', 'remoteTag'] });
      if (item.lure.power)
        r.tags.push({ tag: item.lure.power.batteryTag, path: ['lure', 'power', 'batteryTag'] });
      break;
    case 'ammo':
    case 'container':
    case 'material':
    case 'misc':
      break;
  }
}
