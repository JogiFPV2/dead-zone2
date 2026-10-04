import { z } from 'zod';
import {
  CapacityKgSchema,
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  TagListSchema,
} from './common/index.js';

/** Strona drzwi miejsca: `left` = lewa burta (patrząc w kierunku jazdy), `right` = prawa. */
export const VEHICLE_DOOR_SIDES = ['left', 'right'] as const;
export type VehicleDoorSide = (typeof VEHICLE_DOOR_SIDES)[number];

const Metres = z.number().positive().max(30);

/**
 * Miejsce w pojeździe. Pierwsze miejsce na liście to kierowca. `offset` w metrach od środka
 * auta: `x` do przodu, `y` w prawo. Wsiada się i wysiada drzwiami po stronie `doorSide`.
 */
export const VehicleSeatSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id: kebab-case'),
  doorSide: z.enum(VEHICLE_DOOR_SIDES),
  offset: z.strictObject({ x: z.number().min(-15).max(15), y: z.number().min(-5).max(5) }),
});

/**
 * Typ pojazdu (sim `vehicles/*`). Wymiary w metrach (1 kafel = 1 m), masa w kg, moc w kW,
 * prędkość w m/s, paliwo w litrach, spalanie w l/s przy pełnym gazie (na biegu jałowym 10 %).
 * Hitbox to prostokąt `length` × `width`. Bagażnik i schowek to pojemności w kg (kontenery
 * tworzy Symulacja).
 */
export const VehicleTypeSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    tags: TagListSchema,
    length: Metres,
    width: Metres,
    /** Rozstaw osi i kół. */
    wheelbase: Metres,
    track: Metres,
    wheelRadius: z.number().positive().max(2),
    mass: z.number().min(100).max(40000),
    enginePower: z.number().positive().max(2000),
    maxSpeed: z.number().positive().max(100),
    fuelMax: z.number().positive().max(2000),
    consumption: z.number().min(0).max(1),
    seats: z.array(VehicleSeatSchema).min(1).max(16),
    trunkCapacity: CapacityKgSchema.default(0),
    gloveboxCapacity: CapacityKgSchema.default(0),
    model: z.string().optional(),
    ext: ExtSchema,
  })
  .superRefine((v, ctx) => {
    if (v.wheelbase >= v.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'wheelbase musi być mniejszy niż length',
        path: ['wheelbase'],
      });
    }
    if (v.track >= v.width) {
      ctx.addIssue({
        code: 'custom',
        message: 'track musi być mniejszy niż width',
        path: ['track'],
      });
    }
    const ids = new Set<string>();
    v.seats.forEach((s, i) => {
      if (ids.has(s.id))
        ctx.addIssue({
          code: 'custom',
          message: `miejsce ${s.id} dwa razy`,
          path: ['seats', i, 'id'],
        });
      ids.add(s.id);
      if (Math.abs(s.offset.x) > v.length / 2 || Math.abs(s.offset.y) > v.width / 2) {
        ctx.addIssue({
          code: 'custom',
          message: `miejsce ${s.id} poza autem`,
          path: ['seats', i, 'offset'],
        });
      }
    });
  });

export type VehicleSeat = z.infer<typeof VehicleSeatSchema>;
export type VehicleType = z.infer<typeof VehicleTypeSchema>;
