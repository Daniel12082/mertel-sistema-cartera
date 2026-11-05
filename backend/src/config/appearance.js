export const APPEARANCE_KEY = 'visual_appearance';
export const MAX_LOGO_BYTES = 20 * 1024;
export const DEFAULT_APPEARANCE = Object.freeze({
  name: 'MERTEL', description: 'Sistema de gestión de cartera',
  logo: null, compactLogo: null,
  colors: Object.freeze({primary: '#070707', accent: '#e43134', sidebar: '#070707', background: '#f4f3f0', surface: '#ffffff', text: '#111318'}),
});
export function contrastRatio(a, b) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function foregroundFor(background) {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000') ? '#ffffff' : '#000000';
}
