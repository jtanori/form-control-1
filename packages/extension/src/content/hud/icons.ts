const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(path: string, width = 18): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, 'svg');
  element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('width', String(width));
  element.setAttribute('height', String(width));
  element.setAttribute('fill', 'currentColor');
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('focusable', 'false');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  element.append(shape);
  return element;
}

export function micIcon(): SVGSVGElement {
  return svg(
    'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-2.08A7 7 0 0 0 19 12h-2Z',
  );
}
