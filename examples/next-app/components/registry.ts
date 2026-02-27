import { createRegistry } from "@kibadist/agentui-react";
import { TextBlock } from "./text-block";
import { InfoCard } from "./info-card";
import { ActionCard } from "./action-card";
import { DataTable } from "./data-table";
import { StatusBadge } from "./status-badge";

export const registry = createRegistry({
  "text-block": { component: TextBlock },
  "info-card": { component: InfoCard },
  "action-card": { component: ActionCard },
  "data-table": { component: DataTable },
  "status-badge": { component: StatusBadge },
});
