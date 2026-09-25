import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { PRODUCT } from "@/config/product";

const renderLockup = (props = {}) =>
  render(
    <MemoryRouter>
      <BrandLockup {...props} />
    </MemoryRouter>,
  );

describe("BrandLockup", () => {
  it("announces the brand name as one string, not as two tones", () => {
    renderLockup();
    expect(screen.getByText("VivaahVarnam")).toBeInTheDocument();
    expect(screen.getByText("VivaahVarnam").textContent).toBe(PRODUCT.name);
  });

  it("keeps the visible two-tone split decorative", () => {
    const { container } = renderLockup();
    const halves = Array.from(container.querySelectorAll('[aria-hidden="true"]'));
    expect(halves.map((node) => node.textContent)).toEqual(["Vivaah", "Varnam"]);
  });

  it("adds the descriptor and status only in the full variant", () => {
    renderLockup({ variant: "full" });
    expect(screen.getByText(`${PRODUCT.descriptor} · ${PRODUCT.status}`)).toBeInTheDocument();
  });

  it("links when a destination is given and stays text when it is not", () => {
    renderLockup({ to: "/dashboard" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard");
  });

  it("renders no interactive role without a destination", () => {
    renderLockup();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
