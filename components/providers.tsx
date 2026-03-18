"use client";

import { SWRConfig } from "swr";
import { Toaster } from "sonner";

// Global provider: centralize SWR defaults and toast container.
export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: true
      }}
    >
      {children}
      <Toaster position="top-right" richColors closeButton />
    </SWRConfig>
  );
}
