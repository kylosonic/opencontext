"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./cx";

/**
 * Accessible tabs primitive (WAI-ARIA tabs pattern, automatic activation).
 *
 * Usage:
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabList label="Sections" accessory={<Badge>Demo</Badge>}>
 *       <Tab id="a">Transcript</Tab>
 *       <Tab id="b">OCR</Tab>
 *     </TabList>
 *     <TabPanel id="a">…</TabPanel>
 *     <TabPanel id="b">…</TabPanel>
 *   </Tabs>
 *
 * Panels stay mounted (hidden) so per-tab state is preserved.
 */

interface TabsContextValue {
  value: string;
  setValue: (id: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tab components must be rendered inside <Tabs>");
  }
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (id: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const setValue = useCallback(
    (id: string) => onValueChange(id),
    [onValueChange],
  );
  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /** Accessible name for the tab list (e.g. "Result sections"). */
  label: string;
  children: ReactNode;
  /** Optional right-side accessory, always visible (e.g. a demo badge). */
  accessory?: ReactNode;
  className?: string;
}

export function TabList({ label, children, accessory, className }: TabListProps) {
  const { value, setValue } = useTabsContext();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;

    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    target.focus();
    // Automatic activation: focus moves selection with it.
    const id = target.getAttribute("data-tab-id");
    if (id) setValue(id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cx(
        "flex flex-wrap items-center gap-1 border-b border-line",
        className,
      )}
      data-active-tab={value}
    >
      {children}
      {accessory && <div className="ml-auto pb-2 pr-1">{accessory}</div>}
    </div>
  );
}

export interface TabProps {
  id: string;
  children: ReactNode;
}

export function Tab({ id, children }: TabProps) {
  const { value, setValue, baseId } = useTabsContext();
  const active = value === id;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${id}`}
      tabIndex={active ? 0 : -1}
      data-tab-id={id}
      onClick={() => setValue(id)}
      className={cx(
        "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-accent text-ink"
          : "border-transparent text-ink-muted hover:text-ink hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ id, children, className }: TabPanelProps) {
  const { value, baseId } = useTabsContext();
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={value !== id}
      className={cx("pt-5", className)}
    >
      {children}
    </div>
  );
}
