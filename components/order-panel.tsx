"use client";

import { useEffect } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import useSWRMutation from "swr/mutation";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { submitOrder } from "@/lib/api";
import { useMidPrice } from "@/lib/hooks";
import { normalizePrice, normalizeSize } from "@/lib/number";
import type { MarketId, OrderPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

const orderSchema = z.object({
  side: z.enum(["buy", "sell"]),
  price: z.coerce.number().positive("价格必须大于 0"),
  size: z.coerce.number().positive("数量必须大于 0")
});

type OrderFormValues = z.infer<typeof orderSchema>;

export function OrderPanel({ marketId }: { marketId: MarketId }): React.ReactElement {
  const midPrice = useMidPrice();

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      side: "buy",
      price: 0,
      size: 0.01
    }
  });

  const { trigger, isMutating } = useSWRMutation(
    `submit-order:${marketId}`,
    async (_key: string, { arg }: { arg: OrderPayload }) => submitOrder(arg)
  );

  useEffect(() => {
    if (!midPrice) {
      return;
    }

    // 首次进入时如果价格为空，用当前中间价作为默认参考。
    if (form.getValues("price") <= 0) {
      form.setValue("price", Number(midPrice.toFixed(2)));
    }
  }, [form, midPrice]);

  async function onSubmit(values: OrderFormValues): Promise<void> {
    const payload: OrderPayload = {
      marketId,
      side: values.side,
      type: "limit",
      price: normalizePrice(values.price),
      size: normalizeSize(values.size)
    };

    // 提交期间统一由 toast 展示 loading/success/error。
    await toast.promise(trigger(payload), {
      loading: `Submitting ${payload.side} order...`,
      success: (response) =>
        `Order accepted${response.orderId ? ` · ${String(response.orderId)}` : ""}`,
      error: (error) => (error instanceof Error ? error.message : "Order rejected")
    });
  }

  return (
    <Panel
      eyebrow="Execution"
      title="Mock Order Entry"
      description="使用 zod + react-hook-form 做输入校验，并通过 sonner 提示状态。"
    >
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-3">
          {(["buy", "sell"] as const).map((side) => {
            const active = form.watch("side") === side;

            return (
              <button
                key={side}
                type="button"
                className={cn(
                  "rounded-3xl border px-4 py-3 text-sm font-semibold transition",
                  active && side === "buy" && "border-emerald-400 bg-emerald-50 text-emerald-900",
                  active && side === "sell" && "border-amber-400 bg-amber-50 text-amber-900",
                  !active && "border-slate-200 bg-white text-slate-700"
                )}
                onClick={() => {
                  form.setValue("side", side);
                }}
              >
                {side.toUpperCase()}
              </button>
            );
          })}
        </div>

        <Field
          label="Market"
          hint="题面要求使用 SMFS 原生 marketId。"
          input={
            <input
              readOnly
              value={marketId}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-slate-700"
            />
          }
        />

        <Field
          label="Price"
          hint={midPrice ? `Best mid: ${midPrice.toFixed(2)}` : "Waiting for book..."}
          error={form.formState.errors.price?.message}
          input={
            <input
              type="number"
              step="0.01"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4"
              {...form.register("price", { valueAsNumber: true })}
            />
          }
        />

        <Field
          label="Size"
          hint="使用 bignumber.js 归一化精度。"
          error={form.formState.errors.size?.message}
          input={
            <input
              type="number"
              step="0.001"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4"
              {...form.register("size", { valueAsNumber: true })}
            />
          }
        />

        <Button
          type="submit"
          disabled={isMutating}
          className="cursor-pointer h-12 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
        >
          {isMutating ? "Submitting..." : "Submit Limit Order"}
        </Button>
      </form>
    </Panel>
  );
}

function Field({
  label,
  hint,
  error,
  input
}: {
  label: string;
  hint: string;
  error?: string;
  input: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="grid gap-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="break-all text-xs text-slate-500 sm:text-right">{error ?? hint}</span>
      </div>
      {input}
    </label>
  );
}
