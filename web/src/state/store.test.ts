import { describe, expect, it } from "vitest";
import { useStudioStore } from "./store";

describe("Multi-tab Zustand studio store", () => {
  it("supports creating, switching, and closing tabs independently", () => {
    const store = useStudioStore.getState();
    const initialCount = store.tabs.length;

    store.newTab();
    expect(useStudioStore.getState().tabs.length).toBe(initialCount + 1);
    const createdId = useStudioStore.getState().activeTabId;

    useStudioStore.getState().closeTab(createdId);
    expect(useStudioStore.getState().tabs.length).toBe(initialCount);
  });

  it("records undo and redo history per tab", () => {
    const store = useStudioStore.getState();
    const originalFabric = store.activeTab().document.fabric;

    store.setFabric("towelFleece");
    expect(useStudioStore.getState().activeTab().document.fabric).toBe("towelFleece");

    useStudioStore.getState().undo();
    expect(useStudioStore.getState().activeTab().document.fabric).toBe(originalFabric);

    useStudioStore.getState().redo();
    expect(useStudioStore.getState().activeTab().document.fabric).toBe("towelFleece");
  });
});
