"use client";

import { SWRConfig } from "swr";
import { Toaster } from "sonner";

// 全局 Provider：统一 SWR 默认策略与消息提示容器。
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
