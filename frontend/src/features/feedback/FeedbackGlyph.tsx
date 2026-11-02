/** The feedback glyph at an illustration size (the Icon primitive stops at 20 px). */
export function FeedbackGlyph({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="feedback"
    >
      <path d="M4 4h16v12H8l-4 4zM12 8v5M9.500 10.500h5" />
    </svg>
  );
}
