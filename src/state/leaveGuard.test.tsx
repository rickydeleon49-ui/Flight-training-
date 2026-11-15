// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { LeaveGuardProvider, useGuardedNavigate, useLeaveGuard } from "./leaveGuard";

function Page({ active }: { active: boolean }) {
  useLeaveGuard(active, "Leave this quiz?", "Your answers in this quiz are not kept.");
  const go = useGuardedNavigate();
  const { pathname } = useLocation();
  return (
    <div>
      <p data-testid="path">{pathname}</p>
      <button type="button" onClick={() => go("/elsewhere")}>go</button>
      <Link to="/other">plain</Link>
    </div>
  );
}
function mount(active: boolean) {
  return render(
    <MemoryRouter>
      <LeaveGuardProvider><Page active={active} /></LeaveGuardProvider>
    </MemoryRouter>,
  );
}
afterEach(cleanup);

describe("leave guard", () => {
  it("navigates at once with no guard", () => {
    mount(false);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByTestId("path").textContent).toBe("/elsewhere");
    expect(screen.queryByText("Leave this quiz?")).toBeNull();
  });

  it("asks first with a guard: Keep going stays, Leave navigates", () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Leave this quiz?")).toBeTruthy();
    expect(screen.getByTestId("path").textContent).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.getByTestId("path").textContent).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByTestId("path").textContent).toBe("/elsewhere");
  });
});
