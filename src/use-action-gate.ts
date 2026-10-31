import { useRef } from "react";
import { ActionGate } from "./action-gate";
export function useActionGate(interval = 300) {
  const gate = useRef<ActionGate | null>(null);
  if (!gate.current) gate.current = new ActionGate(interval);
  return gate.current;
}
