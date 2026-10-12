import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Where a setup step's main button goes: the onboarding wizard's footer, or nowhere special (null). */
export const StepActionTarget = createContext<HTMLElement | null>(null);

/**
 * A setup step's main button ("Save and continue", "Add classes", …). Inside the onboarding wizard it is drawn in
 * the wizard's footer, beside "Skip for now"; everywhere else it stays where the step put it.
 */
export function StepAction({ children }: { children: ReactNode }) {
  const target = useContext(StepActionTarget);
  return target ? createPortal(children, target) : <>{children}</>;
}
