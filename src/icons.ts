export const icon = (name: string, size = 24) => {
  const paths: Record<string,string> = {
    leaf:'<path d="M20 4C9 3 3 9 5 15s13 6 15-11Z"/><path d="m4 21 12-13M9 15v-5m0 5h5"/>',
    paw:'<ellipse cx="12" cy="16" rx="6" ry="4.5"/><ellipse cx="5.3" cy="9" rx="2" ry="2.7"/><ellipse cx="10" cy="5.7" rx="2" ry="2.7"/><ellipse cx="15" cy="5.7" rx="2" ry="2.7"/><ellipse cx="19" cy="9.5" rx="2" ry="2.7"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    coin:'<circle cx="12" cy="12" r="9"/><path d="M14.5 8H11a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9.5m2.5-9v10"/>',
    puzzle:'<rect x="4" y="4" width="6" height="6" rx="1.8"/><rect x="14" y="4" width="6" height="6" rx="1.8"/><rect x="4" y="14" width="6" height="6" rx="1.8"/><rect x="14" y="14" width="6" height="6" rx="1.8"/>',
    home:'<path d="m3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
    settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    shuffle:'<path d="m17 3 4 4-4 4M3 5c7 0 7 14 14 14h4m-4-4 4 4-4 4M3 19c7 0 7-12 14-12h4"/>',
    restart:'<path d="M3 10a9 9 0 1 1 1 7M3 3v7h7"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    check:'<path d="m5 12 4 4 10-10"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    volume:'<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    flower:'<path d="M12 7c-5-9-12-2-6 3-9 3-4 12 2 7 0 10 10 10 9 1 8 5 12-4 4-7 6-6-2-12-7-5Z"/><circle cx="12" cy="12" r="3"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.leaf}</svg>`;
};
