export type Normalised =
  { ok: true; value: string } | { ok: false; error: 'VALUE_INVALID'; message: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME_24 = /^(\d{1,2}):(\d{2})$/;

function invalid(message: string): Normalised {
  return { ok: false, error: 'VALUE_INVALID', message };
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Normalise a raw spoken/generated value for a control type.
 * Single source of truth shared by the Hands, the testbed and the eval suite.
 */
export function normaliseValue(type: string, raw: string): Normalised {
  switch (type.toLowerCase()) {
    case 'email': {
      const trimmed = raw.trim();
      if (/\s/.test(trimmed)) return invalid('Email addresses cannot contain spaces');
      const at = trimmed.lastIndexOf('@');
      if (at <= 0 || at === trimmed.length - 1) return invalid('Email address is missing a domain');
      const local = trimmed.slice(0, at);
      const domain = trimmed.slice(at + 1).toLowerCase();
      return { ok: true, value: `${local}@${domain}` };
    }
    case 'number': {
      const compact = raw.replace(/[,\s]/g, '');
      if (!/^[-+]?\d*\.?\d+$/.test(compact)) return invalid('Not a number');
      const parsed = Number(compact);
      if (!Number.isFinite(parsed)) return invalid('Not a finite number');
      return { ok: true, value: String(parsed) };
    }
    case 'tel': {
      const plus = raw.trim().startsWith('+');
      const digits = raw.replace(/[^\d]/g, '');
      if (!digits) return invalid('Phone number has no digits');
      return { ok: true, value: `${plus ? '+' : ''}${digits}` };
    }
    case 'date': {
      const trimmed = raw.trim();
      const iso = ISO_DATE.exec(trimmed);
      if (iso) {
        const year = Number(iso[1]);
        const month = Number(iso[2]);
        const day = Number(iso[3]);
        if (!validDate(year, month, day)) return invalid('Invalid calendar date');
        return { ok: true, value: trimmed };
      }
      const us = US_DATE.exec(trimmed);
      if (us) {
        const month = Number(us[1]);
        const day = Number(us[2]);
        const year = Number(us[3]);
        if (!validDate(year, month, day)) return invalid('Invalid calendar date');
        return {
          ok: true,
          value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        };
      }
      return invalid('Dates must be YYYY-MM-DD or MM/DD/YYYY');
    }
    case 'time': {
      const match = TIME_24.exec(raw.trim());
      if (!match) return invalid('Times must be HH:MM (24h)');
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return invalid('Time out of range');
      return {
        ok: true,
        value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      };
    }
    case 'url': {
      const trimmed = raw.trim();
      if (!trimmed) return invalid('URL is empty');
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return { ok: true, value: trimmed };
      return { ok: true, value: `https://${trimmed}` };
    }
    default:
      return { ok: true, value: raw };
  }
}

/** Normalise using the element's own native type. */
export function normaliseForElement(el: HTMLElement, raw: string): Normalised {
  if (el.tagName === 'TEXTAREA') return { ok: true, value: raw };
  const contenteditable = el.getAttribute('contenteditable');
  if (el.isContentEditable === true || contenteditable === '' || contenteditable === 'true') {
    return { ok: true, value: raw };
  }
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    const normalisable = new Set(['email', 'number', 'tel', 'date', 'time', 'url']);
    if (normalisable.has(type)) return normaliseValue(type, raw);
  }
  return { ok: true, value: raw };
}
