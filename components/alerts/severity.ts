import type { Severity } from "../../lib/alerts";
import { C } from "../ui/theme";
import { tx } from "../../lib/i18n";

export const SEVERITY_STYLE: Record<Severity, { label: string; color: string; tint: string }> = {
  critical: { label: tx("Critical"), color: C.high, tint: C.highTint },
  warning: { label: tx("Warning"), color: "#E07A1F", tint: C.moderateTint },
  advisory: { label: tx("Advisory"), color: "#C99A06", tint: "#FFF8DD" },
  info: { label: tx("Info"), color: C.info, tint: C.infoTint },
  ok: { label: tx("All clear"), color: C.low, tint: C.lowTint },
};
