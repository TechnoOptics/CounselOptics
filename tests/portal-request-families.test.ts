import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PORTAL_REQUEST_FAMILIES,
  REQUEST_TYPES,
  employeeRequestTypes,
  familyByKey,
  familyOfType,
  requestTypesForFamily,
} from '../lib/portal-request-families';

/*
 * The portal home offers four tiles and puts a count on each one. A
 * count is a claim, so these hold the claim up: every type an employee
 * can file lands in exactly one family, every family opens a form that
 * can actually file its own types, and the four tiles the owner named
 * are the four that exist, in the order they were named.
 */

describe('the four tiles are the four the owner named', () => {
  it('is exactly these four, in this order', () => {
    expect(PORTAL_REQUEST_FAMILIES.map((f) => f.title)).toEqual([
      'Internal request',
      'Contract review',
      'Legal request',
      'Legal drop box',
    ]);
  });

  it('gives each one a distinct key, code and title', () => {
    for (const field of ['key', 'code', 'title'] as const) {
      const values = PORTAL_REQUEST_FAMILIES.map((f) => f[field]);
      expect(new Set(values).size, `${field} is not unique`).toBe(
        values.length,
      );
    }
  });

  it('makes the mono chip the URL parameter, not decoration', () => {
    // The chip is the one place a reference number would go, and this
    // product does not issue one for an intake. So the chip shows the
    // handle that IS real: the `family` value the tile links with.
    for (const f of PORTAL_REQUEST_FAMILIES) {
      expect(f.code).toBe(f.key.toUpperCase());
      expect(familyByKey(f.key)).toBe(f);
    }
  });

  it('says something specific on every tile, in the product voice', () => {
    for (const f of PORTAL_REQUEST_FAMILIES) {
      expect(f.blurb.length, `${f.title} blurb`).toBeGreaterThan(60);
      expect(f.startLabel.length, `${f.title} start label`).toBeGreaterThan(5);
      // House rules: no em dashes, no emoji, anywhere including copy.
      for (const text of [f.title, f.blurb, f.startLabel]) {
        expect(text, `${f.title}: em dash`).not.toMatch(/[—–]/);
        expect(text, `${f.title}: non-latin glyph`).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });
});

describe('every tile has something real behind it', () => {
  it('covers only request types the intake form actually offers', () => {
    const filable = new Set(employeeRequestTypes().map((r) => r.value));
    for (const f of PORTAL_REQUEST_FAMILIES) {
      expect(f.types.length, `${f.title} has no types`).toBeGreaterThan(0);
      for (const t of f.types) {
        expect(
          filable.has(t),
          `${f.title} claims "${t}", which is not a type an employee can file`,
        ).toBe(true);
      }
    }
  });

  it('partitions every in-house type, so no open request goes uncounted', () => {
    // A type in no family is a request the tiles never mention, which
    // makes every count on the home page quietly short.
    const placed = PORTAL_REQUEST_FAMILIES.flatMap((f) => f.types);
    expect(new Set(placed).size, 'a type is in two families').toBe(
      placed.length,
    );
    expect([...placed].sort()).toEqual(
      employeeRequestTypes()
        .map((r) => r.value)
        .sort(),
    );
  });

  it('keeps outside-client matters out of the employee half entirely', () => {
    expect(employeeRequestTypes().every((r) => r.mode === 'inhouse')).toBe(true);
    expect(REQUEST_TYPES.some((r) => r.mode === 'client')).toBe(true);
    expect(
      PORTAL_REQUEST_FAMILIES.flatMap((f) => f.types),
    ).not.toContain('New case / matter');
  });

  it('reads a stored matter_type back to the tile that offered it', () => {
    for (const f of PORTAL_REQUEST_FAMILIES) {
      for (const t of f.types) expect(familyOfType(t)?.key).toBe(f.key);
    }
    // Anything else belongs to no tile, and says so rather than guessing.
    expect(familyOfType('New case / matter')).toBeNull();
    expect(familyOfType(null)).toBeNull();
    expect(familyOfType('  ')).toBeNull();
    expect(familyOfType('Something legal renamed')).toBeNull();
  });
});

describe('a tile link opens a form that can file that tile', () => {
  it('narrows the dropdown to the family, and never to nothing', () => {
    for (const f of PORTAL_REQUEST_FAMILIES) {
      const offered = requestTypesForFamily(f.key).map((r) => r.value);
      expect(offered.length, `${f.title} offers nothing`).toBeGreaterThan(0);
      expect([...offered].sort()).toEqual([...f.types].sort());
    }
  });

  it('keeps the dropdown in the canonical order, not the tile order', () => {
    // The order a person reads the types in is REQUEST_TYPES' order,
    // which is the order the form has always offered them. A family
    // lists its members for grouping, and that list is not a second
    // opinion about how they should be sorted.
    const canonical = employeeRequestTypes().map((r) => r.value);
    for (const f of PORTAL_REQUEST_FAMILIES) {
      const offered = requestTypesForFamily(f.key).map((r) => r.value);
      expect(offered).toEqual(canonical.filter((v) => offered.includes(v)));
    }
  });

  it('falls back to the full in-house list for an unknown family', () => {
    // The value comes off a query string. An unknown one must not
    // produce an empty dropdown, which would be a form that files
    // nothing.
    const all = employeeRequestTypes().map((r) => r.value);
    for (const bogus of ['', '   ', 'finance', null, undefined]) {
      expect(requestTypesForFamily(bogus).map((r) => r.value)).toEqual(all);
    }
  });
});

describe('the form and this module have not drifted apart', () => {
  it('is the only place the request types are written down', () => {
    // They used to live inside the client component, and a second copy
    // is how the tiles and the dropdown would come to disagree about
    // what an employee can file.
    const src = readFileSync(
      fileURLToPath(
        new URL('../app/counsel/intake/create-intake-form.tsx', import.meta.url),
      ),
      'utf8',
    );
    expect(src).toContain("from '@/lib/portal-request-families'");
    expect(
      src.includes('const REQUEST_TYPES'),
      'create-intake-form.tsx has its own REQUEST_TYPES again',
    ).toBe(false);
  });
});
