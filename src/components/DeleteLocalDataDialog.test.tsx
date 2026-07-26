import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteLocalDataDialog } from "./DeleteLocalDataDialog";

type Overrides = Partial<React.ComponentProps<typeof DeleteLocalDataDialog>>;

function renderDialog(overrides: Overrides = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteLocalDataDialog
      open
      pending={false}
      blocked={false}
      failures={[]}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm };
}

describe("DeleteLocalDataDialog", () => {
  test("shows an accessible title, description, category list, and sign-out disclosure", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/delete local data/i);
    expect(dialog).toHaveAccessibleDescription(/permanently/i);

    const categories = screen.getByRole("list", { name: /data.*deleted|deleted/i });
    const items = within(categories).getAllByRole("listitem");
    const text = items.map((item) => item.textContent ?? "").join(" ");
    expect(text).toMatch(/repository/i);
    expect(text).toMatch(/chunk/i);
    expect(text).toMatch(/embedding/i);
    expect(text).toMatch(/chat/i);
    expect(text).toMatch(/model cache/i);
    expect(text).toMatch(/provider setting/i);
    expect(text).toMatch(/preference/i);
    expect(text).toMatch(/log/i);

    expect(screen.getByText(/sign(ed)? out/i)).toBeVisible();
  });

  test("cancel triggers no deletion", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("confirm fires exactly once even when clicked repeatedly", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    const confirm = screen.getByRole("button", { name: /delete local data/i });
    await user.click(confirm);
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("disables confirm while pending with an accessible explanation", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ pending: true });

    const confirm = screen.getByRole("button", { name: /delete local data/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription(/progress/i);

    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("disables confirm when blocked with the provided reason as accessible explanation", () => {
    renderDialog({ blocked: true, blockReason: "Finish the active sync first." });

    const confirm = screen.getByRole("button", { name: /delete local data/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription(/finish the active sync first/i);
  });

  test("keeps the partial-failure list visible and accessible", () => {
    renderDialog({
      failures: [
        { category: "provider-settings", message: "cannot clear settings" },
        { category: "logs", message: "log handle busy" },
      ],
    });

    const alert = screen.getByRole("alert");
    expect(alert).toBeVisible();
    expect(within(alert).getByText(/cannot clear settings/i)).toBeVisible();
    expect(within(alert).getByText(/log handle busy/i)).toBeVisible();
    expect(within(alert).getByText(/provider setting/i)).toBeVisible();
  });
});
