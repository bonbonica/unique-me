"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

// `useSyncExternalStore` returns the server-snapshot during SSR and the
// client-snapshot after hydration. We use it as a hydration-safe mount
// signal: `false` on the server and on the first client render, `true`
// afterwards. This avoids the `useEffect` + `setState` pattern that the
// `react-hooks/set-state-in-effect` lint rule (now shipping in
// `eslint-config-next`) rightly flags.
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hasMounted = useHasMounted();

  // Until the client has mounted we render a static, inert button with a
  // stable `aria-label`. Crucially this is the SAME markup the server
  // emitted, so React's hydration pass finds an exact match. Once
  // hydration completes `hasMounted` flips to `true` and we re-render
  // with the real theme-aware label/icon — that re-render happens after
  // hydration so it doesn't trip the mismatch warning.
  if (!hasMounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        disabled
      >
        <Sun className="size-5" aria-hidden="true" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </Button>
  );
}
