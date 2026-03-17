import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

describe("ui components", () => {
  it("renders Button with default data attributes", () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveAttribute("data-size", "default");
  });

  it("renders Panel metadata and content", () => {
    render(
      <Panel eyebrow="Info" title="Panel Title" description="Panel Desc">
        <div>Panel Body</div>
      </Panel>
    );

    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Panel Title" })).toBeInTheDocument();
    expect(screen.getByText("Panel Desc")).toBeInTheDocument();
    expect(screen.getByText("Panel Body")).toBeInTheDocument();
  });

  it("renders Tabs and visible content", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>
    );

    expect(screen.getByRole("tab", { name: "A" })).toBeInTheDocument();
    expect(screen.getByText("Content A")).toBeInTheDocument();
  });

  it("renders Tooltip trigger and content text", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Hover me</button>
          </TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.getByRole("button", { name: "Hover me" })).toBeInTheDocument();
  });
});
