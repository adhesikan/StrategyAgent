// Renders a string with directional bias words highlighted: any occurrence of
// "bullish" is shown in green and "bearish" in red (case-preserving), so
// opportunity headlines and rationale lines telegraph direction at a glance.
// Works in both themes via dark: variants matching the app's emerald/rose
// convention (green = bullish/positive, red = bearish/negative).
const BIAS_WORD_RE = /(bullish|bearish)/gi;

export function BiasText({ text }: { text: string }) {
  const parts = text.split(BIAS_WORD_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const lower = part.toLowerCase();
        if (lower === "bullish") {
          return (
            <span key={i} className="text-green-600 dark:text-green-400 font-semibold">
              {part}
            </span>
          );
        }
        if (lower === "bearish") {
          return (
            <span key={i} className="text-red-600 dark:text-red-400 font-semibold">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
