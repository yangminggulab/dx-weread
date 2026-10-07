// CSS variables are generated from theme.json for both Tailwind and inline charts.
export const themeColor = (name, opacity = 1) => `rgb(var(--color-${name}) / ${opacity})`;
