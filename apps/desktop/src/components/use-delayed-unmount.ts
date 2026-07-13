import { useEffect, useState } from "react";

export function useDelayedUnmount(open: boolean, exitDuration = 180) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }

    if (!mounted) return;
    const timeoutId = window.setTimeout(() => setMounted(false), exitDuration);
    return () => window.clearTimeout(timeoutId);
  }, [exitDuration, mounted, open]);

  return mounted;
}
