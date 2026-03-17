"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-start rounded-2xl border border-slate-200/80 bg-white/85 p-1 text-slate-500 shadow-sm backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden group-data-horizontal/tabs:min-h-10 group-data-horizontal/tabs:w-full group-data-horizontal/tabs:max-w-full group-data-horizontal/tabs:overflow-x-auto group-data-horizontal/tabs:overflow-y-hidden group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col [&>[data-slot=tabs-trigger]]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        line: "gap-1 rounded-2xl border border-slate-200/80 bg-white/85"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-slate-500 transition-all duration-200 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "hover:bg-slate-100/80 hover:text-slate-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-1",
        "data-active:border-slate-900 data-active:bg-slate-900 data-active:text-white data-active:shadow-[0_6px_18px_rgba(15,23,42,0.22)]",
        "data-active:hover:border-slate-900 data-active:hover:bg-slate-900 data-active:hover:text-white data-active:hover:shadow-[0_6px_18px_rgba(15,23,42,0.22)]",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
