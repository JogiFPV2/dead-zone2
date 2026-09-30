import { colors } from '@deadzone/ui';
const title = 'Deadzone';
const tagline = 'Przeżyj jak najwięcej dni.';

export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        background: colors.background,
        color: colors.text,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ color: colors.accent, margin: 0 }}>{title}</h1>
      <p>{tagline}</p>
    </main>
  );
}
