import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("CommandCanvas landing page", () => {
  it("introduces the product before entering a room", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /where meetings become the deliverable/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/voice, hand input, collaborators, and agents/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /everything happens on one living canvas/i,
      }),
    ).toBeInTheDocument();
  });

  it("routes the primary actions to usable product and source destinations", () => {
    render(<Home />);

    const navigation = screen.getByRole("navigation", {
      name: /primary navigation/i,
    });
    expect(
      within(navigation).getByRole("link", { name: /commandcanvas home/i }),
    ).toHaveAttribute("href", "/");
    expect(within(navigation).getByRole("link", { name: /^demo$/i })).toHaveAttribute(
      "href",
      "/demo",
    );

    const demoLinks = screen.getAllByRole("link", {
      name: /try the demo|launch demo/i,
    });
    expect(demoLinks).not.toHaveLength(0);
    for (const link of demoLinks) {
      expect(link).toHaveAttribute("href", "/demo");
    }

    expect(screen.getByRole("link", { name: /start a meeting/i })).toHaveAttribute(
      "href",
      "/meet",
    );
    expect(screen.getByRole("link", { name: /view repository/i })).toHaveAttribute(
      "href",
      "https://github.com/romiteld/commandcanvas",
    );
    expect(screen.getByRole("link", { name: /read the docs/i })).toHaveAttribute(
      "href",
      "https://github.com/romiteld/commandcanvas#readme",
    );
  });

  it("exposes meaningful landmarks and the four-step workflow", () => {
    const { container } = render(<Home />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByText("Voice creates objects")).toBeInTheDocument();
    expect(screen.getByText("Draw with your finger")).toBeInTheDocument();
    expect(screen.getByText("Collaborators join one room")).toBeInTheDocument();
    expect(screen.getByText("Agents act through tools")).toBeInTheDocument();
    expect(
      container.querySelectorAll("img[data-real-hand-capture]"),
    ).toHaveLength(2);
  });
});
