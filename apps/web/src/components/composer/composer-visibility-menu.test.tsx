// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerVisibilityMenu } from "./composer-visibility-menu";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ComposerVisibilityMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    { visibility: "private", target: "team", expected: "protected" },
    { visibility: "protected", target: "personal", expected: "private" },
    { visibility: "private", target: "personal", expected: null },
    { visibility: "protected", target: "team", expected: null },
  ] as const)(
    "clicking $target while $visibility only changes a different target",
    async ({ visibility, target, expected }) => {
      const onVisibilityChange = vi.fn();
      await act(async () => {
        root.render(
          <ComposerVisibilityMenu
            showVisibility
            visibility={visibility}
            isPending={false}
            isUploadingImages={false}
            canSubmit
            voiceActive={false}
            onVisibilityChange={onVisibilityChange}
          />,
        );
      });

      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-label="composer.visibility.aria"]',
      );
      if (!trigger) throw new Error("Visibility menu trigger was not rendered");
      await act(async () => trigger.click());

      const item = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find(
        (element) => element.textContent === `composer.visibility.${target}`,
      );
      if (!item)
        throw new Error(`Visibility option ${target} was not rendered`);
      await act(async () => item.click());

      if (expected === null) {
        expect(onVisibilityChange).not.toHaveBeenCalled();
      } else {
        expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(expected);
      }
    },
  );
});
